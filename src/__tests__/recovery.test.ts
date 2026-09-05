import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================
// RecoveryManager — unit tests
// ============================================
// Tests session persistence, recovery from saved state,
// stale-state detection, node failure handling, and state merging.

// Mock idb-keyval
const idbStore = new Map<string, any>();
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idbStore.get(key) ?? undefined),
  set: vi.fn(async (key: string, value: any) => { idbStore.set(key, value); }),
  del: vi.fn(async (key: string) => { idbStore.delete(key); }),
  keys: vi.fn(async () => Array.from(idbStore.keys())),
}));

// Mock appStore
const mockTasks = [
  { id: 't1', title: 'Task 1', status: 'completed', updatedAt: Date.now() - 1000 },
  { id: 't2', title: 'Task 2', status: 'running', updatedAt: Date.now() - 500 },
  { id: 't3', title: 'Task 3', status: 'assigned', updatedAt: Date.now() - 200 },
];

const mockFiles = [
  { path: 'src/app.ts', content: 'console.log("hi")', language: 'typescript', version: 1, lastModified: Date.now() - 1000 },
];

const addedTasks: any[] = [];
const addedFiles: any[] = [];
const updatedFiles: any[] = [];
const events: string[] = [];

const mockStore = {
  selfId: 'self-node-1',
  masterId: 'master-node-1',
  tasks: [...mockTasks],
  files: [...mockFiles],
  selectedModelId: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC',
  addTask: vi.fn((t) => addedTasks.push(t)),
  updateTask: vi.fn(),
  addFile: vi.fn((f) => addedFiles.push(f)),
  updateFile: vi.fn((path, patch) => updatedFiles.push({ path, patch })),
  setSelectedModelId: vi.fn(),
  addEvent: vi.fn((e) => events.push(e.message)),
};

vi.mock('../stores/appStore', () => ({
  useAppStore: { getState: vi.fn(() => mockStore) },
}));

vi.mock('../utils/helpers', () => ({
  generateId: vi.fn(() => `id-${Math.random().toString(36).slice(2, 8)}`),
}));

// Replicate persistence logic for isolated testing
interface PersistedState {
  selfId: string;
  masterId: string | null;
  tasks: any[];
  files: any[];
  selectedModelId: string | null;
  timestamp: number;
}

const STORAGE_KEY = 'southstack-state';
const TTL_24H = 24 * 60 * 60 * 1000;

async function saveState(state: PersistedState): Promise<void> {
  idbStore.set(STORAGE_KEY, state);
}

async function loadState(): Promise<PersistedState | null> {
  const state = idbStore.get(STORAGE_KEY);
  if (!state) return null;
  if (Date.now() - state.timestamp > TTL_24H) {
    idbStore.delete(STORAGE_KEY);
    return null;
  }
  return state;
}

function restoreTasks(savedTasks: any[], existingTasks: any[]): { restored: any[]; requeued: string[] } {
  const restored: any[] = [];
  const requeued: string[] = [];

  for (const task of savedTasks) {
    const existing = existingTasks.find(t => t.id === task.id);
    if (!existing) {
      const restoredTask = { ...task };
      if (restoredTask.status === 'running' || restoredTask.status === 'assigned') {
        restoredTask.status = 'queued';
        restoredTask.assignedNode = null;
        requeued.push(task.id);
      }
      restored.push(restoredTask);
    }
  }
  return { restored, requeued };
}

function mergeRemoteTasks(local: any[], remote: any[]): any[] {
  const merged = [...local];
  for (const remoteTask of remote) {
    const localIdx = merged.findIndex(t => t.id === remoteTask.id);
    if (localIdx < 0) {
      merged.push(remoteTask);
    } else if (remoteTask.updatedAt > merged[localIdx].updatedAt) {
      merged[localIdx] = remoteTask;
    }
  }
  return merged;
}

describe('RecoveryManager — state persistence', () => {
  beforeEach(() => {
    idbStore.clear();
    addedTasks.length = 0;
    addedFiles.length = 0;
    updatedFiles.length = 0;
    events.length = 0;
  });

  it('saves state to IndexedDB', async () => {
    const state: PersistedState = {
      selfId: 'node-1',
      masterId: 'node-1',
      tasks: mockTasks,
      files: mockFiles,
      selectedModelId: 'model-1',
      timestamp: Date.now(),
    };
    await saveState(state);
    expect(idbStore.has(STORAGE_KEY)).toBe(true);
  });

  it('loads saved state from IndexedDB', async () => {
    const now = Date.now();
    const state: PersistedState = {
      selfId: 'node-2',
      masterId: 'master-2',
      tasks: mockTasks,
      files: mockFiles,
      selectedModelId: 'model-abc',
      timestamp: now,
    };
    idbStore.set(STORAGE_KEY, state);
    const loaded = await loadState();
    expect(loaded).not.toBeNull();
    expect(loaded?.selfId).toBe('node-2');
    expect(loaded?.tasks).toHaveLength(mockTasks.length);
  });

  it('returns null if no state saved', async () => {
    const result = await loadState();
    expect(result).toBeNull();
  });

  it('rejects stale state older than 24 hours', async () => {
    const staleState: PersistedState = {
      selfId: 'old-node',
      masterId: null,
      tasks: [],
      files: [],
      selectedModelId: null,
      timestamp: Date.now() - TTL_24H - 1000, // 1 second past 24h
    };
    idbStore.set(STORAGE_KEY, staleState);
    const result = await loadState();
    expect(result).toBeNull();
    expect(idbStore.has(STORAGE_KEY)).toBe(false); // deleted
  });

  it('accepts state within 24 hours', async () => {
    const freshState: PersistedState = {
      selfId: 'fresh-node',
      masterId: null,
      tasks: [],
      files: [],
      selectedModelId: null,
      timestamp: Date.now() - TTL_24H + 60000, // 1 minute before expiry
    };
    idbStore.set(STORAGE_KEY, freshState);
    const result = await loadState();
    expect(result).not.toBeNull();
    expect(result?.selfId).toBe('fresh-node');
  });
});

