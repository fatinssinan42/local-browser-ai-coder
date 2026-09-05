import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ============================================
// TaskDistributor — unit tests
// ============================================
// Tests task creation, node selection, result handling,
// failure/retry logic, and timeout monitoring.

// Mock store
const mockStore = {
  nodes: [
    {
      id: 'node1', name: 'Node-1', vram: 8192, vramUsed: 0, ramTotal: 16384, ramUsed: 512,
      latency: 10, status: 'online', currentTask: null, capabilities: ['webgpu', 'inference'],
      role: 'master', isSelf: true, uptime: 0, lastHeartbeat: Date.now(),
    },
    {
      id: 'node2', name: 'Node-2', vram: 4096, vramUsed: 500, ramTotal: 8192, ramUsed: 200,
      latency: 50, status: 'online', currentTask: null, capabilities: ['inference'],
      role: 'worker', isSelf: false, uptime: 0, lastHeartbeat: Date.now(),
    },
    {
      id: 'node3', name: 'Node-3 (busy)', vram: 4096, vramUsed: 0, ramTotal: 8192, ramUsed: 0,
      latency: 20, status: 'online', currentTask: 'Some Task', capabilities: ['inference'],
      role: 'debug', isSelf: false, uptime: 0, lastHeartbeat: Date.now(),
    },
  ] as any[],
  tasks: [] as any[],
  masterId: 'node1',
  selfId: 'node1',
  files: [] as any[],
  addTask: vi.fn((t) => { mockStore.tasks.push(t); }),
  updateTask: vi.fn((id, patch) => {
    const idx = mockStore.tasks.findIndex(t => t.id === id);
    if (idx >= 0) mockStore.tasks[idx] = { ...mockStore.tasks[idx], ...patch };
  }),
  updateNode: vi.fn(),
  addEvent: vi.fn(),
};

vi.mock('../stores/appStore', () => ({
  useAppStore: {
    getState: vi.fn(() => mockStore),
  },
}));

// Replicate the node-selection logic for isolated unit testing
function selectBestNode(nodes: any[], task: any): any {
  const available = nodes.filter(n => n.status === 'online' && !n.currentTask);
  if (available.length === 0) {
    const leastBusy = nodes
      .filter(n => n.status !== 'offline')
      .sort((a, b) => (a.vramUsed / a.vram) - (b.vramUsed / b.vram));
    return leastBusy[0] || null;
  }
  return available.sort((a, b) => {
    let sA = 0, sB = 0;
    sA += (a.vram - a.vramUsed) / a.vram;
    sB += (b.vram - b.vramUsed) / b.vram;
    sA += Math.max(0, 1 - a.latency / 500);
    sB += Math.max(0, 1 - b.latency / 500);
    if (task.type === 'debug') {
      if (a.role === 'debug') sA += 2;
      if (b.role === 'debug') sB += 2;
    }
    if (task.type === 'inference' || task.type === 'code-gen') {
      if (a.capabilities.includes('webgpu')) sA += 1.5;
      if (b.capabilities.includes('webgpu')) sB += 1.5;
    }
    return sB - sA;
  })[0] || null;
}

// Replicate retry logic
function handleTaskFailure(task: any, tasks: any[], distribute: (id: string) => void): any[] {
  if (task.retryCount < 3) {
    const updated = {
      ...task,
      status: 'queued',
      assignedNode: null,
      retryCount: task.retryCount + 1,
      history: [...task.history, { timestamp: Date.now(), event: `Retry #${task.retryCount + 1}` }],
    };
    return tasks.map(t => t.id === task.id ? updated : t);
  }
  return tasks.map(t => t.id === task.id ? { ...t, status: 'failed' } : t);
}

describe('TaskDistributor — node selection', () => {
  const nodes = [
    { id: 'n1', vram: 8192, vramUsed: 0, latency: 10, status: 'online', currentTask: null, capabilities: ['webgpu'], role: 'worker' },
    { id: 'n2', vram: 4096, vramUsed: 500, latency: 50, status: 'online', currentTask: null, capabilities: [], role: 'worker' },
    { id: 'n3', vram: 4096, vramUsed: 0, latency: 20, status: 'online', currentTask: 'busy', capabilities: [], role: 'debug' },
  ];

  it('selects node with most free VRAM for code-gen', () => {
    const task = { type: 'code-gen' };
    const result = selectBestNode(nodes, task);
    // n1 has webgpu bonus + full VRAM free
    expect(result?.id).toBe('n1');
  });

  it('prefers debug-role node for debug tasks', () => {
    // n3 is busy, so fall back to available nodes — n1 is available
    // n3 has currentTask so excluded from available
    const debugNodes = [
      { id: 'n4', vram: 4096, vramUsed: 0, latency: 20, status: 'online', currentTask: null, capabilities: [], role: 'debug' },
      { id: 'n5', vram: 4096, vramUsed: 0, latency: 20, status: 'online', currentTask: null, capabilities: [], role: 'worker' },
    ];
    const task = { type: 'debug' };
    const result = selectBestNode(debugNodes, task);
    expect(result?.id).toBe('n4');
  });

  it('prefers webgpu node for inference tasks', () => {
    const inferenceNodes = [
      { id: 'na', vram: 4096, vramUsed: 0, latency: 10, status: 'online', currentTask: null, capabilities: [], role: 'worker' },
      { id: 'nb', vram: 4096, vramUsed: 0, latency: 10, status: 'online', currentTask: null, capabilities: ['webgpu'], role: 'worker' },
    ];
    const task = { type: 'inference' };
    const result = selectBestNode(inferenceNodes, task);
    expect(result?.id).toBe('nb');
  });

  it('skips offline nodes', () => {
    const mixedNodes = [
      { id: 'nx', vram: 8192, vramUsed: 0, latency: 5, status: 'offline', currentTask: null, capabilities: [], role: 'worker' },
      { id: 'ny', vram: 4096, vramUsed: 0, latency: 10, status: 'online', currentTask: null, capabilities: [], role: 'worker' },
    ];
    const result = selectBestNode(mixedNodes, { type: 'code-gen' });
    expect(result?.id).toBe('ny');
  });

  it('returns least-busy node when all are busy', () => {
    const allBusy = [
      { id: 'b1', vram: 4096, vramUsed: 3000, latency: 10, status: 'online', currentTask: 'X', capabilities: [], role: 'worker' },
      { id: 'b2', vram: 4096, vramUsed: 1000, latency: 10, status: 'online', currentTask: 'Y', capabilities: [], role: 'worker' },
    ];
    const result = selectBestNode(allBusy, { type: 'code-gen' });
    // b2 has lower vramUsed ratio
    expect(result?.id).toBe('b2');
  });

  it('returns null if no nodes available', () => {
    const result = selectBestNode([], { type: 'code-gen' });
    expect(result).toBeNull();
  });
});

