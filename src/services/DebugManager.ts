// ============================================
// DebugManager — Distributed Debug Routing
// ============================================
// Creates debug issues, routes them to the best-qualified
// debug node, aggregates results, and updates the store.

import { useAppStore } from '../stores/appStore';
import { generateId } from '../utils/helpers';
import type { P2PManager, P2PMessage } from './P2PManager';
import type { InferenceEngine } from './InferenceEngine';
import type { ContextManager } from './ContextManager';
import type { DebugIssue } from '../types';
import { EventBus, MeshEvents } from './EventBus';

export class DebugManager {
  private p2p: P2PManager;
  private inferenceEngine: InferenceEngine | null = null;
  private contextManager: ContextManager | null = null;

  constructor(p2p: P2PManager) {
    this.p2p = p2p;
    this.setupListeners();
  }

  setInferenceEngine(engine: InferenceEngine): void {
    this.inferenceEngine = engine;
  }

  setContextManager(ctx: ContextManager): void {
    this.contextManager = ctx;
  }

  /** Returns true if any node in the mesh (local or peer) has a model loaded. */
  private hasMeshModel(): boolean {
    if (this.inferenceEngine?.isModelLoaded()) return true;
    const nodes = useAppStore.getState().nodes;
    return nodes.some((n) => !n.isSelf && n.status !== 'offline' && n.modelLoaded);
  }

  private setupListeners(): void {
    this.p2p.on('debug', (message: P2PMessage) => {
      const { action, issue, issueId, suggestedFix } = message.payload;
      if (action === 'analyze' && issue) {
        this.analyzeIssue(issue, message.senderId).catch(err => {
          console.error('Remote debug analysis failed:', err);
        });
      }
      if (action === 'result' && issueId && suggestedFix) {
        const store = useAppStore.getState();
        store.updateDebugIssue(issueId, {
          suggestedFix,
          status: 'resolved',
        });
        this.addEvent('success', `Debug analysis received from remote node`);
      }
    });
  }

  // ------------------------------------------
  // Issue creation
  // ------------------------------------------

  createIssue(
    message: string,
    severity: 'error' | 'warning' | 'info' = 'error',
    options: {
      stackTrace?: string;
      file?: string;
      line?: number;
    } = {},
  ): DebugIssue {
    const store = useAppStore.getState();

    const issue: DebugIssue = {
      id: generateId(),
      severity,
      message,
      stackTrace: options.stackTrace,
      file: options.file,
      line: options.line,
      sourceNode: this.p2p.getSelfId(),
      status: 'open',
      timestamp: Date.now(),
    };

    store.addDebugIssue(issue);
    this.addEvent('warning', `Debug issue created: ${message.slice(0, 80)}`);

    // Route and analyze — properly handle the async promise
    this.routeAndAnalyze(issue);

    return issue;
  }

  // ------------------------------------------
  // Debug routing
  // ------------------------------------------

  private routeAndAnalyze(issue: DebugIssue): void {
    const store = useAppStore.getState();

    // Use AI analysis if any model is available (local or via peer offload)
    if (this.inferenceEngine && this.hasMeshModel()) {
      const source = this.inferenceEngine.isModelLoaded() ? 'local model' : 'peer model';
      this.addEvent('info', `Analyzing debug issue via ${source}`);
      // Properly handle the async call — catch errors and update the issue
      this.analyzeIssue(issue, null).catch(err => {
        console.error('Local debug analysis failed:', err);
        store.updateDebugIssue(issue.id, {
          suggestedFix: `Analysis failed: ${err?.message || 'Unknown error'}. Try clicking "Analyze with AI" to retry.`,
          status: 'resolved',
        });
        this.addEvent('error', `Debug analysis failed: ${err?.message || 'Unknown error'}`);
      });
      return;
    }

    // No local model — try remote debug-capable nodes
    const debugNodes = store.nodes.filter(
      n =>
        n.status !== 'offline' &&
        (n.role === 'debug' || n.capabilities.includes('debug')) &&
        !n.isSelf,
    );

    if (debugNodes.length > 0) {
      const target = debugNodes.sort((a, b) => a.latency - b.latency)[0];
      this.p2p.send(target.id, {
        type: 'debug',
        payload: { action: 'analyze', issue },
      });
      store.updateDebugIssue(issue.id, { status: 'investigating' });
      this.addEvent('info', `Debug issue routed to ${target.name}`);
    } else {
      // No model, no remote nodes — use heuristics
      const fix = this.heuristicFix(issue.message);
      store.updateDebugIssue(issue.id, { suggestedFix: fix, status: 'resolved' });
      this.addEvent('info', `Debug analysis complete (heuristic — no AI model loaded)`);
    }
  }

