import { create } from 'zustand';
import type {
  Theme, SidebarView, PeerNode, Task, VirtualFile,
  ChatMessage, ChatSession, DebugIssue, SystemEvent, ModelInfo, ContextChunk,
  NodeRole, NodeStatus, TaskStatus, Agent, AgentStatus,
  ProjectSession, ProjectSubtask, ProjectAuditEntry,
} from '../types';

// ============================================
// Chat History Persistence (IndexedDB via localStorage fallback)
// ============================================

const CHAT_HISTORY_KEY = 'southstack-chat-history';

function persistChatSessions(sessions: ChatSession[]): void {
  try {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(sessions));
  } catch {
    // Storage full — trim oldest sessions and retry
    const trimmed = sessions.slice(0, 50);
    try {
      localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(trimmed));
    } catch {
      // Silently fail — chat history is non-critical
    }
  }
}

function loadChatSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatSession[];
  } catch {
    return [];
  }
}

// ============================================
// App Store — Global application state
// ============================================

interface AppState {
  // Theme
  theme: Theme;
  toggleTheme: () => void;

  // Navigation
  activeView: SidebarView;
  setActiveView: (view: SidebarView) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  insightPanelOpen: boolean;
  toggleInsightPanel: () => void;
  drawerOpen: boolean;
  toggleDrawer: () => void;
  drawerHeight: number;
  setDrawerHeight: (h: number) => void;
  chatPanelOpen: boolean;
  toggleChatPanel: () => void;

  // Mesh / Nodes
  selfId: string;
  setSelfId: (id: string) => void;
  nodes: PeerNode[];
  addNode: (node: PeerNode) => void;
  updateNode: (id: string, patch: Partial<PeerNode>) => void;
  removeNode: (id: string) => void;
  masterId: string | null;
  setMasterId: (id: string | null) => void;

  // Tasks
  tasks: Task[];
  addTask: (task: Task) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  removeTask: (id: string) => void;

  // Files
  files: VirtualFile[];
  addFile: (file: VirtualFile) => void;
  updateFile: (path: string, patch: Partial<VirtualFile>) => void;
  removeFile: (path: string) => void;
  activeFilePath: string | null;
  setActiveFilePath: (path: string | null) => void;
  openTabs: string[];
  openTab: (path: string) => void;
  closeTab: (path: string) => void;

  // Chat
  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  clearMessages: () => void;

  // Chat History
  activeChatSessionId: string | null;
  chatSessions: ChatSession[];
  saveChatSession: (title?: string) => void;
  loadChatSession: (sessionId: string) => void;
  deleteChatSession: (sessionId: string) => void;
  renameChatSession: (sessionId: string, title: string) => void;
  startNewChat: () => void;

  // Debug
  debugIssues: DebugIssue[];
  addDebugIssue: (issue: DebugIssue) => void;
  updateDebugIssue: (id: string, patch: Partial<DebugIssue>) => void;
  removeDebugIssue: (id: string) => void;

  // Events
  events: SystemEvent[];
  addEvent: (event: SystemEvent) => void;
  clearEvents: () => void;

  // Model / Inference
  availableModels: ModelInfo[];
  selectedModelId: string | null;
  setSelectedModelId: (id: string | null) => void;
  modelLoaded: boolean;
  setModelLoaded: (loaded: boolean) => void;
  modelLoading: boolean;
  setModelLoading: (loading: boolean) => void;
  loadProgress: number;
  setLoadProgress: (p: number) => void;

  // Context
  contextChunks: ContextChunk[];
  setContextChunks: (chunks: ContextChunk[]) => void;
  totalTokens: number;
  setTotalTokens: (n: number) => void;

  // Voice
  voiceListening: boolean;
  setVoiceListening: (v: boolean) => void;
  voiceTranscript: string;
  setVoiceTranscript: (t: string) => void;

  // Selected node for insight panel
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;

  // Unified IDE
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  commandHistory: string[];
  addCommandHistory: (cmd: string) => void;
  fileTreeCollapsed: boolean;
  toggleFileTree: () => void;
  terminalCollapsed: boolean;
  toggleTerminal: () => void;

