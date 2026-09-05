// ============================================
// LiveFileDebugger — Chunk-by-chunk AI File Scan
// ============================================
// Reads a file from the store in token-safe chunks.
// For each chunk:
//   1. Marks it "scanning" in the log immediately
//   2. Sends it to the AI (streaming via onToken)
//   3. Updates the log entry IN-PLACE with result
//   4. If a fix is found: patches the file live + scrolls Monaco to that line
// All progress flows through the Zustand store so the UI reacts live.

import { useAppStore } from '../stores/appStore';
import { generateId } from '../utils/helpers';
import type { InferenceEngine } from './InferenceEngine';
import type { ContextManager } from './ContextManager';

// System prompt — explicit format so we can reliably parse the response
const SYSTEM_PROMPT = `You are a precise code debugger. Analyze the given code section.

RULES:
- If NO issues found: respond with exactly the single word: NO_ISSUES
- If issues ARE found: respond with:
  ISSUE: <one-line description of what is wrong>
  FIX:
  \`\`\`
  <the complete corrected version of ONLY the lines shown>
  \`\`\`
  REASON: <one sentence explanation>

Do not add extra commentary. Do not repeat the original code unless fixing it.`;

export interface LiveDebugLogEntry {
  chunk: number;
  lines: string;
  startLine: number;
  endLine: number;
  status: 'scanning' | 'issues' | 'clean' | 'fixed';
  message: string;
  aiOutput: string | null;
  fixedCode: string | null;
}

export class LiveFileDebugger {
  private inferenceEngine: InferenceEngine | null = null;
  private contextManager: ContextManager | null = null;
  private running = false;

  setInferenceEngine(engine: InferenceEngine): void {
    this.inferenceEngine = engine;
  }

  setContextManager(ctx: ContextManager): void {
    this.contextManager = ctx;
  }

  isRunning(): boolean {
    return this.running;
  }

  stop(): void {
    this.running = false;
  }

  // ------------------------------------------
  // Main entry
  // ------------------------------------------