  // ------------------------------------------
  // File lookup — robust matching
  // ------------------------------------------

  private findFile(filePath: string | undefined | null): { path: string; content: string } | null {
    if (!filePath) return null;
    const store = useAppStore.getState();
    const cleanPath = filePath.split(':')[0]; // Remove line number suffix

    // 1. Exact match
    const exact = store.files.find(f => f.path === cleanPath);
    if (exact) return exact;

    // 2. Match by filename (handles path differences like "main.py" vs "src/main.py")
    const fileName = cleanPath.split('/').pop() || cleanPath;
    const byName = store.files.find(f => {
      const fName = f.path.split('/').pop() || f.path;
      return fName === fileName;
    });
    if (byName) return byName;

    // 3. Match by endsWith (handles partial paths)
    const byEnd = store.files.find(f => f.path.endsWith(cleanPath) || cleanPath.endsWith(f.path));
    if (byEnd) return byEnd;

    return null;
  }

  // ------------------------------------------
  // Analysis — the core AI debug flow
  // ------------------------------------------

  private async analyzeIssue(issue: DebugIssue, requesterId: string | null): Promise<void> {
    const store = useAppStore.getState();
    store.updateDebugIssue(issue.id, { status: 'investigating' });

    let suggestedFix = '';

    const debugSystemPrompt =
      'You are a debugging expert. Analyze this code thoroughly for bugs, logic errors, ' +
      'potential crashes, type issues, and edge cases. For each issue found, explain the ' +
      'problem, its root cause, and provide a specific fix with corrected code.';

    if (this.inferenceEngine && this.hasMeshModel()) {
      const file = this.findFile(issue.file);

      if (file && file.content.trim().length > 0) {
        this.addEvent('info', `Found file "${file.path}" (${file.content.split('\n').length} lines) — starting AI analysis`);

        // Use ContextManager for chunked analysis
        if (this.contextManager) {
          suggestedFix = await this.analyzeWithChunks(issue, file, debugSystemPrompt);
        } else {
          // Fallback: send full file content in one pass
          suggestedFix = await this.analyzeSinglePass(issue, file.content, debugSystemPrompt);
        }
      } else if (file) {
        suggestedFix = 'File is empty — nothing to debug.';
        this.addEvent('warning', `File "${issue.file}" is empty`);
      } else {
        // No file found — still try to analyze with just the issue message
        this.addEvent('warning', `File "${issue.file}" not found in IDE. Analyzing issue message only.`);
        const prompt = [
          `Debug Issue: ${issue.message}`,
          issue.file ? `File: ${issue.file}` : '',
          issue.stackTrace ? `Stack Trace:\n${issue.stackTrace}` : '',
          'Analyze this issue and suggest possible causes and fixes.',
        ].filter(Boolean).join('\n\n');

        try {
          suggestedFix = await this.inferenceEngine.generate({
            id: generateId(),
            prompt,
            systemPrompt: debugSystemPrompt,
            maxTokens: 1024,
          });
        } catch (err: any) {
          this.addEvent('error', `Inference error: ${err?.message}`);
          suggestedFix = this.heuristicFix(issue.message);
        }
      }
    } else {
      suggestedFix = this.heuristicFix(issue.message);
    }

    // Always update the issue — even on error paths
    store.updateDebugIssue(issue.id, {
      suggestedFix,
      status: 'resolved',
    });

    this.addEvent('success', `Debug analysis complete: ${issue.message.slice(0, 60)}`);

    // Send result back to requester if remote
    if (requesterId && requesterId !== this.p2p.getSelfId()) {
      this.p2p.send(requesterId, {
        type: 'debug',
        payload: { action: 'result', issueId: issue.id, suggestedFix },
      });
    }

    EventBus.emit(MeshEvents.TASK_COMPLETED, { taskId: issue.id, result: suggestedFix });
  }

  // ------------------------------------------
  // Chunked analysis via ContextManager
  // ------------------------------------------

