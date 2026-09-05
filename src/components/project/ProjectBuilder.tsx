import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import { getMeshOrchestrator } from '../../services/MeshOrchestrator';
import {
  Play, Square, RefreshCw, Download, FileCode2, CheckCircle2,
  XCircle, Clock, AlertTriangle, Loader2, Cpu, Layers,
  ChevronDown, ChevronRight, Terminal, ArrowDown,
} from 'lucide-react';
import type { ProjectSubtask, ProjectAuditEntry, SubtaskStatus } from '../../types';
import './ProjectBuilder.css';

// ----------------------------------------
// Helpers
// ----------------------------------------

function statusColor(status: SubtaskStatus | string): string {
  switch (status) {
    case 'completed': return 'var(--accent-success)';
    case 'running':   return 'var(--accent-primary)';
    case 'assigned':  return 'var(--accent-primary)';
    case 'failed':    return 'var(--accent-danger)';
    case 'requeued':  return 'var(--accent-warning)';
    default:          return 'var(--text-muted)';
  }
}

function auditEventColor(event: string): string {
  if (event.includes('completed') || event === 'session_completed' || event === 'broadcast_received') return 'var(--accent-success)';
  if (event.includes('failed')) return 'var(--accent-danger)';
  if (event.includes('requeued') || event === 'node_disconnected' || event === 'recovered') return 'var(--accent-warning)';
  return 'var(--accent-primary)';
}

