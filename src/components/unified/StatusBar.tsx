import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { Wifi, WifiOff, Cpu, HardDrive, Users, Settings, Loader2, RefreshCw, ListTodo } from 'lucide-react';
import { getMeshOrchestrator } from '../../services/MeshOrchestrator';
import { TaskBoard } from '../tasks/TaskBoard';

export function StatusBar() {
  const nodes = useAppStore((s) => s.nodes);
  const selfNode = nodes.find((n) => n.isSelf);
  const peers = nodes.filter((n) => !n.isSelf && n.status !== 'offline');
  const modelLoaded = useAppStore((s) => s.modelLoaded);
  const modelLoading = useAppStore((s) => s.modelLoading);
  const loadProgress = useAppStore((s) => s.loadProgress);
  const selectedModelId = useAppStore((s) => s.selectedModelId);
  const availableModels = useAppStore((s) => s.availableModels);
  const activeFilePath = useAppStore((s) => s.activeFilePath);
  const files = useAppStore((s) => s.files);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const tasks = useAppStore((s) => s.tasks);
  const [tasksOpen, setTasksOpen] = useState(false);

  const activeTasks = tasks.filter((t) => t.status === 'running' || t.status === 'assigned').length;
  const queuedTasks = tasks.filter((t) => t.status === 'queued').length;
  const taskBadge = activeTasks + queuedTasks;

  // Track signaling server connection state separately from WebRTC peer count
  const [signalingConnected, setSignalingConnected] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    const check = setInterval(() => {
      try {
        const o = getMeshOrchestrator();
        setSignalingConnected(o.p2p.isMeshConnected());
        setIsStandalone(o.p2p.isStandaloneMode());
      } catch {
        setSignalingConnected(false);
      }
    }, 1000);
    return () => clearInterval(check);
  }, []);

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      const o = getMeshOrchestrator();
      await o.p2p.reconnect();
      setSignalingConnected(o.p2p.isMeshConnected());
      setIsStandalone(o.p2p.isStandaloneMode());
    } catch {
      // ignore
    } finally {
      setReconnecting(false);
    }
  };

  const model = availableModels.find((m) => m.id === selectedModelId);
  const activeFile = files.find((f) => f.path === activeFilePath);

  // Mesh status label
  let meshLabel: React.ReactNode;
  let meshClass = '';
  if (signalingConnected) {
    meshClass = 'connected';
    meshLabel = <><Wifi size={12} /><Users size={11} /> {peers.length} peer{peers.length !== 1 ? 's' : ''}</>;
  } else if (isStandalone) {
    meshLabel = <><WifiOff size={12} /> Standalone</>;
  } else {
    meshLabel = <><Loader2 size={12} className="spin" /> Connecting...</>;
  }

  return (
    <div className="status-bar">
      {/* Tasks popover */}
      {tasksOpen && (
        <>
          <div className="tasks-popover-backdrop" onClick={() => setTasksOpen(false)} />
          <div className="tasks-popover">
            <TaskBoard />
          </div>
        </>
      )}

      <div className="status-bar-left">
        {/* Mesh status */}
        <div className={`status-item ${meshClass}`}>
          {meshLabel}
        </div>

        {/* Reconnect button when standalone */}
        {isStandalone && !reconnecting && (
          <button
            className="status-item status-reconnect-btn"
            title="Retry signaling server connection"
            onClick={handleReconnect}
          >
            <RefreshCw size={11} /> Retry
          </button>
        )}
        {reconnecting && (
          <div className="status-item">
            <Loader2 size={11} className="spin" /> Retrying...
          </div>
        )}

        {/* Model status */}
        <div className={`status-item ${modelLoaded ? 'loaded' : ''}`}>
          <Cpu size={12} />
          {modelLoaded ? (
            <span>{model?.name || 'Model loaded'}</span>
          ) : modelLoading ? (
            <span>Loading {loadProgress}%</span>
          ) : (
            <span>No model</span>
          )}
        </div>

        {/* VRAM */}
        {selfNode && selfNode.vramUsed > 0 && (
          <div className="status-item">
            <HardDrive size={12} />
            <span>{selfNode.vramUsed}MB VRAM</span>
          </div>
        )}
      </div>

      <div className="status-bar-right">
        {activeFile && (
          <div className="status-item">
            <span>{activeFile.language}</span>
          </div>
        )}
        {/* Tasks icon */}
        <button
          className={`status-item status-tasks-btn ${tasksOpen ? 'active' : ''}`}
          onClick={() => setTasksOpen((v) => !v)}
          title="Tasks"
        >
          <ListTodo size={12} />
          {taskBadge > 0 && (
            <span className="status-task-badge">{taskBadge}</span>
          )}
        </button>
        {/* Settings icon */}
        <button className="status-item status-settings-btn" onClick={() => setSettingsOpen(true)}>
          <Settings size={12} />
        </button>
      </div>
    </div>
  );
}
