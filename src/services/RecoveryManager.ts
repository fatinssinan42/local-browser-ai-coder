// ============================================
// RecoveryManager — Fault Tolerance & Persistence
// ============================================
// Uses IndexedDB (via idb-keyval) to persist critical state.
// Handles recovery from browser restarts and node failures.

import { get, set, del, keys } from 'idb-keyval';
import { useAppStore } from '../stores/appStore';
import { generateId } from '../utils/helpers';
import type { P2PManager } from './P2PManager';
import type { TaskDistributor } from './TaskDistributor';
import type { Task, VirtualFile, PeerNode } from '../types';
import { EventBus, MeshEvents } from './EventBus';

interface PersistedState {
  selfId: string;
  masterId: string | null;
  tasks: Task[];
  files: VirtualFile[];
  selectedModelId: string | null;
  timestamp: number;
}

const STORAGE_KEY = 'southstack-state';
const SAVE_INTERVAL = 10000; // Save every 10 seconds

export class RecoveryManager {
  private p2p: P2PManager;
  private taskDistributor: TaskDistributor;
  private saveInterval: ReturnType<typeof setInterval> | null = null;
  private recovering = false;
  // Prevent duplicate failure handling for the same node within 5 seconds
  private recentlyHandledFailures: Map<string, number> = new Map();

  constructor(p2p: P2PManager, taskDistributor: TaskDistributor) {
    this.p2p = p2p;
    this.taskDistributor = taskDistributor;
    this.setupListeners();
  }