function categoryBadgeClass(category: string): string {
  const map: Record<string, string> = {
    ui: 'cat-ui', api: 'cat-api', database: 'cat-db', auth: 'cat-auth',
    testing: 'cat-test', docs: 'cat-docs', config: 'cat-config',
    logic: 'cat-logic', types: 'cat-types', styles: 'cat-styles', util: 'cat-util',
  };
  return map[category] || 'cat-logic';
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function downloadFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadAllFiles(files: Record<string, string>): void {
  // Download as a single JSON manifest
  const manifest = JSON.stringify(
    Object.entries(files).map(([path, content]) => ({ path, content })),
    null,
    2,
  );
  downloadFile('project-files.json', manifest);
}

// ----------------------------------------
// Sub-components
// ----------------------------------------

function SubtaskCard({ subtask, nodes }: { subtask: ProjectSubtask; nodes: ReturnType<typeof useAppStore.getState>['nodes'] }) {
  const node = nodes.find((n) => n.id === subtask.assignedNodeId);
  const openFile = useAppStore((s) => s.openTab);

  return (
    <div className={`subtask-card status-${subtask.status}`}>
      <div className="subtask-card-header">
        <span className={`subtask-cat ${categoryBadgeClass(subtask.category)}`}>{subtask.category}</span>
        <div className="subtask-status-row">
          {subtask.status === 'running' && <Loader2 size={12} className="spin" />}
          {subtask.status === 'completed' && <CheckCircle2 size={12} style={{ color: 'var(--accent-success)' }} />}
          {subtask.status === 'failed' && <XCircle size={12} style={{ color: 'var(--accent-danger)' }} />}
          {subtask.status === 'requeued' && <RefreshCw size={12} style={{ color: 'var(--accent-warning)' }} />}
          <span className="subtask-status-label" style={{ color: statusColor(subtask.status) }}>
            {subtask.status}
          </span>
        </div>
      </div>

      <div className="subtask-title">{subtask.title}</div>

      <div className="subtask-meta">
        <span className="subtask-file">
          <FileCode2 size={10} />
          {subtask.outputFile}
        </span>
        {node && (
          <span className="subtask-node">
            <Cpu size={10} />
            {node.name}
          </span>
        )}
        {subtask.retryCount > 0 && (
          <span className="subtask-retry">
            <RefreshCw size={10} />
            retry {subtask.retryCount}
          </span>
        )}
      </div>

      {subtask.status === 'completed' && subtask.outputFile && (
        <button
          className="subtask-open-btn"
          onClick={() => openFile(subtask.outputFile)}
        >
          Open in Editor
        </button>
      )}

      {subtask.status === 'failed' && subtask.error && (
        <div className="subtask-error">{subtask.error.slice(0, 100)}</div>
      )}
    </div>
  );
}

function AuditEntry({ entry }: { entry: ProjectAuditEntry }) {
  return (
    <div className="audit-row">
      <span className="audit-dot" style={{ background: auditEventColor(entry.event) }} />
      <span className="audit-time">{formatTs(entry.timestamp)}</span>
      <span className="audit-event" style={{ color: auditEventColor(entry.event) }}>
        {entry.event.replace(/_/g, ' ')}
      </span>
      <span className="audit-detail">{entry.detail}</span>
    </div>
  );
}

// ----------------------------------------
// Main Component
// ----------------------------------------

export function ProjectBuilder() {
  const session = useAppStore((s) => s.projectSession);
  const nodes = useAppStore((s) => s.nodes);
  const modelLoaded = useAppStore((s) => s.modelLoaded);
  const clearProjectSession = useAppStore((s) => s.clearProjectSession);
  const openTab = useAppStore((s) => s.openTab);

  const [prompt, setPrompt] = useState('');
  const [auditExpanded, setAuditExpanded] = useState(true);
  const [filesExpanded, setFilesExpanded] = useState(true);
  const auditEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll audit log to latest
  useEffect(() => {
    if (auditExpanded && auditEndRef.current) {
      auditEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [session?.auditLog?.length, auditExpanded]);

  const handleBuild = async () => {
    if (!prompt.trim()) return;
    const orchestrator = getMeshOrchestrator();
    await orchestrator.project.startSession(prompt.trim());
  };

  const handleCancel = () => {
    getMeshOrchestrator().project.cancelSession();
  };

  const handleNewSession = () => {
    clearProjectSession();
    setPrompt('');
  };

  // Computed values from session
  const subtasks = session?.subtasks || [];
  const pending   = subtasks.filter((s) => s.status === 'pending');
  const active    = subtasks.filter((s) => s.status === 'assigned' || s.status === 'running');
  const done      = subtasks.filter((s) => s.status === 'completed');
  const failed    = subtasks.filter((s) => s.status === 'failed');
  const requeued  = subtasks.filter((s) => s.status === 'requeued');

  const progressPct = session && session.totalSubtasks > 0
    ? Math.round(((session.completedCount) / session.totalSubtasks) * 100)
    : 0;

  return (
    <div className="project-builder">
      <div className="pb-header">
        <div className="pb-title-row">
          <Layers size={18} />
          <h2>Project Builder</h2>
          {session && (
            <span className={`pb-status-badge status-${session.status}`}>
              {session.status === 'decomposing' && <Loader2 size={11} className="spin" />}
              {session.status === 'running'     && <Loader2 size={11} className="spin" />}
              {session.status === 'completed'   && <CheckCircle2 size={11} />}
              {session.status === 'failed'      && <XCircle size={11} />}
              {session.status}
            </span>
          )}
        </div>
        <p className="pb-subtitle">
          Decompose a project prompt into subtasks and distribute across the P2P mesh.
        </p>
      </div>

      {/* ── Prompt Input (shown when no active session) ── */}
      {!session && (
        <div className="pb-prompt-section">
          {!modelLoaded && (
            <div className="pb-warning">
              <AlertTriangle size={14} />
              No model loaded — generated code will be stubs. Load a model in Settings for real AI generation.
            </div>
          )}
          <textarea
            className="pb-prompt-textarea"
            placeholder="Describe the project to build... e.g. 'Build a REST API for a task manager with user auth, CRUD endpoints, and unit tests'"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
          />
          <div className="pb-prompt-actions">
            <span className="pb-char-count">{prompt.length} chars</span>
            <button
              className="pb-build-btn"
              onClick={handleBuild}
              disabled={!prompt.trim()}
            >
              <Play size={14} />
              Build Project
            </button>
          </div>
        </div>
      )}

      {/* ── Active Session ── */}
      {session && (
        <>
          {/* Session header */}
          <div className="pb-session-header">
            <div className="pb-session-prompt">
              <Terminal size={12} />
              <span>{session.prompt.slice(0, 100)}{session.prompt.length > 100 ? '…' : ''}</span>
            </div>
            <div className="pb-session-controls">
              {session.status === 'running' && (
                <button className="pb-btn pb-btn-danger" onClick={handleCancel}>
                  <Square size={12} /> Cancel
                </button>
              )}
              <button className="pb-btn pb-btn-ghost" onClick={handleNewSession}>
                <RefreshCw size={12} /> New Session
              </button>
              {session.status === 'completed' && Object.keys(session.completedFiles).length > 0 && (
                <button
                  className="pb-btn pb-btn-primary"
                  onClick={() => downloadAllFiles(session.completedFiles)}
                >
                  <Download size={12} /> Download All
                </button>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="pb-progress-section">
            <div className="pb-progress-stats">
              <span className="pb-stat-item">
                <span className="pb-stat-dot" style={{ background: 'var(--accent-success)' }} />
                {done.length} done
              </span>
              <span className="pb-stat-item">
                <span className="pb-stat-dot" style={{ background: 'var(--accent-primary)' }} />
                {active.length} active
              </span>
              <span className="pb-stat-item">
                <span className="pb-stat-dot" style={{ background: 'var(--text-muted)' }} />
                {pending.length} pending
              </span>
              {failed.length > 0 && (
                <span className="pb-stat-item">
                  <span className="pb-stat-dot" style={{ background: 'var(--accent-danger)' }} />
                  {failed.length} failed
                </span>
              )}
              {requeued.length > 0 && (
                <span className="pb-stat-item">
                  <span className="pb-stat-dot" style={{ background: 'var(--accent-warning)' }} />
                  {requeued.length} requeued
                </span>
              )}
              <span className="pb-stat-pct">{progressPct}%</span>
            </div>
            <div className="pb-progress-bar">
              <div
                className={`pb-progress-fill ${session.status === 'completed' ? 'done' : ''}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* Node assignment map */}
          <div className="pb-section">
            <div className="pb-section-title">
              <Cpu size={14} /> Node Assignment
            </div>
            <div className="pb-node-grid">
              {nodes.filter((n) => n.status !== 'offline').map((node) => {
                const nodeTask = active.find((s) => s.assignedNodeId === node.id);
                return (
                  <div key={node.id} className={`pb-node-card ${nodeTask ? 'working' : 'free'}`}>
                    <div className="pb-node-dot" style={{
                      background: nodeTask ? 'var(--accent-primary)' : 'var(--accent-success)',
                    }} />
                    <div className="pb-node-info">
                      <span className="pb-node-name">{node.name}</span>
                      {nodeTask
                        ? <span className="pb-node-task"><Loader2 size={10} className="spin" /> {nodeTask.title}</span>
                        : <span className="pb-node-idle">idle</span>
                      }
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Three-column subtask queue */}
          <div className="pb-section">
            <div className="pb-section-title">
              <Layers size={14} /> Subtask Queue ({subtasks.length} total)
            </div>
            <div className="pb-queue-grid">
              {/* Pending */}
              <div className="pb-queue-col">
                <div className="pb-queue-col-header pending">
                  <Clock size={12} /> Pending ({pending.length + requeued.length})
                </div>
                <div className="pb-queue-col-body">
                  {[...requeued, ...pending].map((s) => (
                    <SubtaskCard key={s.id} subtask={s} nodes={nodes} />
                  ))}
                  {pending.length === 0 && requeued.length === 0 && (
                    <div className="pb-queue-empty">All tasks dispatched</div>
                  )}
                </div>
              </div>

              {/* In Progress */}
              <div className="pb-queue-col">
                <div className="pb-queue-col-header running">
                  <Loader2 size={12} className="spin" /> In Progress ({active.length})
                </div>
                <div className="pb-queue-col-body">
                  {active.map((s) => (
                    <SubtaskCard key={s.id} subtask={s} nodes={nodes} />
                  ))}
                  {active.length === 0 && (
                    <div className="pb-queue-empty">
                      {session.status === 'completed' ? 'All done!' : 'Waiting for free nodes…'}
                    </div>
                  )}
                </div>
              </div>

              {/* Completed / Failed */}
              <div className="pb-queue-col">
                <div className="pb-queue-col-header done">
                  <CheckCircle2 size={12} /> Done ({done.length + failed.length})
                </div>
                <div className="pb-queue-col-body">
                  {[...done, ...failed].map((s) => (
                    <SubtaskCard key={s.id} subtask={s} nodes={nodes} />
                  ))}
                  {done.length === 0 && failed.length === 0 && (
                    <div className="pb-queue-empty">Nothing yet</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Generated Files */}
          {Object.keys(session.completedFiles).length > 0 && (
            <div className="pb-section">
              <button
                className="pb-collapsible-header"
                onClick={() => setFilesExpanded(!filesExpanded)}
              >
                <FileCode2 size={14} />
                Generated Files ({Object.keys(session.completedFiles).length})
                {filesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {filesExpanded && (
                <div className="pb-files-list">
                  {Object.entries(session.completedFiles).map(([path, content]) => (
                    <div key={path} className="pb-file-row">
                      <FileCode2 size={12} className="pb-file-icon" />
                      <span className="pb-file-path">{path}</span>
                      <span className="pb-file-size">{content.length} chars</span>
                      <button
                        className="pb-file-open"
                        onClick={() => openTab(path)}
                      >
                        Open
                      </button>
                      <button
                        className="pb-file-download"
                        onClick={() => downloadFile(path.split('/').pop() || 'file.txt', content)}
                      >
                        <Download size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Audit Log */}
          <div className="pb-section pb-section-audit">
            <button
              className="pb-collapsible-header"
              onClick={() => setAuditExpanded(!auditExpanded)}
            >
              <Terminal size={14} />
              Audit Log ({session.auditLog.length} entries)
              {auditExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {auditExpanded && (
              <div className="pb-audit-log">
                {session.auditLog.length === 0 && (
                  <div className="pb-audit-empty">No events yet</div>
                )}
                {[...session.auditLog].reverse().map((entry) => (
                  <AuditEntry key={entry.id} entry={entry} />
                ))}
                <div ref={auditEndRef} />
              </div>
            )}
          </div>

          {/* Completion banner */}
          {session.status === 'completed' && (
            <div className="pb-complete-banner">
              <CheckCircle2 size={18} />
              <div className="pb-complete-info">
                <strong>Build Complete!</strong>
                <span>
                  {session.completedCount}/{session.totalSubtasks} subtasks succeeded
                  {session.failedCount > 0 ? ` • ${session.failedCount} failed` : ''}
                  {session.completedAt ? ` • ${new Date(session.completedAt).toLocaleTimeString()}` : ''}
                </span>
              </div>
              <button
                className="pb-btn pb-btn-primary"
                onClick={() => downloadAllFiles(session.completedFiles)}
              >
                <Download size={14} /> Download All Files
              </button>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!session && (
        <div className="pb-empty-state">
          <ArrowDown size={32} className="pb-empty-icon" />
          <p>Enter a project description above to start building with the mesh.</p>
          <p className="pb-empty-hint">
            The master node will decompose your request into parallel subtasks and distribute
            them across all connected peers simultaneously.
          </p>
        </div>
      )}
    </div>
  );
}
