import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../stores/appStore';
import { inferenceService } from '../../services/InferenceService';
import { getMeshOrchestrator, destroyMeshOrchestrator } from '../../services/MeshOrchestrator';
import { X, Monitor, Wifi, Cpu, Download, Loader2, Check, AlertTriangle, Plug } from 'lucide-react';

export function SettingsOverlay() {
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);

  if (!settingsOpen) return null;

  return (
    <div className="settings-overlay-backdrop" onClick={() => setSettingsOpen(false)}>
      <div className="settings-overlay" onClick={(e) => e.stopPropagation()}>
        <div className="settings-overlay-header">
          <h2>Settings</h2>
          <button className="settings-close-btn" onClick={() => setSettingsOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <div className="settings-overlay-body">
          <SettingsContent />
        </div>
      </div>
    </div>
  );
}

function SettingsContent() {
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const availableModels = useAppStore((s) => s.availableModels);
  const selectedModelId = useAppStore((s) => s.selectedModelId);
  const setSelectedModelId = useAppStore((s) => s.setSelectedModelId);
  const modelLoaded = useAppStore((s) => s.modelLoaded);
  const modelLoading = useAppStore((s) => s.modelLoading);
  const loadProgress = useAppStore((s) => s.loadProgress);
  const setModelLoaded = useAppStore((s) => s.setModelLoaded);
  const setLoadProgress = useAppStore((s) => s.setLoadProgress);
  const addEvent = useAppStore((s) => s.addEvent);
  const nodes = useAppStore((s) => s.nodes);

  const [signalingServer, setSignalingServer] = useState(() => {
    return (
      localStorage.getItem('signalingServer') ||
      import.meta.env.VITE_SIGNALING_SERVER ||
      `http://${window.location.hostname}:3001`
    );
  });
  const [connecting, setConnecting] = useState(false);
  const [meshConnected, setMeshConnected] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const orchestratorRef = useRef<ReturnType<typeof getMeshOrchestrator> | null>(null);

  useEffect(() => {
    const checkConnection = setInterval(() => {
      try {
        const o = getMeshOrchestrator();
        setMeshConnected(o.p2p.isMeshConnected());
      } catch {
        setMeshConnected(false);
      }
    }, 500);
    return () => clearInterval(checkConnection);
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    localStorage.setItem('signalingServer', signalingServer);
    try {
      destroyMeshOrchestrator();
      orchestratorRef.current = getMeshOrchestrator(signalingServer);
      await orchestratorRef.current.initialize();
      if (orchestratorRef.current.inference.isModelLoaded()) {
        orchestratorRef.current.wireInferenceEngine();
      }
      const connected = orchestratorRef.current.p2p.isMeshConnected();
      setMeshConnected(connected);
      addEvent({
        id: `event-${Date.now()}`,
        type: connected ? 'success' : 'warning',
        message: connected
          ? `Connected to mesh at ${signalingServer}`
          : `Running standalone — could not reach ${signalingServer}`,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      setMeshConnected(false);
      addEvent({
        id: `event-${Date.now()}`, type: 'error',
        message: `Connection failed: ${err.message}`, timestamp: Date.now(),
      });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    destroyMeshOrchestrator();
    orchestratorRef.current = null;
    setMeshConnected(false);
    const store = useAppStore.getState();
    for (const node of store.nodes) store.removeNode(node.id);
  };

  const handleLoadModel = async () => {
    if (modelLoaded || modelLoading || !selectedModelId) return;
    setLoadError(null);
    try {
      const success = await inferenceService.loadModel(selectedModelId);
      if (!success) {
        setLoadError('Model load failed. Check browser console for details. First download requires internet.');
      }
    } catch (err: any) {
      setLoadError(err.message || 'Unexpected error loading model.');
    }
  };

  const handleUnloadModel = async () => {
    await inferenceService.unload();
    setModelLoaded(false);
    setLoadProgress(0);
  };

  const selectedModel = availableModels.find((m) => m.id === selectedModelId);
  const connectedPeers = nodes.filter((n) => !n.isSelf && n.status !== 'offline').length;

  return (
    <div className="settings-sections">
      {/* Theme */}
      <div className="settings-section">
        <div className="settings-section-header">
          <Monitor size={16} />
          <h3>Appearance</h3>
        </div>
        <div className="settings-row">
          <label>Theme</label>
          <div className="settings-toggle-group">
            <button className={`stoggle ${theme === 'dark' ? 'active' : ''}`} onClick={() => theme !== 'dark' && toggleTheme()}>Dark</button>
            <button className={`stoggle ${theme === 'light' ? 'active' : ''}`} onClick={() => theme !== 'light' && toggleTheme()}>Light</button>
          </div>
        </div>
      </div>

      {/* Model */}
      <div className="settings-section">
        <div className="settings-section-header">
          <Cpu size={16} />
          <h3>AI Model</h3>
        </div>
        <div className="settings-row">
          <label>Model</label>
          <select
            className="settings-select"
            value={selectedModelId || ''}
            onChange={(e) => setSelectedModelId(e.target.value)}
            disabled={modelLoaded || modelLoading}
          >
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>{m.name} ({m.size}) — ~{m.vramRequired}MB</option>
            ))}
          </select>
        </div>
        {selectedModel && <p className="settings-hint">{selectedModel.description}</p>}
        {modelLoading && (
          <div className="settings-progress">
            <div className="settings-progress-bar" style={{ width: `${loadProgress}%` }} />
            <span><Loader2 size={12} className="spin" /> {loadProgress}%</span>
          </div>
        )}
        <div className="settings-row">
          {modelLoaded ? (
            <>
              <span className="settings-badge success"><Check size={12} /> Loaded</span>
              <button className="settings-btn danger" onClick={handleUnloadModel}>Unload</button>
            </>
          ) : modelLoading ? (
            <span className="settings-badge loading"><Loader2 size={12} className="spin" /> Loading...</span>
          ) : (
            <button className="settings-btn primary" onClick={handleLoadModel}>
              <Download size={12} /> Load Model
            </button>
          )}
        </div>
        {loadError && <p className="settings-error"><AlertTriangle size={12} /> {loadError}</p>}
      </div>

      {/* Mesh */}
      <div className="settings-section">
        <div className="settings-section-header">
          <Wifi size={16} />
          <h3>Mesh Network</h3>
        </div>
        <div className="settings-row">
          <label>Signaling Server</label>
          <input
            className="settings-input"
            type="text"
            value={signalingServer}
            onChange={(e) => setSignalingServer(e.target.value)}
            placeholder="http://100.x.x.x:3001 (Tailscale IP)"
            disabled={meshConnected}
          />
        </div>
        <div className="settings-row">
          {meshConnected ? (
            <>
              <span className="settings-badge success"><Check size={12} /> Connected — {connectedPeers} peer{connectedPeers !== 1 ? 's' : ''}</span>
              <button className="settings-btn danger" onClick={handleDisconnect}>Disconnect</button>
            </>
          ) : connecting ? (
            <span className="settings-badge loading"><Loader2 size={12} className="spin" /> Connecting...</span>
          ) : (
            <button className="settings-btn primary" onClick={handleConnect}>
              <Plug size={12} /> Connect
            </button>
          )}
        </div>
        {!meshConnected && !connecting && (
          <p className="settings-hint">
            Run <code>npm run server</code> on one machine. Enter its Tailscale IP (100.x.x.x:3001) here.
          </p>
        )}
      </div>
    </div>
  );
}
