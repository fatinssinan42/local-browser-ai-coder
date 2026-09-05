import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../stores/appStore';
import { getMeshOrchestrator } from '../../services/MeshOrchestrator';
import { getLiveFileDebugger } from '../../services/LiveFileDebugger';
import {
  AlertCircle, AlertTriangle, Info, CheckCircle, ChevronDown,
  ChevronUp, Wrench, Server, Plus, X, Trash2, Loader2,
  ScanLine, StopCircle, FileSearch, CheckCircle2, XCircle,
  Sparkles, Code2, ChevronRight,
} from 'lucide-react';
import { formatRelativeTime } from '../../utils/helpers';
import './DebugPanel.css';

// ============================================
// Chunk log entry component
// ============================================

interface ChunkEntryProps {
  entry: {
    chunk: number;
    lines: string;
    startLine: number;
    endLine: number;
    status: 'scanning' | 'issues' | 'clean' | 'fixed';
    message: string;
    aiOutput: string | null;
    fixedCode: string | null;
  };
  totalChunks: number;
  isActive: boolean;
}

function ChunkEntry({ entry, totalChunks, isActive }: ChunkEntryProps) {
  const [expanded, setExpanded] = useState(false);

  // Auto-expand when active (currently scanning), auto-collapse when done
  useEffect(() => {
    if (isActive) setExpanded(true);
    else if (entry.status !== 'issues' && entry.status !== 'fixed') setExpanded(false);
  }, [isActive, entry.status]);

  const statusLabel = {
    scanning: 'Scanning…',
    clean: 'Clean',
    fixed: 'Fixed',
    issues: 'Issues',
  }[entry.status];

  const hasDetail = entry.aiOutput || entry.fixedCode;

  return (
    <div className={`ld-chunk-entry ${entry.status} ${isActive ? 'is-active' : ''}`}>
      {/* Header row — always visible */}
      <div
        className="ld-chunk-header"
        onClick={() => hasDetail && setExpanded(!expanded)}
        style={{ cursor: hasDetail ? 'pointer' : 'default' }}
      >
        <div className="ld-chunk-status-icon">
          {entry.status === 'scanning' && <Loader2 size={12} className="ld-spin" />}
          {entry.status === 'clean' && <CheckCircle2 size={12} className="ld-icon-clean" />}
          {entry.status === 'fixed' && <Sparkles size={12} className="ld-icon-fixed" />}
          {entry.status === 'issues' && <AlertTriangle size={12} className="ld-icon-warn" />}
        </div>

        <div className="ld-chunk-meta">
          <span className="ld-chunk-num">#{entry.chunk}/{totalChunks}</span>
          <span className="ld-chunk-lines mono">lines {entry.lines}</span>
          <span className={`ld-chunk-badge ${entry.status}`}>{statusLabel}</span>
        </div>

        {/* Stream preview — show live tokens while scanning */}
        {entry.status === 'scanning' && entry.aiOutput && (
          <span className="ld-chunk-stream-preview">
            {entry.aiOutput.slice(-60).replace(/\n/g, ' ')}
          </span>
        )}

        {/* Issue summary line */}
        {(entry.status === 'fixed' || entry.status === 'issues') && (
          <span className="ld-chunk-issue-summary">
            {entry.message.split('\n')[0]}
          </span>
        )}

        {hasDetail && (
          <span className="ld-chunk-expand-btn">
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && hasDetail && (
        <div className="ld-chunk-detail">
          {/* Show all message lines */}
          {entry.message.includes('\n') && (
            <div className="ld-chunk-msg-lines">
              {entry.message.split('\n').map((line, i) => (
                <div key={i} className="ld-chunk-msg-line">{line}</div>
              ))}
            </div>
          )}

          {/* Show fixed code */}
          {entry.fixedCode && (
            <div className="ld-chunk-fixed-block">
              <div className="ld-chunk-fixed-label">
                <Code2 size={11} /> Auto-applied fix:
              </div>
              <pre className="ld-chunk-code">{entry.fixedCode}</pre>
            </div>
          )}

          {/* Show raw AI output if no structured fix */}
          {!entry.fixedCode && entry.aiOutput && entry.status !== 'scanning' && (
            <div className="ld-chunk-fixed-block">
              <div className="ld-chunk-fixed-label">
                <Info size={11} /> AI analysis:
              </div>
              <pre className="ld-chunk-code">{entry.aiOutput}</pre>
            </div>
          )}

          {/* Streaming output while scanning */}
          {entry.status === 'scanning' && entry.aiOutput && (
            <div className="ld-chunk-fixed-block streaming">
              <div className="ld-chunk-fixed-label">
                <Loader2 size={11} className="ld-spin" /> Streaming response…
              </div>
              <pre className="ld-chunk-code">{entry.aiOutput}<span className="ld-cursor">▌</span></pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// LiveDebugPanel
// ============================================

function LiveDebugPanel() {
  const files = useAppStore((s) => s.files);
  const liveDebug = useAppStore((s) => s.liveDebug);
  const resetLiveDebug = useAppStore((s) => s.resetLiveDebug);
  const modelLoaded = useAppStore((s) => s.modelLoaded);

  const [selectedFile, setSelectedFile] = useState('');
  const logBottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the log to bottom on new/updated entries
  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveDebug.log.length, liveDebug.currentChunk]);

  const handleStart = () => {
    const path = selectedFile.trim();
    if (!path) return;
    try {
      const orch = getMeshOrchestrator();
      const lfd = getLiveFileDebugger();
      lfd.setInferenceEngine(orch.inference);
      lfd.setContextManager(orch.context);
      lfd.debugFile(path).catch(console.error);
    } catch (err) {
      console.error('LiveFileDebugger start error:', err);
    }
  };

  const handleStop = () => {
    getLiveFileDebugger().stop();
    useAppStore.getState().setLiveDebug({ active: false, status: 'idle' });
  };

  const isScanning = liveDebug.status === 'scanning';
  const isDone = liveDebug.status === 'done';
  const isError = liveDebug.status === 'error';

  return (
    <div className="live-debug-panel">
      {/* Header */}
      <div className="ld-header">
        <div className="ld-title">
          <FileSearch size={16} />
          <span>Live File Debugger</span>
        </div>
        {!modelLoaded && (
          <span className="ld-no-model">⚠ Load a model in Settings to enable</span>
        )}
      </div>

      {/* Controls */}
      <div className="ld-controls">
        <select
          className="ld-file-select"
          value={selectedFile}
          onChange={(e) => setSelectedFile(e.target.value)}
          disabled={liveDebug.active}
        >
          <option value="">— Select a file to debug —</option>
          {files.map((f) => (
            <option key={f.path} value={f.path}>
              {f.path} ({f.content.split('\n').length} lines)
            </option>
          ))}
        </select>

        {!liveDebug.active ? (
          <button
            className="ld-btn ld-btn-start"
            onClick={handleStart}
            disabled={!selectedFile || !modelLoaded}
            title={!modelLoaded ? 'Load a model in Settings first' : !selectedFile ? 'Select a file first' : 'Start AI debug scan'}
          >
            <ScanLine size={13} /> Scan File
          </button>
        ) : (
          <button className="ld-btn ld-btn-stop" onClick={handleStop}>
            <StopCircle size={13} /> Stop
          </button>
        )}

        {(isDone || isError) && (
          <button className="ld-btn ld-btn-reset" onClick={resetLiveDebug}>
            <X size={13} /> Clear
          </button>
        )}
      </div>

      {/* Progress bar + live stats — shown while scanning or after */}
      {(liveDebug.active || isDone || isError) && (
        <div className="ld-progress-section">
          {/* Progress bar */}
          <div className="ld-progress-row">
            <div className="ld-progress-label">
              {isScanning && <Loader2 size={12} className="ld-spin" />}
              {isDone && liveDebug.issuesFound === 0 && <CheckCircle2 size={12} className="ld-icon-clean" />}
              {isDone && liveDebug.issuesFound > 0 && <AlertTriangle size={12} className="ld-icon-warn" />}
              {isError && <XCircle size={12} className="ld-icon-err" />}
              <span className="ld-file-label">
                {liveDebug.filePath?.split('/').pop() ?? ''}
              </span>
              {isScanning && (
                <span className="ld-scanning-info">
                  [{liveDebug.currentChunk}/{liveDebug.totalChunks}]
                </span>
              )}
            </div>
            <span className="ld-pct">{liveDebug.percent}%</span>
          </div>

          <div className="ld-progress-bar">
            <div
              className={`ld-progress-fill ${liveDebug.issuesFound > 0 ? 'has-issues' : ''} ${isDone && liveDebug.issuesFound === 0 ? 'all-clean' : ''}`}
              style={{ width: `${liveDebug.percent}%` }}
            />
          </div>

          {/* Running counters */}
          <div className="ld-counters">
            <span className={`ld-counter ${liveDebug.issuesFound > 0 ? 'warn' : 'muted'}`}>
              <AlertTriangle size={10} />
              {liveDebug.issuesFound} issue{liveDebug.issuesFound !== 1 ? 's' : ''}
            </span>
            <span className={`ld-counter ${liveDebug.fixesApplied > 0 ? 'ok' : 'muted'}`}>
              <Sparkles size={10} />
              {liveDebug.fixesApplied} auto-fixed
            </span>
            <span className="ld-counter muted">
              <Code2 size={10} />
              {liveDebug.totalChunks} chunk{liveDebug.totalChunks !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      )}

      {/* Summary banner */}
      {liveDebug.summary && (
        <div className={`ld-summary-banner ${
          isError ? 'err'
          : liveDebug.issuesFound === 0 ? 'clean'
          : liveDebug.fixesApplied === liveDebug.issuesFound ? 'fixed'
          : 'partial'
        }`}>
          {isError && <XCircle size={14} />}
          {!isError && liveDebug.issuesFound === 0 && <CheckCircle2 size={14} />}
          {!isError && liveDebug.fixesApplied === liveDebug.issuesFound && liveDebug.issuesFound > 0 && <Sparkles size={14} />}
          {!isError && liveDebug.issuesFound > 0 && liveDebug.fixesApplied < liveDebug.issuesFound && <AlertTriangle size={14} />}
          <span>{liveDebug.summary}</span>
        </div>
      )}

      {/* Live chunk log */}
      {liveDebug.log.length > 0 && (
        <div className="ld-chunk-log">
          <div className="ld-chunk-log-label">
            Scan Log — {liveDebug.log.length} section{liveDebug.log.length !== 1 ? 's' : ''}
          </div>
          {liveDebug.log.map((entry) => (
            <ChunkEntry
              key={entry.chunk}
              entry={entry}
              totalChunks={liveDebug.totalChunks}
              isActive={liveDebug.active && liveDebug.currentChunk === entry.chunk}
            />
          ))}
          <div ref={logBottomRef} />
        </div>
      )}

      {/* Idle hint */}
      {liveDebug.status === 'idle' && liveDebug.log.length === 0 && (
        <div className="ld-idle-hint">
          Select a file and click <strong>Scan File</strong>. The AI will read it chunk by chunk,
          show each issue live, auto-fix what it can, and scroll the editor to each changed section.
        </div>
      )}
    </div>
  );
}

// ============================================
// Main DebugPanel
// ============================================

export function DebugPanel() {
  const debugIssues = useAppStore((s) => s.debugIssues);
  const nodes = useAppStore((s) => s.nodes);
  const updateDebugIssue = useAppStore((s) => s.updateDebugIssue);
  const removeDebugIssue = useAppStore((s) => s.removeDebugIssue);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [newSeverity, setNewSeverity] = useState<'error' | 'warning' | 'info'>('error');
  const [newFile, setNewFile] = useState('');
  const [newStackTrace, setNewStackTrace] = useState('');

  const handleCreateIssue = () => {
    if (!newMessage.trim()) return;
    try {
      const orchestrator = getMeshOrchestrator();
      orchestrator.debug.createIssue(newMessage.trim(), newSeverity, {
        file: newFile.trim() || undefined,
        stackTrace: newStackTrace.trim() || undefined,
      });
      setShowCreateModal(false);
      setNewMessage('');
      setNewSeverity('error');
      setNewFile('');
      setNewStackTrace('');
    } catch (err) {
      console.error('Failed to create debug issue:', err);
    }
  };

  const filtered = debugIssues.filter(
    (i) => filterSeverity === 'all' || i.severity === filterSeverity,
  );

  const errorCount = debugIssues.filter((i) => i.severity === 'error').length;
  const warningCount = debugIssues.filter((i) => i.severity === 'warning').length;
  const infoCount = debugIssues.filter((i) => i.severity === 'info').length;

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'error': return <AlertCircle size={14} />;
      case 'warning': return <AlertTriangle size={14} />;
      case 'info': return <Info size={14} />;
      default: return <Info size={14} />;
    }
  };

  return (
    <div className="debug-view">
      <div className="debug-header">
        <h2 className="view-title">Debug Console</h2>
        <button className="debug-create-btn" onClick={() => setShowCreateModal(true)}>
          <Plus size={14} /> Report Issue
        </button>
      </div>

      {/* Live File Debugger */}
      <LiveDebugPanel />

      <div className="debug-summary">
        <div className={`debug-summary-item error ${filterSeverity === 'error' ? 'active' : ''}`}
          onClick={() => setFilterSeverity(filterSeverity === 'error' ? 'all' : 'error')}>
          <AlertCircle size={14} />
          <span>{errorCount} Error{errorCount !== 1 ? 's' : ''}</span>
        </div>
        <div className={`debug-summary-item warning ${filterSeverity === 'warning' ? 'active' : ''}`}
          onClick={() => setFilterSeverity(filterSeverity === 'warning' ? 'all' : 'warning')}>
          <AlertTriangle size={14} />
          <span>{warningCount} Warning{warningCount !== 1 ? 's' : ''}</span>
        </div>
        <div className={`debug-summary-item info ${filterSeverity === 'info' ? 'active' : ''}`}
          onClick={() => setFilterSeverity(filterSeverity === 'info' ? 'all' : 'info')}>
          <Info size={14} />
          <span>{infoCount} Info</span>
        </div>
      </div>

      {/* Create Issue Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Report Debug Issue</h3>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-field">
                <label>Severity</label>
                <select value={newSeverity} onChange={e => setNewSeverity(e.target.value as any)}>
                  <option value="error">Error</option>
                  <option value="warning">Warning</option>
                  <option value="info">Info</option>
                </select>
              </div>
              <div className="form-field">
                <label>Error Message</label>
                <input
                  type="text"
                  value={newMessage}
                  onChange={e => setNewMessage(e.target.value)}
                  placeholder="e.g., TypeError: Cannot read property 'x' of undefined"
                />
              </div>
              <div className="form-field">
                <label>File (optional)</label>
                <input
                  type="text"
                  value={newFile}
                  onChange={e => setNewFile(e.target.value)}
                  placeholder="e.g., src/components/App.tsx:42"
                />
              </div>
              <div className="form-field">
                <label>Stack Trace (optional)</label>
                <textarea
                  value={newStackTrace}
                  onChange={e => setNewStackTrace(e.target.value)}
                  placeholder="Paste stack trace here..."
                  rows={5}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleCreateIssue}>
                <Plus size={14} /> Report & Analyze
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="debug-list">
        {filtered.length === 0 && (
          <div className="debug-empty">
            <CheckCircle size={32} strokeWidth={1.5} />
            <p>No issues to display</p>
            <span>Use "Report Issue" to create a debug issue, or run tasks that produce errors.</span>
          </div>
        )}
        {filtered.map((issue) => (
          <div key={issue.id} className={`debug-issue ${issue.severity} ${issue.status}`}>
            <div
              className="debug-issue-header"
              onClick={() => setExpandedId(expandedId === issue.id ? null : issue.id)}
            >
              <div className={`debug-severity-icon ${issue.severity}`}>
                {getSeverityIcon(issue.severity)}
              </div>
              <div className="debug-issue-main">
                <span className="debug-issue-message">{issue.message}</span>
                <div className="debug-issue-meta">
                  {issue.file && (
                    <span className="debug-issue-file mono">
                      {issue.file}{issue.line ? `:${issue.line}` : ''}
                    </span>
                  )}
                  <span className="debug-issue-node">
                    <Server size={10} />{' '}
                    {nodes.find((n) => n.id === issue.sourceNode)?.name || 'Unknown'}
                  </span>
                  <span className="debug-issue-time">{formatRelativeTime(issue.timestamp)}</span>
                </div>
              </div>
              <span className={`debug-status-badge ${issue.status}`}>{issue.status}</span>
              {expandedId === issue.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>

            {expandedId === issue.id && (
              <div className="debug-issue-detail">
                {issue.status === 'investigating' && (
                  <div className="debug-detail-section debug-analyzing">
                    <Loader2 size={16} className="spin" />
                    <span>AI is analyzing your code... Check the Event Stream for progress.</span>
                  </div>
                )}
                {issue.stackTrace && (
                  <div className="debug-detail-section">
                    <h4>Stack Trace</h4>
                    <pre className="debug-stack">{issue.stackTrace}</pre>
                  </div>
                )}
                {issue.suggestedFix && (
                  <div className="debug-detail-section">
                    <h4><Wrench size={12} /> AI Analysis Result</h4>
                    <pre className="debug-fix-box">{issue.suggestedFix}</pre>
                  </div>
                )}
                <div className="debug-issue-actions">
                  {(issue.status === 'open' || issue.status === 'investigating') && (
                    <button
                      className="debug-action-btn"
                      onClick={() => {
                        try {
                          const orch = getMeshOrchestrator();
                          orch.debug.reAnalyzeIssue(issue);
                        } catch { /* */ }
                      }}
                    >
                      Analyze with AI
                    </button>
                  )}
                  {(issue.status === 'open' || issue.status === 'investigating') && (
                    <button
                      className="debug-action-btn success"
                      onClick={() => updateDebugIssue(issue.id, { status: 'resolved' })}
                    >
                      Mark Resolved
                    </button>
                  )}
                  <button
                    className="debug-action-btn danger"
                    onClick={() => {
                      removeDebugIssue(issue.id);
                      if (expandedId === issue.id) setExpandedId(null);
                    }}
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
