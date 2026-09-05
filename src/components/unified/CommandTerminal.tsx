import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { executeCommand } from '../../services/CommandInterpreter';
import { FileOps } from '../../services/FileOperations';
import { EventBus, MeshEvents } from '../../services/EventBus';
import { getMeshOrchestrator } from '../../services/MeshOrchestrator';
import { NodeGrid } from '../nodes/NodeGrid';
import { ProjectBuilder } from '../project/ProjectBuilder';
import {
  initializeAgents,
} from '../../services/AgentSystem';
import type { ChatMessage, TaskType } from '../../types';
import {
  ChevronRight, Loader2, Terminal, Check, Copy, Undo2,
  Mic, MicOff, Upload, Settings2, Bot, X,
  Wifi, WifiOff, Cpu, Users, Volume2,
  Activity, Zap, CheckCircle2, AlertCircle, ArrowRight,
  Save, History, Command, Code, Bug, FileText, RefreshCw,
  Palette, HelpCircle, Layers, Play, Wrench, FileSearch, Clock, Server,
} from 'lucide-react';

// ============================================
// Command Suggestions — all available commands & features
// ============================================

interface CommandSuggestion {
  command: string;
  description: string;
  icon: React.ReactNode;
  category: 'command' | 'action' | 'ai';
}

const COMMAND_SUGGESTIONS: CommandSuggestion[] = [
  // Slash commands
  { command: '/help', description: 'Show available commands', icon: <HelpCircle size={12} />, category: 'command' },
  { command: '/clear', description: 'Clear terminal history', icon: <X size={12} />, category: 'command' },
  { command: '/settings', description: 'Open settings panel', icon: <Settings2 size={12} />, category: 'command' },
  { command: '/model', description: 'Show model status', icon: <Cpu size={12} />, category: 'command' },
  { command: '/mesh', description: 'Show mesh network status', icon: <Wifi size={12} />, category: 'command' },
  { command: '/theme', description: 'Toggle dark/light theme', icon: <Palette size={12} />, category: 'command' },
  { command: '/apply', description: 'Re-apply last generated code', icon: <Check size={12} />, category: 'command' },
  { command: '/undo', description: 'Undo last AI edit', icon: <Undo2 size={12} />, category: 'command' },
  // Agent commands
  { command: '/agents', description: 'Show all agents status', icon: <Bot size={12} />, category: 'command' },
  { command: '/agents init', description: 'Initialize background agents', icon: <Play size={12} />, category: 'command' },
  { command: '/agents analyze', description: 'Run all agents on current file', icon: <FileSearch size={12} />, category: 'command' },
  { command: '/agents debug', description: 'Run debug agent', icon: <Bug size={12} />, category: 'command' },
  { command: '/agents review', description: 'Run code review agent', icon: <FileText size={12} />, category: 'command' },
  { command: '/agents test', description: 'Run test agent', icon: <Layers size={12} />, category: 'command' },
  { command: '/agents code', description: 'Run coder agent with description', icon: <Code size={12} />, category: 'command' },
  // AI action keywords
  { command: 'debug', description: 'Debug current file for bugs', icon: <Bug size={12} />, category: 'ai' },
  { command: 'debug this', description: 'Find and fix bugs in current file', icon: <Bug size={12} />, category: 'ai' },
  { command: 'explain', description: 'Explain current code', icon: <HelpCircle size={12} />, category: 'ai' },
  { command: 'explain this', description: 'Explain what the code does', icon: <HelpCircle size={12} />, category: 'ai' },
  { command: 'refactor', description: 'Refactor current file', icon: <RefreshCw size={12} />, category: 'ai' },
  { command: 'refactor this', description: 'Improve code quality', icon: <RefreshCw size={12} />, category: 'ai' },
  { command: 'optimize', description: 'Optimize code performance', icon: <Zap size={12} />, category: 'ai' },
  { command: 'fix', description: 'Fix issues in current file', icon: <Wrench size={12} />, category: 'ai' },
  { command: 'fix all', description: 'Fix all issues automatically', icon: <Wrench size={12} />, category: 'ai' },
  // Code generation
  { command: 'create', description: 'Create a new file with AI content', icon: <Code size={12} />, category: 'action' },
  { command: 'write', description: 'Write code to current file', icon: <Code size={12} />, category: 'action' },
  { command: 'add', description: 'Add code to file', icon: <Code size={12} />, category: 'action' },
  { command: 'generate', description: 'Generate code from description', icon: <Code size={12} />, category: 'action' },
  { command: 'implement', description: 'Implement functionality', icon: <Code size={12} />, category: 'action' },
  { command: 'build', description: 'Build feature from description', icon: <Layers size={12} />, category: 'action' },
  { command: '/build', description: 'Start distributed project build across mesh', icon: <Layers size={12} />, category: 'command' },
  { command: '/build <describe your project>', description: 'Decompose & distribute build to all peers', icon: <Play size={12} />, category: 'command' },
];

interface ProjectLogLine {
  ts: number;
  level: 'info' | 'assign' | 'running' | 'done' | 'fail' | 'requeue' | 'warn' | 'complete';
  text: string;
  node?: string;
  file?: string;
  done?: number;
  total?: number;
}

interface TerminalEntry {
  id: string;
  type: 'input' | 'success' | 'error' | 'info' | 'ai' | 'agent-live' | 'task-live' | 'project-live';
  content: string;
  // Agent live tracking fields
  agentTaskId?: string;
  agentRole?: string;
  agentName?: string;
  agentStatus?: 'queued' | 'running' | 'done' | 'error';
  agentProgress?: number;
  agentNode?: string;
  // Task live tracking fields (mesh task-live entries)
  taskId?: string;
  taskType?: TaskType;
  taskTitle?: string;
  taskNodeId?: string;
  taskNodeName?: string;
  taskStatus?: 'queued' | 'assigned' | 'running' | 'completed' | 'failed';
  taskProgress?: number;
  // Project live tracking fields
  projectSessionId?: string;
  projectPrompt?: string;
  projectStatus?: 'decomposing' | 'running' | 'completed' | 'failed';
  projectTotal?: number;
  projectDone?: number;
  projectLogs?: ProjectLogLine[];
}

// ============================================
// Task type detection from natural language
// ============================================
function detectTaskType(prompt: string): TaskType {
  const p = prompt.toLowerCase();
  if (/\b(debug|fix bug|find bug|error|exception|crash|broken|failing)\b/.test(p)) return 'debug';
  if (/\b(test|unit test|write test|spec|coverage)\b/.test(p)) return 'test';
  if (/\b(review|code review|check quality|lint|best practice|improve)\b/.test(p)) return 'review';
  if (/\b(explain|summarize|what does|what is|describe|overview|document)\b/.test(p)) return 'summarize';
  return 'code-gen';
}

