// ============================================
// ContextManager — Large Context Handling
// ============================================
// Manages up to ~50K tokens of coding context.
// Splits, distributes, summarizes, and reassembles
// context chunks across mesh nodes.
//
// CONTEXT ENGINEERING STRATEGY
// ─────────────────────────────
// Model context window: 4096 tokens (hard limit)
// We reserve budget for:
//   • System prompt:  ~300 tokens
//   • Prompt wrapper: ~150 tokens (file path, chunk info, user prompt)
//   • Model output:   1024 tokens (bugs + fix suggestions)
//   • Safety margin:  200 tokens
// → Max chunk content: 4096 - 300 - 150 - 1024 - 200 = 2422 tokens
//
// We target 2000 tokens per chunk for a comfortable margin.

import { useAppStore } from '../stores/appStore';
import { generateId } from '../utils/helpers';
import type { P2PManager } from './P2PManager';
import type { ContextChunk, VirtualFile } from '../types';

const CHARS_PER_TOKEN = 4;

// Hard model context window — never build a prompt larger than this
export const MODEL_CONTEXT_WINDOW = 4096;

// Reserved token budgets
const SYSTEM_PROMPT_TOKENS  = 300;   // system prompt
const WRAPPER_TOKENS        = 200;   // file path, chunk header, user instruction
const OUTPUT_TOKENS         = 1024;  // space for model to write fixes
const SAFETY_MARGIN         = 100;   // small buffer

// Maximum tokens we can put in a single chunk's code content
export const MAX_CHUNK_CONTENT_TOKENS =
  MODEL_CONTEXT_WINDOW - SYSTEM_PROMPT_TOKENS - WRAPPER_TOKENS - OUTPUT_TOKENS - SAFETY_MARGIN;
// = 4096 - 300 - 200 - 1024 - 100 = 2472

// For multi-file context assembly (getContextForTask), we budget more generously
// because the output phase is separate
const MAX_CONTEXT_ASSEMBLY_TOKENS = MODEL_CONTEXT_WINDOW - SYSTEM_PROMPT_TOKENS - OUTPUT_TOKENS - SAFETY_MARGIN;

const MAX_TOTAL_TOKENS = 50000;

export class ContextManager {
  private p2p: P2PManager;

  constructor(p2p: P2PManager) {
    this.p2p = p2p;
  }

  // ------------------------------------------
  // Token estimation
  // ------------------------------------------

  estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  // ------------------------------------------
  // Context chunking — token-safe adaptive sizing
  // ------------------------------------------

  /**
   * Split a file into chunks that each fit within MAX_CHUNK_CONTENT_TOKENS.
   * Uses token estimation rather than fixed line counts, so dense HTML/JS
   * files get more (smaller) chunks while sparse files get fewer (larger) chunks.
   */
  chunkFile(file: VirtualFile): ContextChunk[] {
    const lines = file.content.split('\n');
    const chunks: ContextChunk[] = [];
    let startLine = 0;

    while (startLine < lines.length) {
      // Binary-search for the largest slice that fits within the token budget
      let lo = 1;
      let hi = Math.min(300, lines.length - startLine); // max 300 lines per chunk as upper bound
      let safeLast = lo;

      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const slice = lines.slice(startLine, startLine + mid).join('\n');
        const tokens = this.estimateTokens(slice);

        if (tokens <= MAX_CHUNK_CONTENT_TOKENS) {
          safeLast = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }

      // Ensure we always make progress (at least 1 line per chunk)
      if (safeLast < 1) safeLast = 1;

      const endLine = startLine + safeLast;
      const chunkContent = lines.slice(startLine, endLine).join('\n');
      const tokenCount = this.estimateTokens(chunkContent);

      chunks.push({
        id: generateId(),
        file: file.path,
        startLine,
        endLine,
        tokenCount,
        summary: this.generateQuickSummary(chunkContent, file.path, startLine),
        distributed: false,
      });

      startLine = endLine;
    }

    return chunks;
  }

  chunkAllFiles(): ContextChunk[] {
    const store = useAppStore.getState();
    const allChunks: ContextChunk[] = [];
    let totalTokens = 0;

    for (const file of store.files) {
      const chunks = this.chunkFile(file);
      for (const chunk of chunks) {
        if (totalTokens + chunk.tokenCount > MAX_TOTAL_TOKENS) break;
        allChunks.push(chunk);
        totalTokens += chunk.tokenCount;
      }
      if (totalTokens >= MAX_TOTAL_TOKENS) break;
    }

    store.setContextChunks(allChunks);
    store.setTotalTokens(totalTokens);
    return allChunks;
  }

  // ------------------------------------------
  // Distribution
  // ------------------------------------------