  private async analyzeWithChunks(
    issue: DebugIssue,
    file: { path: string; content: string },
    systemPrompt: string,
  ): Promise<string> {
    const store = useAppStore.getState();
    const chunks = this.contextManager!.chunkFile(file as any);
    const totalChunks = chunks.length;
    const allResults: string[] = [];

    this.addEvent('info', `Analyzing ${totalChunks} code section${totalChunks > 1 ? 's' : ''}...`);

    for (let i = 0; i < totalChunks; i++) {
      const chunk = chunks[i];
      const lines = file.content.split('\n');
      const chunkContent = lines.slice(chunk.startLine, chunk.endLine).join('\n');

      if (chunkContent.trim().length === 0) continue; // skip empty chunks

      const chunkPrompt = [
        `Debug Issue: ${issue.message}`,
        `File: ${file.path} (lines ${chunk.startLine + 1}-${chunk.endLine}, section ${i + 1}/${totalChunks})`,
        '```',
        chunkContent,
        '```',
        'Analyze this code section for bugs, errors, logic issues, and edge cases.',
      ].join('\n');

      // Emit progress event so UI can show it
      const pct = Math.round(((i + 1) / totalChunks) * 100);
      this.addEvent('info', `Debugging section ${i + 1}/${totalChunks} (${pct}%)...`);

      try {
        const chunkResult = await this.inferenceEngine!.generate({
          id: `${issue.id}-chunk-${i}`,
          prompt: chunkPrompt,
          systemPrompt,
          maxTokens: 1024,
        });

        // Keep all results — let the user see everything the AI found
        if (chunkResult && chunkResult.trim().length > 0) {
          allResults.push(`### Lines ${chunk.startLine + 1}-${chunk.endLine}\n${chunkResult}`);
        }
      } catch (err: any) {
        this.addEvent('error', `Chunk ${i + 1} analysis failed: ${err?.message}`);
        allResults.push(`### Lines ${chunk.startLine + 1}-${chunk.endLine}\n⚠️ Analysis failed: ${err?.message}`);
      }
    }

    // Consolidate if many results
    if (allResults.length > 3 && this.inferenceEngine && this.hasMeshModel()) {
      this.addEvent('info', `Consolidating ${allResults.length} findings...`);
      try {
        const summaryPrompt =
          `Consolidate these debug findings for "${file.path}" into a clear, prioritized report.\n` +
          `List critical bugs first, then warnings, then suggestions. Include code fixes.\n\n` +
          allResults.join('\n\n---\n\n');

        const summary = await this.inferenceEngine.generate({
          id: `${issue.id}-summary`,
          prompt: summaryPrompt,
          systemPrompt: 'Consolidate debug findings. List critical issues first with specific fixes.',
          maxTokens: 2048,
        });
        return summary;
      } catch {
        // If consolidation fails, return the individual results
        return allResults.join('\n\n---\n\n');
      }
    }

    if (allResults.length > 0) {
      return allResults.join('\n\n---\n\n');
    }

    return `Analysis complete for ${file.path} (${totalChunks} section${totalChunks > 1 ? 's' : ''} analyzed). No issues found.`;
  }

  // ------------------------------------------
  // Single-pass analysis (no ContextManager)
  // ------------------------------------------

  private async analyzeSinglePass(
    issue: DebugIssue,
    fileContent: string,
    systemPrompt: string,
  ): Promise<string> {
    const prompt = [
      `Debug Issue: ${issue.message}`,
      issue.file ? `File: ${issue.file}` : '',
      `\`\`\`\n${fileContent}\n\`\`\``,
      issue.stackTrace ? `Stack Trace:\n${issue.stackTrace}` : '',
      'Analyze this code thoroughly for bugs, errors, and issues.',
    ].filter(Boolean).join('\n\n');

    try {
      return await this.inferenceEngine!.generate({
        id: generateId(),
        prompt,
        systemPrompt,
        maxTokens: 2048,
      });
    } catch (err: any) {
      this.addEvent('error', `Inference error: ${err?.message}`);
      return `AI analysis failed: ${err?.message}. ${this.heuristicFix(issue.message)}`;
    }
  }

  // ------------------------------------------
  // Heuristic fallback
  // ------------------------------------------

