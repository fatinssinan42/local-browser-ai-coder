import React from 'react';
import { useAppStore } from '../../stores/appStore';
import { X, Server, Zap, Clock, Wifi, Activity, Brain, CheckCircle2, XCircle } from 'lucide-react';
import { formatUptime, getStatusColor } from '../../utils/helpers';
import './InsightPanel.css';

export function InsightPanel() {
  const toggleInsightPanel = useAppStore((s) => s.toggleInsightPanel);
  const nodes = useAppStore((s) => s.nodes);
  const tasks = useAppStore((s) => s.tasks);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const totalTokens = useAppStore((s) => s.totalTokens);
  const masterId = useAppStore((s) => s.masterId);
  const modelLoaded = useAppStore((s) => s.modelLoaded);
  const modelLoading = useAppStore((s) => s.modelLoading);
  const loadProgress = useAppStore((s) => s.loadProgress);
  const availableModels = useAppStore((s) => s.availableModels);
  const selectedModelId = useAppStore((s) => s.selectedModelId);

  const node = nodes.find((n) => n.id === selectedNodeId) || nodes.find(n => n.isSelf) || nodes[0];
  const task = tasks.find((t) => t.id === selectedTaskId);
  const runningTasks = tasks.filter((t) => t.status === 'running');
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const failedTasks = tasks.filter((t) => t.status === 'failed');
  const selectedModelName = availableModels.find(m => m.id === selectedModelId)?.name;

  return (
    <aside className="insight-panel">
      <div className="insight-header">
        <h3>Insights</h3>
        <button className="insight-close" onClick={toggleInsightPanel}>
          <X size={14} />
        </button>
      </div>

      {node && (
        <div className="insight-section">
          <div className="insight-section-title">
            <Server size={14} />
            <span>Selected Node</span>
          </div>
          <div className="insight-card">
            <div className="insight-node-header">
              <div className="insight-node-dot" style={{ background: getStatusColor(node.status) }} />
              <span className="insight-node-name">{node.name}</span>
              <span className="insight-node-role">{node.role}</span>
            </div>
            <div className="insight-metrics">
              <div className="insight-metric">
                <span className="insight-metric-label">VRAM</span>
                <div className="insight-bar-track">
                  <div
                    className="insight-bar-fill"
                    style={{ width: `${(node.vramUsed / node.vram) * 100}%` }}
                  />
                </div>
                <span className="insight-metric-value">{node.vramUsed}MB / {node.vram}MB</span>
              </div>
              <div className="insight-metric">
                <span className="insight-metric-label">RAM</span>
                <div className="insight-bar-track">
                  <div
                    className="insight-bar-fill ram"
                    style={{ width: `${(node.ramUsed / node.ramTotal) * 100}%` }}
                  />
                </div>
                <span className="insight-metric-value">{node.ramUsed}MB / {node.ramTotal}MB</span>
              </div>
              <div className="insight-metric-row">
                <div className="insight-small-metric">
                  <Clock size={12} />
                  <span>{formatUptime(node.uptime)}</span>
                </div>
                <div className="insight-small-metric">
                  <Wifi size={12} />
                  <span>{node.latency}ms</span>
                </div>
              </div>
            </div>
            {node.currentTask && (
              <div className="insight-current-task">
                <Zap size={12} />
                <span>{node.currentTask}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {task && (
        <div className="insight-section">
          <div className="insight-section-title">
            <Activity size={14} />
            <span>Selected Task</span>
          </div>
          <div className="insight-card">
            <div className="insight-task-title">{task.title}</div>
            <div className="insight-task-meta">
              <span className={`insight-status-pill ${task.status}`}>{task.status}</span>
              <span className="insight-task-tokens">{task.tokenCount.toLocaleString()} tokens</span>
            </div>
            {task.progress > 0 && task.progress < 100 && (
              <div className="insight-bar-track">
                <div className="insight-bar-fill" style={{ width: `${task.progress}%` }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Model status */}
      <div className="insight-section">
        <div className="insight-section-title">
          <Brain size={14} />
          <span>AI Model</span>
        </div>
        <div className="insight-card">
          {modelLoaded ? (
            <div className="insight-model-loaded">
              <CheckCircle2 size={13} style={{ color: 'var(--accent-success)' }} />
              <span>{selectedModelName || selectedModelId || 'Model'}</span>
            </div>
          ) : modelLoading ? (
            <div className="insight-model-loading">
              <div className="insight-bar-track">
                <div className="insight-bar-fill" style={{ width: `${loadProgress}%` }} />
              </div>
              <span className="insight-model-pct">{loadProgress}% loaded</span>
            </div>
          ) : (
            <div className="insight-model-none">
              <XCircle size={13} style={{ color: 'var(--accent-warning)' }} />
              <span>No model loaded</span>
            </div>
          )}
          {masterId && (
            <div className="insight-master-info">
              Master: {nodes.find(n => n.id === masterId)?.name || masterId.slice(0, 8)}
            </div>
          )}
        </div>
      </div>

      {/* Task result preview */}
      {task?.result && (
        <div className="insight-section">
          <div className="insight-section-title">
            <Activity size={14} />
            <span>Task Result</span>
          </div>
          <div className="insight-card insight-result-preview">
            <pre className="insight-result-text">{task.result.slice(0, 400)}{task.result.length > 400 ? '\n...' : ''}</pre>
          </div>
        </div>
      )}

      <div className="insight-section">
        <div className="insight-section-title">
          <Activity size={14} />
          <span>Quick Stats</span>
        </div>
        <div className="insight-stats">
          <div className="insight-stat">
            <span className="insight-stat-value">{nodes.filter((n) => n.status !== 'offline').length}</span>
            <span className="insight-stat-label">Online</span>
          </div>
          <div className="insight-stat">
            <span className="insight-stat-value">{runningTasks.length}</span>
            <span className="insight-stat-label">Running</span>
          </div>
          <div className="insight-stat">
            <span className="insight-stat-value">{completedTasks.length}</span>
            <span className="insight-stat-label">Done</span>
          </div>
          <div className="insight-stat">
            <span className="insight-stat-value" style={{ color: failedTasks.length > 0 ? 'var(--accent-danger)' : undefined }}>
              {failedTasks.length}
            </span>
            <span className="insight-stat-label">Failed</span>
          </div>
          <div className="insight-stat">
            <span className="insight-stat-value">{totalTokens > 0 ? `${Math.round(totalTokens / 1000)}K` : '0'}</span>
            <span className="insight-stat-label">Tokens</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
