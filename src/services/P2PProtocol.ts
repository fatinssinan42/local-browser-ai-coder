// ============================================
// P2PProtocol — Distributed Message Contracts
// ============================================
// Strict type definitions and validation for all P2P messages.
// Ensures all services speak the same language and can validate message integrity.

import type { PeerNode, Task, VirtualFile, DebugIssue } from '../types';

/**
 * Base P2P Message format
 * Every message between peers MUST conform to this structure
 */
export interface P2PMessage {
  type: MessageType;
  senderId: string;
  payload: any;
  timestamp: number;
  sequenceId?: string; // Optional: for deduplication and ordering
}

export type MessageType =
  | 'heartbeat'
  | 'state-sync'
  | 'task'
  | 'result'
  | 'file-sync'
  | 'election'
  | 'debug'
  | 'chat';

// ============================================
// HEARTBEAT - Vital statistics only (frequent)
// ============================================

export interface HeartbeatPayload {
  vramUsed: number; // MB
  ramUsed: number; // MB
  status: 'online' | 'busy' | 'warning' | 'offline';
  uptime: number; // seconds
}

export function isHeartbeatPayload(payload: any): payload is HeartbeatPayload {
  return (
    typeof payload?.vramUsed === 'number' &&
    typeof payload?.ramUsed === 'number' &&
    typeof payload?.status === 'string' &&
    typeof payload?.uptime === 'number'
  );
}

// ============================================
// STATE-SYNC - Node introduction and updates
// ============================================

export type StateSyncAction = 'introduce' | 'update' | 'remove';

export interface StateSyncPayload {
  action: StateSyncAction;
  node?: {
    id: string;
    name: string;
    role: 'master' | 'worker' | 'debug';
    status: 'online' | 'busy' | 'warning' | 'offline';
    vram: number; // MB
    vramUsed: number; // MB
    ramTotal: number; // MB
    ramUsed: number; // MB
    latency: number; // ms
    uptime: number; // seconds
    lastHeartbeat: number;
    currentTask: string | null;
    capabilities: string[];
    isSelf: boolean;
  };
  nodeId?: string; // For 'remove' action
}

export function isStateSyncPayload(payload: any): payload is StateSyncPayload {
  if (!payload || typeof payload?.action !== 'string') return false;
  if (payload.action === 'remove') {
    return typeof payload?.nodeId === 'string';
  }
  if (payload.action === 'introduce' || payload.action === 'update') {
    const n = payload?.node;
    return n && typeof n?.id === 'string' && typeof n?.vram === 'number';
  }
  return false;
}

// ============================================
// TASK - Work assignment and execution
// ============================================

export type TaskAction = 'assign' | 'progress' | 'result' | 'cancel' | 'status-request';

export interface TaskPayload {
  action: TaskAction;
  taskId: string;
  task?: {
    id: string;
    title: string;
    type: 'inference' | 'code-gen' | 'debug' | 'test' | 'review' | 'summarize';
    status: 'queued' | 'assigned' | 'running' | 'waiting' | 'failed' | 'reassigned' | 'completed';
    priority: 'low' | 'normal' | 'high' | 'critical';
    tokenCount: number;
    relatedFiles: string[];
    // For inference tasks
    prompt?: string;
    modelId?: string;
    systemPrompt?: string;
    maxTokens?: number;
    // For code generation
    instructions?: string;
    language?: string;
    // Metadata
    assignedNode?: string;
    result?: string;
    error?: string;
  };
  progress?: number; // 0-100
  result?: string;
  error?: string;
  logs?: string[];
}

export function isTaskPayload(payload: any): payload is TaskPayload {
  return (
    typeof payload?.action === 'string' &&
    typeof payload?.taskId === 'string'
  );
}

// ============================================
// RESULT - Task completion and results
// ============================================

export interface ResultPayload {
  taskId: string;
  status: 'completed' | 'failed' | 'reassigned';
  success: boolean;
  result?: string;
  error?: string;
  logs?: string[];
  artifacts?: Array<{
    path: string;
    content: string;
    language: string;
  }>;
  progress: number; // 0-100
  completedAt: number;
  processingTime: number; // ms
}

export function isResultPayload(payload: any): payload is ResultPayload {
  return (
    typeof payload?.taskId === 'string' &&
    typeof payload?.status === 'string' &&
    typeof payload?.success === 'boolean' &&
    typeof payload?.progress === 'number'
  );
}

// ============================================
// FILE-SYNC - Shared workspace synchronization
// ============================================

export type FileSyncAction = 'create' | 'update' | 'delete' | 'request' | 'response';

export interface FileSyncPayload {
  action: FileSyncAction;
  file?: {
    path: string;
    content: string;
    language: string;
    lastModified: number;
    version: number;
    producedBy?: string; // node id
  };
  path?: string; // For delete action
}