  async debugFile(filePath: string): Promise<void> {
    const store = useAppStore.getState();

    const file = store.files.find(
      (f) => f.path === filePath || f.path.endsWith(filePath) || filePath.endsWith(f.path),
    );

    if (!file) {
      store.setLiveDebug({ status: 'error', summary: `File not found: ${filePath}`, active: false });
      return;
    }

    if (!this.inferenceEngine?.isModelLoaded()) {
      store.setLiveDebug({
        status: 'error',
        summary: 'No AI model loaded. Load a model in Settings first.',
        active: false,
      });
      return;
    }

    if (this.running) {
      store.setLiveDebug({ status: 'error', summary: 'A scan is already running.', active: false });
      return;
    }

    this.running = true;

    const chunks = this.contextManager
      ? this.contextManager.chunkFile(file as any)
      : this.fallbackChunk(file.content);

    const totalChunks = chunks.length;

    // Open the file in the IDE editor so the user can see live changes
    store.openTab(file.path);
    store.setActiveFilePath(file.path);

    store.resetLiveDebug();
    store.setLiveDebug({
      active: true,
      filePath: file.path,
      totalChunks,
      currentChunk: 0,
      percent: 0,
      status: 'scanning',
      issuesFound: 0,
      fixesApplied: 0,
      summary: null,
    });

    this.addEvent('info', `🔍 Live debug started: ${file.path} (${totalChunks} chunk${totalChunks !== 1 ? 's' : ''})`);

    let issuesFound = 0;
    let fixesApplied = 0;

    for (let i = 0; i < totalChunks; i++) {
      if (!this.running) break;

      const chunk = chunks[i];
      const startLine = chunk.startLine;
      const endLine = chunk.endLine;

      // Always read from current store content so prior fixes are visible
      const currentContent = useAppStore.getState().files.find(f => f.path === file.path)?.content ?? file.content;
      const currentLines = currentContent.split('\n');
      const chunkContent = currentLines.slice(startLine, endLine).join('\n');

      const lineLabel = `${startLine + 1}–${endLine}`;
      const pct = Math.round(((i + 1) / totalChunks) * 100);

      // 1. Mark chunk as "scanning" immediately — visible in the log
      store.upsertLiveDebugLog({
        chunk: i + 1,
        lines: lineLabel,
        startLine,
        endLine,
        status: 'scanning',
        message: `Scanning lines ${lineLabel}...`,
        aiOutput: null,
        fixedCode: null,
      });

      store.setLiveDebug({
        currentChunk: i + 1,
        percent: pct,
        // Scroll Monaco to the start of this chunk
        editorScrollTo: { line: startLine + 1, filePath: file.path },
      });

      this.addEvent('info', `[${i + 1}/${totalChunks}] Scanning lines ${lineLabel} (${pct}%)...`);

      // 2. Build prompt
      const prompt = [
        `File: ${file.path}`,
        `Code section ${i + 1}/${totalChunks} — lines ${lineLabel}:`,
        '```',
        chunkContent,
        '```',
      ].join('\n');

      // 3. Stream AI response — accumulate tokens live
      let accumulated = '';
      let streamError: string | null = null;

      try {
        await this.inferenceEngine!.generate({
          id: `live-debug-chunk-${i}-${generateId()}`,
          prompt,
          systemPrompt: SYSTEM_PROMPT,
          maxTokens: 1024,
          temperature: 0.1,
          onToken: (token: string) => {
            accumulated += token;
            // Update the log entry live as tokens stream in
            store.upsertLiveDebugLog({
              chunk: i + 1,
              lines: lineLabel,
              startLine,
              endLine,
              status: 'scanning',
              message: `Analyzing... ${accumulated.slice(-80).replace(/\n/g, ' ')}`,
              aiOutput: accumulated,
              fixedCode: null,
            });
          },
        });
      } catch (err: any) {
        streamError = err?.message || 'AI error';
        this.addEvent('error', `Chunk ${i + 1} error: ${streamError}`);
      }

      if (!this.running) break;

      // 4. Parse response
      if (streamError) {
        store.upsertLiveDebugLog({
          chunk: i + 1,
          lines: lineLabel,
          startLine,
          endLine,
          status: 'issues',
          message: `Error: ${streamError}`,
          aiOutput: streamError,
          fixedCode: null,
        });
        continue;
      }

      const trimmed = accumulated.trim();
      const upperTrimmed = trimmed.toUpperCase();

      if (!trimmed || upperTrimmed === 'NO_ISSUES' || upperTrimmed.startsWith('NO_ISSUES')) {
        // ✅ Clean — update entry in place
        store.upsertLiveDebugLog({
          chunk: i + 1,
          lines: lineLabel,
          startLine,
          endLine,
          status: 'clean',
          message: `Lines ${lineLabel}: ✅ No issues found`,
          aiOutput: trimmed,
          fixedCode: null,
        });
        this.addEvent('success', `[${i + 1}/${totalChunks}] Lines ${lineLabel}: clean`);
      } else {
        // ⚠️ Issues found — extract structured fields
        issuesFound++;

        const issueMatch = trimmed.match(/ISSUE:\s*(.+)/i);
        const issueLine = issueMatch ? issueMatch[1].trim() : 'Issue detected';

        const reasonMatch = trimmed.match(/REASON:\s*(.+)/i);
        const reason = reasonMatch ? reasonMatch[1].trim() : '';

        // Extract the fix code block — match ```...``` after FIX:
        const fixMatch = trimmed.match(/FIX:\s*```(?:\w*\n)?([\s\S]*?)```/i);
        const fixedCode = fixMatch ? fixMatch[1] : null;

        if (fixedCode && fixedCode.trim().length > 0) {
          // Apply fix immediately to the live file
          const latestContent = useAppStore.getState().files.find(f => f.path === file.path)?.content ?? file.content;
          const latestLines = latestContent.split('\n');
          const fixedChunkLines = fixedCode.trimEnd().split('\n');

          // Replace just this chunk's lines
          const newLines = [
            ...latestLines.slice(0, startLine),
            ...fixedChunkLines,
            ...latestLines.slice(endLine),
          ];

          useAppStore.getState().updateFile(file.path, {
            content: newLines.join('\n'),
            lastModified: Date.now(),
            version: (useAppStore.getState().files.find(f => f.path === file.path)?.version ?? 1) + 1,
          });

          // Scroll to the fixed section
          store.setLiveDebug({
            editorScrollTo: { line: startLine + 1, filePath: file.path },
            fixesApplied: fixesApplied + 1,
            issuesFound,
          });

          fixesApplied++;

          const displayMsg = [
            `Lines ${lineLabel}: ⚠ ${issueLine}`,
            reason ? `→ ${reason}` : '',
            `→ ✅ Auto-fixed (${fixedChunkLines.length} line${fixedChunkLines.length !== 1 ? 's' : ''} updated)`,
          ].filter(Boolean).join('\n');

          store.upsertLiveDebugLog({
            chunk: i + 1,
            lines: lineLabel,
            startLine,
            endLine,
            status: 'fixed',
            message: displayMsg,
            aiOutput: trimmed,
            fixedCode,
          });

          this.addEvent('warning', `[${i + 1}/${totalChunks}] Lines ${lineLabel}: issue found & fixed — ${issueLine}`);
        } else {
          // Issue found, no extractable fix
          store.setLiveDebug({ issuesFound });

          const displayMsg = [
            `Lines ${lineLabel}: ⚠ ${issueLine}`,
            reason ? `→ ${reason}` : '',
            `→ Manual fix needed`,
          ].filter(Boolean).join('\n');

          store.upsertLiveDebugLog({
            chunk: i + 1,
            lines: lineLabel,
            startLine,
            endLine,
            status: 'issues',
            message: displayMsg,
            aiOutput: trimmed,
            fixedCode: null,
          });

          this.addEvent('warning', `[${i + 1}/${totalChunks}] Lines ${lineLabel}: issue flagged — ${issueLine}`);
        }
      }
    }

    const wasStopped = !this.running;
    const summary = this.buildSummary(file.path, totalChunks, issuesFound, fixesApplied, wasStopped);

    store.setLiveDebug({
      active: false,
      status: wasStopped ? 'idle' : 'done',
      percent: wasStopped ? useAppStore.getState().liveDebug.percent : 100,
      summary,
      issuesFound,
      fixesApplied,
      editorScrollTo: null,
    });

    this.addEvent(
      issuesFound === 0 ? 'success' : fixesApplied > 0 ? 'info' : 'warning',
      `Live debug complete: ${summary}`,
    );

    this.running = false;
  }

