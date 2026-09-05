import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the app store
vi.mock('../stores/appStore', () => ({
  useAppStore: {
    getState: vi.fn(() => ({
      nodes: [
        { id: 'node1', vram: 8192, vramUsed: 0, uptime: 3600, latency: 10, capabilities: ['webgpu'], role: 'worker', status: 'online' },
        { id: 'node2', vram: 4096, vramUsed: 1000, uptime: 1800, latency: 50, capabilities: [], role: 'worker', status: 'online' },
      ],
      masterId: null,
      setMasterId: vi.fn(),
      updateNode: vi.fn(),
      addEvent: vi.fn(),
    })),
  },
}));

// Simple leader election scoring test
describe('Leader Election', () => {
  const calculateScore = (node: any): number => {
    let score = 0;
    score += Math.min(40, (node.vram / 8192) * 40);
    const vramFree = (node.vram - node.vramUsed) / node.vram;
    score += vramFree * 20;
    score += Math.min(20, (node.uptime / 3600) * 20);
    score += Math.max(0, 10 - (node.latency / 100) * 10);
    if (node.capabilities.includes('webgpu')) score += 10;
    return Math.round(score * 100) / 100;
  };

  it('should calculate higher score for more VRAM', () => {
    const node1 = { vram: 8192, vramUsed: 0, uptime: 3600, latency: 10, capabilities: ['webgpu'] };
    const node2 = { vram: 4096, vramUsed: 0, uptime: 3600, latency: 10, capabilities: ['webgpu'] };
    
    const score1 = calculateScore(node1);
    const score2 = calculateScore(node2);
    
    expect(score1).toBeGreaterThan(score2);
  });

  it('should calculate higher score for lower latency', () => {
    const node1 = { vram: 4096, vramUsed: 0, uptime: 3600, latency: 10, capabilities: [] };
    const node2 = { vram: 4096, vramUsed: 0, uptime: 3600, latency: 100, capabilities: [] };
    
    const score1 = calculateScore(node1);
    const score2 = calculateScore(node2);
    
    expect(score1).toBeGreaterThan(score2);
  });

  it('should give bonus for WebGPU capability', () => {
    const node1 = { vram: 4096, vramUsed: 0, uptime: 3600, latency: 10, capabilities: ['webgpu'] };
    const node2 = { vram: 4096, vramUsed: 0, uptime: 3600, latency: 10, capabilities: [] };
    
    const score1 = calculateScore(node1);
    const score2 = calculateScore(node2);
    
    expect(score1).toBe(score2 + 10);
  });

  it('should give bonus for more uptime', () => {
    const node1 = { vram: 4096, vramUsed: 0, uptime: 7200, latency: 10, capabilities: [] };
    const node2 = { vram: 4096, vramUsed: 0, uptime: 1800, latency: 10, capabilities: [] };
    
    const score1 = calculateScore(node1);
    const score2 = calculateScore(node2);
    
    expect(score1).toBeGreaterThan(score2);
  });

  it('should prefer node with more available VRAM', () => {
    const node1 = { vram: 4096, vramUsed: 3500, uptime: 3600, latency: 10, capabilities: [] };
    const node2 = { vram: 4096, vramUsed: 500, uptime: 3600, latency: 10, capabilities: [] };
    
    const score1 = calculateScore(node1);
    const score2 = calculateScore(node2);
    
    expect(score2).toBeGreaterThan(score1);
  });
});

