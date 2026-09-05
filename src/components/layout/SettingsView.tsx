import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../stores/appStore';
import { inferenceService } from '../../services/InferenceService';
import { getMeshOrchestrator, destroyMeshOrchestrator } from '../../services/MeshOrchestrator';
import { Monitor, Wifi, Cpu, Volume2, Download, Loader2, Check, AlertTriangle, RefreshCw, Plug } from 'lucide-react';
import './SettingsView.css';

export function SettingsView() {
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const availableModels = useAppStore((s) => s.availableModels);
  const selectedModelId = useAppStore((s) => s.selectedModelId);
  const setSelectedModelId = useAppStore((s) => s.setSelectedModelId);
  const modelLoaded = useAppStore((s) => s.modelLoaded);
  const modelLoading = useAppStore((s) => s.modelLoading);
  const loadProgress = useAppStore((s) => s.loadProgress);
  const setModelLoading = useAppStore((s) => s.setModelLoading);
  const setModelLoaded = useAppStore((s) => s.setModelLoaded);
  const setLoadProgress = useAppStore((s) => s.setLoadProgress);
  const addEvent = useAppStore((s) => s.addEvent);
  const nodes = useAppStore((s) => s.nodes);
  const selfId = useAppStore((s) => s.selfId);

  const [signalingServer, setSignalingServer] = useState(() => {
    return (
      localStorage.getItem('signalingServer') ||
      import.meta.env.VITE_SIGNALING_SERVER ||
      `http://${window.location.hostname}:3001`
    );
  });
  const [nodeName, setNodeName] = useState(() => {
    return localStorage.getItem('nodeName') || 'My Node';
  });
  const [connecting, setConnecting] = useState(false);
  const [meshConnected, setMeshConnected] = useState(false);

  const orchestratorRef = useRef<ReturnType<typeof getMeshOrchestrator> | null>(null);

  useEffect(() => {
    const checkConnection = setInterval(() => {
      if (orchestratorRef.current) {
        const connected = orchestratorRef.current.p2p.isMeshConnected();
        setMeshConnected(connected);
      }
    }, 500);
    return () => clearInterval(checkConnection);
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    localStorage.setItem('signalingServer', signalingServer);
    localStorage.setItem('nodeName', nodeName);

    try {
      // Destroy any existing orchestrator (may have been created with wrong URL)
      destroyMeshOrchestrator();
      // Create a fresh one with the user-specified signaling server URL
      orchestratorRef.current = getMeshOrchestrator(signalingServer);
      await orchestratorRef.current.initialize();

      // Re-wire inference engine if a model was previously loaded.
      // Destroying the orchestrator creates new TaskDistributor/DebugManager
      // instances that need the engine reference restored.
      if (orchestratorRef.current.inference.isModelLoaded()) {
        orchestratorRef.current.wireInferenceEngine();
      }

      // Check actual connection state (not standalone)
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
        id: `event-${Date.now()}`,
        type: 'error',
        message: `Connection failed: ${err.message}`,
        timestamp: Date.now(),
      });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    destroyMeshOrchestrator();
    orchestratorRef.current = null;
    setMeshConnected(false);
    // Clear stale nodes from the store — fresh connect will re-populate
    const store = useAppStore.getState();
    for (const node of store.nodes) {
      store.removeNode(node.id);
    }
    addEvent({
      id: `event-${Date.now()}`,
      type: 'info',
      message: 'Disconnected from mesh network',
      timestamp: Date.now(),
    });
  };

  const [loadError, setLoadError] = useState<string | null>(null);

  const handleLoadModel = async () => {
    if (modelLoaded || modelLoading || !selectedModelId) return;
    setLoadError(null);

    // Check internet connectivity before attempting download
    if (!navigator.onLine) {
      const msg = 'No internet connection. Models must be downloaded from the internet on first use. Connect to the internet and try again.';
      setLoadError(msg);
      addEvent({ id: `event-${Date.now()}`, type: 'error', message: msg, timestamp: Date.now() });
      return;
    }

    const success = await inferenceService.loadModel(selectedModelId);

    if (success) {
      addEvent({
        id: `event-${Date.now()}`,
        type: 'success',
        message: `Model loaded: ${availableModels.find(m => m.id === selectedModelId)?.name}`,
        timestamp: Date.now(),
      });
    } else {
      const msg = 'Model download failed. Ensure you have a stable internet connection (models are ~1-4 GB). Once downloaded, models are cached for offline use.';
      setLoadError(msg);
      addEvent({ id: `event-${Date.now()}`, type: 'error', message: msg, timestamp: Date.now() });
    }
  };

  const handleUnloadModel = async () => {
    await inferenceService.unload();
    setModelLoaded(false);
    setLoadProgress(0);
    addEvent({
      id: `event-${Date.now()}`,
      type: 'info',
      message: 'Model unloaded',
      timestamp: Date.now(),
    });
  };

  const selectedModel = availableModels.find(m => m.id === selectedModelId);
  const connectedPeers = nodes.filter(n => !n.isSelf && n.status !== 'offline').length;

  return (
    <div className="settings-view">
      <h2 className="view-title">Settings</h2>

      <div className="settings-grid">
        {/* Appearance */}
        <div className="settings-card">
          <div className="settings-card-header">
            <Monitor size={18} />
            <h3>Appearance</h3>
          </div>
          <div className="settings-field">
            <label>Theme</label>
            <div className="settings-toggle-group">
              <button
                className={`settings-toggle-btn ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => theme !== 'dark' && toggleTheme()}
              >
                Dark
              </button>
              <button
                className={`settings-toggle-btn ${theme === 'light' ? 'active' : ''}`}
                onClick={() => theme !== 'light' && toggleTheme()}
              >
                Light
              </button>
            </div>
          </div>
        </div>

        {/* Model Settings */}
        <div className="settings-card model-card">
          <div className="settings-card-header">
            <Cpu size={18} />
            <h3>AI Model</h3>
          </div>
          
          <div className="settings-field">
            <label>Model Selection</label>
            <select
              className="settings-select"
              value={selectedModelId || ''}
              onChange={(e) => setSelectedModelId(e.target.value)}
              disabled={modelLoaded || modelLoading}
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.size}) — ~{m.vramRequired}MB VRAM
                </option>
              ))}
            </select>
          </div>

          {selectedModel && (
            <div className="model-info">
              <p className="model-description">{selectedModel.description}</p>
              <div className="model-stats">
                <span>Size: {selectedModel.size}</span>
                <span>VRAM: ~{selectedModel.vramRequired}MB</span>
              </div>
            </div>
          )}

          {modelLoading && (
            <div className="model-loading">
              <div className="loading-bar">
                <div className="loading-bar-fill" style={{ width: `${loadProgress}%` }} />
              </div>
              <span className="loading-text">
                <Loader2 size={14} className="spin" /> Loading... {loadProgress}%
              </span>
            </div>
          )}

          <div className="model-status">
            {modelLoaded ? (
              <>
                <span className="status-badge loaded">
                  <Check size={14} /> Model Loaded
                </span>
                <button className="settings-btn danger" onClick={handleUnloadModel}>
                  Unload Model
                </button>
              </>
            ) : modelLoading ? (
              <span className="status-badge loading">
                <Loader2 size={14} className="spin" /> Loading...
              </span>
            ) : (
              <button className="settings-btn primary" onClick={handleLoadModel}>
                <Download size={14} /> Load Model
              </button>
            )}
          </div>

          {loadError && (
            <div className="model-error">
              <AlertTriangle size={14} />
              <span>{loadError}</span>
            </div>
          )}

          {!modelLoaded && !modelLoading && (
            <div className="demo-mode-section">
              <p className="settings-hint">
                Load a model to enable AI chat and code assistance.
                Without a model, the chat will use pre-built fallback responses.
                First download requires internet (~1-4 GB). After that, models load offline from cache.
              </p>
            </div>
          )}
        </div>

        {/* Mesh Network */}
        <div className="settings-card">
          <div className="settings-card-header">
            <Wifi size={18} />
            <h3>Mesh Network</h3>
          </div>

          <div className="settings-field">
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

          <div className="settings-field">
            <label>Node Name</label>
            <input
              className="settings-input"
              type="text"
              value={nodeName}
              onChange={(e) => setNodeName(e.target.value)}
              placeholder="My Node"
              disabled={meshConnected}
            />
          </div>

          <div className="connection-status">
            {meshConnected ? (
              <>
                <span className="status-badge connected">
                  <Check size={14} /> Connected
                </span>
                <span className="peer-count">{connectedPeers} peer{connectedPeers !== 1 ? 's' : ''} online</span>
                <button className="settings-btn danger" onClick={handleDisconnect}>
                  Disconnect
                </button>
              </>
            ) : connecting ? (
              <span className="status-badge connecting">
                <Loader2 size={14} className="spin" /> Connecting...
              </span>
            ) : (
              <button className="settings-btn primary" onClick={handleConnect}>
                <Plug size={14} /> Connect to Mesh
              </button>
            )}
          </div>

          {!meshConnected && !connecting && (
            <div className="network-info">
              <AlertTriangle size={14} />
              <span>
                Run <code>npm run server</code> on one machine, then enter its Tailscale IP
                (e.g. <code>http://100.x.x.x:3001</code>) on all machines. For same-network use,
                the LAN IP works too. The server prints all available addresses on startup.
              </span>
            </div>
          )}
        </div>

        {/* Voice Settings */}
        <div className="settings-card">
          <div className="settings-card-header">
            <Volume2 size={18} />
            <h3>Voice Interaction</h3>
          </div>
          <div className="settings-field">
            <label>Speech Recognition</label>
            <div className="settings-toggle-group">
              <button className="settings-toggle-btn active">Enabled</button>
              <button className="settings-toggle-btn">Disabled</button>
            </div>
          </div>
          <div className="settings-field">
            <label>Speech Synthesis</label>
            <div className="settings-toggle-group">
              <button className="settings-toggle-btn active">Enabled</button>
              <button className="settings-toggle-btn">Disabled</button>
            </div>
          </div>
          <div className="settings-field">
            <label>Language</label>
            <select className="settings-select" defaultValue="en-US">
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="es-ES">Spanish</option>
              <option value="fr-FR">French</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
