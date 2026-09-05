// ============================================
// TaskDistributor — Distributed Task Assignment
// ============================================
// Splits work into subtasks, assigns to available nodes
// based on capacity, and aggregates results.

import { useAppStore } from '../stores/appStore';
import { generateId } from '../utils/helpers';
import { EventBus, MeshEvents } from './EventBus';
import { FileOps } from './FileOperations';
import type { P2PManager, P2PMessage } from './P2PManager';
import type { InferenceEngine } from './InferenceEngine';
import type { ContextManager } from './ContextManager';
import type { Task, TaskStatus, TaskType, PeerNode } from '../types';

interface TaskAssignment {
  taskId: string;
  nodeId: string;
  assignedAt: number;
  timeout: number;
}

export class TaskDistributor {
  private p2p: P2PManager;
  private activeAssignments: Map<string, TaskAssignment> = new Map();
  private assignmentCheckInterval: ReturnType<typeof setInterval> | null = null;
  private inferenceEngine: InferenceEngine | null = null;
  private contextManager: ContextManager | null = null;

  constructor(p2p: P2PManager) {
    this.p2p = p2p;
    this.setupListeners();
    this.startAssignmentMonitor();
  }

  setInferenceEngine(engine: InferenceEngine): void {
    this.inferenceEngine = engine;
  }

  setContextManager(ctx: ContextManager): void {
    this.contextManager = ctx;
  }

  // Prevent re-running a task that's already executing locally
  private executingTaskIds: Set<string> = new Set();

  private setupListeners(): void {
    // Receive task assignments from master
    this.p2p.on('task', (message: P2PMessage) => {
      const { action, task, taskId, fileContents } = message.payload;

      switch (action) {
        case 'assign':
          // fileContents is a map { [filePath]: content } sent by master so the
          // worker has all required files before executing without a separate sync round-trip.
          this.handleTaskAssignment(task, fileContents);
          break;
        case 'cancel':
          this.handleTaskCancellation(taskId);
          break;
        case 'status-request':
          this.handleStatusRequest(taskId, message.senderId);
          break;
        case 'inference':
          this.handleInferenceOffload(message.payload, message.senderId);
          break;
        case 'progress-ack':
          // Worker sent a heartbeat for a long-running task — reset its assignment timer
          if (this.activeAssignments.has(taskId)) {
            this.activeAssignments.get(taskId)!.assignedAt = Date.now();
          }
          break;
      }
    });

    // Receive results from workers
    this.p2p.on('result', (message: P2PMessage) => {
      const { taskId, status, result, error } = message.payload;
      this.handleTaskResult(taskId, status, result, error, message.senderId);
    });

    // Receive streaming tokens from workers — relay to the UI via EventBus
    this.p2p.on('task-token', (message: P2PMessage) => {
      const { taskId, token, progress, nodeId, nodeName } = message.payload;
      // Reset the assignment timer so the task doesn't time out during streaming
      if (this.activeAssignments.has(taskId)) {
        this.activeAssignments.get(taskId)!.assignedAt = Date.now();
      }
      // Update task progress in store
      useAppStore.getState().updateTask(taskId, { progress, updatedAt: Date.now() });
      // Emit to UI so the terminal live entry streams tokens in real time
      EventBus.emit(MeshEvents.TASK_PROGRESS, { taskId, progress, token, nodeId, nodeName });
    });
  }

  private handleStatusRequest(taskId: string, requesterId: string): void {
    const store = useAppStore.getState();
    const task = store.tasks.find((t) => t.id === taskId);
    if (task) {
      this.p2p.send(requesterId, {
        type: 'result',
        payload: { taskId, status: task.status, progress: task.progress },
      });
    }
  }

  /**
   * Handle a raw inference offload request from a peer that has no local model.
   * Runs the prompt through the local InferenceEngine and sends the result back.
   */
  private async handleInferenceOffload(
    payload: { requestId: string; prompt: string; systemPrompt?: string; maxTokens?: number; temperature?: number },
    requesterId: string,
  ): Promise<void> {
    const { requestId, prompt, systemPrompt, maxTokens, temperature } = payload;

    if (!this.inferenceEngine?.isModelLoaded()) {
      this.p2p.send(requesterId, {
        type: 'result',
        payload: { requestId, error: 'No model loaded on this node' },
      });
      return;
    }

    this.addEvent('info', `Running inference offload for peer (req: ${requestId.slice(0, 8)}...)`);

    try {
      const result = await this.inferenceEngine.generate({
        id: requestId,
        prompt,
        systemPrompt,
        maxTokens,
        temperature,
      });

      this.p2p.send(requesterId, {
        type: 'result',
        payload: { requestId, result },
      });

      this.addEvent('success', `Inference offload complete (req: ${requestId.slice(0, 8)}...)`);
    } catch (err: any) {
      this.p2p.send(requesterId, {
        type: 'result',
        payload: { requestId, error: err.message || 'Inference failed' },
      });
      this.addEvent('error', `Inference offload failed: ${err.message}`);
    }
  }

