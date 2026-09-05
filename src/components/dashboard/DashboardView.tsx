import React from 'react';
import { useAppStore } from '../../stores/appStore';
import {
  Server, Zap, Crown, Heart, AlertTriangle, CheckCircle2,
  XCircle, Clock, Wifi, Activity, ArrowRight,
} from 'lucide-react';
import { formatUptime, getStatusColor, formatRelativeTime } from '../../utils/helpers';
import './DashboardView.css';

export function DashboardView() {
  const nodes = useAppStore((s) => s.nodes);
  const tasks = useAppStore((s) => s.tasks);
  const events = useAppStore((s) => s.events);
  const masterId = useAppStore((s) => s.masterId);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const setSelectedNodeId = useAppStore((s) => s.setSelectedNodeId);

  const onlineNodes = nodes.filter((n) => n.status !== 'offline');
  const peerCount = onlineNodes.filter((n) => !n.isSelf).length;
  const runningTasks = tasks.filter((t) => t.status === 'running');
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const failedTasks = tasks.filter((t) => t.status === 'failed');
  const warningNodes = nodes.filter((n) => n.status === 'warning');
  const masterNode = nodes.find((n) => n.id === masterId);

  const clusterHealth = warningNodes.length === 0 && failedTasks.length === 0 ? 'Healthy' :
    failedTasks.length > 0 ? 'Degraded' : 'Caution';

  return (
    <div className="dashboard">
      <h2 className="view-title">Dashboard</h2>

      {/* Hero strip */}
      <div className="hero-strip">
        <div className="hero-card">
          <div className="hero-icon" style={{ background: 'var(--accent-primary-muted)', color: 'var(--accent-primary)' }}>
            <Server size={20} />
          </div>
          <div className="hero-info">
            <span className="hero-value">{peerCount}</span>
            <span className="hero-label">Peers Online ({onlineNodes.length} nodes)</span>
          </div>
        </div>

        <div className="hero-card">
          <div className="hero-icon" style={{ background: 'var(--accent-success-muted)', color: 'var(--accent-success)' }}>
            <Zap size={20} />
          </div>
          <div className="hero-info">
            <span className="hero-value">{runningTasks.length}</span>
            <span className="hero-label">Active Jobs</span>
          </div>
        </div>

        <div className="hero-card">
          <div className="hero-icon" style={{ background: 'var(--accent-warning-muted)', color: 'var(--accent-warning)' }}>
            <Crown size={20} />
          </div>
          <div className="hero-info">
            <span className="hero-value">{masterNode?.name || '—'}</span>
            <span className="hero-label">Master Node</span>
          </div>
        </div>

        <div className="hero-card">
          <div className="hero-icon" style={{
            background: clusterHealth === 'Healthy' ? 'var(--accent-success-muted)' :
              clusterHealth === 'Degraded' ? 'var(--accent-danger-muted)' : 'var(--accent-warning-muted)',
            color: clusterHealth === 'Healthy' ? 'var(--accent-success)' :
              clusterHealth === 'Degraded' ? 'var(--accent-danger)' : 'var(--accent-warning)',
          }}>
            <Heart size={20} />
          </div>
          <div className="hero-info">
            <span className="hero-value">{clusterHealth}</span>
            <span className="hero-label">Cluster Health</span>
          </div>
        </div>
      </div>

      {/* Failover banner */}
      {warningNodes.length > 0 && (
        <div className="failover-banner">
          <AlertTriangle size={16} />
          <span>
            {warningNodes.length} node{warningNodes.length > 1 ? 's' : ''} experiencing issues:{' '}
            {warningNodes.map((n) => n.name).join(', ')}
          </span>
        </div>
      )}

      <div className="dashboard-grid">
        {/* Node cards */}
        <div className="dashboard-section">
          <div className="section-header">
            <h3>Node Health</h3>
            <button className="section-link" onClick={() => setActiveView('nodes')}>
              View all <ArrowRight size={14} />
            </button>
          </div>
          <div className="node-cards">
            {nodes.map((node) => (
              <div
                key={node.id}
                className={`dash-node-card ${node.status}`}
                onClick={() => setSelectedNodeId(node.id)}
              >
                <div className="dash-node-top">
                  <div className="dash-node-dot" style={{ background: getStatusColor(node.status) }} />
                  <span className="dash-node-name">{node.name}</span>
                  {node.id === masterId && <Crown size={12} className="dash-node-crown" />}
                </div>
                <div className="dash-node-bar-group">
                  <div className="dash-node-bar-label">
                    <span>VRAM</span>
                    <span className="mono">{node.vram > 0 ? Math.round((node.vramUsed / node.vram) * 100) : 0}%</span>
                  </div>
                  <div className="dash-node-bar">
                    <div
                      className="dash-node-bar-fill"
                      style={{ width: `${node.vram > 0 ? (node.vramUsed / node.vram) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <div className="dash-node-meta">
                  <span><Wifi size={10} /> {node.latency}ms</span>
                  <span><Clock size={10} /> {formatUptime(node.uptime)}</span>
                </div>
                {node.currentTask && (
                  <div className="dash-node-task">{node.currentTask}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Task flow */}
        <div className="dashboard-section">
          <div className="section-header">
            <h3>Task Distribution</h3>
            <button className="section-link" onClick={() => setActiveView('tasks')}>
              View all <ArrowRight size={14} />
            </button>
          </div>
          <div className="task-flow-stats">
            <div className="task-stat">
              <span className="task-stat-dot" style={{ background: 'var(--accent-warning)' }} />
              <span className="task-stat-label">Queued</span>
              <span className="task-stat-value">{tasks.filter((t) => t.status === 'queued').length}</span>
            </div>
            <div className="task-stat">
              <span className="task-stat-dot" style={{ background: 'var(--accent-primary)' }} />
              <span className="task-stat-label">Running</span>
              <span className="task-stat-value">{runningTasks.length}</span>
            </div>
            <div className="task-stat">
              <span className="task-stat-dot" style={{ background: 'var(--accent-danger)' }} />
              <span className="task-stat-label">Failed</span>
              <span className="task-stat-value">{failedTasks.length}</span>
            </div>
            <div className="task-stat">
              <span className="task-stat-dot" style={{ background: 'var(--accent-success)' }} />
              <span className="task-stat-label">Done</span>
              <span className="task-stat-value">{completedTasks.length}</span>
            </div>
          </div>

          <div className="task-flow-list">
            {tasks.filter((t) => t.status !== 'completed').slice(0, 5).map((task) => (
              <div key={task.id} className="task-flow-item">
                <div className="task-flow-status" style={{ background: getStatusColor(task.status) }} />
                <div className="task-flow-info">
                  <span className="task-flow-title">{task.title}</span>
                  <span className="task-flow-node">
                    {task.assignedNode ? nodes.find((n) => n.id === task.assignedNode)?.name || 'Unknown' : 'Unassigned'}
                  </span>
                </div>
                {task.progress > 0 && task.progress < 100 && (
                  <div className="task-flow-progress">
                    <div className="task-flow-progress-bar" style={{ width: `${task.progress}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Event timeline */}
        <div className="dashboard-section full-width">
          <div className="section-header">
            <h3>Recent Events</h3>
          </div>
          <div className="event-timeline">
            {events.slice(0, 8).map((event) => (
              <div key={event.id} className={`event-item ${event.type}`}>
                <div className="event-icon">
                  {event.type === 'success' && <CheckCircle2 size={14} />}
                  {event.type === 'error' && <XCircle size={14} />}
                  {event.type === 'warning' && <AlertTriangle size={14} />}
                  {event.type === 'info' && <Activity size={14} />}
                  {event.type === 'mesh' && <Wifi size={14} />}
                </div>
                <span className="event-message">{event.message}</span>
                <span className="event-time">{formatRelativeTime(event.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