  // AI Code Pipeline — tracks last generated code + undo history
  lastGeneratedCode: string | null;
  lastGeneratedLanguage: string | null;
  lastGeneratedTarget: string | null;
  setLastGeneratedCode: (code: string | null, lang: string | null, target: string | null) => void;
  fileUndoHistory: Record<string, string>;
  saveFileUndo: (path: string, previousContent: string) => void;
  clearFileUndo: (path: string) => void;

  // Agents
  agents: Agent[];
  addAgent: (agent: Agent) => void;
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  removeAgent: (id: string) => void;

  // Shared IDE — peer cursors & presence
  peerCursors: Record<string, {
    peerId: string;
    peerName: string;
    color: string;
    filePath: string;
    line: number;
    column: number;
    selection: { startLine: number; startCol: number; endLine: number; endCol: number } | null;
    updatedAt: number;
  }>;
  upsertPeerCursor: (peerId: string, cursor: Omit<AppState['peerCursors'][string], 'updatedAt'>) => void;
  removePeerCursor: (peerId: string) => void;

  // Live File Debug Session
  liveDebug: {
    active: boolean;
    filePath: string | null;
    totalChunks: number;
    currentChunk: number;
    percent: number;
    status: 'idle' | 'scanning' | 'done' | 'error';
    log: Array<{
      chunk: number;
      lines: string;
      startLine: number;
      endLine: number;
      status: 'scanning' | 'issues' | 'clean' | 'fixed';
      message: string;
      aiOutput: string | null;    // full raw AI response
      fixedCode: string | null;   // extracted fixed code block
    }>;
    issuesFound: number;
    fixesApplied: number;
    summary: string | null;
    editorScrollTo: { line: number; filePath: string } | null;  // triggers Monaco reveal
  };
  setLiveDebug: (patch: Partial<AppState['liveDebug']>) => void;
  upsertLiveDebugLog: (entry: AppState['liveDebug']['log'][number]) => void;
  resetLiveDebug: () => void;

