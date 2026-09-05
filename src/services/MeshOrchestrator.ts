// ============================================
// MeshOrchestrator — Service Coordinator
// ============================================
// Single entry point that initializes and coordinates
// all backend services (P2P, Election, Tasks, Recovery,
// Context, Inference).

import { P2PManager } from './P2PManager';
import { LeaderElection } from './LeaderElection';
import { TaskDistributor } from './TaskDistributor';
import { RecoveryManager } from './RecoveryManager';
import { ContextManager } from './ContextManager';
import { InferenceEngine } from './InferenceEngine';
import { DebugManager } from './DebugManager';
import { ProjectOrchestrator } from './ProjectOrchestrator';
import { getLiveFileDebugger } from './LiveFileDebugger';
import { useAppStore } from '../stores/appStore';

export class MeshOrchestrator {
  p2p: P2PManager;
  election: LeaderElection;
  tasks: TaskDistributor;
  recovery: RecoveryManager;
  context: ContextManager;
  inference: InferenceEngine;
  debug: DebugManager;
  project: ProjectOrchestrator;
  private initialized = false;
  private modelLoadAttempted = false;

  constructor(signalingUrl?: string) {
    this.p2p = new P2PManager(signalingUrl);
    this.election = new LeaderElection(this.p2p);
    this.tasks = new TaskDistributor(this.p2p);
    this.recovery = new RecoveryManager(this.p2p, this.tasks);
    this.context = new ContextManager(this.p2p);
    this.inference = new InferenceEngine(this.p2p);
    this.debug = new DebugManager(this.p2p);
    this.project = new ProjectOrchestrator(this.p2p, this.tasks);

    // Wire ContextManager to task executors so they can chunk large files
    this.tasks.setContextManager(this.context);
    this.debug.setContextManager(this.context);

    // Wire LiveFileDebugger
    const lfd = getLiveFileDebugger();
    lfd.setContextManager(this.context);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 1. Recover previous state if available
    await this.recovery.recover();
    await this.project.recoverSession();

    // 2. Connect to signaling server / discover peers
    await this.p2p.connect();

    // 3. Start auto-saving state
    this.recovery.startAutoSave();

    // 4. Trigger leader election after a short delay (allow peers to connect)
    setTimeout(() => {
      this.election.startElection();
    }, 3000);

    // 5. Auto-load model if WebGPU is available and no model loaded yet
    await this.autoLoadModel();

    this.initialized = true;
  }

  /**
   * Wire the inference engine to all consumers (tasks, debug).
   * Called after any successful model load — manual or auto.
   */
  wireInferenceEngine(): void {
    this.tasks.setInferenceEngine(this.inference);
    this.debug.setInferenceEngine(this.inference);
    this.project.setInferenceEngine(this.inference);
    getLiveFileDebugger().setInferenceEngine(this.inference);
  }

  private async autoLoadModel(): Promise<void> {
    if (this.modelLoadAttempted) return;
    this.modelLoadAttempted = true;

    const store = useAppStore.getState();
    if (store.modelLoaded || store.modelLoading) return;

    // Check WebGPU support first
    if (!this.inference.checkWebGPUSupport()) {
      store.addEvent({
        id: `event-${Date.now()}`,
        type: 'warning',
        message: 'WebGPU not available - model auto-load skipped',
        timestamp: Date.now(),
      });
      return;
    }

    // Only auto-load if the model is already cached in the browser.
    // First-time downloads require internet and should be user-initiated
    // via the Settings panel to avoid silent failures on startup.
    const modelId = store.selectedModelId;
    if (!modelId) return;

    const isCached = await this.isModelCached(modelId);
    if (!isCached) {
      store.addEvent({
        id: `event-${Date.now()}`,
        type: 'info',
        message: `Model ${modelId} not cached yet. Load it from Settings (requires internet for first download).`,
        timestamp: Date.now(),
      });
      return;
    }

    store.addEvent({
      id: `event-${Date.now()}`,
      type: 'info',
      message: `Auto-loading cached model: ${modelId}`,
      timestamp: Date.now(),
    });

    const success = await this.inference.loadModel(modelId);
    if (success) {
      this.wireInferenceEngine();
    }
  }

  /**
   * Check if a model's weights are already cached.
   * With useIndexedDBCache=true, WebLLM stores artifacts in IndexedDB
   * under the 'tvmjs' database. We also check Cache API as a fallback
   * in case the model was cached before the IndexedDB switch.
   */
  private async isModelCached(_modelId: string): Promise<boolean> {
    try {
      // Check IndexedDB (current cache backend)
      const dbs = await indexedDB.databases();
      const hasIDB = dbs.some(db =>
        db.name?.includes('tvmjs') || db.name?.includes('webllm')
      );
      if (hasIDB) return true;

      // Check Cache API (legacy fallback)
      const cacheNames = await caches.keys();
      return cacheNames.some(name =>
        name.includes('tvmjs') || name.includes('webllm')
      );
    } catch {
      // APIs not available — allow the load attempt
      return true;
    }
  }

  destroy(): void {
    this.inference.destroy();
    this.recovery.destroy();
    this.tasks.destroy();
    this.project.destroy();
    this.p2p.destroy();
    this.initialized = false;
  }
}

// Singleton instance
let orchestrator: MeshOrchestrator | null = null;

export function getMeshOrchestrator(signalingUrl?: string): MeshOrchestrator {
  if (!orchestrator) {
    orchestrator = new MeshOrchestrator(signalingUrl);
  }
  return orchestrator;
}

export function destroyMeshOrchestrator(): void {
  if (orchestrator) {
    orchestrator.destroy();
    orchestrator = null;
  }
}
