import React, { useState, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { FileTree } from './FileTree';
import { EditorTabs } from './EditorTabs';
import { CommandTerminal } from './CommandTerminal';
import { StatusBar } from './StatusBar';
import { SettingsOverlay } from './SettingsOverlay';
import { ChatHistoryView } from '../chat/ChatHistoryView';
import { ResizeHandle } from './ResizeHandle';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, History } from 'lucide-react';
import './UnifiedIDE.css';

// Default panel sizes
const DEFAULT_FILE_TREE_WIDTH = 240;
const MIN_FILE_TREE_WIDTH = 160;
const MAX_FILE_TREE_WIDTH = 400;

const DEFAULT_TERMINAL_WIDTH = 380;
const MIN_TERMINAL_WIDTH = 280;
const MAX_TERMINAL_WIDTH = 600;

export function UnifiedIDE() {
  const fileTreeCollapsed = useAppStore((s) => s.fileTreeCollapsed);
  const toggleFileTree = useAppStore((s) => s.toggleFileTree);
  const terminalCollapsed = useAppStore((s) => s.terminalCollapsed);
  const toggleTerminal = useAppStore((s) => s.toggleTerminal);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const chatSessions = useAppStore((s) => s.chatSessions);

  // Resizable panel widths
  const [fileTreeWidth, setFileTreeWidth] = useState(DEFAULT_FILE_TREE_WIDTH);
  const [terminalWidth, setTerminalWidth] = useState(DEFAULT_TERMINAL_WIDTH);
  const [isResizing, setIsResizing] = useState(false);

  // Handle file tree resize
  const handleFileTreeResize = useCallback((delta: number) => {
    setFileTreeWidth((prev) => Math.min(MAX_FILE_TREE_WIDTH, Math.max(MIN_FILE_TREE_WIDTH, prev + delta)));
  }, []);

  // Handle terminal resize
  const handleTerminalResize = useCallback((delta: number) => {
    setTerminalWidth((prev) => Math.min(MAX_TERMINAL_WIDTH, Math.max(MIN_TERMINAL_WIDTH, prev - delta)));
  }, []);

  return (
    <div className={`unified-ide ${isResizing ? 'resizing' : ''}`}>
      {/* Top bar */}
      <div className="unified-topbar">
        <div className="unified-topbar-left">
          <button className="topbar-toggle" onClick={toggleFileTree} title={fileTreeCollapsed ? 'Show explorer' : 'Hide explorer'}>
            {fileTreeCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <span className="topbar-title">SouthStack</span>
          <span className="topbar-subtitle">Offline AI IDE</span>
        </div>
        <div className="unified-topbar-right">
          <button
            className={`topbar-toggle ${chatHistoryOpen ? 'active' : ''}`}
            onClick={() => setChatHistoryOpen(!chatHistoryOpen)}
            title="Chat History"
          >
            <History size={16} />
            {chatSessions.length > 0 && (
              <span className="topbar-badge">{chatSessions.length}</span>
            )}
          </button>
          <button className="topbar-toggle" onClick={toggleTerminal} title={terminalCollapsed ? 'Show terminal' : 'Hide terminal'}>
            {terminalCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="unified-body">
        {/* File tree sidebar */}
        {!fileTreeCollapsed && (
          <>
            <div className="unified-filetree" style={{ width: fileTreeWidth }}>
              <FileTree />
            </div>
            <ResizeHandle
              direction="horizontal"
              onResize={handleFileTreeResize}
              onResizeStart={() => setIsResizing(true)}
              onResizeEnd={() => setIsResizing(false)}
              className="resize-handle-filetree"
            />
          </>
        )}

        {/* Editor */}
        <div className="unified-editor">
          <EditorTabs />
        </div>

        {/* Command terminal */}
        {!terminalCollapsed && (
          <>
            <ResizeHandle
              direction="horizontal"
              onResize={handleTerminalResize}
              onResizeStart={() => setIsResizing(true)}
              onResizeEnd={() => setIsResizing(false)}
              className="resize-handle-terminal"
            />
            <div className="unified-terminal" style={{ width: terminalWidth }}>
              <CommandTerminal />
            </div>
          </>
        )}
      </div>

      {/* Status bar */}
      <StatusBar />

      {/* Settings modal */}
      <SettingsOverlay />

      {/* Chat History overlay */}
      {chatHistoryOpen && (
        <div className="chat-history-overlay-backdrop" onClick={() => setChatHistoryOpen(false)}>
          <div className="chat-history-overlay" onClick={(e) => e.stopPropagation()}>
            <ChatHistoryView />
          </div>
        </div>
      )}
    </div>
  );
}
