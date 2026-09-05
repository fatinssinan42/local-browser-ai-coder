import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import {
  Play, Square, Trash2, ChevronDown, ChevronUp,
  Terminal, AlertCircle, CheckCircle, Clock, Loader2
} from 'lucide-react';

// -------------------------------------------------------
// Types
// -------------------------------------------------------

type RunStatus = 'idle' | 'loading' | 'running' | 'done' | 'error';

interface OutputLine {
  type: 'stdout' | 'stderr' | 'info' | 'result';
  text: string;
  ts: number;
}

// -------------------------------------------------------
// Pyodide singleton loader
// -------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWindow = Window & typeof globalThis & Record<string, any>;

let pyodidePromise: Promise<unknown> | null = null;

function loadPyodide(): Promise<unknown> {
  if (pyodidePromise) return pyodidePromise;

  pyodidePromise = new Promise((resolve, reject) => {
    const win = window as AnyWindow;
    if (win.loadPyodide) {
      (win.loadPyodide as (opts: unknown) => Promise<unknown>)(
        { indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full/' }
      ).then(resolve).catch(reject);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js';
    script.onload = () => {
      (win.loadPyodide as (opts: unknown) => Promise<unknown>)(
        { indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full/' }
      ).then(resolve).catch(reject);
    };
    script.onerror = () => reject(new Error('Failed to load Pyodide script'));
    document.head.appendChild(script);
  });

  return pyodidePromise;
}

// -------------------------------------------------------
// JS / TS sandbox runner using a hidden iframe
// -------------------------------------------------------

function buildSandboxHtml(code: string, isTypeScript: boolean): string {
  // For TS: strip type annotations with a simple regex heuristic so basic TS runs
  // Full TS support would need @babel/standalone; this covers most simple cases
  let runCode = code;
  if (isTypeScript) {
    // Strip type annotations: `: Type`, `<Type>`, `interface ...{}`, `type X =`
    runCode = code
      .replace(/:\s*[A-Za-z_$][\w<>\[\]|&.,\s]*(?=[,)\s={])/g, '')
      .replace(/<[A-Za-z_$][\w<>,\s]*>/g, '')
      .replace(/^(export\s+)?(interface|type)\s+\w[\s\S]*?\n\}/gm, '')
      .replace(/^(export\s+)?type\s+\w[^\n]*/gm, '');
  }

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script>
(function() {
  var _logs = [];
  function _send(type, args) {
    var text = args.map(function(a) {
      try { return (typeof a === 'object') ? JSON.stringify(a, null, 2) : String(a); }
      catch(e) { return String(a); }
    }).join(' ');
    parent.postMessage({ __sandbox: true, type: type, text: text }, '*');
  }
  var _orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  console.log   = function() { _send('stdout', Array.from(arguments)); };
  console.warn  = function() { _send('stdout', ['[warn] ' + Array.from(arguments).join(' ')]); };
  console.error = function() { _send('stderr', Array.from(arguments)); };
  console.info  = function() { _send('stdout', ['[info] ' + Array.from(arguments).join(' ')]); };
  window.onerror = function(msg, src, line, col, err) {
    _send('stderr', [err ? err.stack || err.message : msg]);
  };
  window.addEventListener('unhandledrejection', function(e) {
    _send('stderr', [e.reason ? (e.reason.stack || String(e.reason)) : 'Unhandled promise rejection']);
  });
  try {
    var _result = eval(${JSON.stringify(runCode)});
    if (_result !== undefined) {
      _send('result', [typeof _result === 'object' ? JSON.stringify(_result, null, 2) : String(_result)]);
    }
  } catch(e) {
    _send('stderr', [e.stack || e.message]);
  }
  parent.postMessage({ __sandbox: true, type: '__done' }, '*');
})();
<\/script>
</body>
</html>`;
}

// -------------------------------------------------------
// HTML Preview runner
// -------------------------------------------------------

function buildHtmlPreview(code: string): string {
  return code;
}

// -------------------------------------------------------
// Main CompilerPanel component
// -------------------------------------------------------

interface CompilerPanelProps {
  onClose: () => void;
}

export function CompilerPanel({ onClose }: CompilerPanelProps) {
  const files = useAppStore((s) => s.files);
  const activeFilePath = useAppStore((s) => s.activeFilePath);
  const activeFile = files.find((f) => f.path === activeFilePath);

  const [status, setStatus] = useState<RunStatus>('idle');
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [pyodide, setPyodide] = useState<unknown>(null);
  const [pyLoading, setPyLoading] = useState(false);
  const [htmlPreview, setHtmlPreview] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const startTimeRef = useRef<number>(0);
  const outputEndRef = useRef<HTMLDivElement>(null);

  const lang = activeFile?.language ?? 'plaintext';
  const isJS = lang === 'javascript';
  const isTS = lang === 'typescript';
  const isPython = lang === 'python';
  const isHTML = lang === 'html';
  const isSupported = isJS || isTS || isPython || isHTML;

  // Auto-scroll output
  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [output]);

  // Listen for sandbox messages
  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      if (!ev.data?.__sandbox) return;
      const { type, text } = ev.data as { type: string; text: string };

      if (type === '__done') {
        setStatus('done');
        setElapsed(Date.now() - startTimeRef.current);
        return;
      }

      setOutput((prev) => [
        ...prev,
        { type: type as OutputLine['type'], text, ts: Date.now() },
      ]);
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const appendLine = useCallback((type: OutputLine['type'], text: string) => {
    setOutput((prev) => [...prev, { type, text, ts: Date.now() }]);
  }, []);

  const runCode = useCallback(async () => {
    if (!activeFile || !isSupported) return;

    setOutput([]);
    setElapsed(null);
    setHtmlPreview(false);
    setStatus('running');
    startTimeRef.current = Date.now();

    // HTML — just render preview
    if (isHTML) {
      setHtmlPreview(true);
      if (iframeRef.current) {
        iframeRef.current.srcdoc = buildHtmlPreview(activeFile.content);
      }
      setStatus('done');
      setElapsed(Date.now() - startTimeRef.current);
      return;
    }

    // JavaScript / TypeScript — sandboxed iframe
    if (isJS || isTS) {
      const html = buildSandboxHtml(activeFile.content, isTS);
      if (iframeRef.current) {
        // Reset iframe
        iframeRef.current.srcdoc = html;
      }
      // __done message will flip status to done
      return;
    }

    // Python — Pyodide
    if (isPython) {
      let py = pyodide;
      if (!py) {
        setPyLoading(true);
        setStatus('loading');
        appendLine('info', 'Loading Pyodide (Python runtime)…');
        try {
          py = await loadPyodide();
          setPyodide(py);
          appendLine('info', 'Pyodide ready.');
        } catch (err) {
          appendLine('stderr', `Failed to load Pyodide: ${err}`);
          setStatus('error');
          setPyLoading(false);
          return;
        }
        setPyLoading(false);
        setStatus('running');
      }

      // Redirect stdout/stderr
      const capturedLines: OutputLine[] = [];
      try {
        const pyAny = py as Record<string, unknown>;
        // Redirect Python stdout/stderr
        (pyAny.runPython as (code: string) => void)(`
import sys
import io
_stdout_capture = io.StringIO()
_stderr_capture = io.StringIO()
sys.stdout = _stdout_capture
sys.stderr = _stderr_capture
`);
        (pyAny.runPython as (code: string) => void)(activeFile.content);

        const stdout = (pyAny.runPython as (code: string) => string)(
          '_stdout_capture.getvalue()'
        );
        const stderr = (pyAny.runPython as (code: string) => string)(
          '_stderr_capture.getvalue()'
        );

        if (stdout) {
          stdout.split('\n').filter(Boolean).forEach((line: string) => {
            capturedLines.push({ type: 'stdout', text: line, ts: Date.now() });
          });
        }
        if (stderr) {
          stderr.split('\n').filter(Boolean).forEach((line: string) => {
            capturedLines.push({ type: 'stderr', text: line, ts: Date.now() });
          });
        }

        // Restore
        (pyAny.runPython as (code: string) => void)(
          'sys.stdout = sys.__stdout__; sys.stderr = sys.__stderr__'
        );

        setOutput((prev) => [...prev, ...capturedLines]);
        setStatus('done');
        setElapsed(Date.now() - startTimeRef.current);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLine('stderr', msg);
        setStatus('error');
        setElapsed(Date.now() - startTimeRef.current);
        // Restore anyway
        try {
          const pyAny = py as Record<string, unknown>;
          (pyAny.runPython as (code: string) => void)(
            'import sys; sys.stdout = sys.__stdout__; sys.stderr = sys.__stderr__'
          );
        } catch { /* ignore */ }
      }
    }
  }, [activeFile, isSupported, isJS, isTS, isPython, isHTML, pyodide, appendLine]);

  const stopRun = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.srcdoc = '';
    }
    setStatus('idle');
    appendLine('info', 'Execution stopped.');
  }, [appendLine]);

  const clearOutput = useCallback(() => {
    setOutput([]);
    setElapsed(null);
    setStatus('idle');
    setHtmlPreview(false);
  }, []);

  const statusIcon = () => {
    if (status === 'loading') return <Loader2 size={13} className="compiler-spin" />;
    if (status === 'running') return <Loader2 size={13} className="compiler-spin" />;
    if (status === 'done')    return <CheckCircle size={13} className="compiler-icon-done" />;
    if (status === 'error')   return <AlertCircle size={13} className="compiler-icon-error" />;
    return <Terminal size={13} />;
  };

  return (
    <div className="compiler-panel">
      {/* Header */}
      <div className="compiler-header">
        <div className="compiler-header-left">
          <Terminal size={14} />
          <span className="compiler-title">Compiler & Run</span>
          {activeFile && (
            <span className="compiler-file-badge">{activeFile.path.split('/').pop()}</span>
          )}
          <span className={`compiler-lang-badge compiler-lang-${lang}`}>{lang.toUpperCase()}</span>
          {statusIcon()}
          {elapsed !== null && (
            <span className="compiler-elapsed">
              <Clock size={11} /> {elapsed}ms
            </span>
          )}
        </div>
        <div className="compiler-header-right">
          {status === 'running' || status === 'loading' ? (
            <button className="compiler-btn compiler-btn-stop" onClick={stopRun} title="Stop">
              <Square size={12} /> Stop
            </button>
          ) : (
            <button
              className="compiler-btn compiler-btn-run"
              onClick={runCode}
              disabled={!isSupported || !activeFile}
              title={isSupported ? `Run ${activeFile?.path ?? ''}` : `${lang} not supported in browser`}
            >
              <Play size={12} /> Run
            </button>
          )}
          <button className="compiler-btn compiler-btn-clear" onClick={clearOutput} title="Clear output">
            <Trash2 size={12} />
          </button>
          <button className="compiler-btn compiler-btn-close" onClick={onClose} title="Close compiler">
            <ChevronDown size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="compiler-body">
        {/* HTML preview pane */}
        {isHTML && htmlPreview ? (
          <iframe
            ref={iframeRef}
            className="compiler-html-preview"
            title="HTML Preview"
            sandbox="allow-scripts allow-same-origin"
          />
        ) : (
          <>
            {/* Hidden sandbox iframe for JS/TS */}
            {(isJS || isTS) && (
              <iframe
                ref={iframeRef}
                title="JS Sandbox"
                className="compiler-sandbox-hidden"
                sandbox="allow-scripts"
              />
            )}

            {/* Output terminal */}
            <div className="compiler-output">
              {output.length === 0 && status === 'idle' && (
                <div className="compiler-empty">
                  {isSupported ? (
                    <>
                      <Play size={24} strokeWidth={1} />
                      <p>Press <strong>Run</strong> to execute {lang === 'python' ? 'Python' : lang.toUpperCase()} code</p>
                      {isPython && <p className="compiler-hint">First run loads Pyodide (~10MB) — subsequent runs are instant</p>}
                    </>
                  ) : (
                    <>
                      <AlertCircle size={24} strokeWidth={1} />
                      <p><strong>{lang}</strong> cannot be run in the browser</p>
                      <p className="compiler-hint">Supported: JavaScript, TypeScript, Python, HTML</p>
                    </>
                  )}
                </div>
              )}

              {output.map((line, i) => (
                <div key={i} className={`compiler-line compiler-line-${line.type}`}>
                  <span className="compiler-line-prefix">
                    {line.type === 'stderr' ? '✗' : line.type === 'result' ? '⇒' : line.type === 'info' ? 'ℹ' : '›'}
                  </span>
                  <span className="compiler-line-text">{line.text}</span>
                </div>
              ))}

              {(status === 'running' || status === 'loading') && (
                <div className="compiler-line compiler-line-info">
                  <span className="compiler-line-prefix">
                    <Loader2 size={11} className="compiler-spin" />
                  </span>
                  <span className="compiler-line-text">Running…</span>
                </div>
              )}

              {status === 'done' && output.filter(l => l.type !== 'info').length === 0 && (
                <div className="compiler-line compiler-line-info">
                  <span className="compiler-line-prefix">✓</span>
                  <span className="compiler-line-text">Executed successfully (no output)</span>
                </div>
              )}

              <div ref={outputEndRef} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