  // ------------------------------------------
  // Task creation & distribution
  // ------------------------------------------

  createTask(title: string, type: TaskType, options: {
    tokenCount?: number;
    relatedFiles?: string[];
    priority?: 'low' | 'normal' | 'high' | 'critical';
    context?: string;
  } = {}): Task {
    const task: Task = {
      id: generateId(),
      title,
      type,
      status: 'queued',
      priority: options.priority || 'normal',
      assignedNode: null,
      progress: 0,
      tokenCount: options.tokenCount || (options.context ? Math.ceil(options.context.length / 4) : 0),
      retryCount: 0,
      relatedFiles: options.relatedFiles || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      history: [{
        timestamp: Date.now(),
        event: 'Task created',
        // Store the user's prompt/context in the first history entry so executeCodeGenTask can use it
        detail: options.context || '',
      }],
    };

    useAppStore.getState().addTask(task);
    this.addEvent('info', `Task created: ${title}`);
    return task;
  }

  /**
   * Distribute a task to the best available node.
   * @param preferredNodeId - If provided, skip scoring and assign to this node directly.
   *                          Falls back to auto-selection if the preferred node is offline.
   */
  distributeTask(taskId: string, preferredNodeId?: string): void {
    const store = useAppStore.getState();
    const task = store.tasks.find((t) => t.id === taskId);
    if (!task || task.status !== 'queued') return;

    // Honour peer preference from terminal (@NodeName syntax), but fall back if offline
    let targetNode = preferredNodeId
      ? store.nodes.find((n) => n.id === preferredNodeId && n.status !== 'offline') ?? this.selectBestNode(task)
      : this.selectBestNode(task);

    if (!targetNode) {
      // No node at all — leave as queued, will be picked up when a node frees up
      this.addEvent('info', `Task queued — no node available yet: ${task.title}`);
      EventBus.emit(MeshEvents.TASK_PROGRESS, {
        taskId,
        progress: 0,
        token: '',
        nodeId: '',
        nodeName: 'Waiting for peer…',
      });
      return;
    }

    // Assign task
    store.updateTask(taskId, {
      status: 'assigned',
      assignedNode: targetNode.id,
      updatedAt: Date.now(),
      history: [...task.history, {
        timestamp: Date.now(),
        event: `Assigned to ${targetNode.name}`,
        nodeId: targetNode.id,
      }],
    });

    store.updateNode(targetNode.id, { currentTask: task.title });

    this.activeAssignments.set(taskId, {
      taskId,
      nodeId: targetNode.id,
      assignedAt: Date.now(),
      timeout: this.getTaskTimeout(task.type),
    });

    // Emit TASK_ASSIGNED so the terminal can update its live entry immediately
    EventBus.emit(MeshEvents.TASK_ASSIGNED, {
      taskId,
      nodeId: targetNode.id,
      nodeName: targetNode.name,
    });

    if (targetNode.id !== this.p2p.getSelfId()) {
      // Build file content map so the worker can execute without a separate file-sync
      const taskSnapshot = store.tasks.find((t) => t.id === taskId)!;
      const fileContents: Record<string, string> = {};
      for (const filePath of taskSnapshot.relatedFiles) {
        const file = store.files.find((f) => f.path === filePath);
        if (file) fileContents[filePath] = file.content;
      }

      // Send to remote worker — include file content inline
      this.p2p.send(targetNode.id, {
        type: 'task',
        payload: {
          action: 'assign',
          task: taskSnapshot,
          fileContents,
        },
      });
    } else {
      // Execute locally — update status to running and begin
      const currentTask = store.tasks.find((t) => t.id === taskId)!;
      store.updateTask(taskId, { status: 'running', updatedAt: Date.now() });
      this.executeTask(currentTask);
    }

    this.addEvent('info', `Task "${task.title}" assigned to ${targetNode.name}`);
  }

  distributeAllQueued(): void {
    const store = useAppStore.getState();
    const queued = store.tasks
      .filter((t) => t.status === 'queued')
      .sort((a, b) => {
        const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });

    for (const task of queued) {
      this.distributeTask(task.id);
    }
  }

  // ------------------------------------------
  // Node selection
  // ------------------------------------------

  /**
   * Returns all non-offline nodes that currently have no active task assignments.
   * Used by ProjectOrchestrator to find free nodes for subtask dispatch.
   */
  getAvailableNodes(): PeerNode[] {
    const store = useAppStore.getState();
    const busyNodeIds = new Set(
      Array.from(this.activeAssignments.values()).map((a) => a.nodeId),
    );
    return store.nodes.filter(
      (n) => n.status !== 'offline' && !busyNodeIds.has(n.id),
    );
  }

