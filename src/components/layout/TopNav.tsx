import React from 'react';
import { useAppStore } from '../../stores/appStore';
import {
  Layers, Sun, Moon, Mic, MicOff, Settings, PanelRightOpen, PanelRightClose,
  Terminal, Menu, Wifi, Crown, Cpu, Loader2, MessageSquare, Server,
} from 'lucide-react';
import './TopNav.css';

export function TopNav() {
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const nodes = useAppStore((s) => s.nodes);
  const masterId = useAppStore((s) => s.masterId);
  const insightPanelOpen = useAppStore((s) => s.insightPanelOpen);
  const toggleInsightPanel = useAppStore((s) => s.toggleInsightPanel);
  const drawerOpen = useAppStore((s) => s.drawerOpen);
  const toggleDrawer = useAppStore((s) => s.toggleDrawer);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const voiceListening = useAppStore((s) => s.voiceListening);
  const setVoiceListening = useAppStore((s) => s.setVoiceListening);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const modelLoaded = useAppStore((s) => s.modelLoaded);
  const modelLoading = useAppStore((s) => s.modelLoading);
  const loadProgress = useAppStore((s) => s.loadProgress);
  const availableModels = useAppStore((s) => s.availableModels);
  const selectedModelId = useAppStore((s) => s.selectedModelId);
  const chatPanelOpen = useAppStore((s) => s.chatPanelOpen);
  const toggleChatPanel = useAppStore((s) => s.toggleChatPanel);

  const onlineNodes = nodes.filter((n) => n.status !== 'offline');
  const peerCount = onlineNodes.filter((n) => !n.isSelf).length;
  const masterNode = nodes.find((n) => n.id === masterId);
  const selectedModel = availableModels.find(m => m.id === selectedModelId);

  return (
    <header className="topnav">
      <div className="topnav-left">
        <button className="topnav-menu-btn" onClick={toggleSidebar} aria-label="Toggle sidebar">
          <Menu size={18} />
        </button>
        <div className="topnav-brand">
          <div className="topnav-logo">
            <Layers size={18} />
          </div>
          <span className="topnav-title">SouthStack</span>
        </div>

        <div className="topnav-divider" />

        <div className="topnav-status">
          <div className={`status-dot ${modelLoaded ? 'online' : modelLoading ? 'loading' : 'idle'}`} />
          {modelLoading ? (
            <span className="model-loading-status">
              <Loader2 size={12} className="spin-small" /> Loading {loadProgress}%
            </span>
          ) : (
            <span>{modelLoaded ? 'AI Ready' : 'No Model'}</span>
          )}
        </div>

        {modelLoaded && selectedModel && (
          <div className="topnav-badge model-badge">
            <Cpu size={12} />
            <span>{selectedModel.name}</span>
          </div>
        )}
      </div>

      <div className="topnav-center">
        {masterNode && (
          <div className="topnav-badge master-badge">
            <Crown size={12} />
            <span>{masterNode.name}</span>
          </div>
        )}
        <div className="topnav-badge peer-badge">
          <Wifi size={12} />
          <span>{peerCount} peer{peerCount !== 1 ? 's' : ''} | {onlineNodes.length} node{onlineNodes.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div className="topnav-right">
        <button
          className={`topnav-icon-btn ${chatPanelOpen ? 'active' : ''}`}
          onClick={toggleChatPanel}
          aria-label="AI Chat"
          title="AI Chat"
        >
          <MessageSquare size={16} />
        </button>

        <button
          className="topnav-icon-btn"
          onClick={() => setActiveView('nodes')}
          aria-label="Nodes"
          title={`Nodes (${onlineNodes.length} online)`}
        >
          <Server size={16} />
          {peerCount > 0 && (
            <span className="topnav-icon-badge">{peerCount}</span>
          )}
        </button>

        <button
          className={`topnav-icon-btn ${voiceListening ? 'active listening' : ''}`}
          onClick={() => {
            setVoiceListening(!voiceListening);
            setActiveView('voice');
          }}
          aria-label="Voice"
        >
          {voiceListening ? <MicOff size={16} /> : <Mic size={16} />}
        </button>

        <button
          className={`topnav-icon-btn ${drawerOpen ? 'active' : ''}`}
          onClick={toggleDrawer}
          aria-label="Terminal"
        >
          <Terminal size={16} />
        </button>

        <button className="topnav-icon-btn" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <button
          className={`topnav-icon-btn ${insightPanelOpen ? 'active' : ''}`}
          onClick={toggleInsightPanel}
          aria-label="Toggle insight panel"
        >
          {insightPanelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>

        <button
          className="topnav-icon-btn"
          onClick={() => setActiveView('settings')}
          aria-label="Settings"
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
}
