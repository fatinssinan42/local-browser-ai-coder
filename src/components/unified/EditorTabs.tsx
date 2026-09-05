import React, { useCallback, useRef, useEffect, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import Editor, { type OnMount } from '@monaco-editor/react';
import { X, FileCode2, Play } from 'lucide-react';
import type * as Monaco from 'monaco-editor';
import { CompilerPanel } from './CompilerPanel';
import { getMeshOrchestrator } from '../../services/MeshOrchestrator';

// Decoration collection key — reused across renders
const LIVE_DEBUG_DECORATION_KEY = 'live-debug-highlight';

const RUNNABLE_LANGS = new Set(['javascript', 'typescript', 'python', 'html']);

export function EditorTabs() {
  const openTabs = useAppStore((s) => s.openTabs);
  const activeFilePath = useAppStore((s) => s.activeFilePath);
  const files = useAppStore((s) => s.files);
  const theme = useAppStore((s) => s.theme);
  const closeTab = useAppStore((s) => s.closeTab);
  const setActiveFilePath = useAppStore((s) => s.setActiveFilePath);
  const updateFile = useAppStore((s) => s.updateFile);
  const liveDebug = useAppStore((s) => s.liveDebug);
  const [compilerOpen, setCompilerOpen] = useState(false);

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  // Track decoration collection for live debug highlight
  const decorationCollectionRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  // Guard: true while applying a peer edit so we don't re-broadcast it
  const applyingPeerEditRef = useRef(false);
  // Tracks which file path Monaco currently shows (for the store subscription)
  const activePathInEditorRef = useRef<string | null>(null);

  const activeFile = files.find((f) => f.path === activeFilePath);

  // --- Handle Monaco mount ---
  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    decorationCollectionRef.current = editor.createDecorationsCollection([]);

    // Set initial content for the currently active file (since we removed the
    // controlled `value` prop to prevent cursor resets during peer edits)
    const { files, activeFilePath: initialPath } = useAppStore.getState();
    const initialFile = files.find((f) => f.path === initialPath);
    if (initialFile) {
      applyingPeerEditRef.current = true;
      editor.setValue(initialFile.content);
      Promise.resolve().then(() => { applyingPeerEditRef.current = false; });
      const model = editor.getModel();
      if (model) monaco.editor.setModelLanguage(model, initialFile.language);
      activePathInEditorRef.current = initialPath;
    }

    // Subscribe to store: apply peer edits surgically (preserves cursor position)
    const unsubscribe = useAppStore.subscribe((state) => {
      if (applyingPeerEditRef.current) return;

      const curPath = state.activeFilePath;
      if (!curPath) return;

      // Only update if this editor instance is showing the same file
      if (activePathInEditorRef.current !== curPath) return;

      const curFile = state.files.find((f) => f.path === curPath);
      if (!curFile) return;

      const model = editor.getModel();
      if (!model) return;

      const editorContent = editor.getValue();
      if (editorContent === curFile.content) return;

      // Peer edit arrived — apply it without moving the cursor
      const position = editor.getPosition();
      const selections = editor.getSelections();

      applyingPeerEditRef.current = true;
      model.pushEditOperations(
        selections ?? [],
        [{ range: model.getFullModelRange(), text: curFile.content, forceMoveMarkers: true }],
        () => selections ?? [],
      );
      Promise.resolve().then(() => { applyingPeerEditRef.current = false; });

      if (position) {
        const lineCount = model.getLineCount();
        editor.setPosition({
          lineNumber: Math.min(position.lineNumber, lineCount),
          column: position.column,
        });
      }
    });

    editor.onDidDispose(() => unsubscribe());
  }, []);

  // --- React to editorScrollTo changes (live debug is scanning) ---
  useEffect(() => {
    const { editorScrollTo } = liveDebug;
    if (!editorScrollTo || !editorRef.current || !monacoRef.current) return;

    // If the file being debugged isn't the active tab, switch to it
    if (editorScrollTo.filePath !== activeFilePath) {
      setActiveFilePath(editorScrollTo.filePath);
      // The editor will remount — the next effect run will handle it
      return;
    }

    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const targetLine = editorScrollTo.line;

    // Reveal the line smoothly in the center
    editor.revealLineInCenter(targetLine, monaco.editor.ScrollType.Smooth);

    // Highlight the current chunk being analyzed
    const currentLog = liveDebug.log[liveDebug.log.length - 1];
    if (currentLog && decorationCollectionRef.current) {
      const startLine = currentLog.startLine + 1;
      const endLine = currentLog.endLine;

      const isFixed = currentLog.status === 'fixed';
      const isIssue = currentLog.status === 'issues';

      const className = isFixed
        ? 'live-debug-line-fixed'
        : isIssue
        ? 'live-debug-line-issue'
        : 'live-debug-line-scanning';

      decorationCollectionRef.current.set([
        {
          range: new monaco.Range(startLine, 1, endLine, 1),
          options: {
            isWholeLine: true,
            className,
            glyphMarginClassName: isFixed
              ? 'live-debug-glyph-fixed'
              : isIssue
              ? 'live-debug-glyph-issue'
              : 'live-debug-glyph-scanning',
            overviewRuler: {
              color: isFixed ? '#22c55e' : isIssue ? '#f59e0b' : '#60a5fa',
              position: monaco.editor.OverviewRulerLane.Right,
            },
          },
        },
      ]);
    }
  }, [liveDebug.editorScrollTo, liveDebug.log, activeFilePath, setActiveFilePath]);

  // --- Clear decorations when scan finishes ---
  useEffect(() => {
    if (liveDebug.status === 'done' || liveDebug.status === 'idle') {
      // Keep final decorations visible for a moment then fade
      const t = setTimeout(() => {
        decorationCollectionRef.current?.clear();
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [liveDebug.status]);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (!activeFilePath || value === undefined) return;
      // If we are programmatically applying a peer edit, do not re-broadcast
      if (applyingPeerEditRef.current) return;

      const now = Date.now();
      const { files } = useAppStore.getState();
      const file = files.find((f) => f.path === activeFilePath);
      const language = file?.language ?? 'plaintext';
      const version = (file?.version ?? 0) + 1;

      updateFile(activeFilePath, { content: value, lastModified: now, version });

      // Broadcast every keystroke to peers in real-time
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

  const isRunnable = activeFile ? RUNNABLE_LANGS.has(activeFile.language) : false;

  if (openTabs.length === 0) {
    return (
      <div className="editor-empty">
        <FileCode2 size={48} strokeWidth={1} />
        <h3>SouthStack IDE</h3>
        <p>Create or open a file to start editing.</p>
        <p className="editor-empty-hint">
          Type <code>create hello.py</code> in the terminal<br />
          or click <strong>+</strong> in the file explorer.
        </p>
      </div>
    );
  }

  return (
    <div className="editor-container">
      {/* Tab bar */}
      <div className="editor-tabs">
        {openTabs.map((path) => {
          const name = path.split('/').pop() || path;
          const isActive = path === activeFilePath;
          const isBeingDebugged = liveDebug.active && liveDebug.filePath === path;

          return (
            <div
              key={path}
              className={`editor-tab ${isActive ? 'active' : ''} ${isBeingDebugged ? 'debugging' : ''}`}
              onClick={() => setActiveFilePath(path)}
            >
              {isBeingDebugged && <span className="editor-tab-debug-dot" />}
              <span className="editor-tab-name">{name}</span>
              <button
                className="editor-tab-close"
                onClick={(e) => { e.stopPropagation(); closeTab(path); }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}

        {/* Run button */}
        <div className="editor-tabs-run-area">
          <button
            className={`editor-run-btn ${isRunnable ? 'runnable' : ''} ${compilerOpen ? 'active' : ''}`}
            onClick={() => setCompilerOpen((v) => !v)}
            title={isRunnable ? 'Run code (Compiler)' : 'Open compiler (JS, TS, Python, HTML supported)'}
          >
            <Play size={13} />
            <span>{compilerOpen ? 'Hide Output' : 'Run'}</span>
          </button>
        </div>
      </div>

      {/* Live debug scanning banner */}
      {liveDebug.active && liveDebug.filePath === activeFilePath && (
        <div className="editor-live-debug-bar">
          <span className="editor-live-debug-spinner" />
          <span>
            AI scanning chunk {liveDebug.currentChunk}/{liveDebug.totalChunks}
            {' — '}lines {liveDebug.log[liveDebug.log.length - 1]?.lines ?? '…'}
          </span>
          <span className="editor-live-debug-pct">{liveDebug.percent}%</span>
          <div className="editor-live-debug-progress">
            <div
              className="editor-live-debug-fill"
              style={{ width: `${liveDebug.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Monaco editor + compiler split */}
      <div className={`editor-body ${compilerOpen ? 'editor-body-split' : ''}`}>
        <div className="editor-monaco-area">
          {activeFile ? (
            <Editor
              key={activeFilePath}
              height="100%"
              language={activeFile.language}
              theme={theme === 'dark' ? 'vs-dark' : 'vs'}
              onChange={handleEditorChange}
              onMount={handleEditorMount}
              options={{
                fontSize: 13,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                minimap: { enabled: true, maxColumn: 80 },
                wordWrap: 'on',
                lineNumbers: 'on',
                renderLineHighlight: 'line',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                padding: { top: 8 },
                bracketPairColorization: { enabled: true },
                cursorBlinking: 'smooth',
                smoothScrolling: true,
                glyphMargin: true,
              }}
            />
          ) : (
            <div className="editor-empty-tab">
              <p>File not found: {activeFilePath}</p>
            </div>
          )}
        </div>

        {/* Compiler panel */}
        {compilerOpen && (
          <CompilerPanel onClose={() => setCompilerOpen(false)} />
        )}
      </div>
    </div>
  );
}