export function isFileSyncPayload(payload: any): payload is FileSyncPayload {
  return (
    typeof payload?.action === 'string' &&
    (payload?.file || payload?.path)
  );
}

// ============================================
// ELECTION - Leader selection and failover
// ============================================

export type ElectionPhase = 'call' | 'vote' | 'elected';

export interface ElectionPayload {
  phase: ElectionPhase;
  candidateId?: string;
  score?: number;
  voterId?: string;
  winnerId?: string;
  winnerScore?: number;
}

export function isElectionPayload(payload: any): payload is ElectionPayload {
  return typeof payload?.phase === 'string';
}

// ============================================
// DEBUG - Distributed debugging
// ============================================

export type DebugAction = 'create' | 'route' | 'resolve' | 'update';

export interface DebugPayload {
  action: DebugAction;
  issue?: {
    id: string;
    severity: 'error' | 'warning' | 'info';
    message: string;
    stackTrace?: string;
    sourceNode: string;
    file?: string;
    line?: number;
    suggestedFix?: string;
    status: 'open' | 'investigating' | 'resolved';
    timestamp: number;
  };
  issueId?: string;
  nodeId?: string; // Target debug node for routing
}

export function isDebugPayload(payload: any): payload is DebugPayload {
  return typeof payload?.action === 'string';
}

// ============================================
// CHAT - Distributed chat/communication
// ============================================

export interface ChatPayload {
  messageId: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  parentId?: string;
}

export function isChatPayload(payload: any): payload is ChatPayload {
  return (
    typeof payload?.messageId === 'string' &&
    typeof payload?.content === 'string' &&
    typeof payload?.role === 'string'
  );
}

// ============================================
// Message Validation & Construction
// ============================================

/**
 * Validates a message against the P2PMessage schema
 */
export function validateMessage(msg: any): { valid: boolean; error?: string } {
  if (!msg || typeof msg !== 'object') {
    return { valid: false, error: 'Message must be an object' };
  }

  if (typeof msg.type !== 'string') {
    return { valid: false, error: 'Missing message type' };
  }

  if (typeof msg.senderId !== 'string') {
    return { valid: false, error: 'Missing senderId' };
  }

  if (typeof msg.timestamp !== 'number') {
    return { valid: false, error: 'Missing or invalid timestamp' };
  }

  if (!msg.payload || typeof msg.payload !== 'object') {
    return { valid: false, error: 'Missing or invalid payload' };
  }

  // Type-specific validation
  switch (msg.type) {
    case 'heartbeat':
      if (!isHeartbeatPayload(msg.payload)) {
        return { valid: false, error: 'Invalid heartbeat payload' };
      }
      break;
    case 'state-sync':
      if (!isStateSyncPayload(msg.payload)) {
        return { valid: false, error: 'Invalid state-sync payload' };
      }
      break;
    case 'task':
      if (!isTaskPayload(msg.payload)) {
        return { valid: false, error: 'Invalid task payload' };
      }
      break;
    case 'result':
      if (!isResultPayload(msg.payload)) {
        return { valid: false, error: 'Invalid result payload' };
      }
      break;
    case 'file-sync':
      if (!isFileSyncPayload(msg.payload)) {
        return { valid: false, error: 'Invalid file-sync payload' };
      }
      break;
    case 'election':
      if (!isElectionPayload(msg.payload)) {
        return { valid: false, error: 'Invalid election payload' };
      }
      break;
    case 'debug':
      if (!isDebugPayload(msg.payload)) {
        return { valid: false, error: 'Invalid debug payload' };
      }
      break;
    case 'chat':
      if (!isChatPayload(msg.payload)) {
        return { valid: false, error: 'Invalid chat payload' };
      }
      break;
    default:
      return { valid: false, error: `Unknown message type: ${msg.type}` };
  }

  return { valid: true };
}

/**
 * Helper to create a valid P2P message
 */
export function createMessage<T extends MessageType>(
  type: T,
  senderId: string,
  payload: any,
  sequenceId?: string
): P2PMessage {
  return {
    type,
    senderId,
    payload,
    timestamp: Date.now(),
    sequenceId,
  };
}

// ============================================
// Message History & Deduplication
// ============================================

/**
 * Simple deduplication store for messages
 */
export class MessageDeduplicator {
  private seen: Map<string, number> = new Map();
  private readonly TTL = 30000; // 30 seconds

  isDuplicate(msg: P2PMessage): boolean {
    if (!msg.sequenceId) {
      return false; // No dedup without sequenceId
    }

    const key = `${msg.senderId}:${msg.sequenceId}`;
    const lastSeen = this.seen.get(key);

    if (lastSeen && Date.now() - lastSeen < this.TTL) {
      return true; // Duplicate
    }

    this.seen.set(key, Date.now());
    this.cleanup();
    return false;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.seen) {
      if (now - timestamp > this.TTL) {
        this.seen.delete(key);
      }
    }
  }

  clear(): void {
    this.seen.clear();
  }
}