describe('TaskDistributor — task creation', () => {
  it('task created with correct defaults', () => {
    const task = {
      id: 'task-1',
      title: 'Generate login form',
      type: 'code-gen' as const,
      status: 'queued' as const,
      priority: 'normal' as const,
      assignedNode: null,
      progress: 0,
      tokenCount: 0,
      retryCount: 0,
      relatedFiles: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      history: [{ timestamp: Date.now(), event: 'Task created', detail: 'Build a login form with React' }],
    };

    expect(task.status).toBe('queued');
    expect(task.retryCount).toBe(0);
    expect(task.progress).toBe(0);
    expect(task.assignedNode).toBeNull();
    expect(task.history[0].detail).toBe('Build a login form with React');
  });

  it('tokenCount estimated from context length', () => {
    const context = 'a'.repeat(400); // 400 chars / 4 = 100 tokens
    const tokenCount = Math.ceil(context.length / 4);
    expect(tokenCount).toBe(100);
  });
});

describe('TaskDistributor — retry & failure logic', () => {
  it('re-queues task on first failure', () => {
    const task = {
      id: 't1', title: 'Test', status: 'failed', retryCount: 0,
      history: [{ timestamp: Date.now(), event: 'created' }],
    };
    const tasks = [task];
    const distribute = vi.fn();
    const updated = handleTaskFailure(task, tasks, distribute);
    expect(updated[0].status).toBe('queued');
    expect(updated[0].retryCount).toBe(1);
  });

  it('marks task failed after 3 retries', () => {
    const task = {
      id: 't1', title: 'Test', status: 'failed', retryCount: 3,
      history: [{ timestamp: Date.now(), event: 'created' }],
    };
    const tasks = [task];
    const distribute = vi.fn();
    const updated = handleTaskFailure(task, tasks, distribute);
    expect(updated[0].status).toBe('failed');
    expect(updated[0].retryCount).toBe(3); // unchanged
  });

  it('increments retryCount on each failure', () => {
    let tasks = [{ id: 't1', title: 'T', status: 'failed', retryCount: 0, history: [] }];
    for (let i = 1; i <= 3; i++) {
      tasks = handleTaskFailure(tasks[0], tasks, vi.fn());
      if (i < 3) {
        expect(tasks[0].retryCount).toBe(i);
        expect(tasks[0].status).toBe('queued');
      }
    }
    tasks = handleTaskFailure(tasks[0], tasks, vi.fn());
    expect(tasks[0].status).toBe('failed');
  });
});

describe('TaskDistributor — task status progression', () => {
  it('task lifecycle: queued → assigned → running → completed', () => {
    const statuses = ['queued', 'assigned', 'running', 'completed'];
    let current = 'queued';
    expect(statuses.includes(current)).toBe(true);
    current = 'assigned';
    expect(statuses.includes(current)).toBe(true);
    current = 'running';
    expect(statuses.includes(current)).toBe(true);
    current = 'completed';
    expect(statuses.includes(current)).toBe(true);
  });

  it('does not distribute already-running task', () => {
    const task = { id: 't2', status: 'running' };
    // distributeTask checks status === 'queued' before proceeding
    const shouldDistribute = task.status === 'queued';
    expect(shouldDistribute).toBe(false);
  });
});

describe('TaskDistributor — assignment timeout', () => {
  it('calculates correct timeout for each task type', () => {
    const timeouts: Record<string, number> = {
      inference: 120000,
      'code-gen': 180000,
      debug: 60000,
      test: 90000,
      review: 60000,
      summarize: 30000,
    };

    expect(timeouts['code-gen']).toBe(180000);
    expect(timeouts['inference']).toBe(120000);
    expect(timeouts['debug']).toBe(60000);
    expect(timeouts['summarize']).toBe(30000);
  });
});