  // Project Builder
  projectSession: ProjectSession | null;
  setProjectSession: (session: ProjectSession | null) => void;
  updateProjectSession: (patch: Partial<ProjectSession>) => void;
  upsertProjectSubtask: (subtask: ProjectSubtask) => void;
  appendProjectAuditEntry: (entry: ProjectAuditEntry) => void;
  clearProjectSession: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Theme
  theme: 'dark',
  toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),

  // Navigation
  activeView: 'dashboard',
  setActiveView: (view) => set({ activeView: view }),
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  insightPanelOpen: true,
  toggleInsightPanel: () => set((s) => ({ insightPanelOpen: !s.insightPanelOpen })),
  drawerOpen: false,
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
  drawerHeight: 280,
  setDrawerHeight: (h) => set({ drawerHeight: h }),
  chatPanelOpen: false,
  toggleChatPanel: () => set((s) => ({ chatPanelOpen: !s.chatPanelOpen })),

   // Mesh
   selfId: '',
   setSelfId: (id) => set({ selfId: id }),
   nodes: [],
   addNode: (node) => set((s) => {
     const existing = s.nodes.find(n => n.id === node.id);
     if (existing) {
       // Update existing node
       return { nodes: s.nodes.map(n => n.id === node.id ? { ...n, ...node } : n) };
     }
     // Add new node
     return { nodes: [...s.nodes, node] };
   }),
   updateNode: (id, patch) =>
     set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })),
   removeNode: (id) => set((s) => ({ nodes: s.nodes.filter((n) => n.id !== id) })),
   masterId: null,
   setMasterId: (id) => set({ masterId: id }),

  // Tasks
  tasks: [],
  addTask: (task) => set((s) => {
    // Prevent duplicate tasks by ID
    const existing = s.tasks.find(t => t.id === task.id);
    if (existing) {
      // Update existing task instead of adding duplicate
      return { tasks: s.tasks.map(t => t.id === task.id ? { ...t, ...task } : t) };
    }
    return { tasks: [...s.tasks, task] };
  }),
  updateTask: (id, patch) =>
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

  // Files
  files: [],
  addFile: (file) => set((s) => ({ files: [...s.files, file] })),
  updateFile: (path, patch) =>
    set((s) => ({ files: s.files.map((f) => (f.path === path ? { ...f, ...patch } : f)) })),
  removeFile: (path) => set((s) => ({ files: s.files.filter((f) => f.path !== path) })),
  activeFilePath: null,
  setActiveFilePath: (path) => set({ activeFilePath: path }),
  openTabs: [],
  openTab: (path) =>
    set((s) => ({
      openTabs: s.openTabs.includes(path) ? s.openTabs : [...s.openTabs, path],
      activeFilePath: path,
    })),
  closeTab: (path) =>
    set((s) => {
      const tabs = s.openTabs.filter((t) => t !== path);
      return {
        openTabs: tabs,
        activeFilePath: s.activeFilePath === path ? (tabs[tabs.length - 1] ?? null) : s.activeFilePath,
      };
    }),

  // Chat
  messages: [],
  addMessage: (msg) => set((s) => {
    const newMessages = [...s.messages, msg];
    // Auto-save to active session
    if (s.activeChatSessionId) {
      const sessions = s.chatSessions.map((sess) =>
        sess.id === s.activeChatSessionId
          ? { ...sess, messages: newMessages, updatedAt: Date.now() }
          : sess
      );
      persistChatSessions(sessions);
      return { messages: newMessages, chatSessions: sessions };
    }
    return { messages: newMessages };
  }),
  updateMessage: (id, patch) =>
    set((s) => {
      const newMessages = s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m));
      // Auto-save to active session
      if (s.activeChatSessionId) {
        const sessions = s.chatSessions.map((sess) =>
          sess.id === s.activeChatSessionId
            ? { ...sess, messages: newMessages, updatedAt: Date.now() }
            : sess
        );
        persistChatSessions(sessions);
        return { messages: newMessages, chatSessions: sessions };
      }
      return { messages: newMessages };
    }),
  clearMessages: () => set({ messages: [], activeChatSessionId: null }),

  // Chat History
  activeChatSessionId: null,
  chatSessions: loadChatSessions(),
  saveChatSession: (title) => set((s) => {
    if (s.messages.length === 0) return {};
    const now = Date.now();

    // If there's an active session, update it
    if (s.activeChatSessionId) {
      const sessions = s.chatSessions.map((sess) =>
        sess.id === s.activeChatSessionId
          ? { ...sess, messages: [...s.messages], updatedAt: now, ...(title ? { title } : {}) }
          : sess
      );
      persistChatSessions(sessions);
      return { chatSessions: sessions };
    }

    // Create new session
    const firstUserMsg = s.messages.find((m) => m.role === 'user');
    const sessionTitle = title || firstUserMsg?.content.slice(0, 50) || 'New Chat';
    const session: ChatSession = {
      id: `chat-${now}-${Math.random().toString(36).slice(2, 7)}`,
      title: sessionTitle,
      messages: [...s.messages],
      createdAt: now,
      updatedAt: now,
    };
    const sessions = [session, ...s.chatSessions];
    persistChatSessions(sessions);
    return { chatSessions: sessions, activeChatSessionId: session.id };
  }),
  loadChatSession: (sessionId) => set((s) => {
    const session = s.chatSessions.find((sess) => sess.id === sessionId);
    if (!session) return {};
    return { messages: [...session.messages], activeChatSessionId: sessionId };
  }),
  deleteChatSession: (sessionId) => set((s) => {
    const sessions = s.chatSessions.filter((sess) => sess.id !== sessionId);
    persistChatSessions(sessions);
    const isActive = s.activeChatSessionId === sessionId;
    return {
      chatSessions: sessions,
      ...(isActive ? { messages: [], activeChatSessionId: null } : {}),
    };
  }),
  renameChatSession: (sessionId, title) => set((s) => {
    const sessions = s.chatSessions.map((sess) =>
      sess.id === sessionId ? { ...sess, title } : sess
    );
    persistChatSessions(sessions);
    return { chatSessions: sessions };
  }),
  startNewChat: () => set((s) => {
    // Save current chat if it has messages and isn't already saved
    if (s.messages.length > 0 && !s.activeChatSessionId) {
      const now = Date.now();
      const firstUserMsg = s.messages.find((m) => m.role === 'user');
      const session: ChatSession = {
        id: `chat-${now}-${Math.random().toString(36).slice(2, 7)}`,
        title: firstUserMsg?.content.slice(0, 50) || 'New Chat',
        messages: [...s.messages],
        createdAt: now,
        updatedAt: now,
      };
      const sessions = [session, ...s.chatSessions];
      persistChatSessions(sessions);
      return { messages: [], activeChatSessionId: null, chatSessions: sessions };
    }
    return { messages: [], activeChatSessionId: null };
  }),

  // Debug
  debugIssues: [],
  addDebugIssue: (issue) => set((s) => ({ debugIssues: [...s.debugIssues, issue] })),
  updateDebugIssue: (id, patch) =>
    set((s) => ({ debugIssues: s.debugIssues.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
  removeDebugIssue: (id) =>
    set((s) => ({ debugIssues: s.debugIssues.filter((i) => i.id !== id) })),

  // Events
  events: [],
  addEvent: (event) => set((s) => {
    // Ensure unique ID by adding a suffix if duplicate
    const id = event.id || `event-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const newEvent = { ...event, id };
    return { events: [newEvent, ...s.events].slice(0, 200) };
  }),
  clearEvents: () => set({ events: [] }),

  // Model
  availableModels: [
    { id: 'gemma-2b-it-q4f16_1-MLC', name: 'Gemma 2B', size: '2B', vramRequired: 1477, description: 'Google lightweight model — fastest to load', contextSize: 4096 },
    { id: 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen 2.5 Coder 1.5B', size: '1.5B', vramRequired: 1630, description: 'Fast, lightweight coding model', contextSize: 4096 },
    { id: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC', name: 'Qwen 2.5 Coder 3B', size: '3B', vramRequired: 2505, description: 'Balanced speed and quality (recommended)', contextSize: 4096 },
    { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', name: 'Phi 3.5 Mini', size: '3.8B', vramRequired: 3672, description: 'Microsoft reasoning model', contextSize: 4096 },
    { id: 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC', name: 'Qwen 2.5 Coder 7B', size: '7B', vramRequired: 5107, description: 'Best quality — needs 5GB+ VRAM', contextSize: 4096 },
  ],
  selectedModelId: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC',
  setSelectedModelId: (id) => set({ selectedModelId: id }),
  modelLoaded: false,
  setModelLoaded: (loaded) => set({ modelLoaded: loaded }),
  modelLoading: false,
  setModelLoading: (loading) => set({ modelLoading: loading }),
  loadProgress: 0,
  setLoadProgress: (p) => set({ loadProgress: p }),

  // Context
  contextChunks: [],
  setContextChunks: (chunks) => set({ contextChunks: chunks }),
  totalTokens: 0,
  setTotalTokens: (n) => set({ totalTokens: n }),

  // Voice
  voiceListening: false,
  setVoiceListening: (v) => set({ voiceListening: v }),
  voiceTranscript: '',
  setVoiceTranscript: (t) => set({ voiceTranscript: t }),

  // Insight panel selections
  selectedNodeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  selectedTaskId: null,
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),

  // Unified IDE
  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  commandHistory: [],
  addCommandHistory: (cmd) => set((s) => ({
    commandHistory: [...s.commandHistory.slice(-99), cmd],
  })),
  fileTreeCollapsed: false,
  toggleFileTree: () => set((s) => ({ fileTreeCollapsed: !s.fileTreeCollapsed })),
  terminalCollapsed: false,
  toggleTerminal: () => set((s) => ({ terminalCollapsed: !s.terminalCollapsed })),

  // AI Code Pipeline
  lastGeneratedCode: null,
  lastGeneratedLanguage: null,
  lastGeneratedTarget: null,
  setLastGeneratedCode: (code, lang, target) => set({
    lastGeneratedCode: code,
    lastGeneratedLanguage: lang,
    lastGeneratedTarget: target,
  }),
  fileUndoHistory: {},
  saveFileUndo: (path, previousContent) => set((s) => ({
    fileUndoHistory: { ...s.fileUndoHistory, [path]: previousContent },
  })),
  clearFileUndo: (path) => set((s) => {
    const { [path]: _, ...rest } = s.fileUndoHistory;
    return { fileUndoHistory: rest };
  }),

  // Live File Debug Session
  liveDebug: {
    active: false,
    filePath: null,
    totalChunks: 0,
    currentChunk: 0,
    percent: 0,
    status: 'idle',
    log: [],
    issuesFound: 0,
    fixesApplied: 0,
    summary: null,
    editorScrollTo: null,
  },
  setLiveDebug: (patch) => set((s) => ({ liveDebug: { ...s.liveDebug, ...patch } })),
  // Upsert: if a log entry for this chunk already exists, update it; otherwise append
  upsertLiveDebugLog: (entry) => set((s) => {
    const existing = s.liveDebug.log.findIndex((e) => e.chunk === entry.chunk);
    const newLog = existing >= 0
      ? s.liveDebug.log.map((e, i) => i === existing ? { ...e, ...entry } : e)
      : [...s.liveDebug.log, entry];
    return { liveDebug: { ...s.liveDebug, log: newLog } };
  }),
  resetLiveDebug: () => set({
    liveDebug: {
      active: false,
      filePath: null,
      totalChunks: 0,
      currentChunk: 0,
      percent: 0,
      status: 'idle',
      log: [],
      issuesFound: 0,
      fixesApplied: 0,
      summary: null,
      editorScrollTo: null,
    },
  }),

  // Peer cursors
  peerCursors: {},
  upsertPeerCursor: (peerId, cursor) => set((s) => ({
    peerCursors: { ...s.peerCursors, [peerId]: { ...cursor, updatedAt: Date.now() } },
  })),
  removePeerCursor: (peerId) => set((s) => {
    const { [peerId]: _, ...rest } = s.peerCursors;
    return { peerCursors: rest };
  }),

  // Agents
  agents: [],
  addAgent: (agent) => set((s) => {
    const existing = s.agents.find((a) => a.id === agent.id);
    if (existing) return { agents: s.agents.map((a) => a.id === agent.id ? { ...a, ...agent } : a) };
    return { agents: [...s.agents, agent] };
  }),
  updateAgent: (id, patch) => set((s) => ({
    agents: s.agents.map((a) => a.id === id ? { ...a, ...patch } : a),
  })),
  removeAgent: (id) => set((s) => ({
    agents: s.agents.filter((a) => a.id !== id),
  })),

  // Project Builder
  projectSession: null,
  setProjectSession: (session) => set({ projectSession: session }),
  updateProjectSession: (patch) => set((s) => ({
    projectSession: s.projectSession ? { ...s.projectSession, ...patch } : null,
  })),
  upsertProjectSubtask: (subtask) => set((s) => {
    if (!s.projectSession) return {};
    const exists = s.projectSession.subtasks.findIndex((st) => st.id === subtask.id);
    const subtasks = exists >= 0
      ? s.projectSession.subtasks.map((st, i) => i === exists ? { ...st, ...subtask } : st)
      : [...s.projectSession.subtasks, subtask];
    return { projectSession: { ...s.projectSession, subtasks } };
  }),
  appendProjectAuditEntry: (entry) => set((s) => {
    if (!s.projectSession) return {};
    const auditLog = [...s.projectSession.auditLog, entry].slice(-500);
    return { projectSession: { ...s.projectSession, auditLog } };
  }),
  clearProjectSession: () => set({ projectSession: null }),
}));