  private setupListeners(): void {
    // Listen for peer disconnections via EventBus to trigger task reassignment
    EventBus.on(MeshEvents.PEER_DISCONNECTED, (disconnectedId: string) => {
      this.handleNodeFailure(disconnectedId);
    });

    // Listen for state-sync messages (recovery protocol)
    this.p2p.on('state-sync', (message) => {
      this.handleStateSync(message.payload, message.senderId);
    });

    // Listen for file content requests from peers
    this.p2p.on('file-sync', (message) => {
      if (message.payload?.action === 'request') {
        this.handleFileContentRequest(message.payload.path, message.senderId);
      } else if (message.payload?.action === 'response') {
        this.handleFileContentResponse(message.payload.file);
      }
    });

    // Auto-save on visibility change (user switching tabs / closing)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.saveState();
        }
      });

      window.addEventListener('beforeunload', () => {
        this.saveState();
      });
    }
  }

  // ------------------------------------------
  // Persistence
  // ------------------------------------------

  startAutoSave(): void {
    this.saveInterval = setInterval(() => {
      this.saveState();
    }, SAVE_INTERVAL);
  }

  async saveState(): Promise<void> {
    const store = useAppStore.getState();
    const state: PersistedState = {
      selfId: store.selfId,
      masterId: store.masterId,
      tasks: store.tasks,
      files: store.files,
      selectedModelId: store.selectedModelId,
      timestamp: Date.now(),
    };

    try {
      await set(STORAGE_KEY, state);
    } catch (err) {
      console.warn('Failed to save state to IndexedDB:', err);
    }
  }

  async loadState(): Promise<PersistedState | null> {
    try {
      const state = await get<PersistedState>(STORAGE_KEY);
      if (!state) return null;

      // Check if state is stale (older than 24 hours)
      if (Date.now() - state.timestamp > 24 * 60 * 60 * 1000) {
        await del(STORAGE_KEY);
        return null;
      }

      return state;
    } catch (err) {
      console.warn('Failed to load state from IndexedDB:', err);
      return null;
    }
  }

  async clearState(): Promise<void> {
    try {
      await del(STORAGE_KEY);
    } catch (err) {
      console.warn('Failed to clear persisted state:', err);
    }
  }

  // ------------------------------------------
  // Recovery
  // ------------------------------------------

  async recover(): Promise<boolean> {
    if (this.recovering) return false;
    this.recovering = true;

    try {
      const savedState = await this.loadState();
      if (!savedState) {
        this.recovering = false;
        return false;
      }

      const store = useAppStore.getState();
      this.addEvent('info', 'Recovering previous session state...');

      // Restore tasks (mark running tasks as queued for reassignment)
      for (const task of savedState.tasks) {
        const existing = store.tasks.find((t) => t.id === task.id);
        if (!existing) {
          const restoredTask = { ...task };
          if (restoredTask.status === 'running' || restoredTask.status === 'assigned') {
            restoredTask.status = 'queued';
            restoredTask.assignedNode = null;
            restoredTask.history = [
              ...restoredTask.history,
              { timestamp: Date.now(), event: 'Recovered from session — re-queued' },
            ];
          }
          store.addTask(restoredTask);
        }
      }

      // Restore files
      for (const file of savedState.files) {
        const existing = store.files.find((f) => f.path === file.path);
        if (!existing) {
          store.addFile(file);
        } else if (file.lastModified > existing.lastModified) {
          store.updateFile(file.path, file);
        }
      }

      // Restore model selection
      if (savedState.selectedModelId) {
        store.setSelectedModelId(savedState.selectedModelId);
      }

      this.addEvent('success', `Recovered ${savedState.tasks.length} tasks, ${savedState.files.length} files`);
      this.recovering = false;
      return true;
    } catch (err) {
      console.error('Recovery failed:', err);
      this.addEvent('error', 'Session recovery failed');
      this.recovering = false;
      return false;
    }
  }

  // ------------------------------------------
  // Node failure handling
  // ------------------------------------------

  private handleNodeFailure(nodeId: string): void {
    // Deduplicate: ignore if we already handled this node's failure recently
    const lastHandled = this.recentlyHandledFailures.get(nodeId) ?? 0;
    if (Date.now() - lastHandled < 5000) return;
    this.recentlyHandledFailures.set(nodeId, Date.now());

    const store = useAppStore.getState();
    const node = store.nodes.find((n) => n.id === nodeId);
    const name = node?.name || nodeId.slice(0, 8);

    this.addEvent('warning', `Handling failure of node: ${name}`);

    // Reassign tasks from failed node
    this.taskDistributor.reassignNodeTasks(nodeId);

    // Broadcast state sync to keep remaining nodes aligned
    this.broadcastStateSync();
  }

  // ------------------------------------------
  // State synchronization
  // ------------------------------------------

  broadcastStateSync(): void {
    const store = useAppStore.getState();
    this.p2p.broadcast({
      type: 'state-sync',
      payload: {
        tasks: store.tasks,
        files: store.files.map((f) => ({ path: f.path, version: f.version, lastModified: f.lastModified })),
        masterId: store.masterId,
      },
    });
  }

  private handleStateSync(payload: any, senderId: string): void {
    const store = useAppStore.getState();

    // Merge tasks — prefer newer updates
    if (payload.tasks) {
      for (const remoteTask of payload.tasks) {
        const local = store.tasks.find((t) => t.id === remoteTask.id);
        if (!local) {
          store.addTask(remoteTask);
        } else if (remoteTask.updatedAt > local.updatedAt) {
          store.updateTask(remoteTask.id, remoteTask);
        }
      }
    }

    // Merge file metadata — request full content for newer versions
    if (payload.files) {
      for (const remoteFile of payload.files) {
        const local = store.files.find((f) => f.path === remoteFile.path);
        if (!local || remoteFile.version > local.version) {
          this.p2p.send(senderId, {
            type: 'file-sync',
            payload: { action: 'request', path: remoteFile.path },
          });
          this.addEvent('info', `Requesting file content: ${remoteFile.path} (v${remoteFile.version})`);
        }
      }
    }
  }

  /**
   * Respond to a peer's request for file content.
   */
  private handleFileContentRequest(path: string, requesterId: string): void {
    const store = useAppStore.getState();
    const file = store.files.find((f) => f.path === path);
    if (!file) return;

    this.p2p.send(requesterId, {
      type: 'file-sync',
      payload: {
        action: 'response',
        file: {
          path: file.path,
          content: file.content,
          language: file.language,
          lastModified: file.lastModified,
          version: file.version,
        },
      },
    });
  }

  /**
   * Handle incoming file content from a peer (response to our request).
   */
  private handleFileContentResponse(file: VirtualFile): void {
    if (!file?.path || !file?.content) return;

    const store = useAppStore.getState();
    const local = store.files.find((f) => f.path === file.path);

    // Only apply if remote version is still newer (avoid race conditions)
    if (!local) {
      store.addFile(file);
      this.addEvent('success', `File synced from peer: ${file.path}`);
    } else if (file.version > local.version || file.lastModified > local.lastModified) {
      store.updateFile(file.path, file);
      this.addEvent('success', `File updated from peer: ${file.path} (v${file.version})`);
    }
  }

  // ------------------------------------------
  // Helpers
  // ------------------------------------------

  private addEvent(type: 'info' | 'success' | 'warning' | 'error' | 'mesh', message: string): void {
    useAppStore.getState().addEvent({
      id: generateId(),
      type,
      message,
      timestamp: Date.now(),
    });
  }

  destroy(): void {
    if (this.saveInterval) clearInterval(this.saveInterval);
    this.saveState(); // Final save
  }
}
