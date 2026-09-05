// ============================================
// P2P Message Types
// ============================================
// Shared TypeScript interfaces for P2P communication
// Ensures type safety across services

export interface P2PMessage {
  type: P2PMessageType;
  senderId: string;
  payload: any;
  timestamp: number;
}

export type P2PMessageType =
  | 'heartbeat'
  | 'task'
  | 'result'
  | 'task-token'   // worker → master: streaming inference token during execution
  | 'file-sync'
  | 'state-sync'
  | 'election'
  | 'debug'
  | 'chat'
  | 'cursor'
  | 'file-request'
  | 'project-subtask'     // master → worker: assign a project subtask
  | 'project-result'      // worker → master: subtask result
  | 'project-broadcast'   // master → all: final project complete
  | 'project-status'      // master → all: live progress update
  | 'project-state-sync'; // master → all: full session snapshot for live UI sync

export interface P2PHeartbeatPayload {
  vramUsed: number;      // MB
  ramUsed: number;       // MB
  status: 'online' | 'busy' | 'warning' | 'offline';
  uptime: number;        // seconds
}

export interface P2PTaskPayload {
  taskId: string;
  title: string;
  type: 'inference' | 'code-gen' | 'debug' | 'test' | 'review' | 'summarize';
  priority: 'low' | 'normal' | 'high' | 'critical';
  tokenCount: number;
  relatedFiles: string[];
  // For inference tasks
  prompt?: string;
  modelId?: string;
  // For code generation
  instructions?: string;
  language?: string;
}

export interface P2PResultPayload {
  taskId: string;
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
}

export interface P2PFileSyncPayload {
  action: 'create' | 'update' | 'delete';
  file: {
    path: string;
    content: string;
    language: string;
    lastModified: number;
    version: number;
  };
}

export interface P2PStateSyncPayload {
  action: 'introduce' | 'update' | 'remove';
  node: {
    id: string;
    name: string;
    role: 'master' | 'worker' | 'debug';
    status: 'online' | 'busy' | 'warning' | 'offline';
    vram: number;        // MB
    vramUsed: number;    // MB
    ramTotal: number;    // MB
    ramUsed: number;     // MB
    latency: number;     // ms
    uptime: number;      // seconds
    lastHeartbeat: number;
    currentTask: string | null;
    capabilities: string[];
  };
}

export interface P2PElectionPayload {
  phase: 'call' | 'vote' | 'elected';
  candidateId?: string;
  score?: number;
  winnerId?: string;
  voterId?: string;
}

export interface P2PDebugPayload {
  issueId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  sourceNode: string;
  file?: string;
  line?: number;
  suggestedFix?: string;
  status: 'open' | 'investigating' | 'resolved';
}

export interface P2PChatPayload {
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  nodeId?: string;
}

export interface P2PCursorPayload {
  filePath: string;
  line: number;
  column: number;
  // selection range (null if no selection)
  selection: { startLine: number; startCol: number; endLine: number; endCol: number } | null;
  peerName: string;
  color: string; // hex color assigned to this peer
}

// ============================================
// Project Builder Message Payloads
// ============================================

export interface P2PProjectSubtaskPayload {
  sessionId: string;
  subtask: import('../types').ProjectSubtask;
  dependencyOutputs: Record<string, string>; // subtaskId → generated code
}

export interface P2PProjectResultPayload {
  sessionId: string;
  subtaskId: string;
  success: boolean;
  code: string | null;
  error: string | null;
  outputFile: string;
}

export interface P2PProjectBroadcastPayload {
  sessionId: string;
  prompt: string;
  files: Array<{ path: string; content: string; language: string }>;
  auditLog: import('../types').ProjectAuditEntry[];
  totalSubtasks: number;
  completedCount: number;
  failedCount: number;
  completedAt: number;
}

export interface P2PProjectStatusPayload {
  sessionId: string;
  completedCount: number;
  totalSubtasks: number;
  activeNodes: Array<{ nodeId: string; nodeName: string; subtaskTitle: string }>;
}

export interface P2PFileRequestPayload {
  action: 'request-all' | 'request-file' | 'respond-all';
  filePath?: string; // for 'request-file'
  files?: Array<{
    path: string;
    content: string;
    language: string;
    lastModified: number;
    version: number;
  }>; // for 'respond-all'
}