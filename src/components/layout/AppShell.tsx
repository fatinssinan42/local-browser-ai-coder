import React from 'react';
import { useAppStore } from '../../stores/appStore';
import { TopNav } from './TopNav';
import { Sidebar } from './Sidebar';
import { InsightPanel } from './InsightPanel';
import { ChatPanel } from '../chat/ChatPanel';
import { TerminalDrawer } from '../terminal/TerminalDrawer';
import { DashboardView } from '../dashboard/DashboardView';
import { NodeGrid } from '../nodes/NodeGrid';
import { TaskBoard } from '../tasks/TaskBoard';
import { SharedIDE } from '../ide/SharedIDE';
import { DebugPanel } from '../debug/DebugPanel';
import { FilesView } from '../files/FilesView';
import { VoicePanel } from '../voice/VoicePanel';
import { SettingsView } from './SettingsView';
import { ChatHistoryView } from '../chat/ChatHistoryView';
import { ProjectBuilder } from '../project/ProjectBuilder';
import './AppShell.css';

export function AppShell() {
  const activeView = useAppStore((s) => s.activeView);
  const insightPanelOpen = useAppStore((s) => s.insightPanelOpen);
  const drawerOpen = useAppStore((s) => s.drawerOpen);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const chatPanelOpen = useAppStore((s) => s.chatPanelOpen);
  const toggleChatPanel = useAppStore((s) => s.toggleChatPanel);

  const renderView = () => {
    switch (activeView) {
      case 'dashboard': return <DashboardView />;
      case 'nodes': return <NodeGrid />;
      case 'tasks': return <TaskBoard />;
      case 'ide': return <SharedIDE />;
      case 'debug': return <DebugPanel />;
      case 'terminal': return <TerminalDrawer />;
      case 'files': return <FilesView />;
      case 'voice': return <VoicePanel />;
      case 'chat-history': return <ChatHistoryView />;
      case 'project-builder': return <ProjectBuilder />;
      case 'settings': return <SettingsView />;
      default: return <DashboardView />;
    }
  };

  return (
    <div className="app-shell">
      <TopNav />
      <div className="app-body">
        <Sidebar />
        <main className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
          <div className="view-container">
            {renderView()}
          </div>
          {drawerOpen && activeView !== 'terminal' && (
            <div className="drawer-container">
              <TerminalDrawer />
            </div>
          )}
        </main>
        {insightPanelOpen && activeView !== 'settings' && <InsightPanel />}
      </div>

      {/* Collapsible Chat Panel */}
      <button 
        className={`chat-toggle-btn ${chatPanelOpen ? 'open' : ''}`}
        onClick={toggleChatPanel}
        title={chatPanelOpen ? 'Close AI Chat' : 'Open AI Chat'}
      >
        <span className="toggle-icon">‹</span>
      </button>

      {chatPanelOpen && (
        <div className="chat-panel-container">
          <ChatPanel onClose={toggleChatPanel} />
        </div>
      )}
    </div>
  );
}