  // ------------------------------------------
  // Fallback chunker (no ContextManager)
  // ------------------------------------------

  private fallbackChunk(content: string, linesPerChunk = 100): Array<{ startLine: number; endLine: number }> {
    const lines = content.split('\n');
    const result: Array<{ startLine: number; endLine: number }> = [];
    for (let i = 0; i < lines.length; i += linesPerChunk) {
      result.push({ startLine: i, endLine: Math.min(i + linesPerChunk, lines.length) });
    }
    return result;
  }

  // ------------------------------------------
  // Summary
  // ------------------------------------------

  private buildSummary(filePath: string, totalChunks: number, issuesFound: number, fixesApplied: number, stopped: boolean): string {
    const name = filePath.split('/').pop() || filePath;
    if (stopped) return `Scan stopped on ${name} (partial).`;
    if (issuesFound === 0) return `✅ No issues in ${name} — ${totalChunks} section${totalChunks !== 1 ? 's' : ''} scanned. Code looks clean!`;
    if (fixesApplied === issuesFound) return `✅ ${issuesFound} issue${issuesFound !== 1 ? 's' : ''} auto-fixed in ${name}. File updated.`;
    return `⚠ ${issuesFound} issue${issuesFound !== 1 ? 's' : ''} in ${name}: ${fixesApplied} auto-fixed, ${issuesFound - fixesApplied} need manual review.`;
  }

  private addEvent(type: 'info' | 'success' | 'warning' | 'error' | 'mesh', message: string): void {
    useAppStore.getState().addEvent({ id: generateId(), type, message, timestamp: Date.now() });
  }
}

let _instance: LiveFileDebugger | null = null;

export function getLiveFileDebugger(): LiveFileDebugger {
  if (!_instance) _instance = new LiveFileDebugger();
  return _instance;
}
