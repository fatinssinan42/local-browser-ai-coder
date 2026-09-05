import React, { useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { getMeshOrchestrator } from '../../services/MeshOrchestrator';
import {
  Crown, Wifi, Clock, Cpu, HardDrive, Zap,
  Trash2, ArrowUpCircle, Eye, X, Brain,
} from 'lucide-react';
import { formatUptime, getStatusColor } from '../../utils/helpers';
import './NodeGrid.css';

export function NodeGrid() {
  const rawNodes = useAppStore((s) => s.nodes);
  const masterId = useAppStore((s) => s.masterId);
  const selfId = useAppStore((s) => s.selfId);
  const availableModels = useAppStore((s) => s.availableModels);
  const modelLoaded = useAppStore((s) => s.modelLoaded);
  const selectedModelId = useAppStore((s) => s.selectedModelId);
  const setSelectedNodeId = useAppStore((s) => s.setSelectedNodeId);
  const [inspectId, setInspectId] = useState<string | null>(null);

  // Always show at least the self-node even before P2P initializes
  const nodes = rawNodes.length > 0 ? rawNodes : selfId ? [{
    id: selfId,
    name: `Node-${selfId.slice(5, 13)}`,
    status: 'online' as const,
    role: 'master' as const,
    vram: 0, vramUsed: 0,
    ramTotal: 0, ramUsed: 0,
    latency: 0, uptime: 0,
    currentTask: null,
    capabilities: [],
    isSelf: true,
    modelLoaded,
    modelId: selectedModelId || null,
  }] : [];

  const inspectedNode = nodes.find((n) => n.id === inspectId);

  const getModelName = (node: typeof nodes[0]): string | null => {
    // For self node, check the store directly
    if (node.isSelf && modelLoaded && selectedModelId) {
      return availableModels.find(m => m.id === selectedModelId)?.name || selectedModelId;
    }
    // For peers, check heartbeat-propagated modelId
    const modelId = (node as any).modelId;
    if (modelId) {
      return availableModels.find(m => m.id === modelId)?.name || modelId;
    }
    return null;
  };

  const handleForceElection = () => {
    try {
      getMeshOrchestrator().election.forceElection();
    } catch { /* */ }
  };

  return (
    <div className="nodes-view">
      <div className="nodes-view-header">
        <h2 className="view-title">Nodes</h2>
        <button className="nodes-election-btn" onClick={handleForceElection} title="Force a new leader election">
          <ArrowUpCircle size={14} /> Re-elect Master
        </button>
      </div>
      {nodes.length === 1 && nodes[0].isSelf && (
        <div className="nodes-empty">
          Running standalone — connect another device on the same network to form a mesh.
        </div>
      )}
      {!selfId && rawNodes.length === 0 && (
        <div className="nodes-empty">Initializing mesh network…</div>
      )}
      <div className="nodes-grid">
        {nodes.map((node) => (
          <div
            key={node.id}
            className={`node-card ${node.status}`}
            onClick={() => setSelectedNodeId(node.id)}
          >
            <div className="node-card-header">
              <div className="node-card-dot" style={{ background: getStatusColor(node.status) }} />
              <span className="node-card-name">{node.name}</span>
              {node.id === masterId && <Crown size={14} className="node-crown" />}
              <span className={`node-role-badge ${node.role}`}>{node.role}</span>
            </div>

            <div className="node-card-metrics">
              <div className="node-metric-row">
                <span className="node-metric-label"><Cpu size={12} /> VRAM</span>
                <div className="node-metric-bar-container">
                  <div className="node-metric-bar">
                    <div className="node-metric-bar-fill" style={{
                      width: `${node.vram > 0 ? (node.vramUsed / node.vram) * 100 : 0}%`,
                      background: node.vram > 0 && (node.vramUsed / node.vram) > 0.85 ? 'var(--accent-danger)' : 'var(--accent-primary)',
                    }} />
                  </div>
                  <span className="node-metric-value mono">{node.vramUsed}/{node.vram}MB</span>
                </div>
              </div>
              <div className="node-metric-row">
                <span className="node-metric-label"><HardDrive size={12} /> RAM</span>
                <div className="node-metric-bar-container">
                  <div className="node-metric-bar">
                    <div className="node-metric-bar-fill ram" style={{
                      width: `${node.ramTotal > 0 ? (node.ramUsed / node.ramTotal) * 100 : 0}%`,
                      background: node.ramTotal > 0 && (node.ramUsed / node.ramTotal) > 0.85 ? 'var(--accent-danger)' : 'var(--accent-warning)',
                    }} />
                  </div>
                  <span className="node-metric-value mono">{node.ramUsed}/{node.ramTotal}MB</span>
                </div>
              </div>
            </div>

            <div className="node-card-footer">
              <div className="node-footer-stats">
                <span><Wifi size={11} /> {node.latency}ms</span>
                <span><Clock size={11} /> {formatUptime(node.uptime)}</span>
              </div>
              {(() => {
                const modelName = getModelName(node);
                return modelName ? (
                  <div className="node-model-badge">
                    <Brain size={10} /> {modelName}
                  </div>
                ) : null;
              })()}
              {node.currentTask && (
                <div className="node-current-task">
                  <Zap size={11} /> {node.currentTask}
                </div>
              )}
            </div>

            <div className="node-cap-list">
              {node.capabilities.map(c => (
                <span key={c} className="node-cap-chip">{c}</span>
              ))}
            </div>

            <div className="node-card-actions">
              <button className="node-action-btn" onClick={(e) => { e.stopPropagation(); setInspectId(node.id); }} title="Inspect">
                <Eye size={13} />
              </button>
              {!node.isSelf && (
                <button className="node-action-btn danger" title="Remove node" onClick={(e) => {
                  e.stopPropagation();
                  useAppStore.getState().removeNode(node.id);
                }}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Inspect drawer */}
      {inspectedNode && (
        <div className="node-inspect-overlay" onClick={() => setInspectId(null)}>
          <div className="node-inspect-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="inspect-header">
              <h3>{inspectedNode.name}</h3>
              <button className="inspect-close" onClick={() => setInspectId(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="inspect-body">
              <div className="inspect-field">
                <span className="inspect-label">ID</span>
                <span className="inspect-value mono">{inspectedNode.id}</span>
              </div>
              <div className="inspect-field">
                <span className="inspect-label">Role</span>
                <span className={`node-role-badge ${inspectedNode.role}`}>{inspectedNode.role}</span>
              </div>
              <div className="inspect-field">
                <span className="inspect-label">Status</span>
                <span style={{ color: getStatusColor(inspectedNode.status) }}>{inspectedNode.status}</span>
              </div>
              <div className="inspect-field">
                <span className="inspect-label">VRAM</span>
                <span className="mono">{inspectedNode.vramUsed}MB / {inspectedNode.vram}MB ({inspectedNode.vram > 0 ? Math.round((inspectedNode.vramUsed / inspectedNode.vram) * 100) : 0}%)</span>
              </div>
              <div className="inspect-field">
                <span className="inspect-label">RAM</span>
                <span className="mono">{inspectedNode.ramUsed}MB / {inspectedNode.ramTotal}MB</span>
              </div>
              <div className="inspect-field">
                <span className="inspect-label">Latency</span>
                <span className="mono">{inspectedNode.latency}ms</span>
              </div>
              <div className="inspect-field">
                <span className="inspect-label">Uptime</span>
                <span>{formatUptime(inspectedNode.uptime)}</span>
              </div>
              <div className="inspect-field">
                <span className="inspect-label">Current Task</span>
                <span>{inspectedNode.currentTask || 'Idle'}</span>
              </div>
              <div className="inspect-field">
                <span className="inspect-label">Model</span>
                <span>{getModelName(inspectedNode) || 'None loaded'}</span>
              </div>
              <div className="inspect-field">
                <span className="inspect-label">Capabilities</span>
                <div className="inspect-caps">
                  {inspectedNode.capabilities.map((c) => (
                    <span key={c} className="inspect-cap-badge">{c}</span>
                  ))}
                </div>
              </div>
              <div className="inspect-field">
                <span className="inspect-label">Self</span>
                <span>{inspectedNode.isSelf ? 'Yes (this machine)' : 'No (remote peer)'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