// Parse "@NodeName prompt" or "@node-id prompt" from terminal input.
// Returns { peerId, prompt } — peerId is null if no @ prefix.
function parsePeerTarget(input: string, nodes: { id: string; name: string }[]): { peerId: string | null; prompt: string } {
  const match = input.match(/^@(\S+)\s+([\s\S]*)$/);
  if (!match) return { peerId: null, prompt: input };
  const tag = match[1].toLowerCase();
  const rest = match[2].trim();
  // Try to match by name (case-insensitive partial) or by id prefix
  const node = nodes.find(
    (n) => n.name.toLowerCase().includes(tag) || n.id.toLowerCase().startsWith(tag),
  );
  return { peerId: node?.id ?? null, prompt: rest };
}

export function CommandTerminal() {
  const [entries, setEntries] = useState<TerminalEntry[]>([
    {
      id: 'welcome',
      type: 'info',
      content: '**SouthStack AI Terminal**\nType a prompt or command. Multiple tasks run in parallel across peers.\n\n  `debug this code`  ·  `write a REST API`  ·  `review this file`\n  `@NodeName debug` — send task to a specific peer\n  `/mesh` — show connected nodes  ·  `/help` — all commands',
    },
  ]);
  const [input, setInput] = useState('');
  // isProcessing is true only while a slash-command is executing (not for mesh tasks)
  const [isProcessing, setIsProcessing] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showFeaturePanel, setShowFeaturePanel] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [shouldAutoSave, setShouldAutoSave] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [showNodesPopup, setShowNodesPopup] = useState(false);
  const [showBuildPopup, setShowBuildPopup] = useState(false);
  const [showFullNodes, setShowFullNodes] = useState(false);
  const [showFullBuild, setShowFullBuild] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const commandHistory = useAppStore((s) => s.commandHistory);
  const setVoiceListening = useAppStore((s) => s.setVoiceListening);
  const setVoiceTranscript = useAppStore((s) => s.setVoiceTranscript);
  const saveChatSession = useAppStore((s) => s.saveChatSession);
  const chatSessions = useAppStore((s) => s.chatSessions);
  const activeChatSessionId = useAppStore((s) => s.activeChatSessionId);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const nodes = useAppStore((s) => s.nodes);
  const projectSession = useAppStore((s) => s.projectSession);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamingRef = useRef<string>('');
  const recognitionRef = useRef<any>(null);
  const featurePanelRef = useRef<HTMLDivElement>(null);

  // Initialize agents on first render
  useEffect(() => {
    initializeAgents();
  }, []);

  // ============================================
  // Live Agent Event Subscriptions
  // ============================================
  useEffect(() => {
    // Agent started/queued — add a live entry to the terminal
    const offStarted = EventBus.on(MeshEvents.AGENT_STARTED, (data: any) => {
      setEntries(prev => {
        const existing = prev.find(e => e.agentTaskId === data.taskId);
        if (existing) {
          return prev.map(e =>
            e.agentTaskId === data.taskId
              ? { ...e, agentStatus: data.status, agentProgress: data.status === 'running' ? 5 : 0, content: '' }
              : e
          );
        }
        return [...prev, {
          id: `agent-${data.taskId}`,
          type: 'agent-live' as const,
          content: '',
          agentTaskId: data.taskId,
          agentRole: data.role,
          agentName: data.agentName,
          agentStatus: data.status,
          agentProgress: 0,
        }];
      });
    });

    // Agent streaming token — append to the live entry
    const offToken = EventBus.on(MeshEvents.AGENT_TOKEN, (data: any) => {
      setEntries(prev =>
        prev.map(e =>
          e.agentTaskId === data.taskId
            ? {
                ...e,
                content: (e.content || '') + data.token,
                agentProgress: data.progress,
                agentStatus: 'running',
              }
            : e
        )
      );
    });

    // Agent progress update (mesh offload status messages)
    const offProgress = EventBus.on(MeshEvents.AGENT_PROGRESS, (data: any) => {
      setEntries(prev =>
        prev.map(e =>
          e.agentTaskId === data.taskId
            ? {
                ...e,
                agentProgress: data.progress,
                agentNode: data.message,
              }
            : e
        )
      );
    });

    // Agent completed — finalize the live entry
    const offCompleted = EventBus.on(MeshEvents.AGENT_COMPLETED, (data: any) => {
      setEntries(prev =>
        prev.map(e =>
          e.agentTaskId === data.taskId
            ? {
                ...e,
                agentStatus: 'done',
                agentProgress: 100,
                content: data.result || e.content,
                agentNode: data.assignedNode ? `Ran on ${data.assignedNode.slice(0, 12)}` : undefined,
              }
            : e
        )
      );
    });

    // Agent error
    const offError = EventBus.on(MeshEvents.AGENT_ERROR, (data: any) => {
      setEntries(prev =>
        prev.map(e =>
          e.agentTaskId === data.taskId
            ? {
                ...e,
                agentStatus: 'error',
                agentProgress: 0,
                content: `Error: ${data.error}`,
              }
            : e
        )
      );
    });

    return () => {
      offStarted();
      offToken();
      offProgress();
      offCompleted();
      offError();
    };
  }, []);

  // ============================================
  // Mesh Task Event Subscriptions
  // ============================================
  useEffect(() => {
    // Task assigned to a node — update the live entry's node info
    const offAssigned = EventBus.on(MeshEvents.TASK_ASSIGNED, (data: any) => {
      setEntries((prev) =>
        prev.map((e) =>
          e.taskId === data.taskId
            ? { ...e, taskNodeId: data.nodeId, taskNodeName: data.nodeName, taskStatus: 'assigned' }
            : e,
        ),
      );
    });

    // Task progress — update progress bar and stream tokens
    const offProgress = EventBus.on(MeshEvents.TASK_PROGRESS, (data: any) => {
      setEntries((prev) =>
        prev.map((e) => {
          if (e.taskId !== data.taskId) return e;
          // If no nodeId, task is still queued — don't flip to 'running'
          const isQueued = !data.nodeId;
          return {
            ...e,
            taskStatus: isQueued ? 'queued' : 'running',
            taskProgress: data.progress,
            taskNodeId: data.nodeId || e.taskNodeId,
            taskNodeName: data.nodeName || e.taskNodeName,
            content: data.token ? (e.content || '') + data.token : e.content,
          };
        }),
      );
    });

    // Task completed — show final result
    const offCompleted = EventBus.on(MeshEvents.TASK_COMPLETED, (data: any) => {
      setEntries((prev) =>
        prev.map((e) =>
          e.taskId === data.taskId
            ? {
                ...e,
                taskStatus: 'completed',
                taskProgress: 100,
                taskNodeName: data.nodeName || e.taskNodeName,
                content: data.result || e.content,
              }
            : e,
        ),
      );
    });

    // Task failed — show error
    const offFailed = EventBus.on(MeshEvents.TASK_FAILED, (data: any) => {
      setEntries((prev) =>
        prev.map((e) =>
          e.taskId === data.taskId
            ? {
                ...e,
                taskStatus: 'failed',
                taskProgress: 0,
                taskNodeName: data.nodeName || e.taskNodeName,
                content: `Error: ${data.error || 'Task failed'}`,
              }
            : e,
        ),
      );
    });

    return () => {
      offAssigned();
      offProgress();
      offCompleted();
      offFailed();
    };
  }, []);

  // Listen for chat session load events from ChatHistoryView
  useEffect(() => {
    const off = EventBus.on(MeshEvents.CHAT_SESSION_LOADED, (messages: ChatMessage[]) => {
      if (!messages || messages.length === 0) {
        // New chat — preserve logs (project-live / agent-live / task-live), reset only chat entries
        setEntries((prev) => {
          const logEntries = prev.filter((e) =>
            e.type === 'project-live' || e.type === 'agent-live' || e.type === 'task-live',
          );
          return [
            ...logEntries,
            { id: 'welcome-new', type: 'info', content: '**New conversation started.**\nType a command or ask anything.' },
          ];
        });
        return;
      }
      const chatEntries: TerminalEntry[] = [
        { id: 'restored-header', type: 'info', content: '**Loaded conversation from history**' },
        ...messages.map((m) => ({
          id: m.id,
          type: (m.role === 'user' ? 'input' : 'ai') as TerminalEntry['type'],
          content: m.content,
        })),
      ];
      // Preserve build/agent logs above the loaded chat messages
      setEntries((prev) => {
        const logEntries = prev.filter((e) =>
          e.type === 'project-live' || e.type === 'agent-live' || e.type === 'task-live',
        );
        return [...logEntries, ...chatEntries];
      });
    });
    return () => off();
  }, []);

  // ============================================
  // Project Build Live Log Subscriptions
  // ============================================
  useEffect(() => {
    // Session started → create a new project-live entry (idempotent by sessionId)
    const offStart = EventBus.on(MeshEvents.PROJECT_SESSION_STARTED, (data: any) => {
      setEntries((prev) => {
        // Don't create a duplicate card if we already have this session
        if (prev.some((e) => e.projectSessionId === data.sessionId)) return prev;
        return [
          ...prev,
          {
            id: `project-live-${data.sessionId}`,
            type: 'project-live' as const,
            content: '',
            projectSessionId: data.sessionId,
            projectPrompt: data.prompt,
            projectStatus: 'decomposing',
            projectTotal: 0,
            projectDone: 0,
            projectLogs: [],
          },
        ];
      });
      // Workers: also open the Project Builder panel
      useAppStore.getState().setActiveView('project-builder');
    });

    // Micro-detail log line → append to the matching entry
    const offLog = EventBus.on(MeshEvents.PROJECT_LOG_LINE, (data: any) => {
      setEntries((prev) =>
        prev.map((e) => {
          if (e.projectSessionId !== data.sessionId) return e;
          const logs = [...(e.projectLogs || []), {
            ts: data.ts || Date.now(),
            level: data.level,
            text: data.text,
            node: data.node,
            file: data.file,
            done: data.done,
            total: data.total,
          } as ProjectLogLine];
          // Keep latest 200 lines, remove very old ones
          return {
            ...e,
            projectLogs: logs.slice(-200),
            projectDone: data.done ?? e.projectDone,
            projectTotal: data.total ?? e.projectTotal,
          };
        }),
      );
    });

    // Session completed → mark done
    const offComplete = EventBus.on(MeshEvents.PROJECT_SESSION_COMPLETED, (data: any) => {
      setEntries((prev) =>
        prev.map((e) =>
          e.projectSessionId === data.sessionId
            ? { ...e, projectStatus: 'completed' }
            : e,
        ),
      );
    });

    // Session failed → mark failed
    const offFail = EventBus.on(MeshEvents.PROJECT_SESSION_FAILED, (data: any) => {
      setEntries((prev) =>
        prev.map((e) =>
          e.projectSessionId === data.sessionId
            ? { ...e, projectStatus: 'failed' }
            : e,
        ),
      );
    });

    // Subtask updated → refresh done/total counters from store
    const offSubtask = EventBus.on(MeshEvents.PROJECT_SUBTASK_UPDATED, () => {
      const session = useAppStore.getState().projectSession;
      if (!session) return;
      setEntries((prev) =>
        prev.map((e) =>
          e.projectSessionId === session.id
            ? {
                ...e,
                projectStatus: session.status as TerminalEntry['projectStatus'],
                projectTotal: session.totalSubtasks,
                projectDone: session.completedCount,
              }
            : e,
        ),
      );
    });

    return () => {
      offStart();
      offLog();
      offComplete();
      offFail();
      offSubtask();
    };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close feature panel on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (featurePanelRef.current && !featurePanelRef.current.contains(e.target as Node)) {
        setShowFeaturePanel(false);
      }
    };
    if (showFeaturePanel) {
      document.addEventListener('mousedown', handler);
    }
    return () => document.removeEventListener('mousedown', handler);
  }, [showFeaturePanel]);

  // Cleanup recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  const addEntry = useCallback((type: TerminalEntry['type'], content: string) => {
    setEntries((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type, content },
    ]);
  }, []);

  // Convert terminal entries to ChatMessages for saving to history
  const entriesToMessages = useCallback((ents: TerminalEntry[]): ChatMessage[] => {
    return ents
      .filter((e) => e.type === 'input' || e.type === 'ai' || e.type === 'success' || e.type === 'error')
      .map((e) => ({
        id: e.id,
        role: e.type === 'input' ? 'user' as const : 'assistant' as const,
        content: e.content,
        timestamp: parseInt(e.id.split('-')[0]) || Date.now(),
      }));
  }, []);

  // Save current terminal conversation to chat history
  const saveCurrentChat = useCallback(() => {
    const msgs = entriesToMessages(entries);
    if (msgs.length === 0) return;

    // Sync messages to the store, then save session
    const store = useAppStore.getState();
    // Clear and set messages from terminal entries
    store.clearMessages();
    msgs.forEach((m) => store.addMessage(m));
    store.saveChatSession();
  }, [entries, entriesToMessages]);

  // Auto-save chat to history after AI response
  useEffect(() => {
    if (shouldAutoSave) {
      setShouldAutoSave(false);
      const msgs = entriesToMessages(entries);
      if (msgs.length >= 2) { // At least one user + one AI message
        const store = useAppStore.getState();
        store.clearMessages();
        msgs.forEach((m) => store.addMessage(m));
        if (!store.activeChatSessionId) {
          store.saveChatSession();
        }
      }
    }
  }, [shouldAutoSave, entries, entriesToMessages]);

  const handleSubmit = async (overrideInput?: string) => {
    const trimmed = (overrideInput || input).trim();
    if (!trimmed) return;

    // /clear is always instant
    if (trimmed === '/clear') {
      setEntries([]);
      setInput('');
      setHistoryIndex(-1);
      return;
    }

    setInput('');
    setHistoryIndex(-1);

    // ── Slash commands (/help, /mesh, /model, /agents …) ─────────────────────
    // These run on the local node immediately; block input while they execute.
    if (trimmed.startsWith('/')) {
      addEntry('input', trimmed);
      setIsProcessing(true);
      try {
        const streamId = `stream-${Date.now()}`;
        streamingRef.current = '';
        const result = await executeCommand(trimmed, (token: string) => {
          streamingRef.current += token;
          setEntries((prev) => {
            const existing = prev.find((e) => e.id === streamId);
            if (existing) {
              return prev.map((e) =>
                e.id === streamId ? { ...e, content: streamingRef.current } : e,
              );
            }
            return [...prev, { id: streamId, type: 'ai' as const, content: streamingRef.current }];
          });
        });
        if (result.type !== 'ai-stream' && result.message) {
          addEntry(
            result.type === 'success' ? 'success' : result.type === 'error' ? 'error' : 'info',
            result.message,
          );
        }
      } catch (err: unknown) {
        addEntry('error', `Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setIsProcessing(false);
        streamingRef.current = '';
        setTimeout(() => setShouldAutoSave(true), 100);
      }
      return;
    }

    // ── Natural language prompts ──────────────────────────────────────────────
    // Parse optional @NodeName prefix for peer targeting
    const allNodes = useAppStore.getState().nodes;
    const { peerId, prompt } = parsePeerTarget(trimmed, allNodes);
    const lower = prompt.toLowerCase().trim();

    // Commands that are NOT project builds — they operate on a single existing file.
    // Everything else goes through the full distributed ProjectOrchestrator pipeline.
    const isSingleFileOp =
      // Bare file system ops: "delete x", "rename x to y", "open x", "list", "read x"
      /^(?:delete|remove|rm)\s+\S/.test(lower) ||
      /^(?:rename|mv|move)\s+\S/.test(lower) ||
      /^(?:open|show|view)\s+\S/.test(lower) ||
      /^(?:list|ls|files|dir)\s*$/.test(lower) ||
      /^(?:read|cat)\s+\S/.test(lower) ||
      /^(?:create|new|touch)\s+[a-zA-Z0-9_/.\-]+\.[a-zA-Z]{1,8}\s*$/.test(lower) ||
      // Per-file AI actions on the currently open file
      /^(?:debug|analyze|lint|review)\s*(?:this|current)?\s*(?:file|code)?\s*$/.test(lower) ||
      /^(?:debug|analyze|lint|review)\s+[a-zA-Z0-9_/.\-]+\.[a-zA-Z]{1,8}/.test(lower) ||
      /^(?:explain|what does|what is|describe|how does)\s/.test(lower) ||
      /^fix\s+line\s+\d+/.test(lower);

    let orchestrator: ReturnType<typeof getMeshOrchestrator> | null = null;
    try {
      orchestrator = getMeshOrchestrator();
    } catch {
      // Mesh not initialised — fall back to local executeCommand
    }

    if (orchestrator) {
      addEntry('input', trimmed);

      if (!isSingleFileOp) {
        // ── EVERY other prompt → full distributed build pipeline ──────────────
        // ProjectOrchestrator: decompose → subtask queue → parallel dispatch
        // → code-gen on each node → aggregate → broadcast to all peers
        useAppStore.getState().setActiveView('project-builder');
        orchestrator.project.startSession(prompt);
        // Terminal auto-creates the live project-live card via PROJECT_SESSION_STARTED event
        return;
      }

      // ── Single-file ops: route through task distributor ───────────────────
      const taskType = detectTaskType(prompt);
      const activeFilePath = useAppStore.getState().activeFilePath;
      const relatedFiles = activeFilePath ? [activeFilePath] : [];

      const task = orchestrator.tasks.createTask(prompt, taskType, {
        context: prompt,
        relatedFiles,
      });

      setEntries((prev) => [
        ...prev,
        {
          id: `task-live-${task.id}`,
          type: 'task-live' as const,
          content: '',
          taskId: task.id,
          taskType,
          taskTitle: prompt.length > 60 ? prompt.slice(0, 60) + '…' : prompt,
          taskNodeId: peerId ?? undefined,
          taskNodeName: peerId
            ? allNodes.find((n) => n.id === peerId)?.name ?? peerId.slice(0, 12)
            : undefined,
          taskStatus: 'queued',
          taskProgress: 0,
        },
      ]);

      orchestrator.tasks.distributeTask(task.id, peerId ?? undefined);
    } else {
      // No mesh — fall back to local AI (executeCommand)
      addEntry('input', trimmed);
      setIsProcessing(true);
      try {
        const streamId = `stream-${Date.now()}`;
        streamingRef.current = '';
        const result = await executeCommand(trimmed, (token: string) => {
          streamingRef.current += token;
          setEntries((prev) => {
            const existing = prev.find((e) => e.id === streamId);
            if (existing) {
              return prev.map((e) =>
                e.id === streamId ? { ...e, content: streamingRef.current } : e,
              );
            }
            return [...prev, { id: streamId, type: 'ai' as const, content: streamingRef.current }];
          });
        });
        if (result.type !== 'ai-stream' && result.message) {
          addEntry(
            result.type === 'success' ? 'success' : result.type === 'error' ? 'error' : 'info',
            result.message,
          );
        }
      } catch (err: unknown) {
        addEntry('error', `Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setIsProcessing(false);
        streamingRef.current = '';
        setTimeout(() => setShouldAutoSave(true), 100);
      }
    }
  };

  // ============================================
  // Command Suggestions Filtering
  // ============================================

  const filteredSuggestions = React.useMemo(() => {
    if (!input.trim()) return [];
    const query = input.toLowerCase().trim();
    return COMMAND_SUGGESTIONS.filter((s) =>
      s.command.toLowerCase().includes(query) ||
      s.description.toLowerCase().includes(query)
    ).slice(0, 8); // Limit to 8 suggestions
  }, [input]);

  // Show suggestions when typing
  React.useEffect(() => {
    setShowSuggestions(filteredSuggestions.length > 0 && input.length > 0 && !isProcessing);
    setSelectedSuggestionIndex(0);
  }, [filteredSuggestions.length, input, isProcessing]);

  // Scroll selected suggestion into view
  React.useEffect(() => {
    if (showSuggestions && suggestionsRef.current) {
      const selected = suggestionsRef.current.querySelector('.suggestion-item.selected');
      selected?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedSuggestionIndex, showSuggestions]);

  const selectSuggestion = (suggestion: CommandSuggestion) => {
    setInput(suggestion.command + ' ');
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle suggestion navigation
    if (showSuggestions && filteredSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIndex((prev) =>
          prev < filteredSuggestions.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIndex((prev) =>
          prev > 0 ? prev - 1 : filteredSuggestions.length - 1
        );
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && filteredSuggestions.length > 0)) {
        e.preventDefault();
        selectSuggestion(filteredSuggestions[selectedSuggestionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        return;
      }
    }

    // Normal Enter handling (submit command)
    if (e.key === 'Enter' && !showSuggestions) {
      handleSubmit();
      return;
    }

    // History navigation (only when not showing suggestions)
    if (e.key === 'ArrowUp' && !showSuggestions) {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
      }
    } else if (e.key === 'ArrowDown' && !showSuggestions) {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
      } else {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  };

  // Quick action buttons
  const runQuickCommand = (cmd: string) => {
    setInput(cmd);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  // ============================================
  // Voice Input
  // ============================================

  const toggleVoice = () => {
    if (voiceActive) {
      stopVoice();
    } else {
      startVoice();
    }
  };

  const startVoice = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      addEntry('error', 'Speech recognition not supported in this browser. Use Chrome or Edge.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
      setVoiceTranscript(transcript);

      if (event.results[event.results.length - 1].isFinal) {
        const finalText = transcript.trim();
        if (finalText) {
          stopVoice();
          setTimeout(() => handleSubmit(finalText), 100);
        }
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error !== 'aborted') {
        addEntry('error', `Voice error: ${event.error}`);
      }
      setVoiceActive(false);
      setVoiceListening(false);
    };

    recognition.onend = () => {
      setVoiceActive(false);
      setVoiceListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setVoiceActive(true);
    setVoiceListening(true);
    addEntry('info', 'Listening... Speak your command.');
  };

  const stopVoice = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setVoiceActive(false);
    setVoiceListening(false);
  };

  // ============================================
  // File Upload
  // ============================================

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target?.result as string;
        const path = file.name;
        const existing = useAppStore.getState().files.find((f) => f.path === path);
        if (existing) {
          FileOps.update(path, content);
          addEntry('success', `Updated \`${path}\` (${content.split('\n').length} lines)`);
        } else {
          FileOps.create(path, content);
          addEntry('success', `Uploaded \`${path}\` (${content.split('\n').length} lines)`);
        }
      };
      reader.onerror = () => {
        addEntry('error', `Failed to read ${file.name}`);
      };
      reader.readAsText(file);
    });

    e.target.value = '';
  };

  // ============================================
  // TTS
  // ============================================

  const speakLastResponse = () => {
    const lastAi = [...entries].reverse().find((e) => e.type === 'ai' || e.type === 'info');
    if (!lastAi) return;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const text = lastAi.content.replace(/\*\*/g, '').replace(/```[\s\S]*?```/g, 'code block').slice(0, 500);
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      utterance.pitch = 1;
      window.speechSynthesis.speak(utterance);
    }
  };

  return (
    <div className="command-terminal" onClick={() => inputRef.current?.focus()}>
      <div className="command-terminal-header">
        <Terminal size={14} />
        <span>AI TERMINAL</span>
        <div className="terminal-quick-actions">
          <button onClick={() => runQuickCommand('/undo')} title="Undo last AI edit">
            <Undo2 size={12} />
          </button>
          <button onClick={speakLastResponse} title="Speak last response">
            <Volume2 size={12} />
          </button>
        </div>
      </div>

      <div className="command-terminal-output" ref={scrollRef}>
        {entries.map((entry) => {
          if (entry.type === 'agent-live') {
            return <AgentLiveEntry key={entry.id} entry={entry} />;
          }
          if (entry.type === 'task-live') {
            return <TaskLiveEntry key={entry.id} entry={entry} />;
          }
          if (entry.type === 'project-live') {
            return <ProjectLiveEntry key={entry.id} entry={entry} />;
          }
          return (
            <div key={entry.id} className={`terminal-entry terminal-${entry.type}`}>
              {entry.type === 'input' && (
                <span className="terminal-prompt">
                  <ChevronRight size={12} />
                </span>
              )}
              {entry.type === 'success' && (
                <span className="terminal-prompt terminal-check">
                  <Check size={12} />
                </span>
              )}
              <div className="terminal-content">
                <TerminalText content={entry.content} />
              </div>
            </div>
          );
        })}
        {isProcessing && !streamingRef.current && (
          <div className="terminal-entry terminal-loading">
            <Loader2 size={14} className="spin" />
            <span>Processing...</span>
          </div>
        )}
      </div>

      {/* ============================================ */}
      {/* Chat Toolbar                                 */}
      {/* ============================================ */}
      <div className="terminal-toolbar">
        <button
          className={`toolbar-btn ${voiceActive ? 'active voice-active' : ''}`}
          onClick={(e) => { e.stopPropagation(); toggleVoice(); }}
          title={voiceActive ? 'Stop listening' : 'Voice input'}
        >
          {voiceActive ? <MicOff size={14} /> : <Mic size={14} />}
          {voiceActive && <span className="toolbar-pulse" />}
        </button>

        <button
          className="toolbar-btn"
          onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
          title="Upload files"
        >
          <Upload size={14} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileUpload}
          accept=".py,.ts,.tsx,.js,.jsx,.html,.css,.json,.md,.txt,.go,.rs,.java,.c,.cpp,.h,.sql,.sh,.yaml,.yml,.toml,.xml,.csv"
        />

        <button
          className="toolbar-btn"
          onClick={(e) => { e.stopPropagation(); handleSubmit('/agents'); }}
          title="View agents"
        >
          <Bot size={14} />
        </button>

        <button
          className="toolbar-btn"
          onClick={(e) => { e.stopPropagation(); saveCurrentChat(); }}
          title={`Save chat to history (${chatSessions.length} saved)`}
        >
          <Save size={14} />
        </button>

        <div className="toolbar-features-wrapper" ref={featurePanelRef}>
          <button
            className={`toolbar-btn ${showFeaturePanel ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setShowFeaturePanel(!showFeaturePanel); }}
            title="Features & Status"
          >
            <Settings2 size={14} />
          </button>

          {showFeaturePanel && (
            <FeaturePanel
              onClose={() => setShowFeaturePanel(false)}
              onCommand={(cmd) => { setShowFeaturePanel(false); handleSubmit(cmd); }}
            />
          )}
        </div>
      </div>

      {/* Input area with suggestions */}
      <div className="command-terminal-input-wrapper">
        {/* Suggestions dropdown */}
        {showSuggestions && filteredSuggestions.length > 0 && (
          <div className="command-suggestions" ref={suggestionsRef}>
            <div className="command-suggestions-header">
              <Command size={11} />
              <span>Suggestions</span>
              <span className="command-suggestions-hint">Tab to complete</span>
            </div>
            {filteredSuggestions.map((suggestion, index) => (
              <div
                key={suggestion.command}
                className={`suggestion-item ${index === selectedSuggestionIndex ? 'selected' : ''} suggestion-${suggestion.category}`}
                onClick={() => selectSuggestion(suggestion)}
                onMouseEnter={() => setSelectedSuggestionIndex(index)}
              >
                <span className="suggestion-icon">{suggestion.icon}</span>
                <span className="suggestion-command">{suggestion.command}</span>
                <span className="suggestion-desc">{suggestion.description}</span>
                <span className={`suggestion-badge suggestion-badge-${suggestion.category}`}>
                  {suggestion.category === 'command' ? 'CMD' : suggestion.category === 'ai' ? 'AI' : 'ACTION'}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="command-terminal-input">
          <ChevronRight size={14} className="input-prompt" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setShowSuggestions(filteredSuggestions.length > 0 && input.length > 0)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder={
              voiceActive ? 'Listening...' :
              isProcessing ? 'Processing...' :
              'Ask AI, type a command, or @NodeName to target a peer...'
            }
            disabled={voiceActive || isProcessing}
            autoComplete="off"
            spellCheck={false}
          />
          {/* Quick-access icon buttons — right side of input */}
          <div className="terminal-input-actions">
            {(() => {
              const peerCount = nodes.filter(n => n.status !== 'offline' && !n.isSelf).length;
              return (
                <button
                  className={`terminal-quick-btn${peerCount > 0 ? ' has-peers' : ''}${showNodesPopup ? ' active' : ''}`}
                  onClick={() => { setShowNodesPopup(v => !v); setShowBuildPopup(false); }}
                  title={`Nodes · ${nodes.filter(n => n.status !== 'offline').length} online`}
                >
                  <Server size={13} />
                  {peerCount > 0 && <span className="tqb-dot" />}
                </button>
              );
            })()}
            <button
              className={`terminal-quick-btn${projectSession?.status === 'running' ? ' active' : ''}${showBuildPopup ? ' active' : ''}`}
              onClick={() => { setShowBuildPopup(v => !v); setShowNodesPopup(false); }}
              title={projectSession?.status === 'running'
                ? `Build running · ${projectSession.completedCount}/${projectSession.totalSubtasks} done`
                : 'Project Builder'}
            >
              <Layers size={13} />
              {projectSession?.status === 'running' && <span className="tqb-dot pulse" />}
            </button>
          </div>

          {/* Nodes popup */}
          {showNodesPopup && (
            <div className="terminal-popup nodes-popup">
              <div className="tpop-header">
                <Server size={12} />
                <span>Nodes</span>
                <span className="tpop-count">{nodes.filter(n => n.status !== 'offline').length} online</span>
                <button className="tpop-close" onClick={() => setShowNodesPopup(false)}><X size={11} /></button>
              </div>
              <div className="tpop-body">
                {nodes.length === 0 && (
                  <div className="tpop-empty">No nodes connected yet</div>
                )}
                {nodes.map(node => (
                  <div key={node.id} className={`tpop-node-row ${node.status}`}>
                    <span className={`tpop-dot ${node.status}`} />
                    <span className="tpop-node-name">{node.name}{node.isSelf ? ' (you)' : ''}</span>
                    {node.modelLoaded && <span className="tpop-tag model">AI</span>}
                    {node.currentTask && <span className="tpop-tag task" title={node.currentTask}>⚙</span>}
                    <span className="tpop-node-role">{node.role}</span>
                  </div>
                ))}
              </div>
              <div className="tpop-footer">
                <button className="tpop-link" onClick={() => { setShowNodesPopup(false); setShowFullNodes(true); }}>
                  Open full view →
                </button>
              </div>
            </div>
          )}

          {/* Build popup */}
          {showBuildPopup && (
            <div className="terminal-popup build-popup">
              <div className="tpop-header">
                <Layers size={12} />
                <span>Project Builder</span>
                {projectSession && <span className={`tpop-status-badge ${projectSession.status}`}>{projectSession.status}</span>}
                <button className="tpop-close" onClick={() => setShowBuildPopup(false)}><X size={11} /></button>
              </div>
              <div className="tpop-body">
                {!projectSession && (
                  <div className="tpop-empty">No active build. Type <code>/build &lt;prompt&gt;</code> to start.</div>
                )}
                {projectSession && (
                  <>
                    <div className="tpop-build-prompt">"{projectSession.prompt.slice(0, 70)}{projectSession.prompt.length > 70 ? '…' : ''}"</div>
                    <div className="tpop-progress-row">
                      <div className="tpop-progress-bar">
                        <div className="tpop-progress-fill" style={{ width: `${projectSession.totalSubtasks > 0 ? (projectSession.completedCount / projectSession.totalSubtasks) * 100 : 0}%` }} />
                      </div>
                      <span className="tpop-progress-label">{projectSession.completedCount}/{projectSession.totalSubtasks}</span>
                    </div>
                    <div className="tpop-subtask-list">
                      {projectSession.subtasks.filter(s => s.status === 'running' || s.status === 'assigned').map(s => (
                        <div key={s.id} className="tpop-subtask-row running">
                          <Loader2 size={10} className="spin" />
                          <span>{s.title}</span>
                          {s.assignedNodeName && <span className="tpop-node-tag">{s.assignedNodeName}</span>}
                        </div>
                      ))}
                      {projectSession.subtasks.filter(s => s.status === 'completed').slice(-3).map(s => (
                        <div key={s.id} className="tpop-subtask-row done">
                          <CheckCircle2 size={10} />
                          <span>{s.title}</span>
                        </div>
                      ))}
                      {projectSession.subtasks.filter(s => s.status === 'failed').map(s => (
                        <div key={s.id} className="tpop-subtask-row failed">
                          <AlertCircle size={10} />
                          <span>{s.title}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className="tpop-footer">
                <button className="tpop-link" onClick={() => { setShowBuildPopup(false); setShowFullBuild(true); }}>
                  Open full view →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full-screen overlays — rendered over the terminal, not replacing the IDE */}
      {showFullNodes && (
        <div className="terminal-full-overlay">
          <div className="tfo-header">
            <Server size={14} />
            <span>Nodes</span>
            <button className="tfo-close" onClick={() => setShowFullNodes(false)}><X size={14} /></button>
          </div>
          <div className="tfo-body">
            <NodeGrid />
          </div>
        </div>
      )}

      {showFullBuild && (
        <div className="terminal-full-overlay">
          <div className="tfo-header">
            <Layers size={14} />
            <span>Project Builder</span>
            <button className="tfo-close" onClick={() => setShowFullBuild(false)}><X size={14} /></button>
          </div>
          <div className="tfo-body">
            <ProjectBuilder />
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// AgentLiveEntry — Claude Code-style live agent card
// ============================================

// ============================================
// TaskLiveEntry — Mesh task with micro-progress
// ============================================

const TASK_TYPE_LABEL: Record<string, string> = {
  'code-gen': 'CODE-GEN',
  debug: 'DEBUG',
  test: 'TEST',
  review: 'REVIEW',
  summarize: 'SUMMARIZE',
  inference: 'INFERENCE',
};

function TaskLiveEntry({ entry }: { entry: TerminalEntry }) {
  const [expanded, setExpanded] = useState(true);
  const status = entry.taskStatus || 'queued';
  const progress = entry.taskProgress || 0;
  const hasContent = entry.content && entry.content.length > 0;
  const nodeName = entry.taskNodeName;
  const typeLabel = TASK_TYPE_LABEL[entry.taskType || 'code-gen'] || 'TASK';

  const statusIcon = () => {
    switch (status) {
      case 'queued':    return <Clock size={13} className="task-icon-queued" />;
      case 'assigned':  return <Zap size={13} className="task-icon-assigned pulse-opacity" />;
      case 'running':   return <Loader2 size={13} className="spin task-icon-running" />;
      case 'completed': return <CheckCircle2 size={13} className="task-icon-done" />;
      case 'failed':    return <AlertCircle size={13} className="task-icon-error" />;
      default:          return <Activity size={13} />;
    }
  };

  const nodeLabel = () => {
    if (!nodeName) {
      if (status === 'queued') return 'Queued — waiting for available peer…';
      return 'Routing to best peer…';
    }
    switch (status) {
      case 'queued':    return `Queued on ${nodeName}`;
      case 'assigned':  return `→ ${nodeName} (starting…)`;
      case 'running':   return `⚙ ${nodeName}  ${progress}%`;
      case 'completed': return `✓ ${nodeName} — done`;
      case 'failed':    return `✗ ${nodeName} — failed`;
      default:          return nodeName;
    }
  };

  return (
    <div className={`terminal-entry terminal-task-live task-status-${status}`}>
      <div
        className="task-live-header"
        onClick={() => hasContent && setExpanded(!expanded)}
        style={{ cursor: hasContent ? 'pointer' : 'default' }}
      >
        <span className="task-live-icon">{statusIcon()}</span>
        <span className="task-live-type">{typeLabel}</span>
        <span className="task-live-title">{entry.taskTitle}</span>
        <span className="task-live-node">{nodeLabel()}</span>
        {(status === 'running' || status === 'assigned') && (
          <span className="task-live-bar-wrapper">
            <span
              className="task-live-bar"
              style={{ width: `${progress}%`, transition: 'width 0.3s ease' }}
            />
          </span>
        )}
        {hasContent && (
          <span className="task-live-toggle">
            <ArrowRight
              size={11}
              style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
            />
          </span>
        )}
      </div>
      {expanded && hasContent && (
        <div className="task-live-body">
          <TerminalText content={entry.content} />
        </div>
      )}
    </div>
  );
}

function AgentLiveEntry({ entry }: { entry: TerminalEntry }) {
  const [expanded, setExpanded] = useState(true);
  const status = entry.agentStatus || 'queued';
  const progress = entry.agentProgress || 0;
  const hasContent = entry.content && entry.content.length > 0;

  const statusIcon = () => {
    switch (status) {
      case 'queued':
        return <Loader2 size={13} className="spin agent-icon-queued" />;
      case 'running':
        return <Activity size={13} className="agent-icon-running pulse-opacity" />;
      case 'done':
        return <CheckCircle2 size={13} className="agent-icon-done" />;
      case 'error':
        return <AlertCircle size={13} className="agent-icon-error" />;
      default:
        return <Zap size={13} />;
    }
  };

  const statusLabel = () => {
    switch (status) {
      case 'queued': return 'Queued';
      case 'running': return entry.agentNode || `Running... ${progress}%`;
      case 'done': return 'Completed';
      case 'error': return 'Failed';
      default: return status;
    }
  };

  return (
    <div className={`terminal-entry terminal-agent-live agent-status-${status}`}>
      <div
        className="agent-live-header"
        onClick={() => hasContent && setExpanded(!expanded)}
        style={{ cursor: hasContent ? 'pointer' : 'default' }}
      >
        <span className="agent-live-icon">{statusIcon()}</span>
        <span className="agent-live-name">{entry.agentName || entry.agentRole}</span>
        <span className="agent-live-status">{statusLabel()}</span>
        {status === 'running' && (
          <span className="agent-live-bar-wrapper">
            <span className="agent-live-bar" style={{ width: `${progress}%` }} />
          </span>
        )}
        {hasContent && (
          <span className="agent-live-toggle">
            <ArrowRight size={11} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
          </span>
        )}
      </div>
      {expanded && hasContent && (
        <div className="agent-live-body">
          <TerminalText content={entry.content} />
        </div>
      )}
    </div>
  );
}

// ============================================
// ProjectLiveEntry — real-time distributed build log
// ============================================

const LOG_LEVEL_COLOR: Record<string, string> = {
  info:     'var(--text-muted)',
  assign:   '#64b5f6',   // blue
  running:  '#ffb74d',   // amber
  done:     '#81c784',   // green
  fail:     '#e57373',   // red
  requeue:  '#ffb74d',   // amber
  warn:     '#ffd54f',   // yellow
  complete: '#a5d6a7',   // bright green
};

const LOG_LEVEL_ICON: Record<string, string> = {
  info:     '·',
  assign:   '→',
  running:  '⚙',
  done:     '✓',
  fail:     '✗',
  requeue:  '↺',
  warn:     '⚠',
  complete: '★',
};

function formatLogTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function ProjectLiveEntry({ entry }: { entry: TerminalEntry }) {
  const [expanded, setExpanded] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

  const status = entry.projectStatus || 'decomposing';
  const logs = entry.projectLogs || [];
  const done = entry.projectDone ?? 0;
  const total = entry.projectTotal ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // Auto-scroll log to bottom as new lines arrive
  useEffect(() => {
    if (expanded && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [logs.length, expanded]);

  const statusIcon = () => {
    if (status === 'completed') return <CheckCircle2 size={13} style={{ color: '#81c784' }} />;
    if (status === 'failed')    return <AlertCircle  size={13} style={{ color: '#e57373' }} />;
    return <Loader2 size={13} className="spin" style={{ color: '#64b5f6' }} />;
  };

  const statusLabel = () => {
    if (status === 'decomposing') return 'Decomposing…';
    if (status === 'running')     return `${done}/${total} subtasks  (${pct}%)`;
    if (status === 'completed')   return `Done — ${done}/${total} subtasks`;
    if (status === 'failed')      return 'Failed';
    return status;
  };

  return (
    <div className={`terminal-entry terminal-project-live project-status-${status}`}>
      {/* ── Header row ── */}
      <div className="proj-live-header" onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
        <span className="proj-live-icon">{statusIcon()}</span>
        <span className="proj-live-badge">PROJECT BUILD</span>
        <span className="proj-live-prompt">
          {(entry.projectPrompt || '').slice(0, 55)}{(entry.projectPrompt || '').length > 55 ? '…' : ''}
        </span>
        <span className="proj-live-status">{statusLabel()}</span>
        <ArrowRight
          size={11}
          className="proj-live-toggle"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', marginLeft: 'auto', flexShrink: 0 }}
        />
      </div>

      {/* ── Progress bar ── */}
      {total > 0 && (
        <div className="proj-live-progress-wrap">
          <div
            className={`proj-live-progress-bar ${status === 'completed' ? 'done' : ''}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* ── Log lines ── */}
      {expanded && (
        <div className="proj-live-log">
          {logs.length === 0 && (
            <div className="proj-live-empty">Waiting for events…</div>
          )}
          {logs.map((line, i) => (
            <div key={i} className="proj-live-line">
              <span className="proj-live-line-time">{formatLogTime(line.ts)}</span>
              <span
                className="proj-live-line-icon"
                style={{ color: LOG_LEVEL_COLOR[line.level] || 'var(--text-muted)' }}
              >
                {LOG_LEVEL_ICON[line.level] || '·'}
              </span>
              <span
                className="proj-live-line-text"
                style={{ color: LOG_LEVEL_COLOR[line.level] || 'var(--text-secondary)' }}
              >
                {line.text}
              </span>
              {line.file && (
                <span className="proj-live-line-file">{line.file.split('/').pop()}</span>
              )}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );
}

// ============================================
// Feature Panel
// ============================================

function FeaturePanel({ onClose, onCommand }: { onClose: () => void; onCommand: (cmd: string) => void }) {
  const nodes = useAppStore((s) => s.nodes);
  const modelLoaded = useAppStore((s) => s.modelLoaded);
  const selectedModelId = useAppStore((s) => s.selectedModelId);
  const availableModels = useAppStore((s) => s.availableModels);
  const agents = useAppStore((s) => s.agents);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const masterId = useAppStore((s) => s.masterId);

  const peers = nodes.filter((n) => !n.isSelf && n.status !== 'offline');
  const model = availableModels.find((m) => m.id === selectedModelId);
  const workingAgents = agents.filter((a) => a.status === 'working').length;

  return (
    <div className="feature-panel" onClick={(e) => e.stopPropagation()}>
      <div className="feature-panel-header">
        <span>Features & Status</span>
        <button className="feature-panel-close" onClick={onClose}><X size={12} /></button>
      </div>

      {/* P2P Mesh */}
      <div className="feature-section">
        <div className="feature-section-title">
          {peers.length > 0 ? <Wifi size={12} /> : <WifiOff size={12} />}
          <span>P2P Mesh Network</span>
        </div>
        <div className="feature-row">
          <Users size={11} />
          <span>{peers.length} peer{peers.length !== 1 ? 's' : ''} connected</span>
        </div>
        {masterId && (
          <div className="feature-row">
            <span className="feature-label">Master:</span>
            <span className="feature-value">{masterId.slice(0, 12)}...</span>
          </div>
        )}
        <button className="feature-action" onClick={() => onCommand('/mesh')}>View mesh details</button>
      </div>

      {/* AI Model */}
      <div className="feature-section">
        <div className="feature-section-title">
          <Cpu size={12} />
          <span>AI Model</span>
        </div>
        <div className="feature-row">
          <span className={`feature-dot ${modelLoaded ? 'green' : 'gray'}`} />
          <span>{modelLoaded ? model?.name || 'Loaded' : 'No model loaded'}</span>
        </div>
        <button className="feature-action" onClick={() => { onClose(); setSettingsOpen(true); }}>
          {modelLoaded ? 'Change model' : 'Load model'}
        </button>
      </div>

      {/* Background Agents */}
      <div className="feature-section">
        <div className="feature-section-title">
          <Bot size={12} />
          <span>Background Agents</span>
        </div>
        <div className="feature-row">
          <span>{agents.length} agents — {workingAgents} active</span>
        </div>
        {agents.slice(0, 6).map((a) => (
          <div key={a.id} className="feature-row feature-agent-row">
            <span className={`feature-dot ${a.status === 'working' ? 'blue' : a.status === 'error' ? 'red' : a.status === 'done' ? 'green' : 'gray'}`} />
            <span className="feature-agent-name">{a.name}</span>
            <span className="feature-agent-status">{a.status}</span>
          </div>
        ))}
        <button className="feature-action" onClick={() => onCommand('/agents')}>Manage agents</button>
      </div>

      {/* Quick Actions */}
      <div className="feature-section">
        <div className="feature-section-title">Quick Actions</div>
        <div className="feature-quick-actions">
          <button onClick={() => onCommand('/agents analyze')}>Analyze file</button>
          <button onClick={() => onCommand('/settings')}>Settings</button>
          <button onClick={() => onCommand('/theme')}>Toggle theme</button>
          <button onClick={() => onCommand('/help')}>Help</button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Markdown-like renderer with copy button
// ============================================

function TerminalText({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const lines = part.slice(3, -3);
          const firstNewline = lines.indexOf('\n');
          const lang = firstNewline >= 0 ? lines.slice(0, firstNewline).trim() : '';
          const code = firstNewline >= 0 ? lines.slice(firstNewline + 1) : lines;
          return <CodeBlockWithCopy key={i} code={code} language={lang} />;
        }

        return (
          <span key={i}>
            {part.split('\n').map((line, j) => (
              <React.Fragment key={j}>
                {j > 0 && <br />}
                <TerminalLine line={line} />
              </React.Fragment>
            ))}
          </span>
        );
      })}
    </>
  );
}

function CodeBlockWithCopy({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="terminal-code-block-wrapper">
      <div className="terminal-code-block-header">
        {language && <span className="terminal-code-lang">{language}</span>}
        <button className="terminal-copy-btn" onClick={handleCopy} title="Copy code">
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="terminal-code-block">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function TerminalLine({ line }: { line: string }) {
  const parts = line.split(/(\*\*.*?\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        const codeParts = part.split(/(`[^`]+`)/g);
        return (
          <React.Fragment key={i}>
            {codeParts.map((cp, j) => {
              if (cp.startsWith('`') && cp.endsWith('`')) {
                return <code key={j} className="terminal-inline-code">{cp.slice(1, -1)}</code>;
              }
              return <React.Fragment key={j}>{cp}</React.Fragment>;
            })}
          </React.Fragment>
        );
      })}
    </>
  );
}
