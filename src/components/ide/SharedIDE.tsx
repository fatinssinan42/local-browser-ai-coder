import React, {
  useCallback, useState, useEffect, useRef,
} from 'react';
import type { OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useAppStore } from '../../stores/appStore';
import { getMeshOrchestrator } from '../../services/MeshOrchestrator';
import { generateId } from '../../utils/helpers';
import {
  X, FileText, MessageSquare, Bug, Share2, FileSearch,
  ChevronRight, Circle, Loader2, FilePlus, Users,
} from 'lucide-react';
import './SharedIDE.css';

const MonacoEditor = React.lazy(() => import('@monaco-editor/react'));

export function SharedIDE() {
  const files = useAppStore((s) => s.files);
  const openTabs = useAppStore((s) => s.openTabs);
  const activeFilePath = useAppStore((s) => s.activeFilePath);
  const setActiveFilePath = useAppStore((s) => s.setActiveFilePath);
  const openTab = useAppStore((s) => s.openTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const updateFile = useAppStore((s) => s.updateFile);
  const toggleChatPanel = useAppStore((s) => s.toggleChatPanel);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const addEvent = useAppStore((s) => s.addEvent);
  const theme = useAppStore((s) => s.theme);
  const nodes = useAppStore((s) => s.nodes);
  const peerCursors = useAppStore((s) => s.peerCursors);

  const [editorLoading, setEditorLoading] = useState(true);
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [showPresence, setShowPresence] = useState(false);
  // Flipped to true once Monaco fires onMount — gates the imperative sync effect
  const [editorMounted, setEditorMounted] = useState(false);

  // Monaco refs
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const cursorDecorationsRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  // Tracks which file path Monaco is currently showing
  const activePathInEditorRef = useRef<string | null>(null);
  // Guard: true while we are programmatically applying a peer edit into Monaco.
  // Prevents the resulting onChange from re-broadcasting the same edit back.
  const applyingPeerEditRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setEditorLoading(false), 500);
    return () => clearTimeout(timer);
  }, []);

  const activeFile = files.find((f) => f.path === activeFilePath);

  // ── Imperative real-time sync ─────────────────────────────
  // Runs whenever the active file content, path, or language changes.
  // Applies peer updates directly to the Monaco model so they appear
  // instantly without a page refresh, while preserving the local cursor.
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !activeFile || !editorMounted) return;

    const model = editor.getModel();
    if (!model) return;

    const targetContent = activeFile.content;
    const isFileSwitched = activePathInEditorRef.current !== activeFile.path;

    if (isFileSwitched) {
      // ── File switch: hard reset — new model content + language ──
      activePathInEditorRef.current = activeFile.path;
      applyingPeerEditRef.current = true;
      editor.setValue(targetContent);
      Promise.resolve().then(() => { applyingPeerEditRef.current = false; });
      monaco.editor.setModelLanguage(model, activeFile.language);
      editor.setScrollPosition({ scrollTop: 0 });
      return;
    }

    // ── Same file: skip if Monaco already has this exact content ──
    // This is true after a local edit (Monaco typed it, store echoes it back).
    const currentEditorContent = editor.getValue();
    if (currentEditorContent === targetContent) return;

    // ── Peer update: apply surgically, preserving cursor ──────────
    const position = editor.getPosition();
    const selections = editor.getSelections();

    applyingPeerEditRef.current = true;
    model.pushEditOperations(
      selections ?? [],
      [{
        range: model.getFullModelRange(),
        text: targetContent,
        forceMoveMarkers: true,
      }],
      () => selections ?? [],
    );
    // Reset on next microtask — @monaco-editor/react may fire onChange
    // asynchronously after pushEditOperations completes
    Promise.resolve().then(() => { applyingPeerEditRef.current = false; });

    // Clamp and restore cursor so the local user's position doesn't jump
    if (position) {
      const lineCount = model.getLineCount();
      editor.setPosition({
        lineNumber: Math.min(position.lineNumber, lineCount),
        column: position.column,
      });
    }
  }, [activeFile?.content, activeFile?.path, activeFile?.language, editorMounted]);

  // ── Monaco mount ──────────────────────────────────────────
  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    cursorDecorationsRef.current = editor.createDecorationsCollection([]);

    // Set initial file content immediately on mount
    const currentFiles = useAppStore.getState().files;
    const currentPath = useAppStore.getState().activeFilePath;
    const initialFile = currentFiles.find(f => f.path === currentPath);
    if (initialFile) {
      applyingPeerEditRef.current = true;
      editor.setValue(initialFile.content);
      Promise.resolve().then(() => { applyingPeerEditRef.current = false; });
      monaco.editor.setModelLanguage(editor.getModel()!, initialFile.language);
      activePathInEditorRef.current = initialFile.path;
    }

    // Signal that the editor is ready — gates the imperative sync effect
    setEditorMounted(true);

    // ── Direct store subscription for peer edits ──────────────
    // Subscribe to the Zustand store directly (outside React rendering)
    // so peer edits are pushed into Monaco immediately when they arrive
    // via P2P — without waiting for a React re-render cycle.
    const unsubscribe = useAppStore.subscribe((state) => {
      const currentPath = state.activeFilePath;
      if (!currentPath) return;

      const file = state.files.find((f) => f.path === currentPath);
      if (!file) return;

      // Skip if this update came from our own typing (guard is set)
      if (applyingPeerEditRef.current) return;

      const editorModel = editor.getModel();
      if (!editorModel) return;

      const editorContent = editor.getValue();

      // File switched — hard reset
      if (activePathInEditorRef.current !== currentPath) {
        activePathInEditorRef.current = currentPath;
        applyingPeerEditRef.current = true;
        editor.setValue(file.content);
        Promise.resolve().then(() => { applyingPeerEditRef.current = false; });
        monaco.editor.setModelLanguage(editorModel, file.language);
        editor.setScrollPosition({ scrollTop: 0 });
        return;
      }

      // Same file — apply peer content if different
      if (editorContent !== file.content) {
        const position = editor.getPosition();
        const selections = editor.getSelections();

        applyingPeerEditRef.current = true;
        editorModel.pushEditOperations(
          selections ?? [],
          [{ range: editorModel.getFullModelRange(), text: file.content, forceMoveMarkers: true }],
          () => selections ?? [],
        );
        Promise.resolve().then(() => { applyingPeerEditRef.current = false; });

        if (position) {
          const lineCount = editorModel.getLineCount();
          editor.setPosition({
            lineNumber: Math.min(position.lineNumber, lineCount),
            column: position.column,
          });
        }
      }
    });

    // Clean up store subscription when editor unmounts
    editor.onDidDispose(() => unsubscribe());

    // Broadcast own cursor position to peers
    editor.onDidChangeCursorPosition((e) => {
      const selection = editor.getSelection();
      const hasSelection = selection &&
        !(selection.startLineNumber === selection.endLineNumber &&
          selection.startColumn === selection.endColumn);

      try {
        const orchestrator = getMeshOrchestrator();
        const path = useAppStore.getState().activeFilePath ?? '';
        orchestrator.p2p.broadcastCursor(
          path,
          e.position.lineNumber,
          e.position.column,
          hasSelection ? {
            startLine: selection!.startLineNumber,
            startCol: selection!.startColumn,
            endLine: selection!.endLineNumber,
            endCol: selection!.endColumn,
          } : null,
        );
      } catch { /* orchestrator not ready */ }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Peer cursor decorations ───────────────────────────────
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const collection = cursorDecorationsRef.current;
    if (!editor || !monaco || !collection || !activeFilePath) return;

    const cursorsOnThisFile = Object.values(peerCursors).filter(
      (c) => c.filePath === activeFilePath,
    );

    const decorations: Monaco.editor.IModelDeltaDecoration[] = [];

    for (const cursor of cursorsOnThisFile) {
      const color = cursor.color.replace('#', '');
      const styleId = `peer-cursor-${cursor.peerId.slice(0, 8)}`;

      // Inject dynamic CSS for this peer's color if not already present
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          .peer-cursor-line-${color} { border-left: 2px solid #${color}; }
          .peer-cursor-label-${color}::before {
            content: '${cursor.peerName}';
            background: #${color};
            color: #000;
            font-size: 10px;
            padding: 1px 4px;
            border-radius: 3px;
            position: absolute;
            top: -18px;
            left: 0;
            white-space: nowrap;
            pointer-events: none;
            z-index: 100;
          }
        `;
        document.head.appendChild(style);
      }

      // Cursor line decoration
      decorations.push({
        range: new monaco.Range(cursor.line, cursor.column, cursor.line, cursor.column + 1),
        options: {
          className: `peer-cursor-line-${color}`,
          afterContentClassName: `peer-cursor-label-${color}`,
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      });

      // Selection decoration
      if (cursor.selection) {
        const { startLine, startCol, endLine, endCol } = cursor.selection;
        decorations.push({
          range: new monaco.Range(startLine, startCol, endLine, endCol),
          options: {
            className: `peer-selection-${color}`,
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        });

        // Dynamic selection CSS
        const selStyleId = `peer-sel-${color}`;
        if (!document.getElementById(selStyleId)) {
          const style = document.createElement('style');
          style.id = selStyleId;
          style.textContent = `.peer-selection-${color} { background: #${color}33; }`;
          document.head.appendChild(style);
        }
      }
    }

    collection.set(decorations);
  }, [peerCursors, activeFilePath]);

  // ── Editor change — broadcast every keystroke to peers ────
  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (!activeFilePath || value === undefined) return;

      // If we are programmatically applying a peer edit, do NOT re-broadcast
      if (applyingPeerEditRef.current) return;

      const now = Date.now();
      const file = useAppStore.getState().files.find((f) => f.path === activeFilePath);
      const language = file?.language ?? 'plaintext';
      const version = (file?.version ?? 0) + 1;

      // Update local store immediately
      updateFile(activeFilePath, { content: value, lastModified: now, version });

      // Broadcast to peers immediately — no debounce, every keystroke is sent
      try {
        getMeshOrchestrator().p2p.broadcast({
          type: 'file-sync',
          payload: {
            action: 'update',
            file: { path: activeFilePath, content: value, language, lastModified: now, version },
          },
        });
      } catch { /* orchestrator not ready */ }
    },
    [activeFilePath, updateFile],
  );

  // ── Mesh actions ──────────────────────────────────────────
  const handleAskMesh = useCallback(() => {
    if (!activeFile) return;
    try {
      const orchestrator = getMeshOrchestrator();
      const task = orchestrator.tasks.createTask(
        `Review file: ${activeFile.path.split('/').pop()}`,
        'review',
        {
          relatedFiles: [activeFile.path],
          context: `Review the file at ${activeFile.path} for quality, bugs, and improvements.`,
          priority: 'normal',
        },
      );
      orchestrator.tasks.distributeTask(task.id);
      setActiveView('tasks');
      addEvent({ id: generateId(), type: 'info', message: `Review task created for ${activeFile.path}`, timestamp: Date.now() });
    } catch (err) {
      console.error('Ask Mesh failed:', err);
    }
  }, [activeFile, setActiveView, addEvent]);

  const handleSendToDebug = useCallback(() => {
    if (!activeFile) return;
    try {
      const orchestrator = getMeshOrchestrator();
      const fileName = activeFile.path.split('/').pop() || activeFile.path;
      orchestrator.debug.createIssue(
        `Debug analysis requested for: ${fileName}`,
        'info',
        { file: activeFile.path },
      );
      setActiveView('debug');
      addEvent({ id: generateId(), type: 'info', message: `Debug analysis started for ${activeFile.path}`, timestamp: Date.now() });
    } catch (err) {
      console.error('Send to debug failed:', err);
    }
  }, [activeFile, setActiveView, addEvent]);

  const handleDistributeTask = useCallback(() => {
    if (!activeFile) return;
    try {
      const orchestrator = getMeshOrchestrator();
      const task = orchestrator.tasks.createTask(
        `Code-gen from: ${activeFile.path.split('/').pop()}`,
        'code-gen',
        {
          relatedFiles: [activeFile.path],
          context: `Using the code in ${activeFile.path} as context, generate improvements or missing functionality.`,
          priority: 'normal',
        },
      );
      orchestrator.tasks.distributeTask(task.id);
      setActiveView('tasks');
      addEvent({ id: generateId(), type: 'info', message: `Code-gen task distributed for ${activeFile.path}`, timestamp: Date.now() });
    } catch (err) {
      console.error('Distribute task failed:', err);
    }
  }, [activeFile, setActiveView, addEvent]);

  const handleSummarize = useCallback(() => {
    if (!activeFile) return;
    try {
      const orchestrator = getMeshOrchestrator();
      const task = orchestrator.tasks.createTask(
        `Summarize: ${activeFile.path.split('/').pop()}`,
        'summarize',
        {
          relatedFiles: [activeFile.path],
          context: `Summarize the code in ${activeFile.path}.`,
          priority: 'low',
        },
      );
      orchestrator.tasks.distributeTask(task.id);
      setActiveView('tasks');
      addEvent({ id: generateId(), type: 'info', message: `Summarize task created for ${activeFile.path}`, timestamp: Date.now() });
    } catch (err) {
      console.error('Summarize failed:', err);
    }
  }, [activeFile, setActiveView, addEvent]);

  const handleCreateFile = useCallback(() => {
    if (!newFilePath.trim()) return;
    try {
      const orchestrator = getMeshOrchestrator();
      const ext = newFilePath.split('.').pop() || 'txt';
      const langMap: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
        py: 'python', json: 'json', html: 'html', css: 'css', md: 'markdown',
      };
      orchestrator.p2p.syncFile({
        path: newFilePath.trim(),
        content: '// New file\n',
        language: langMap[ext] || 'plaintext',
      });
      openTab(newFilePath.trim());
      setNewFilePath('');
      setShowNewFile(false);
    } catch (err) {
      console.error('Create file failed:', err);
    }
  }, [newFilePath, openTab]);

  // ── Peer presence helpers ─────────────────────────────────
  const peersOnActiveFile = Object.values(peerCursors).filter(
    (c) => c.filePath === activeFilePath,
  );

  const allActiveCursors = Object.values(peerCursors);

  // File tree
  const fileTree = buildFileTree(files.map((f) => f.path));

  // Peers with cursors per file path (for tree indicators)
  const peersPerFile: Record<string, typeof allActiveCursors> = {};
  for (const c of allActiveCursors) {
    if (!peersPerFile[c.filePath]) peersPerFile[c.filePath] = [];
    peersPerFile[c.filePath].push(c);
  }

  return (
    <div className="ide-view">
      <div className="ide-layout">
        {/* File explorer */}
        <div className="ide-explorer">
          <div className="ide-explorer-header">
            <span>Explorer</span>
            <div className="ide-explorer-actions">
              {allActiveCursors.length > 0 && (
                <button
                  className={`ide-presence-btn ${showPresence ? 'active' : ''}`}
                  title="Show peer presence"
                  onClick={() => setShowPresence(!showPresence)}
                >
                  <Users size={13} />
                  <span className="ide-presence-count">{allActiveCursors.length}</span>
                </button>
              )}
              <button
                className="ide-new-file-btn"
                title="New File"
                onClick={() => setShowNewFile(!showNewFile)}
              >
                <FilePlus size={13} />
              </button>
            </div>
          </div>

          {/* Peer presence panel */}
          {showPresence && allActiveCursors.length > 0 && (
            <div className="ide-presence-panel">
              {allActiveCursors.map((c) => (
                <div key={c.peerId} className="ide-presence-row">
                  <span
                    className="ide-presence-dot"
                    style={{ background: c.color }}
                  />
                  <span className="ide-presence-name">{c.peerName}</span>
                  <span className="ide-presence-file">
                    {c.filePath.split('/').pop()}:{c.line}
                  </span>
                </div>
              ))}
            </div>
          )}

          {showNewFile && (
            <div className="ide-new-file-row">
              <input
                autoFocus
                className="ide-new-file-input"
                placeholder="filename.ts"
                value={newFilePath}
                onChange={(e) => setNewFilePath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFile();
                  if (e.key === 'Escape') setShowNewFile(false);
                }}
              />
            </div>
          )}

          <div className="ide-file-tree">
            {files.length === 0 ? (
              <div className="ide-explorer-empty">No files yet. Create one above.</div>
            ) : renderTree(fileTree, openTab, peersPerFile, 0)}
          </div>
        </div>

        {/* Editor area */}
        <div className="ide-editor-area">
          {/* Tabs */}
          <div className="ide-tabs">
            {openTabs.map((path) => {
              const fileName = path.split('/').pop() || path;
              const tabPeers = peersPerFile[path] ?? [];
              return (
                <div
                  key={path}
                  className={`ide-tab ${activeFilePath === path ? 'active' : ''}`}
                  onClick={() => setActiveFilePath(path)}
                >
                  <FileText size={12} />
                  <span>{fileName}</span>
                  {/* Peer avatar dots on the tab */}
                  {tabPeers.map((c) => (
                    <span
                      key={c.peerId}
                      className="ide-tab-peer-dot"
                      style={{ background: c.color }}
                      title={`${c.peerName} is here`}
                    />
                  ))}
                  <button
                    className="ide-tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(path);
                    }}
                  >
                    <X size={11} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Peer presence bar inside editor area */}
          {peersOnActiveFile.length > 0 && (
            <div className="ide-peer-bar">
              {peersOnActiveFile.map((c) => (
                <div key={c.peerId} className="ide-peer-bar-item">
                  <span
                    className="ide-peer-bar-dot"
                    style={{ background: c.color }}
                  />
                  <span className="ide-peer-bar-name">{c.peerName}</span>
                  <span className="ide-peer-bar-pos">L{c.line}:{c.column}</span>
                </div>
              ))}
            </div>
          )}

          {/* Editor */}
          {activeFile ? (
            <div className="ide-editor-wrapper">
              <React.Suspense fallback={
                <div className="ide-editor-loading">
                  <Loader2 size={24} className="spin" />
                  <span>Loading editor...</span>
                </div>
              }>
                <MonacoEditor
                  height="100%"
                  theme={theme === 'dark' ? 'vs-dark' : 'light'}
                  onChange={handleEditorChange}
                  onMount={handleEditorMount}
                  options={{
                    fontSize: 13,
                    fontFamily: 'JetBrains Mono, monospace',
                    minimap: { enabled: false },
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    smoothScrolling: true,
                    padding: { top: 12 },
                    renderLineHighlight: 'line',
                    bracketPairColorization: { enabled: true },
                  }}
                />
              </React.Suspense>
              {/* AI action bar */}
              <div className="ide-action-bar">
                <button className="ide-action-btn" onClick={handleAskMesh} title="Create a review task for this file">
                  <MessageSquare size={13} /> Ask Mesh
                </button>
                <button className="ide-action-btn" onClick={handleSendToDebug} title="Create a debug task for this file">
                  <Bug size={13} /> Send to Debug
                </button>
                <button className="ide-action-btn" onClick={handleDistributeTask} title="Create a code-gen task using this file as context">
                  <Share2 size={13} /> Distribute Task
                </button>
                <button className="ide-action-btn" onClick={handleSummarize} title="Summarize this file">
                  <FileSearch size={13} /> Summarize
                </button>
                {activeFile.producedBy && (
                  <span className="ide-produced-by">
                    <Circle size={8} /> Generated by{' '}
                    {nodes.find((n) => n.id === activeFile.producedBy)?.name || 'Unknown'}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="ide-empty">
              <FileText size={48} strokeWidth={1} />
              <p>Select a file from the explorer to start editing</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── File tree helpers ────────────────────────────────────────
interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  isFile: boolean;
}

function buildFileTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const path of paths) {
    const parts = path.split('/');
    let current = root;
    let currentPath = '';
    for (let i = 0; i < parts.length; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      const isFile = i === parts.length - 1;
      let node = current.find((n) => n.name === parts[i]);
      if (!node) {
        node = { name: parts[i], path: currentPath, children: [], isFile };
        current.push(node);
      }
      current = node.children;
    }
  }
  return root;
}

type PeerCursorEntry = {
  peerId: string;
  peerName: string;
  color: string;
  filePath: string;
  line: number;
  column: number;
  selection: any;
  updatedAt: number;
};

function renderTree(
  nodes: TreeNode[],
  openTab: (path: string) => void,
  peersPerFile: Record<string, PeerCursorEntry[]>,
  depth: number,
): React.ReactNode {
  return nodes.map((node) => (
    <div key={node.path}>
      <div
        className={`file-tree-item ${node.isFile ? 'file' : 'folder'}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => node.isFile && openTab(node.path)}
      >
        {!node.isFile && <ChevronRight size={12} className="folder-chevron" />}
        <span className="file-tree-name">{node.name}</span>
        {/* Peer presence dots on file tree items */}
        {node.isFile && (peersPerFile[node.path] ?? []).map((c) => (
          <span
            key={c.peerId}
            className="file-tree-peer-dot"
            style={{ background: c.color }}
            title={`${c.peerName} is editing this file`}
          />
        ))}
      </div>
      {node.children.length > 0 && renderTree(node.children, openTab, peersPerFile, depth + 1)}
    </div>
  ));
}
