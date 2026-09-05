import { describe, it, expect } from 'vitest';
import {
  validateMessage,
  createMessage,
  isHeartbeatPayload,
  isStateSyncPayload,
  isTaskPayload,
  isResultPayload,
  MessageDeduplicator,
} from '../services/P2PProtocol';
import type { P2PMessage } from '../services/P2PProtocol';

describe('P2PProtocol - Message Contracts', () => {
  describe('Message Validation', () => {
    it('should reject messages without type', () => {
      const msg = { senderId: 'test', timestamp: Date.now(), payload: {} };
      const result = validateMessage(msg);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('type');
    });

    it('should reject messages without senderId', () => {
      const msg = { type: 'heartbeat', timestamp: Date.now(), payload: {} };
      const result = validateMessage(msg);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('senderId');
    });

    it('should reject messages without timestamp', () => {
      const msg = { type: 'heartbeat', senderId: 'test', payload: {} };
      const result = validateMessage(msg);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('timestamp');
    });

    it('should validate correct heartbeat message', () => {
      const msg = createMessage('heartbeat', 'node1', {
        vramUsed: 1024,
        ramUsed: 2048,
        status: 'online',
        uptime: 3600,
      });
      const result = validateMessage(msg);
      expect(result.valid).toBe(true);
    });

    it('should reject heartbeat with invalid payload', () => {
      const msg = createMessage('heartbeat', 'node1', {
        vramUsed: 'invalid', // Should be number
        ramUsed: 2048,
        status: 'online',
        uptime: 3600,
      });
      const result = validateMessage(msg);
      expect(result.valid).toBe(false);
    });

    it('should validate state-sync introduce message', () => {
      const msg = createMessage('state-sync', 'node1', {
        action: 'introduce',
        node: {
          id: 'node1',
          name: 'Test Node',
          role: 'worker',
          status: 'online',
          vram: 8192,
          vramUsed: 0,
          ramTotal: 16384,
          ramUsed: 2048,
          latency: 10,
          uptime: 3600,
          lastHeartbeat: Date.now(),
          currentTask: null,
          capabilities: ['inference'],
          isSelf: true,
        },
      });
      const result = validateMessage(msg);
      expect(result.valid).toBe(true);
    });

    it('should validate task assignment message', () => {
      const msg = createMessage('task', 'node1', {
        action: 'assign',
        taskId: 'task1',
        task: {
          id: 'task1',
          title: 'Test Task',
          type: 'inference',
          status: 'assigned',
          priority: 'normal',
          tokenCount: 100,
          relatedFiles: [],
          prompt: 'Hello, world!',
        },
      });
      const result = validateMessage(msg);
      expect(result.valid).toBe(true);
    });

    it('should validate result message', () => {
      const msg = createMessage('result', 'node1', {
        taskId: 'task1',
        status: 'completed',
        success: true,
        result: 'Task completed successfully',
        progress: 100,
        completedAt: Date.now(),
        processingTime: 1000,
      });
      const result = validateMessage(msg);
      expect(result.valid).toBe(true);
    });

    it('should reject unknown message type', () => {
      const msg = {
        type: 'unknown-type',
        senderId: 'node1',
        timestamp: Date.now(),
        payload: {},
      };
      const result = validateMessage(msg);
      expect(result.valid).toBe(false);
    });
  });

  describe('Message Creation', () => {
    it('should create heartbeat message with timestamp', () => {
      const beforeTime = Date.now();
      const msg = createMessage('heartbeat', 'node1', {
        vramUsed: 1024,
        ramUsed: 2048,
        status: 'online',
        uptime: 3600,
      });
      const afterTime = Date.now();

      expect(msg.type).toBe('heartbeat');
      expect(msg.senderId).toBe('node1');
      expect(msg.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(msg.timestamp).toBeLessThanOrEqual(afterTime);
      expect(msg.payload.vramUsed).toBe(1024);
    });

    it('should create message with sequence ID', () => {
      const msg = createMessage('task', 'node1', { action: 'assign' }, 'seq-123');
      expect(msg.sequenceId).toBe('seq-123');
    });
  });

  describe('Payload Type Guards', () => {
    it('should identify valid heartbeat payload', () => {
      const valid = {
        vramUsed: 1024,
        ramUsed: 2048,
        status: 'online',
        uptime: 3600,
      };
      expect(isHeartbeatPayload(valid)).toBe(true);
    });

    it('should reject invalid heartbeat payload', () => {
      const invalid = {
        vramUsed: 'not-a-number',
        ramUsed: 2048,
        status: 'online',
        uptime: 3600,
      };
      expect(isHeartbeatPayload(invalid)).toBe(false);
    });

    it('should identify valid state-sync payload', () => {
      const valid = {
        action: 'introduce',
        node: {
          id: 'node1',
          vram: 8192,
          // ... other fields
        },
      };
      expect(isStateSyncPayload(valid)).toBe(true);
    });

    it('should identify valid task payload', () => {
      const valid = {
        action: 'assign',
        taskId: 'task1',
      };
      expect(isTaskPayload(valid)).toBe(true);
    });
  });

  describe('Message Deduplication', () => {
    it('should not detect duplicate without sequence ID', () => {
      const dedup = new MessageDeduplicator();
      const msg = createMessage('heartbeat', 'node1', { /* ... */ });
      expect(dedup.isDuplicate(msg)).toBe(false);
      expect(dedup.isDuplicate(msg)).toBe(false);
    });

    it('should detect duplicate with same sequence ID', () => {
      const dedup = new MessageDeduplicator();
      const msg = createMessage('heartbeat', 'node1', { /* ... */ }, 'seq-1');
      expect(dedup.isDuplicate(msg)).toBe(false);
      expect(dedup.isDuplicate(msg)).toBe(true);
    });

    it('should not detect duplicate with different sender', () => {
      const dedup = new MessageDeduplicator();
      const msg1 = createMessage('heartbeat', 'node1', { /* ... */ }, 'seq-1');
      const msg2 = createMessage('heartbeat', 'node2', { /* ... */ }, 'seq-1');
      expect(dedup.isDuplicate(msg1)).toBe(false);
      expect(dedup.isDuplicate(msg2)).toBe(false);
    });

    it('should clear deduplication state', () => {
      const dedup = new MessageDeduplicator();
      const msg = createMessage('heartbeat', 'node1', { /* ... */ }, 'seq-1');
      expect(dedup.isDuplicate(msg)).toBe(false);
      dedup.clear();
      expect(dedup.isDuplicate(msg)).toBe(false);
    });
  });
});