describe('Task Distribution', () => {
  const selectBestNode = (nodes: any[], task: any): any => {
    const available = nodes.filter(n => n.status === 'online' && !n.currentTask);
    
    if (available.length === 0) return null;
    
    return available.sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;
      
      scoreA += (a.vram - a.vramUsed) / a.vram;
      scoreB += (b.vram - b.vramUsed) / b.vram;
      
      scoreA += Math.max(0, 1 - a.latency / 500);
      scoreB += Math.max(0, 1 - b.latency / 500);
      
      if (task.type === 'inference' || task.type === 'code-gen') {
        if (a.capabilities.includes('webgpu')) scoreA += 1.5;
        if (b.capabilities.includes('webgpu')) scoreB += 1.5;
      }
      
      return scoreB - scoreA;
    })[0];
  };

  it('should select node with more free VRAM', () => {
    const nodes = [
      { id: 'node1', vram: 8192, vramUsed: 7000, status: 'online', currentTask: null, latency: 10, capabilities: [] },
      { id: 'node2', vram: 4096, vramUsed: 500, status: 'online', currentTask: null, latency: 10, capabilities: [] },
    ];
    const task = { type: 'code-gen' };
    
    const selected = selectBestNode(nodes, task);
    
    expect(selected?.id).toBe('node2');
  });

  it('should prefer WebGPU nodes for inference tasks', () => {
    const nodes = [
      { id: 'node1', vram: 4096, vramUsed: 0, status: 'online', currentTask: null, latency: 10, capabilities: [] },
      { id: 'node2', vram: 4096, vramUsed: 0, status: 'online', currentTask: null, latency: 10, capabilities: ['webgpu'] },
    ];
    const task = { type: 'inference' };
    
    const selected = selectBestNode(nodes, task);
    
    expect(selected?.id).toBe('node2');
  });

  it('should return null if no available nodes', () => {
    const nodes = [
      { id: 'node1', vram: 4096, vramUsed: 0, status: 'online', currentTask: 'Task 1', latency: 10, capabilities: [] },
    ];
    const task = { type: 'code-gen' };
    
    const selected = selectBestNode(nodes, task);
    
    expect(selected).toBeNull();
  });
});

describe('Context Chunking', () => {
  const chunkFile = (content: string, linesPerChunk: number = 200): string[] => {
    const lines = content.split('\n');
    const chunks: string[] = [];
    
    for (let i = 0; i < lines.length; i += linesPerChunk) {
      chunks.push(lines.slice(i, i + linesPerChunk).join('\n'));
    }
    
    return chunks;
  };

  const estimateTokens = (text: string): number => {
    return Math.ceil(text.length / 4);
  };

  it('should chunk file into correct number of chunks', () => {
    const content = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join('\n');
    const chunks = chunkFile(content, 200);
    
    expect(chunks).toHaveLength(3);
  });

  it('should estimate tokens correctly', () => {
    const text = 'This is a test string.';
    const tokens = estimateTokens(text);
    
    expect(tokens).toBe(6);
  });

  it('should handle empty content', () => {
    const chunks = chunkFile('', 200);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('');
  });

  it('should handle content smaller than chunk size', () => {
    const content = 'line 1\nline 2\nline 3';
    const chunks = chunkFile(content, 200);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(content);
  });
});

describe('Helpers', () => {
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatUptime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'online':
      case 'completed':
      case 'ready':
        return 'var(--accent-success)';
      case 'busy':
      case 'running':
      case 'assigned':
        return 'var(--accent-primary)';
      case 'warning':
      case 'waiting':
      case 'queued':
      case 'reassigned':
        return 'var(--accent-warning)';
      case 'offline':
      case 'failed':
      case 'error':
        return 'var(--accent-danger)';
      default:
        return 'var(--text-muted)';
    }
  };

  it('should format bytes correctly', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1048576)).toBe('1 MB');
  });

  it('should format uptime correctly', () => {
    expect(formatUptime(30)).toBe('30s');
    expect(formatUptime(120)).toBe('2m');
    expect(formatUptime(3660)).toBe('1h 1m');
  });

  it('should return correct status colors', () => {
    expect(getStatusColor('online')).toBe('var(--accent-success)');
    expect(getStatusColor('running')).toBe('var(--accent-primary)');
    expect(getStatusColor('warning')).toBe('var(--accent-warning)');
    expect(getStatusColor('offline')).toBe('var(--accent-danger)');
  });
});