  distributeContext(): Map<string, ContextChunk[]> {
    const store = useAppStore.getState();
    const chunks = store.contextChunks.length > 0 ? store.contextChunks : this.chunkAllFiles();
    const nodes = store.nodes.filter((n) => n.status !== 'offline');
    const distribution = new Map<string, ContextChunk[]>();

    if (nodes.length === 0) return distribution;

    for (const node of nodes) {
      distribution.set(node.id, []);
    }

    const sortedNodes = [...nodes].sort((a, b) =>
      (b.vram - b.vramUsed) - (a.vram - a.vramUsed),
    );

    let nodeIndex = 0;
    for (const chunk of chunks) {
      const targetNode = sortedNodes[nodeIndex % sortedNodes.length];
      distribution.get(targetNode.id)!.push({
        ...chunk,
        distributed: true,
        assignedNode: targetNode.id,
      });
      nodeIndex++;
    }

    const updatedChunks = chunks.map((chunk) => {
      for (const [nodeId, nodeChunks] of distribution) {
        const found = nodeChunks.find((c) => c.id === chunk.id);
        if (found) return { ...chunk, distributed: true, assignedNode: nodeId };
      }
      return chunk;
    });
    store.setContextChunks(updatedChunks);

    for (const [nodeId, nodeChunks] of distribution) {
      if (nodeId !== this.p2p.getSelfId() && nodeChunks.length > 0) {
        this.p2p.send(nodeId, {
          type: 'task',
          payload: { action: 'load-context', chunks: nodeChunks },
        });
      }
    }

    this.addEvent('info', `Distributed ${chunks.length} context chunks across ${nodes.length} nodes`);
    return distribution;
  }

  // ------------------------------------------
  // Context assembly
  // ------------------------------------------

  getContextForTask(filePaths: string[], maxTokens = MAX_CONTEXT_ASSEMBLY_TOKENS): string {
    const store = useAppStore.getState();
    const relevantChunks = store.contextChunks.filter((c) =>
      filePaths.includes(c.file),
    );

    let context = '';
    let tokens = 0;

    for (const chunk of relevantChunks) {
      if (tokens + chunk.tokenCount > maxTokens) {
        context += `\n// [${chunk.file}:${chunk.startLine}-${chunk.endLine}] ${chunk.summary}\n`;
        tokens += this.estimateTokens(chunk.summary);
      } else {
        const file = store.files.find((f) => f.path === chunk.file);
        if (file) {
          const lines = file.content.split('\n');
          const chunkContent = lines.slice(chunk.startLine, chunk.endLine).join('\n');
          context += `\n// === ${chunk.file}:${chunk.startLine}-${chunk.endLine} ===\n${chunkContent}\n`;
          tokens += chunk.tokenCount;
        }
      }
    }

    return context;
  }

  getContextSummary(): {
    totalFiles: number;
    totalChunks: number;
    totalTokens: number;
    distributedChunks: number;
    nodeDistribution: { nodeId: string; chunkCount: number; tokenCount: number }[];
  } {
    const store = useAppStore.getState();
    const chunks = store.contextChunks;

    const nodeMap = new Map<string, { count: number; tokens: number }>();
    for (const chunk of chunks) {
      if (chunk.assignedNode) {
        const existing = nodeMap.get(chunk.assignedNode) || { count: 0, tokens: 0 };
        existing.count++;
        existing.tokens += chunk.tokenCount;
        nodeMap.set(chunk.assignedNode, existing);
      }
    }

    return {
      totalFiles: new Set(chunks.map((c) => c.file)).size,
      totalChunks: chunks.length,
      totalTokens: store.totalTokens,
      distributedChunks: chunks.filter((c) => c.distributed).length,
      nodeDistribution: Array.from(nodeMap.entries()).map(([nodeId, data]) => ({
        nodeId,
        chunkCount: data.count,
        tokenCount: data.tokens,
      })),
    };
  }

  // ------------------------------------------
  // Summarization
  // ------------------------------------------

  private generateQuickSummary(content: string, filePath: string, startLine: number): string {
    const lines = content.split('\n').filter((l) => l.trim());
    const ext = filePath.split('.').pop() || '';

    const signatures: string[] = [];
    for (const line of lines.slice(0, 30)) {
      const trimmed = line.trim();
      if (
        trimmed.startsWith('function ') ||
        trimmed.startsWith('class ') ||
        trimmed.startsWith('export ') ||
        trimmed.startsWith('const ') ||
        trimmed.startsWith('interface ') ||
        trimmed.startsWith('type ') ||
        trimmed.match(/^\w+\s*\(/) ||
        trimmed.startsWith('def ') ||
        trimmed.startsWith('async ')
      ) {
        signatures.push(trimmed.slice(0, 80));
        if (signatures.length >= 3) break;
      }
    }

    if (signatures.length > 0) {
      return `[${ext}] ${signatures.join('; ')}`;
    }
    return `[${ext}] ${lines.length} lines starting at L${startLine}`;
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
