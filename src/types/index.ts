// ============================================
// SouthStack — Core Type Definitions
// ============================================

export type Theme = 'dark' | 'light';

export type NodeRole = 'master' | 'worker' | 'debug';
export type NodeStatus = 'online' | 'busy' | 'warning' | 'offline';

export interface PeerNode {
  id: string;
  name: string;
  role: NodeRole;
  status: NodeStatus;
  vram: number;        // MB
  vramUsed: number;    // MB
  ramTotal: number;    // MB
  ramUsed: number;     // MB
  latency: number;     // ms
  uptime: number;      // seconds
  lastHeartbeat: number;
  currentTask: string | null;
  capabilities: string[];
  isSelf: boolean;
  modelLoaded?: boolean;
  modelId?: string | null;
}

export type TaskStatus = 'queued' | 'assigned' | 'running' | 'waiting' | 'failed' | 'reassigned' | 'completed';
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';
export type TaskType = 'inference' | 'code-gen' | 'debug' | 'test' | 'review' | 'summarize';

export interface Task {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  assignedNode: string | null;
  progress: number;      // 0–100
  tokenCount: number;
  retryCount: number;
  relatedFiles: string[];
  createdAt: number;
  updatedAt: number;
  result?: string;
  error?: string;
  history: TaskHistoryEntry[];
}

export interface TaskHistoryEntry {
  timestamp: number;
  event: string;
  nodeId?: string;
  detail?: string;
}

export interface VirtualFile {
  path: string;
  content: string;
  language: string;
  lastModified: number;
  producedBy?: string;   // node id
  version: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  nodeId?: string;
}

export interface DebugIssue {
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
}

export interface SystemEvent {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'mesh';
  message: string;
  detail?: string;
  nodeId?: string;
  timestamp: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  size: string;
  vramRequired: number;
  description: string;
  contextSize: number;
}

export type SidebarView =
  | 'dashboard'
  | 'nodes'
  | 'tasks'
  | 'ide'
  | 'debug'
  | 'terminal'
  | 'files'
  | 'voice'
  | 'chat-history'
  | 'project-builder'
  | 'settings';

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ContextChunk {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  tokenCount: number;
  summary: string;
  distributed: boolean;
  assignedNode?: string;
}

// ============================================
// Project Builder Types
// ============================================

export type SubtaskCategory =
  | 'ui' | 'api' | 'database' | 'auth' | 'testing'
  | 'docs' | 'config' | 'logic' | 'types' | 'styles' | 'util';

export type ProjectSessionStatus =
  | 'idle' | 'decomposing' | 'running' | 'completed' | 'failed' | 'recovering';

export type SubtaskStatus =
  | 'pending' | 'assigned' | 'running' | 'completed' | 'failed' | 'requeued';

export interface ProjectSubtask {
  id: string;
  sessionId: string;
  category: SubtaskCategory;
  title: string;
  description: string;
  outputFile: string;
  language: string;
  dependsOn: string[];
  status: SubtaskStatus;
  assignedNodeId: string | null;
  assignedNodeName: string | null;
  result: string | null;
  error: string | null;
  retryCount: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export type ProjectAuditEvent =
  | 'session_started'
  | 'decomposed'
  | 'subtask_assigned'
  | 'subtask_completed'
  | 'subtask_failed'
  | 'subtask_requeued'
  | 'node_disconnected'
  | 'session_completed'
  | 'session_failed'
  | 'recovered'
  | 'broadcast_received';

export interface ProjectAuditEntry {
  id: string;
  sessionId: string;
  timestamp: number;
  event: ProjectAuditEvent;
  subtaskId: string | null;
  nodeId: string | null;
  nodeName: string | null;
  detail: string;
}

export interface ProjectSession {
  id: string;
  prompt: string;
  status: ProjectSessionStatus;
  subtasks: ProjectSubtask[];
  auditLog: ProjectAuditEntry[];
  completedFiles: Record<string, string>;
  totalSubtasks: number;
  completedCount: number;
  failedCount: number;
  startedAt: number;
  completedAt: number | null;
  masterNodeId: string;
}

// ============================================
// Agent System Types
// ============================================

export type AgentRole = 'coder' | 'debugger' | 'reviewer' | 'tester' | 'architect' | 'context';

export type AgentStatus = 'idle' | 'working' | 'done' | 'error';

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  status: AgentStatus;
  description: string;
  currentTask: string | null;
  lastResult: string | null;
  tasksCompleted: number;
  createdAt: number;
}
