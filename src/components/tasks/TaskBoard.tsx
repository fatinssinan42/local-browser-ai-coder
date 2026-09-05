import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import { getMeshOrchestrator } from '../../services/MeshOrchestrator';
import {
  Search, FileText, RefreshCw, Plus, X, Send, Trash2,
  CheckCircle2, AlertCircle, Loader2, Clock, Cpu,
  Copy, Check, ChevronDown, ChevronUp, File, Wifi, WifiOff,
  Zap, Users,
} from 'lucide-react';
import { getStatusColor, formatRelativeTime } from '../../utils/helpers';
import type { TaskStatus, TaskType, TaskPriority } from '../../types';
import './TaskBoard.css';

const STATUSES: TaskStatus[] = ['queued', 'assigned', 'running', 'waiting', 'failed', 'reassigned', 'completed'];
const TASK_TYPES: TaskType[] = ['inference', 'code-gen', 'debug', 'test', 'review', 'summarize'];
const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'critical'];

const TYPE_DESCRIPTIONS: Record<TaskType, string> = {
  'inference': 'Run AI inference on the selected files',
  'code-gen':  'Generate or modify code',
  'debug':     'Find and fix bugs in the selected files',
  'test':      'Generate unit tests for the selected files',
  'review':    'Review code quality and suggest improvements',
  'summarize': 'Summarize what the code does',
};

function StatusIcon({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'completed': return <CheckCircle2 size={13} className="status-icon completed" />;
    case 'failed':    return <AlertCircle size={13} className="status-icon failed" />;
    case 'running':   return <Loader2 size={13} className="status-icon running spin" />;
    case 'assigned':  return <Zap size={13} className="status-icon assigned" />;
    case 'queued':    return <Clock size={13} className="status-icon queued" />;
    default:          return <Clock size={13} className="status-icon" />;
  }
}

// Simple markdown renderer for task results
function ResultText({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <div className="result-text">
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const inner = part.slice(3, -3);
          const nl = inner.indexOf('\n');
          const lang = nl >= 0 ? inner.slice(0, nl).trim() : '';
          const code = nl >= 0 ? inner.slice(nl + 1) : inner;
          return <ResultCode key={i} code={code} lang={lang} />;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i} className="result-inline-code">{part.slice(1, -1)}</code>;
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        return (
          <span key={i}>
            {part.split('\n').map((line, j) => (
              <React.Fragment key={j}>
                {j > 0 && <br />}
                {line}
              </React.Fragment>
            ))}
          </span>
        );
      })}
    </div>
  );
}

function ResultCode({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="result-code-block">
      <div className="result-code-header">
        {lang && <span className="result-code-lang">{lang}</span>}
        <button
          className="result-copy-btn"
          onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        >
          {copied ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy</>}
        </button>
      </div>
      <pre className="result-code-pre"><code>{code}</code></pre>
    </div>
  );
}