  private selectBestNode(task: Task): PeerNode | null {
    const store = useAppStore.getState();

    // Use activeAssignments as the source of truth for how many tasks each node is running.
    // This avoids the single-string `currentTask` overwrite bug where assigning a second
    // task to the same node clobbers the first task's tracking and makes the node appear
    // free before the first task actually finishes.
    const nodeTaskCounts = new Map<string, number>();
    for (const [, assignment] of this.activeAssignments) {
      nodeTaskCounts.set(assignment.nodeId, (nodeTaskCounts.get(assignment.nodeId) || 0) + 1);
    }

    const available = store.nodes.filter(
      (n) => n.status === 'online' && (nodeTaskCounts.get(n.id) || 0) === 0,
    );

    if (available.length === 0) {
      // Fall back to least busy node by active task count, then VRAM ratio
      const leastBusy = store.nodes
        .filter((n) => n.status !== 'offline')
        .sort((a, b) => {
          const countDiff = (nodeTaskCounts.get(a.id) || 0) - (nodeTaskCounts.get(b.id) || 0);
          if (countDiff !== 0) return countDiff;
          return (a.vramUsed / (a.vram || 1)) - (b.vramUsed / (b.vram || 1));
        });
      return leastBusy[0] || null;
    }

    const isAITask = ['inference', 'code-gen', 'debug', 'review', 'summarize', 'test'].includes(task.type);

    // Score nodes for this task
    return available.sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;

      // For AI tasks: strongly prefer nodes that have a model loaded
      if (isAITask) {
        if (a.modelLoaded) scoreA += 10;
        if (b.modelLoaded) scoreB += 10;
      }

      // Prefer nodes with more free VRAM
      if (a.vram > 0) scoreA += (a.vram - a.vramUsed) / a.vram;
      if (b.vram > 0) scoreB += (b.vram - b.vramUsed) / b.vram;

      // Prefer lower latency
      scoreA += Math.max(0, 1 - a.latency / 500);
      scoreB += Math.max(0, 1 - b.latency / 500);

      // Prefer debug nodes for debug tasks
      if (task.type === 'debug') {
        if (a.role === 'debug') scoreA += 2;
        if (b.role === 'debug') scoreB += 2;
      }

      // Prefer nodes with WebGPU for inference
      if (task.type === 'inference' || task.type === 'code-gen') {
        if (a.capabilities.includes('webgpu')) scoreA += 1.5;
        if (b.capabilities.includes('webgpu')) scoreB += 1.5;
      }

      return scoreB - scoreA;
    })[0] || null;
  }

  // ------------------------------------------
  // Task handling
  // ------------------------------------------

  private handleTaskAssignment(task: Task, fileContents?: Record<string, string>): void {
    // Prevent duplicate execution if this task is already running locally
    if (this.executingTaskIds.has(task.id)) {
      this.addEvent('info', `Duplicate assignment ignored for task: ${task.title}`);
      return;
    }

    const store = useAppStore.getState();

    // Hydrate any attached file content into the local store so buildFileContext works
    if (fileContents && Object.keys(fileContents).length > 0) {
      for (const [filePath, content] of Object.entries(fileContents)) {
        const existing = store.files.find((f) => f.path === filePath);
        if (!existing) {
          const ext = filePath.split('.').pop()?.toLowerCase() || '';
          const langMap: Record<string, string> = {
            ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
            py: 'python', go: 'go', rs: 'rust', java: 'java', cpp: 'cpp', c: 'c',
            html: 'html', css: 'css', json: 'json', md: 'markdown',
          };
          store.addFile({
            path: filePath,
            content,
            language: langMap[ext] || 'plaintext',
            lastModified: Date.now(),
            version: 1,
          });
        }
      }
    }

    store.addTask({ ...task, status: 'running', assignedNode: this.p2p.getSelfId() });
    store.updateNode(this.p2p.getSelfId(), { currentTask: task.title });
    this.addEvent('info', `Received task: ${task.title}`);
    const selfName = store.nodes.find((n) => n.id === this.p2p.getSelfId())?.name ?? this.p2p.getSelfId().slice(0, 12);
    EventBus.emit(MeshEvents.TASK_ASSIGNED, { taskId: task.id, nodeId: this.p2p.getSelfId(), nodeName: selfName });

    // Send immediate ack to master so its assignment timer is reset right away,
    // preventing false-positive timeouts while the task waits in the inference queue.
    const masterId = store.masterId;
    if (masterId && masterId !== this.p2p.getSelfId()) {
      this.p2p.send(masterId, {
        type: 'task',
        payload: { action: 'progress-ack', taskId: task.id },
      });
    }

    this.executeTask(task);
  }

  private async executeTask(task: Task): Promise<void> {
    // Execution lock — prevents duplicate runs if master reassigns before result arrives
    if (this.executingTaskIds.has(task.id)) return;
    this.executingTaskIds.add(task.id);

    // Heartbeat to master: tell it we're alive every 10s during long tasks
    // This resets the assignment timeout and prevents false-positive reassignment.
    // Token streaming (task-token messages) also resets the timer, but we keep
    // this as a safety net for non-streaming phases (e.g. chunked debug analysis).
    const masterId = useAppStore.getState().masterId;
    const heartbeatTimer = masterId && masterId !== this.p2p.getSelfId()
      ? setInterval(() => {
          this.p2p.send(masterId, {
            type: 'task',
            payload: { action: 'progress-ack', taskId: task.id },
          });
        }, 10000)
      : null;

    try {
      this.addEvent('info', `Executing task: ${task.title}`);

      let result = '';

      switch (task.type) {
        case 'inference':
        case 'code-gen':
          result = await this.executeCodeGenTask(task);
          break;
        case 'debug':
          result = await this.executeDebugTask(task);
          break;
        case 'summarize':
          result = await this.executeSummarizeTask(task);
          break;
        case 'review':
          result = await this.executeReviewTask(task);
          break;
        case 'test':
          result = await this.executeTestTask(task);
          break;
        default:
          result = `Task type '${task.type}' not implemented`;
      }

      this.completeTask(task.id, result);
    } catch (error: any) {
      this.failTask(task.id, error.message || 'Task execution failed');
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      this.executingTaskIds.delete(task.id);
    }
  }

  /**
   * Build file context using ContextManager for intelligent chunking.
   * For large files, chunks are used with summaries for overflow sections.
   * Falls back to direct file reading if ContextManager is unavailable.
   */
  private buildFileContext(task: Task): string {
    if (task.relatedFiles.length === 0) return '';

    const store = useAppStore.getState();

    // Use ContextManager for intelligent chunking (handles 50K+ tokens)
    if (this.contextManager) {
      // Ensure files are chunked
      for (const filePath of task.relatedFiles) {
        const file = store.files.find(f => f.path === filePath);
        if (file) {
          const existingChunks = store.contextChunks.filter(c => c.file === filePath);
          if (existingChunks.length === 0) {
            const chunks = this.contextManager.chunkFile(file);
            const allChunks = [...store.contextChunks, ...chunks];
            store.setContextChunks(allChunks);
            store.setTotalTokens(allChunks.reduce((sum, c) => sum + c.tokenCount, 0));
          }
        }
      }
      // Assemble context with chunking — fits within model context window
      // Uses full content for chunks that fit, summaries for overflow
      return this.contextManager.getContextForTask(task.relatedFiles);
    }

    // Fallback: direct file content (no truncation — send everything)
    return store.files
      .filter(f => task.relatedFiles.includes(f.path))
      .map(f => `// File: ${f.path}\n${f.content}`)
      .join('\n\n---\n\n');
  }

  /**
   * Returns true if any node in the mesh (local or peer) has a model loaded.
   */
  private hasMeshModel(): boolean {
    if (this.inferenceEngine?.isModelLoaded()) return true;
    const nodes = useAppStore.getState().nodes;
    return nodes.some((n) => !n.isSelf && n.status !== 'offline' && n.modelLoaded);
  }

  /**
   * Run inference with streaming progress updates.
   * Uses local model if available; offloads to a peer with a model otherwise.
   * Returns null only when no model is available anywhere in the mesh.
   */
  private async runInference(
    task: Task,
    prompt: string,
    systemPrompt: string,
    maxTokens: number,
    estimatedOutputTokens = 500,
  ): Promise<string | null> {
    if (!this.inferenceEngine) return null;
    if (!this.hasMeshModel()) return null;

    const store = useAppStore.getState();
    store.updateTask(task.id, { status: 'running', progress: 10, updatedAt: Date.now() });

    let streamedTokens = 0;
    const assignment = this.activeAssignments.get(task.id);
    const nodeId = assignment?.nodeId ?? this.p2p.getSelfId();
    const nodeName = useAppStore.getState().nodes.find((n) => n.id === nodeId)?.name ?? nodeId.slice(0, 12);

    // InferenceEngine.generate() automatically offloads to a peer if no local model
    const masterIdForStream = store.masterId;
    const isWorker = masterIdForStream && masterIdForStream !== this.p2p.getSelfId();

    const result = await this.inferenceEngine.generate({
      id: task.id,
      prompt,
      systemPrompt,
      maxTokens,
      onToken: (token) => {
        streamedTokens++;
        const progress = Math.min(95, 10 + Math.round((streamedTokens / estimatedOutputTokens) * 85));
        store.updateTask(task.id, { progress, updatedAt: Date.now() });
        // Emit progress so local terminal live entries update in real time
        EventBus.emit(MeshEvents.TASK_PROGRESS, { taskId: task.id, progress, token, nodeId, nodeName });
        // If we're a worker, stream token back to master so its terminal also updates live
        if (isWorker) {
          this.p2p.send(masterIdForStream!, {
            type: 'task-token',
            payload: { taskId: task.id, token, progress, nodeId, nodeName },
          });
        }
      },
    });

    store.updateTask(task.id, { progress: 100, updatedAt: Date.now() });
    return result;
  }

  private async executeCodeGenTask(task: Task): Promise<string> {
    const store = useAppStore.getState();
    const fileContext = this.buildFileContext(task);
    const userPrompt = task.history[0]?.detail?.trim() || '';

    const promptParts: string[] = [];
    if (fileContext) promptParts.push(`Relevant files:\n\n${fileContext}`);
    if (userPrompt) promptParts.push(`Instructions: ${userPrompt}`);
    promptParts.push(`Task: ${task.title}`);

    const prompt = promptParts.join('\n\n');
    const systemPrompt = `You are SouthStack AI, a distributed coding assistant running locally via WebGPU.
Generate clean, working TypeScript/JavaScript code based on the task.
Provide the code directly with minimal prose. Use best practices.`;

    try {
      const result = await this.runInference(task, prompt, systemPrompt, 2048, 500);
      if (result !== null) return result;
    } catch (err) {
      console.warn('Inference failed, using fallback:', err);
    }

    store.updateTask(task.id, { status: 'running', progress: 100, updatedAt: Date.now() });
    return `⚠️ **No AI model loaded**\n\nCannot generate code for: "${task.title}"\n\nTo enable code generation:\n1. Go to **Settings** and load a model (e.g. Qwen2.5-Coder or Phi-3.5)\n2. Or connect to a peer that has a model loaded\n\nThe task has been queued and will auto-execute when a model becomes available.`;
  }

  private async executeDebugTask(task: Task): Promise<string> {
    const store = useAppStore.getState();
    const userPrompt = task.history[0]?.detail?.trim() || '';

    const debugSystemPrompt = 'You are a debugging expert. Analyze the code thoroughly for bugs, logic errors, potential crashes, type issues, and edge cases. Identify root causes and provide specific fixes with code examples.';

    if (this.inferenceEngine && this.hasMeshModel()) {
      store.updateTask(task.id, { status: 'running', progress: 5, updatedAt: Date.now() });

      try {
        // For large files, use chunk-by-chunk analysis
        if (this.contextManager && task.relatedFiles.length > 0) {
          const allResults: string[] = [];
          let chunkIndex = 0;

          for (const filePath of task.relatedFiles) {
            const file = store.files.find(f => f.path === filePath);
            if (!file) continue;

            const chunks = this.contextManager.chunkFile(file);
            const totalChunks = chunks.length;

            for (const chunk of chunks) {
              chunkIndex++;
              const lines = file.content.split('\n');
              const chunkContent = lines.slice(chunk.startLine, chunk.endLine).join('\n');

              const chunkPrompt = [
                `File: ${filePath} (lines ${chunk.startLine + 1}-${chunk.endLine}, chunk ${chunkIndex}/${totalChunks})`,
                `\`\`\`\n${chunkContent}\n\`\`\``,
                userPrompt || `Analyze this code section for bugs, errors, and issues.`,
              ].join('\n\n');

              const progress = Math.min(90, 5 + Math.round((chunkIndex / (totalChunks * task.relatedFiles.length)) * 80));
              store.updateTask(task.id, { progress, updatedAt: Date.now() });

              const chunkResult = await this.inferenceEngine.generate({
                id: `${task.id}-chunk-${chunkIndex}`,
                prompt: chunkPrompt,
                systemPrompt: debugSystemPrompt,
                maxTokens: 1024,
              });

              // Only keep chunks that found actual issues
              const lower = chunkResult.toLowerCase();
              if (!lower.includes('no issues') && !lower.includes('looks good') && !lower.includes('no bugs')) {
                allResults.push(`### ${filePath} (lines ${chunk.startLine + 1}-${chunk.endLine})\n${chunkResult}`);
              }
            }
          }

          store.updateTask(task.id, { progress: 95, updatedAt: Date.now() });

          // If many chunks had issues, do a final summary pass
          if (allResults.length > 3) {
            const summaryPrompt = `Summarize these debug findings into a concise report with the most critical issues first:\n\n${allResults.join('\n\n---\n\n')}`;
            const summary = await this.inferenceEngine.generate({
              id: `${task.id}-summary`,
              prompt: summaryPrompt,
              systemPrompt: 'You are a debugging expert. Consolidate multiple debug findings into a clear, prioritized report. List critical bugs first, then warnings, then suggestions.',
              maxTokens: 2048,
            });
            store.updateTask(task.id, { progress: 100, updatedAt: Date.now() });
            return summary;
          }

          store.updateTask(task.id, { progress: 100, updatedAt: Date.now() });
          return allResults.length > 0
            ? allResults.join('\n\n---\n\n')
            : `Debug analysis complete for: ${task.title}\n\nNo issues found after analyzing all ${chunkIndex} code sections.`;
        }

        // Fallback: single-pass analysis with buildFileContext
        const fileContext = this.buildFileContext(task);
        const promptParts: string[] = [];
        if (fileContext) promptParts.push(`Code to debug:\n\n${fileContext}`);
        if (userPrompt) promptParts.push(userPrompt);
        promptParts.push(`Task: ${task.title}`);

        const result = await this.runInference(task, promptParts.join('\n\n'), debugSystemPrompt, 1024, 300);
        if (result !== null) return result;
      } catch (err) {
        console.warn('Debug inference failed:', err);
      }
    }

    store.updateTask(task.id, { status: 'running', progress: 100, updatedAt: Date.now() });
    return `⚠️ **No AI model loaded**\n\nCannot perform debug analysis for: "${task.title}"\n\nBasic heuristic checks are available via the **Debug** panel.\nFor deep AI-powered analysis, load a model in **Settings** or connect to a peer with a loaded model.`;
  }

  private async executeSummarizeTask(task: Task): Promise<string> {
    const store = useAppStore.getState();
    const fileContext = this.buildFileContext(task);
    const prompt = fileContext ? `Summarize this code:\n\n${fileContext}` : `Summarize: ${task.title}`;

    try {
      const result = await this.runInference(task, prompt,
        'Summarize the code concisely. List key functions, purpose, and dependencies.', 512, 200);
      if (result !== null) return result;
    } catch { /* fall through */ }

    store.updateTask(task.id, { status: 'running', progress: 100, updatedAt: Date.now() });
    return `⚠️ **No AI model loaded**\n\nCannot summarize: "${task.title}"\n\nLoad a model in **Settings** or connect to a peer with a loaded model.`;
  }

  private async executeReviewTask(task: Task): Promise<string> {
    const store = useAppStore.getState();

    const reviewSystemPrompt = 'Review the code for bugs, style, performance issues, and improvements. Be specific and actionable. Provide code examples for suggested fixes.';

    if (this.inferenceEngine && this.hasMeshModel()) {
      try {
        // For large files, do chunk-by-chunk review then consolidate
        if (this.contextManager && task.relatedFiles.length > 0) {
          const allResults: string[] = [];
          let chunkIndex = 0;

          for (const filePath of task.relatedFiles) {
            const file = store.files.find(f => f.path === filePath);
            if (!file) continue;

            const chunks = this.contextManager.chunkFile(file);
            const totalChunks = chunks.length;

            for (const chunk of chunks) {
              chunkIndex++;
              const lines = file.content.split('\n');
              const chunkContent = lines.slice(chunk.startLine, chunk.endLine).join('\n');

              const chunkPrompt = `Review this code section:\n\nFile: ${filePath} (lines ${chunk.startLine + 1}-${chunk.endLine})\n\`\`\`\n${chunkContent}\n\`\`\``;

              const progress = Math.min(90, 5 + Math.round((chunkIndex / (totalChunks * task.relatedFiles.length)) * 80));
              store.updateTask(task.id, { status: 'running', progress, updatedAt: Date.now() });

              const chunkResult = await this.inferenceEngine.generate({
                id: `${task.id}-chunk-${chunkIndex}`,
                prompt: chunkPrompt,
                systemPrompt: reviewSystemPrompt,
                maxTokens: 1024,
              });

              allResults.push(`### ${filePath} (lines ${chunk.startLine + 1}-${chunk.endLine})\n${chunkResult}`);
            }
          }

          store.updateTask(task.id, { progress: 95, updatedAt: Date.now() });

          // Consolidate if many chunks
          if (allResults.length > 3) {
            const summaryPrompt = `Consolidate these code review findings into a single actionable report. Group by severity (critical, warnings, suggestions):\n\n${allResults.join('\n\n---\n\n')}`;
            const summary = await this.inferenceEngine.generate({
              id: `${task.id}-summary`,
              prompt: summaryPrompt,
              systemPrompt: 'Consolidate code review findings into a clear, prioritized report.',
              maxTokens: 2048,
            });
            store.updateTask(task.id, { progress: 100, updatedAt: Date.now() });
            return summary;
          }

          store.updateTask(task.id, { progress: 100, updatedAt: Date.now() });
          return allResults.join('\n\n---\n\n');
        }

        // Single-pass review with buildFileContext
        const fileContext = this.buildFileContext(task);
        const prompt = fileContext ? `Review this code:\n\n${fileContext}` : `Review: ${task.title}`;
        const result = await this.runInference(task, prompt, reviewSystemPrompt, 1024, 400);
        if (result !== null) return result;
      } catch (err) {
        console.warn('Review inference failed:', err);
      }
    }

    store.updateTask(task.id, { status: 'running', progress: 100, updatedAt: Date.now() });
    return `⚠️ **No AI model loaded**\n\nCannot perform code review for: "${task.title}"\n\nLoad a model in **Settings** or connect to a peer with a loaded model for AI-powered review.`;
  }

  private async executeTestTask(task: Task): Promise<string> {
    const store = useAppStore.getState();
    const userPrompt = task.history[0]?.detail?.trim() || '';

    if (this.inferenceEngine && this.hasMeshModel()) {
      store.updateTask(task.id, { status: 'running', progress: 10, updatedAt: Date.now() });
      try {
        const result = await this.inferenceEngine.generate({
          id: task.id,
          prompt: userPrompt ? `Write tests for: ${userPrompt}\n\nTask: ${task.title}` : `Write tests for: ${task.title}`,
          systemPrompt: 'Write comprehensive unit tests using Vitest. Include edge cases and mocks where needed.',
          maxTokens: 2048,
        });
        store.updateTask(task.id, { progress: 100, updatedAt: Date.now() });
        return result;
      } catch { /* fall through */ }
    }

    store.updateTask(task.id, { status: 'running', progress: 100, updatedAt: Date.now() });
    return `⚠️ **No AI model loaded**\n\nCannot generate tests for: "${task.title}"\n\nLoad a model in **Settings** or connect to a peer with a loaded model for AI-powered test generation.`;
  }

  private handleTaskCancellation(taskId: string): void {
    const store = useAppStore.getState();
    store.updateTask(taskId, { status: 'failed', error: 'Cancelled by master' });
    this.activeAssignments.delete(taskId);
  }

  private handleTaskResult(
    taskId: string,
    status: TaskStatus,
    result: string | undefined,
    error: string | undefined,
    fromNodeId: string,
  ): void {
    const store = useAppStore.getState();
    const task = store.tasks.find((t) => t.id === taskId);
    if (!task) return;

    store.updateTask(taskId, {
      status,
      result,
      error,
      progress: status === 'completed' ? 100 : task.progress,
      updatedAt: Date.now(),
      history: [...task.history, {
        timestamp: Date.now(),
        event: status === 'completed' ? 'Task completed' : `Task ${status}`,
        nodeId: fromNodeId,
      }],
    });

    // Free up the node
    this.activeAssignments.delete(taskId);

    // Clear the node's currentTask display only if it has no remaining active assignments
    const remainingForNode = [...this.activeAssignments.values()].some((a) => a.nodeId === fromNodeId);
    if (!remainingForNode) {
      store.updateNode(fromNodeId, { currentTask: null });
    }

    const nodeName = store.nodes.find((n) => n.id === fromNodeId)?.name ?? fromNodeId.slice(0, 12);
    if (status === 'completed') {
      this.addEvent('success', `Task "${task.title}" completed`);
      EventBus.emit(MeshEvents.TASK_COMPLETED, { taskId, result, nodeId: fromNodeId, nodeName });
      // Auto-apply code result to the related file when task is code-gen or debug
      if (result && (task.type === 'code-gen' || task.type === 'debug') && task.relatedFiles.length > 0) {
        this.applyCodeResultToFile(task, result);
      } else if (result) {
        // For all other task types, at least store the last generated code so /apply works
        const targetFile = task.relatedFiles[0] || null;
        store.setLastGeneratedCode(result, null, targetFile);
      }
    } else if (status === 'failed') {
      this.addEvent('error', `Task "${task.title}" failed: ${error || 'Unknown error'}`);
      EventBus.emit(MeshEvents.TASK_FAILED, { taskId, error, nodeId: fromNodeId, nodeName });
      this.handleTaskFailure(taskId);
    }

    // Auto-distribute any tasks that were queued while all nodes were busy.
    // Run on both master and worker so tasks resume even if the master is self.
    setTimeout(() => this.distributeAllQueued(), 200);
  }

  reportTaskProgress(taskId: string, progress: number): void {
    const store = useAppStore.getState();
    store.updateTask(taskId, { progress, updatedAt: Date.now() });
  }

  completeTask(taskId: string, result: string): void {
    const store = useAppStore.getState();
    const task = store.tasks.find((t) => t.id === taskId);
    if (!task) return;

    // Notify master if we're a worker
    const masterId = store.masterId;
    if (masterId && masterId !== this.p2p.getSelfId()) {
      // Clear our own node's currentTask display immediately
      store.updateNode(this.p2p.getSelfId(), { currentTask: null });
      this.p2p.send(masterId, {
        type: 'result',
        payload: { taskId, status: 'completed', result },
      });
    } else {
      this.handleTaskResult(taskId, 'completed', result, undefined, this.p2p.getSelfId());
    }
  }

  failTask(taskId: string, error: string): void {
    const store = useAppStore.getState();
    const masterId = store.masterId;
    if (masterId && masterId !== this.p2p.getSelfId()) {
      // Clear our own node's currentTask display immediately
      store.updateNode(this.p2p.getSelfId(), { currentTask: null });
      this.p2p.send(masterId, {
        type: 'result',
        payload: { taskId, status: 'failed', error },
      });
    } else {
      this.handleTaskResult(taskId, 'failed', undefined, error, this.p2p.getSelfId());
    }
  }

  // ------------------------------------------
  // Fault tolerance
  // ------------------------------------------

  private handleTaskFailure(taskId: string): void {
    const store = useAppStore.getState();
    const task = store.tasks.find((t) => t.id === taskId);
    if (!task) return;

    if (task.retryCount < 3) {
      // Retry on a different node
      store.updateTask(taskId, {
        status: 'queued',
        assignedNode: null,
        retryCount: task.retryCount + 1,
        updatedAt: Date.now(),
        history: [...task.history, {
          timestamp: Date.now(),
          event: `Retry #${task.retryCount + 1} — reassigning`,
        }],
      });
      this.addEvent('warning', `Retrying task "${task.title}" (attempt ${task.retryCount + 1})`);

      // Re-distribute after a short delay
      setTimeout(() => this.distributeTask(taskId), 1000);
    } else {
      store.updateTask(taskId, {
        status: 'failed',
        updatedAt: Date.now(),
        history: [...task.history, {
          timestamp: Date.now(),
          event: 'Max retries reached — task failed permanently',
        }],
      });
      this.addEvent('error', `Task "${task.title}" failed after 3 retries`);
    }
  }

  reassignNodeTasks(nodeId: string): void {
    const store = useAppStore.getState();
    const nodeTasks = store.tasks.filter(
      (t) => t.assignedNode === nodeId && (t.status === 'running' || t.status === 'assigned'),
    );

    for (const task of nodeTasks) {
      store.updateTask(task.id, {
        status: 'queued',
        assignedNode: null,
        updatedAt: Date.now(),
        history: [...task.history, {
          timestamp: Date.now(),
          event: `Reassigned — node ${nodeId.slice(0, 8)} lost`,
          nodeId,
        }],
      });
      this.activeAssignments.delete(task.id);
      setTimeout(() => this.distributeTask(task.id), 500);
    }

    if (nodeTasks.length > 0) {
      this.addEvent('warning', `Reassigned ${nodeTasks.length} tasks from disconnected node`);
    }
  }

  // ------------------------------------------
  // Monitoring
  // ------------------------------------------

  private startAssignmentMonitor(): void {
    this.assignmentCheckInterval = setInterval(() => {
      const now = Date.now();
      for (const [taskId, assignment] of this.activeAssignments) {
        // Check the task is still in a running/assigned state (not already completed)
        const task = useAppStore.getState().tasks.find((t) => t.id === taskId);
        if (!task || task.status === 'completed' || task.status === 'failed') {
          this.activeAssignments.delete(taskId);
          continue;
        }
        // assignment.assignedAt is reset each time a progress-ack arrives from the worker
        if (now - assignment.assignedAt > assignment.timeout) {
          this.addEvent('warning', `Task ${taskId.slice(0, 8)} timed out on node ${assignment.nodeId.slice(0, 8)}`);
          this.handleTaskResult(taskId, 'failed', undefined, 'Task timed out', assignment.nodeId);
        }
      }
    }, 10000);
  }

  private getTaskTimeout(type: TaskType): number {
    // These are generous timeouts — the heartbeat mechanism (progress-ack + task-token
    // messages) resets the timer continuously, so the actual risk of false-positive
    // timeout is low. These values are only the *initial* window before the first
    // heartbeat/token arrives.
    const timeouts: Record<TaskType, number> = {
      inference: 600000,   // 10 min — raw inference can be slow on mobile/integrated GPU
      'code-gen': 600000,  // 10 min — may involve large file context + chunking
      debug: 600000,       // 10 min — chunk-by-chunk analysis of large files
      test: 600000,        // 10 min
      review: 600000,      // 10 min — same as debug
      summarize: 300000,   // 5 min
    };
    return timeouts[type] || 600000;
  }

  /**
   * Extract a code block from the AI result and apply it to the task's primary related file.
   * Falls back to storing as lastGeneratedCode so the user can /apply manually.
   */
  private applyCodeResultToFile(task: Task, result: string): void {
    const store = useAppStore.getState();
    const targetPath = task.relatedFiles[0];
    if (!targetPath) return;

    // Extract the first fenced code block from the result
    const codeBlockMatch = result.match(/```(?:\w+)?\n([\s\S]*?)```/);
    const code = codeBlockMatch ? codeBlockMatch[1].trim() : null;

    if (code) {
      // Save undo snapshot before overwriting
      const existing = store.files.find((f) => f.path === targetPath);
      if (existing) {
        store.saveFileUndo(targetPath, existing.content);
        FileOps.update(targetPath, code);
        this.addEvent('success', `Applied code to ${targetPath}`);
      } else {
        FileOps.create(targetPath, code);
        this.addEvent('success', `Created ${targetPath} with generated code`);
      }
      store.setLastGeneratedCode(code, null, targetPath);
    } else {
      // No code block found — store raw result so user can /apply or inspect manually
      store.setLastGeneratedCode(result, null, targetPath);
      this.addEvent('info', `Task result stored — use /apply to write to ${targetPath}`);
    }
  }

  private addEvent(type: 'info' | 'success' | 'warning' | 'error' | 'mesh', message: string): void {
    useAppStore.getState().addEvent({
      id: generateId(),
      type,
      message,
      timestamp: Date.now(),
    });
  }

  destroy(): void {
    if (this.assignmentCheckInterval) clearInterval(this.assignmentCheckInterval);
    this.activeAssignments.clear();
  }
}