  private heuristicFix(message: string): string {
    const lower = message.toLowerCase();

    if (lower.includes('undefined') || lower.includes('null') || lower.includes('cannot read prop')) {
      return '**Null/Undefined Error**\n\n1. Add null checks before accessing properties: `obj?.prop`\n2. Use nullish coalescing for defaults: `value ?? fallback`\n3. Check if the variable is initialized before use\n4. Verify async data has loaded before accessing it';
    }
    if (lower.includes('type error') || lower.includes('typeerror') || lower.includes('is not a function')) {
      return '**Type Error**\n\n1. Verify the variable type matches expected usage\n2. Check if the function exists on the object (typo in method name?)\n3. Ensure imports resolve to the correct module\n4. Use `typeof` or `instanceof` guards before calling methods';
    }
    if (lower.includes('syntax') || lower.includes('unexpected token')) {
      return '**Syntax Error**\n\n1. Check for missing brackets, parentheses, or semicolons\n2. Verify template literal syntax (backticks, not quotes)\n3. Check for mismatched string delimiters\n4. Look for trailing commas in JSON or object literals';
    }
    if (lower.includes('network') || lower.includes('fetch') || lower.includes('connection') || lower.includes('cors')) {
      return '**Network Error**\n\n1. Check network connectivity and server availability\n2. Verify CORS headers on the server (`Access-Control-Allow-Origin`)\n3. Confirm API endpoint URLs are correct\n4. Check request headers and authentication tokens\n5. For P2P: verify signaling server is running';
    }
    if (lower.includes('import') || lower.includes('module') || lower.includes('require') || lower.includes('cannot find')) {
      return '**Module Error**\n\n1. Verify import path is correct (relative vs absolute)\n2. Check that the package is installed: `npm install <package>`\n3. Ensure the export name matches: named vs default export\n4. Check tsconfig.json `paths` and `moduleResolution` settings';
    }
    if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('deadline')) {
      return '**Timeout Error**\n\n1. Increase the timeout value if the operation is legitimately slow\n2. Check for infinite loops or blocking operations\n3. Verify the target service is responsive\n4. Add retry logic with exponential backoff';
    }
    if (lower.includes('memory') || lower.includes('heap') || lower.includes('allocation')) {
      return '**Memory Error**\n\n1. Check for memory leaks (unreleased event listeners, growing arrays)\n2. Use pagination or streaming for large datasets\n3. Dispose of WebGPU/WebGL resources when done\n4. Monitor with `performance.memory` in DevTools';
    }
    if (lower.includes('permission') || lower.includes('denied') || lower.includes('forbidden') || lower.includes('401') || lower.includes('403')) {
      return '**Permission Error**\n\n1. Verify authentication credentials are valid and not expired\n2. Check user role/permissions for the requested resource\n3. Ensure API keys have the required scopes\n4. Check file system permissions if accessing local files';
    }
    if (lower.includes('async') || lower.includes('promise') || lower.includes('await') || lower.includes('unhandled rejection')) {
      return '**Async/Promise Error**\n\n1. Ensure `await` is used inside an `async` function\n2. Add `.catch()` or try/catch around async operations\n3. Check for unhandled promise rejections\n4. Verify the promise actually resolves (not stuck pending)';
    }

    return '**General Debug Suggestion**\n\n1. Open DevTools (F12) and check the Console tab\n2. Review the stack trace to find the error origin\n3. Add `console.log` or breakpoints around the failure point\n4. Load a model in **Settings** for AI-powered deep analysis';
  }

  // ------------------------------------------
  // Re-analyze an existing issue
  // ------------------------------------------

  reAnalyzeIssue(issue: DebugIssue): void {
    const store = useAppStore.getState();
    store.updateDebugIssue(issue.id, { status: 'investigating', suggestedFix: undefined });
    this.addEvent('info', `Re-analyzing debug issue: ${issue.message.slice(0, 60)}`);
    this.routeAndAnalyze(issue);
  }

  // ------------------------------------------
  // Resolve / close
  // ------------------------------------------

  resolveIssue(issueId: string): void {
    useAppStore.getState().updateDebugIssue(issueId, { status: 'resolved' });
    this.addEvent('success', `Debug issue resolved: ${issueId.slice(0, 8)}`);
  }

  // ------------------------------------------
  // Helpers
  // ------------------------------------------

  private addEvent(type: 'info' | 'success' | 'warning' | 'error' | 'mesh', message: string): void {
    useAppStore.getState().addEvent({
      id: generateId(),
      type,
      message,
      timestamp: Date.now(),
    });
  }
}