export function TaskBoard() {
  const tasks    = useAppStore((s) => s.tasks);
  const nodes    = useAppStore((s) => s.nodes);
  const files    = useAppStore((s) => s.files);
  const activeFilePath = useAppStore((s) => s.activeFilePath);
  const removeTask     = useAppStore((s) => s.removeTask);
  const setSelectedTaskId = useAppStore((s) => s.setSelectedTaskId);

  const [filter,      setFilter]      = useState<TaskStatus | 'all'>('all');
  const [search,      setSearch]      = useState('');
  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [showCreate,  setShowCreate]  = useState(false);

  // Create modal state
  const [newTitle,    setNewTitle]    = useState('');
  const [newType,     setNewType]     = useState<TaskType>('code-gen');
  const [newPriority, setNewPriority] = useState<TaskPriority>('normal');
  const [newPrompt,   setNewPrompt]   = useState('');
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [creating,    setCreating]    = useState(false);
  const [createError, setCreateError] = useState('');

  // Auto-attach active file when modal opens
  useEffect(() => {
    if (showCreate && activeFilePath && !selectedFiles.includes(activeFilePath)) {
      setSelectedFiles([activeFilePath]);
    }
  }, [showCreate, activeFilePath]);

  // Auto-select newly created task
  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);
  useEffect(() => {
    if (lastCreatedId && tasks.find((t) => t.id === lastCreatedId)) {
      setSelectedId(lastCreatedId);
      setSelectedTaskId(lastCreatedId);
      setLastCreatedId(null);
    }
  }, [tasks, lastCreatedId, setSelectedTaskId]);

  const peers   = nodes.filter((n) => !n.isSelf && n.status !== 'offline');
  const selfNode = nodes.find((n) => n.isSelf);

  const filtered = tasks.filter((t) => {
    if (filter !== 'all' && t.status !== filter) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const selectedTask = tasks.find((t) => t.id === selectedId);

  const handleCreateTask = async () => {
    if (!newTitle.trim()) { setCreateError('Title is required'); return; }
    setCreating(true);
    setCreateError('');

    try {
      const orchestrator = getMeshOrchestrator();
      const task = orchestrator.tasks.createTask(newTitle.trim(), newType, {
        priority:     newPriority,
        relatedFiles: selectedFiles,
        context:      newPrompt,
      });

      orchestrator.tasks.distributeTask(task.id);
      setLastCreatedId(task.id);
      setShowCreate(false);
      resetForm();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setCreating(false);
    }
  };

  const resetForm = () => {
    setNewTitle('');
    setNewPrompt('');
    setNewType('code-gen');
    setNewPriority('normal');
    setSelectedFiles([]);
    setCreateError('');
  };

  const handleDistributeQueued = () => {
    try { getMeshOrchestrator().tasks.distributeAllQueued(); } catch { /* ignore */ }
  };

  const toggleFile = (path: string) => {
    setSelectedFiles((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  };

  const queuedCount  = tasks.filter((t) => t.status === 'queued').length;
  const runningCount = tasks.filter((t) => t.status === 'running' || t.status === 'assigned').length;

  return (
    <div className="tasks-view">
      {/* ---- Header ---- */}
      <div className="tasks-header">
        <div className="tasks-header-left">
          <h2 className="tasks-title">Tasks</h2>
          <div className="tasks-mesh-status">
            {peers.length > 0
              ? <><Wifi size={11} className="mesh-icon online" /><span>{peers.length + 1} nodes</span></>
              : <><WifiOff size={11} className="mesh-icon offline" /><span>Standalone</span></>
            }
          </div>
        </div>
        <div className="tasks-header-right">
          {queuedCount > 0 && (
            <button className="tasks-btn tasks-btn-secondary" onClick={handleDistributeQueued} title="Distribute all queued tasks">
              <Send size={13} /> Distribute ({queuedCount})
            </button>
          )}
          <button className="tasks-btn tasks-btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={13} /> New Task
          </button>
        </div>
      </div>

      {/* ---- Stats strip ---- */}
      <div className="tasks-stats">
        <div className="tasks-stat">
          <span className="tasks-stat-num">{tasks.length}</span>
          <span className="tasks-stat-label">total</span>
        </div>
        <div className="tasks-stat running">
          <span className="tasks-stat-num">{runningCount}</span>
          <span className="tasks-stat-label">running</span>
        </div>
        <div className="tasks-stat queued">
          <span className="tasks-stat-num">{queuedCount}</span>
          <span className="tasks-stat-label">queued</span>
        </div>
        <div className="tasks-stat done">
          <span className="tasks-stat-num">{tasks.filter((t) => t.status === 'completed').length}</span>
          <span className="tasks-stat-label">done</span>
        </div>
      </div>

      {/* ---- Search + filters ---- */}
      <div className="tasks-toolbar">
        <div className="tasks-search">
          <Search size={12} />
          <input
            type="text"
            placeholder="Search tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="tasks-filters">
          <button className={`filter-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
            All
          </button>
          {STATUSES.map((s) => {
            const count = tasks.filter((t) => t.status === s).length;
            if (count === 0) return null;
            return (
              <button
                key={s}
                className={`filter-chip ${filter === s ? 'active' : ''}`}
                onClick={() => setFilter(s)}
              >
                <span className="filter-dot" style={{ background: getStatusColor(s) }} />
                {s} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- Task list + detail ---- */}
      <div className="tasks-body">
        <div className="tasks-list">
          {filtered.length === 0 && (
            <div className="tasks-empty">
              <FileText size={32} strokeWidth={1} />
              <p>{tasks.length === 0 ? 'No tasks yet' : 'No tasks match your filters'}</p>
              {tasks.length === 0 && (
                <button className="tasks-btn tasks-btn-primary" onClick={() => setShowCreate(true)}>
                  <Plus size={13} /> Create your first task
                </button>
              )}
            </div>
          )}
          {filtered.map((task) => {
            const assignedNode = nodes.find((n) => n.id === task.assignedNode);
            return (
              <div
                key={task.id}
                className={`task-card ${selectedId === task.id ? 'selected' : ''} status-${task.status}`}
                onClick={() => { setSelectedId(task.id); setSelectedTaskId(task.id); }}
              >
                <div className="task-card-left">
                  <StatusIcon status={task.status} />
                </div>
                <div className="task-card-body">
                  <div className="task-card-top">
                    <span className="task-card-title">{task.title}</span>
                    <span className={`task-type-badge type-${task.type}`}>{task.type}</span>
                  </div>
                  <div className="task-card-meta">
                    {assignedNode
                      ? <span className="task-node"><Cpu size={10} /> {assignedNode.name}</span>
                      : <span className="task-node unassigned">Unassigned</span>
                    }
                    <span className="task-priority priority-{task.priority}">{task.priority}</span>
                    {task.retryCount > 0 && (
                      <span className="task-retry"><RefreshCw size={10} /> {task.retryCount}×</span>
                    )}
                  </div>
                  {task.status === 'running' && task.progress > 0 && (
                    <div className="task-progress-bar">
                      <div className="task-progress-fill" style={{ width: `${task.progress}%` }} />
                      <span className="task-progress-pct">{task.progress}%</span>
                    </div>
                  )}
                </div>
                <div className="task-card-right">
                  <span className="task-card-time">{formatRelativeTime(task.updatedAt)}</span>
                  <button
                    className="task-delete-btn"
                    title="Delete task"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTask(task.id);
                      if (selectedId === task.id) { setSelectedId(null); setSelectedTaskId(null); }
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* ---- Detail panel ---- */}
        {selectedTask && (
          <TaskDetailPanel
            task={selectedTask}
            nodes={nodes}
            onDelete={() => {
              removeTask(selectedTask.id);
              setSelectedId(null);
              setSelectedTaskId(null);
            }}
          />
        )}
      </div>

      {/* ---- Create Task Modal ---- */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => { setShowCreate(false); resetForm(); }}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create New Task</h3>
              <button className="modal-close" onClick={() => { setShowCreate(false); resetForm(); }}>
                <X size={16} />
              </button>
            </div>

            <div className="modal-body">
              {/* Peer info strip */}
              <div className="modal-mesh-info">
                {peers.length > 0 ? (
                  <><Users size={12} className="mesh-icon online" />
                  Task will be distributed across {peers.length + 1} nodes</>
                ) : (
                  <><Cpu size={12} /> Running locally (no peers connected)</>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Task Title <span className="required">*</span></label>
                <input
                  className="form-input"
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTask(); }}
                  placeholder="e.g., Generate login component"
                  autoFocus
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Task Type</label>
                  <select className="form-select" value={newType} onChange={(e) => setNewType(e.target.value as TaskType)}>
                    {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <span className="form-hint">{TYPE_DESCRIPTIONS[newType]}</span>
                </div>
                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <select className="form-select" value={newPriority} onChange={(e) => setNewPriority(e.target.value as TaskPriority)}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Description / Prompt</label>
                <textarea
                  className="form-textarea"
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  placeholder="Describe what you want done in detail..."
                  rows={4}
                />
              </div>

              {/* File picker */}
              <div className="form-group">
                <label className="form-label">
                  Attach Files
                  <span className="form-label-sub"> (context for the AI)</span>
                </label>
                {files.length === 0 ? (
                  <div className="file-picker-empty">No files open yet</div>
                ) : (
                  <div className="file-picker">
                    {files.map((f) => (
                      <label key={f.path} className={`file-picker-item ${selectedFiles.includes(f.path) ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selectedFiles.includes(f.path)}
                          onChange={() => toggleFile(f.path)}
                        />
                        <File size={11} />
                        <span className="file-picker-name">{f.path}</span>
                        {f.path === activeFilePath && <span className="file-picker-active">active</span>}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {createError && <div className="form-error">{createError}</div>}
            </div>

            <div className="modal-footer">
              <button className="tasks-btn tasks-btn-secondary" onClick={() => { setShowCreate(false); resetForm(); }}>
                Cancel
              </button>
              <button
                className="tasks-btn tasks-btn-primary"
                onClick={handleCreateTask}
                disabled={creating || !newTitle.trim()}
              >
                {creating
                  ? <><Loader2 size={13} className="spin" /> Creating…</>
                  : <><Plus size={13} /> Create &amp; Distribute</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Task Detail Panel — shows full info, result, history
// ============================================================

interface DetailProps {
  task: ReturnType<typeof useAppStore.getState>['tasks'][0];
  nodes: ReturnType<typeof useAppStore.getState>['nodes'];
  onDelete: () => void;
}

function TaskDetailPanel({ task, nodes, onDelete }: DetailProps) {
  const [resultExpanded, setResultExpanded] = useState(true);
  const assignedNode = nodes.find((n) => n.id === task.assignedNode);

  return (
    <div className="task-detail">
      <div className="task-detail-header">
        <div className="task-detail-title-row">
          <StatusIcon status={task.status} />
          <h3 className="task-detail-title">{task.title}</h3>
        </div>
        <div className="task-detail-actions">
          <span className={`task-status-badge status-${task.status}`}>{task.status}</span>
          <button className="task-delete-full-btn" onClick={onDelete}><Trash2 size={13} /> Delete</button>
        </div>
      </div>

      <div className="task-detail-meta-grid">
        <div className="task-meta-cell">
          <span className="meta-label">Type</span>
          <span className={`task-type-badge type-${task.type}`}>{task.type}</span>
        </div>
        <div className="task-meta-cell">
          <span className="meta-label">Priority</span>
          <span className={`priority-badge priority-${task.priority}`}>{task.priority}</span>
        </div>
        <div className="task-meta-cell">
          <span className="meta-label">Assigned to</span>
          <span className="meta-value">
            {assignedNode ? <><Cpu size={10} /> {assignedNode.name}</> : '—'}
          </span>
        </div>
        <div className="task-meta-cell">
          <span className="meta-label">Retries</span>
          <span className="meta-value">{task.retryCount}</span>
        </div>
      </div>

      {/* Running progress */}
      {task.status === 'running' && (
        <div className="task-detail-progress">
          <div className="task-detail-progress-bar">
            <div className="task-detail-progress-fill" style={{ width: `${task.progress}%` }} />
          </div>
          <span className="task-detail-progress-label">
            <Loader2 size={11} className="spin" /> Running on {assignedNode?.name || 'peer'} — {task.progress}%
          </span>
        </div>
      )}

      {/* Attached files */}
      {task.relatedFiles.length > 0 && (
        <div className="task-detail-section">
          <h4 className="task-section-title">Attached Files</h4>
          <div className="task-files">
            {task.relatedFiles.map((f) => (
              <div key={f} className="task-file-chip"><File size={11} /> {f}</div>
            ))}
          </div>
        </div>
      )}

      {/* Result */}
      {task.result && (
        <div className="task-detail-section">
          <div
            className="task-section-title-row"
            onClick={() => setResultExpanded((v) => !v)}
          >
            <h4 className="task-section-title">Result</h4>
            {resultExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </div>
          {resultExpanded && (
            <div className="task-result-box">
              <ResultText text={task.result} />
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {task.error && (
        <div className="task-detail-section">
          <h4 className="task-section-title error-title"><AlertCircle size={13} /> Error</h4>
          <div className="task-error-box">{task.error}</div>
        </div>
      )}

      {/* History timeline */}
      <div className="task-detail-section">
        <h4 className="task-section-title">Timeline</h4>
        <div className="task-timeline">
          {task.history.map((h, i) => {
            const hNode = nodes.find((n) => n.id === h.nodeId);
            return (
              <div key={i} className="timeline-item">
                <div className="timeline-dot" />
                <div className="timeline-content">
                  <span className="timeline-event">{h.event}</span>
                  {hNode && <span className="timeline-node"><Cpu size={9} /> {hNode.name}</span>}
                  <span className="timeline-time">{formatRelativeTime(h.timestamp)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