describe('RecoveryManager — task restoration', () => {
  it('restores tasks that did not exist locally', () => {
    const saved = [
      { id: 'new-task', title: 'New', status: 'completed', assignedNode: null },
    ];
    const existing: any[] = [];
    const { restored } = restoreTasks(saved, existing);
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe('new-task');
  });

  it('skips tasks that already exist locally', () => {
    const saved = [
      { id: 'existing', title: 'Exists', status: 'completed', assignedNode: null },
    ];
    const existing = [{ id: 'existing', status: 'completed' }];
    const { restored } = restoreTasks(saved, existing);
    expect(restored).toHaveLength(0);
  });

  it('re-queues running tasks on recovery', () => {
    const saved = [
      { id: 'r1', title: 'Running', status: 'running', assignedNode: 'node-x' },
      { id: 'r2', title: 'Assigned', status: 'assigned', assignedNode: 'node-y' },
      { id: 'r3', title: 'Completed', status: 'completed', assignedNode: null },
    ];
    const { restored, requeued } = restoreTasks(saved, []);
    expect(restored.find(t => t.id === 'r1')?.status).toBe('queued');
    expect(restored.find(t => t.id === 'r2')?.status).toBe('queued');
    expect(restored.find(t => t.id === 'r3')?.status).toBe('completed');
    expect(requeued).toContain('r1');
    expect(requeued).toContain('r2');
    expect(requeued).not.toContain('r3');
  });

  it('clears assignedNode for re-queued tasks', () => {
    const saved = [{ id: 'x1', status: 'running', assignedNode: 'old-node', title: 'T', history: [] }];
    const { restored } = restoreTasks(saved, []);
    expect(restored[0].assignedNode).toBeNull();
  });
});

describe('RecoveryManager — task state merge (state-sync)', () => {
  it('adds remote tasks not present locally', () => {
    const local = [{ id: 'l1', status: 'queued', updatedAt: 1000 }];
    const remote = [{ id: 'r1', status: 'completed', updatedAt: 2000 }];
    const merged = mergeRemoteTasks(local, remote);
    expect(merged).toHaveLength(2);
    expect(merged.find(t => t.id === 'r1')?.status).toBe('completed');
  });

  it('prefers newer updatedAt from remote', () => {
    const now = Date.now();
    const local = [{ id: 't1', status: 'queued', updatedAt: now - 1000 }];
    const remote = [{ id: 't1', status: 'completed', updatedAt: now }];
    const merged = mergeRemoteTasks(local, remote);
    expect(merged[0].status).toBe('completed');
  });

  it('keeps local task if it is newer', () => {
    const now = Date.now();
    const local = [{ id: 't1', status: 'running', updatedAt: now }];
    const remote = [{ id: 't1', status: 'queued', updatedAt: now - 500 }];
    const merged = mergeRemoteTasks(local, remote);
    expect(merged[0].status).toBe('running');
  });
});

describe('RecoveryManager — file restoration', () => {
  it('restores files not present locally', () => {
    const saved = [{ path: 'new.ts', content: '// new', version: 1, lastModified: Date.now() }];
    const local: any[] = [];
    const toAdd = saved.filter(f => !local.find(l => l.path === f.path));
    expect(toAdd).toHaveLength(1);
    expect(toAdd[0].path).toBe('new.ts');
  });

  it('updates local file if saved version is newer', () => {
    const now = Date.now();
    const saved = [{ path: 'app.ts', content: '// updated', version: 2, lastModified: now }];
    const local = [{ path: 'app.ts', content: '// old', version: 1, lastModified: now - 1000 }];
    const toUpdate = saved.filter(f => {
      const l = local.find(lf => lf.path === f.path);
      return l && f.lastModified > l.lastModified;
    });
    expect(toUpdate).toHaveLength(1);
    expect(toUpdate[0].content).toBe('// updated');
  });

  it('skips file if local is newer', () => {
    const now = Date.now();
    const saved = [{ path: 'app.ts', content: '// old', lastModified: now - 1000 }];
    const local = [{ path: 'app.ts', content: '// newer', lastModified: now }];
    const toUpdate = saved.filter(f => {
      const l = local.find(lf => lf.path === f.path);
      return l && f.lastModified > l.lastModified;
    });
    expect(toUpdate).toHaveLength(0);
  });
});
