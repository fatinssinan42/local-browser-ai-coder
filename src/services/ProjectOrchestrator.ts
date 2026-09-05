// ============================================
// ProjectOrchestrator — Distributed Project Building
// ============================================
// Decomposes a user prompt into subtasks, distributes them across
// the P2P mesh in parallel, handles fault tolerance, and aggregates
// results into a synchronized virtual file system.

import { get, set, del } from 'idb-keyval';
import { useAppStore } from '../stores/appStore';
import { generateId } from '../utils/helpers';
import { EventBus, MeshEvents } from './EventBus';
import type { P2PManager } from './P2PManager';
import type { InferenceEngine } from './InferenceEngine';
import type { TaskDistributor } from './TaskDistributor';
import type {
  ProjectSession,
  ProjectSubtask,
  ProjectAuditEntry,
  ProjectAuditEvent,
  SubtaskCategory,
  PeerNode,
} from '../types';

const IDB_PROJECT_KEY = 'southstack-project-session';
const SUBTASK_TIMEOUT_MS = 180_000; // 3 minutes per subtask
const MAX_RETRY_COUNT = 2;
const SESSION_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

export class ProjectOrchestrator {
  private p2p: P2PManager;
  private inference: InferenceEngine | null = null;
  private taskDistributor: TaskDistributor;
  private activeAssignments: Map<string, { nodeId: string; assignedAt: number }> = new Map();
  private assignmentMonitor: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(p2p: P2PManager, taskDistributor: TaskDistributor) {
    this.p2p = p2p;
    this.taskDistributor = taskDistributor;
    this.setupListeners();
    this.startAssignmentMonitor();
  }

  setInferenceEngine(engine: InferenceEngine): void {
    this.inference = engine;
  }

  // ------------------------------------------
  // Log line emitter — streams micro-details to terminal
  // ------------------------------------------

  private log(
    sessionId: string,
    level: 'info' | 'assign' | 'running' | 'done' | 'fail' | 'requeue' | 'warn' | 'complete',
    text: string,
    meta?: { node?: string; file?: string; done?: number; total?: number },
  ): void {
    EventBus.emit(MeshEvents.PROJECT_LOG_LINE, {
      sessionId,
      level,
      text,
      node: meta?.node,
      file: meta?.file,
      done: meta?.done,
      total: meta?.total,
      ts: Date.now(),
    });
  }

  // ------------------------------------------
  // Public API
  // ------------------------------------------

  async startSession(prompt: string): Promise<void> {
    const store = useAppStore.getState();
    const selfId = this.p2p.getSelfId();

    // Only master can start a project session
    if (store.masterId && store.masterId !== selfId) {
      store.addEvent({
        id: `proj-${Date.now()}`,
        type: 'warning',
        message: 'Only the master node can start a project build.',
        timestamp: Date.now(),
      });
      return;
    }

    const sessionId = `proj-${generateId()}`;
    const now = Date.now();

    const session: ProjectSession = {
      id: sessionId,
      prompt,
      status: 'decomposing',
      subtasks: [],
      auditLog: [],
      completedFiles: {},
      totalSubtasks: 0,
      completedCount: 0,
      failedCount: 0,
      startedAt: now,
      completedAt: null,
      masterNodeId: selfId,
    };

    store.setProjectSession(session);
    this.appendAudit(sessionId, 'session_started', null, null, null, `Project build started: "${prompt.slice(0, 80)}"`);
    this.log(sessionId, 'info', `Build started — decomposing prompt...`);

    store.addEvent({
      id: `proj-start-${now}`,
      type: 'mesh',
      message: `Project build started: "${prompt.slice(0, 60)}..."`,
      timestamp: now,
    });

    EventBus.emit(MeshEvents.PROJECT_SESSION_STARTED, { sessionId, prompt });

    // Decompose the prompt into subtasks — only decomposition errors should fail the session
    let subtasks: ProjectSubtask[];
    try {
      subtasks = await this.decomposePrompt(prompt, sessionId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      store.updateProjectSession({ status: 'failed' });
      this.appendAudit(sessionId, 'session_failed', null, null, null, `Decomposition failed: ${msg}`);
      store.addEvent({
        id: `proj-fail-${Date.now()}`,
        type: 'error',
        message: `Project decomposition failed: ${msg}`,
        timestamp: Date.now(),
      });
      EventBus.emit(MeshEvents.PROJECT_SESSION_FAILED, { sessionId });
      return;
    }

    store.updateProjectSession({
      status: 'running',
      subtasks,
      totalSubtasks: subtasks.length,
    });

    this.appendAudit(sessionId, 'decomposed', null, null, null, `Decomposed into ${subtasks.length} subtasks`);
    this.log(sessionId, 'info', `Decomposed into ${subtasks.length} subtasks:`, { total: subtasks.length, done: 0 });
    subtasks.forEach((s, i) => {
      this.log(sessionId, 'info', `  [${i + 1}] ${s.category.toUpperCase()} — "${s.title}" → ${s.outputFile}`);
    });
    this.log(sessionId, 'info', `Dispatching to available nodes...`);

    // IDB persistence and scheduling are non-critical — failures here must NOT kill the session
    try { await this.saveSession(); } catch { /* IndexedDB unavailable — session continues in memory */ }

    // Broadcast full session state to all peers so their terminals show live progress
    try { this.broadcastSessionState(); } catch { /* non-critical */ }

    try { this.scheduleNextSubtasks(); } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(sessionId, 'warn', `Scheduling error (non-fatal): ${msg}`);
    }
  }

  // Broadcast the full session snapshot to all peers so every node's
  // Project Builder and terminal show live progress (not just the master).
  private broadcastSessionState(): void {
    const session = useAppStore.getState().projectSession;
    if (!session) return;
    this.p2p.broadcast({
      type: 'project-state-sync',
      payload: {
        session: {
          id: session.id,
          prompt: session.prompt,
          status: session.status,
          subtasks: session.subtasks,
          auditLog: session.auditLog,
          totalSubtasks: session.totalSubtasks,
          completedCount: session.completedCount,
          failedCount: session.failedCount,
          startedAt: session.startedAt,
          completedAt: session.completedAt,
          masterNodeId: session.masterNodeId,
        },
      },
    });
  }

  cancelSession(): void {
    const store = useAppStore.getState();
    if (!store.projectSession) return;
    store.updateProjectSession({ status: 'failed', completedAt: Date.now() });
    this.activeAssignments.clear();
    this.saveSession();
    store.addEvent({
      id: `proj-cancel-${Date.now()}`,
      type: 'warning',
      message: 'Project build cancelled.',
      timestamp: Date.now(),
    });
  }

  async recoverSession(): Promise<boolean> {
    try {
      const saved = await get<ProjectSession>(IDB_PROJECT_KEY);
      if (!saved) return false;

      // Discard stale sessions
      if (Date.now() - saved.startedAt > SESSION_MAX_AGE_MS) {
        await del(IDB_PROJECT_KEY);
        return false;
      }

      // Only recover running/decomposing sessions
      if (saved.status !== 'running' && saved.status !== 'decomposing') return false;

      const store = useAppStore.getState();

      // Re-mark any assigned/running tasks as pending
      const recoveredSubtasks = saved.subtasks.map((s) =>
        (s.status === 'assigned' || s.status === 'running')
          ? { ...s, status: 'pending' as const, assignedNodeId: null, assignedNodeName: null, updatedAt: Date.now() }
          : s,
      );

      const recovered: ProjectSession = {
        ...saved,
        status: 'running',
        subtasks: recoveredSubtasks,
      };

      store.setProjectSession(recovered);
      this.appendAudit(saved.id, 'recovered', null, null, null, 'Session recovered after master change');

      store.addEvent({
        id: `proj-recover-${Date.now()}`,
        type: 'mesh',
        message: `Project session recovered: ${recovered.completedCount}/${recovered.totalSubtasks} subtasks done`,
        timestamp: Date.now(),
      });

      await this.saveSession();
      this.scheduleNextSubtasks();
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------
  // Prompt Decomposition via LLM
  // ------------------------------------------

  private async decomposePrompt(prompt: string, sessionId: string): Promise<ProjectSubtask[]> {
    const systemPrompt = `You are a software architect. Decompose the user's project request into implementation subtasks.
Respond with ONLY a valid JSON array. Each item must have exactly these fields:
{
  "category": one of [ui, api, database, auth, testing, docs, config, logic, types, styles, util],
  "title": "short title",
  "description": "detailed instructions for code generation",
  "outputFile": "relative/path/to/file.ext",
  "language": "typescript|css|json|markdown|etc",
  "dependsOn": []
}
Generate 4–12 subtasks. dependsOn contains titles of other subtasks this one requires. Keep it minimal.`;

    const userPrompt = `Project request: ${prompt}\n\nGenerate the JSON subtask array now:`;

    let rawJson = '';

    if (this.inference?.isModelLoaded()) {
      rawJson = await this.inference.generate({
        id: `decompose-${sessionId}`,
        prompt: userPrompt,
        systemPrompt,
        maxTokens: 2048,
        temperature: 0.3,
      });
    } else {
      // Fallback decomposition when no model is loaded
      return this.fallbackDecomposition(prompt, sessionId);
    }

    return this.parseSubtasksFromJson(rawJson, sessionId);
  }

  private parseSubtasksFromJson(raw: string, sessionId: string): ProjectSubtask[] {
    // Extract JSON from markdown code fence or raw text
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    const jsonStr = fenceMatch ? fenceMatch[1] : raw.trim();

    // Find the array bounds
    const start = jsonStr.indexOf('[');
    const end = jsonStr.lastIndexOf(']');
    if (start === -1 || end === -1) {
      throw new Error('No JSON array found in LLM response');
    }

    const arr = JSON.parse(jsonStr.slice(start, end + 1)) as Array<{
      category: SubtaskCategory;
      title: string;
      description: string;
      outputFile: string;
      language: string;
      dependsOn?: string[];
    }>;

    const now = Date.now();
    // Build a title→id map to resolve dependsOn references
    const idMap = new Map<string, string>();
    arr.forEach((item) => {
      idMap.set(item.title, `subtask-${generateId()}`);
    });

    // Build a case-insensitive, trimmed lookup so LLM title variations still resolve
    const normalise = (s: string) => s.toLowerCase().trim();
    const normIdMap = new Map<string, string>();
    idMap.forEach((id, title) => normIdMap.set(normalise(title), id));

    return arr.map((item) => ({
      id: idMap.get(item.title)!,
      sessionId,
      category: item.category || 'logic',
      title: item.title,
      description: item.description,
      outputFile: item.outputFile,
      language: item.language || 'typescript',
      // Resolve deps: exact match first, then case-insensitive, then drop unresolvable ones
      // (unresolvable deps would permanently block a subtask — safer to drop than to deadlock)
      dependsOn: (item.dependsOn || [])
        .map((dep) => idMap.get(dep) ?? normIdMap.get(normalise(dep)) ?? null)
        .filter((id): id is string => id !== null),
      status: 'pending' as const,
      assignedNodeId: null,
      assignedNodeName: null,
      result: null,
      error: null,
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    }));
  }

  private fallbackDecomposition(prompt: string, sessionId: string): ProjectSubtask[] {
    const now = Date.now();
    const makeId = () => `subtask-${generateId()}`;

    const typesId = makeId();
    const logicId = makeId();
    const apiId = makeId();
    const testId = makeId();

    return [
      {
        id: typesId, sessionId, category: 'types', title: 'Type Definitions',
        description: `Define TypeScript interfaces and types for: ${prompt}`,
        outputFile: 'src/types/index.ts', language: 'typescript',
        dependsOn: [], status: 'pending', assignedNodeId: null, assignedNodeName: null,
        result: null, error: null, retryCount: 0, createdAt: now, updatedAt: now, completedAt: null,
      },
      {
        id: logicId, sessionId, category: 'logic', title: 'Core Logic',
        description: `Implement the core business logic for: ${prompt}`,
        outputFile: 'src/lib/core.ts', language: 'typescript',
        dependsOn: [typesId], status: 'pending', assignedNodeId: null, assignedNodeName: null,
        result: null, error: null, retryCount: 0, createdAt: now, updatedAt: now, completedAt: null,
      },
      {
        id: apiId, sessionId, category: 'api', title: 'API Layer',
        description: `Create API routes and handlers for: ${prompt}`,
        outputFile: 'src/api/routes.ts', language: 'typescript',
        dependsOn: [logicId], status: 'pending', assignedNodeId: null, assignedNodeName: null,
        result: null, error: null, retryCount: 0, createdAt: now, updatedAt: now, completedAt: null,
      },
      {
        id: testId, sessionId, category: 'testing', title: 'Unit Tests',
        description: `Write unit tests covering the main functionality for: ${prompt}`,
        outputFile: 'src/__tests__/core.test.ts', language: 'typescript',
        dependsOn: [logicId], status: 'pending', assignedNodeId: null, assignedNodeName: null,
        result: null, error: null, retryCount: 0, createdAt: now, updatedAt: now, completedAt: null,
      },
    ];
  }

  // ------------------------------------------
  // Task Queue & Distribution
  // ------------------------------------------

  private scheduleNextSubtasks(): void {
    if (this.destroyed) return;
    const store = useAppStore.getState();
    const session = store.projectSession;
    if (!session || session.status !== 'running') return;

    // Find subtasks that are ready (all dependencies completed)
    const completedIds = new Set(
      session.subtasks.filter((s) => s.status === 'completed').map((s) => s.id),
    );

    const dispatchable = session.subtasks.filter((s) => {
      if (s.status !== 'pending') return false;
      return s.dependsOn.every((depId) => completedIds.has(depId));
    });

    for (const subtask of dispatchable) {
      this.assignSubtask(subtask, session);
    }
  }

  private assignSubtask(subtask: ProjectSubtask, session: ProjectSession): void {
    const store = useAppStore.getState();
    const node = this.pickFreeNode();

    if (!node) {
      // No free node right now — scheduleNextSubtasks will retry when one frees up
      return;
    }

    // Build dependency outputs
    const dependencyOutputs: Record<string, string> = {};
    for (const depId of subtask.dependsOn) {
      if (session.completedFiles) {
        const depSubtask = session.subtasks.find((s) => s.id === depId);
        if (depSubtask?.outputFile && session.completedFiles[depSubtask.outputFile]) {
          dependencyOutputs[depId] = session.completedFiles[depSubtask.outputFile];
        }
      }
    }

    // Mark as assigned
    store.upsertProjectSubtask({
      ...subtask,
      status: 'assigned',
      assignedNodeId: node.id,
      assignedNodeName: node.name,
      updatedAt: Date.now(),
    });

    this.activeAssignments.set(subtask.id, { nodeId: node.id, assignedAt: Date.now() });

    store.updateNode(node.id, { currentTask: subtask.title });

    this.appendAudit(
      session.id, 'subtask_assigned',
      subtask.id, node.id, node.name,
      `"${subtask.title}" → ${node.name}`,
    );

    const isSelf = node.id === this.p2p.getSelfId();
    this.log(session.id, 'assign',
      `[ASSIGNED] "${subtask.title}" → ${node.name}${isSelf ? ' (this node)' : ''}`,
      { node: node.name, file: subtask.outputFile },
    );

    EventBus.emit(MeshEvents.PROJECT_SUBTASK_UPDATED, { subtaskId: subtask.id });

    if (node.id === this.p2p.getSelfId()) {
      // Execute locally — errors are caught inside executeSubtaskLocally
      const updatedSubtask = { ...subtask, assignedNodeId: node.id, assignedNodeName: node.name };
      this.executeSubtaskLocally(updatedSubtask, dependencyOutputs, session.id);
    } else {
      // Send to remote worker
      try {
        this.p2p.send(node.id, {
          type: 'project-subtask',
          payload: {
            sessionId: session.id,
            subtask: { ...subtask, assignedNodeId: node.id, assignedNodeName: node.name },
            dependencyOutputs,
          },
        });
      } catch (err: unknown) {
        // P2P send failed — treat as immediate failure so it gets requeued
        const msg = err instanceof Error ? err.message : String(err);
        this.handleSubtaskResult(subtask, session.id, false, null, `P2P send failed: ${msg}`);
        return;
      }
    }

    try { this.broadcastStatus(); } catch { /* non-critical */ }
    try { this.saveSession(); } catch { /* non-critical */ }
  }

  private async executeSubtaskLocally(
    subtask: ProjectSubtask,
    dependencyOutputs: Record<string, string>,
    sessionId: string,
  ): Promise<void> {
    const store = useAppStore.getState();

    store.upsertProjectSubtask({ ...subtask, status: 'running', updatedAt: Date.now() });

    const nodeDisplay = subtask.assignedNodeName || 'this node';
    this.log(subtask.sessionId, 'running',
      `[RUNNING] ${nodeDisplay} → generating ${subtask.outputFile}...`,
      { node: nodeDisplay, file: subtask.outputFile },
    );

    // Build the code-gen prompt
    const depContext = Object.values(dependencyOutputs).length > 0
      ? `\n\nExisting code to reference:\n${Object.entries(dependencyOutputs)
          .map(([, code]) => `\`\`\`\n${code.slice(0, 800)}\n\`\`\``)
          .join('\n')}`
      : '';

    const prompt = `${subtask.description}${depContext}\n\nGenerate the complete ${subtask.language} file for: ${subtask.outputFile}
Respond with ONLY the code, no explanation.`;

    if (!this.inference?.isModelLoaded()) {
      // Placeholder when no model loaded
      this.handleSubtaskResult(subtask, sessionId, true, `// ${subtask.title}\n// TODO: Implement ${subtask.description}`, null);
      return;
    }

    try {
      store.upsertProjectSubtask({ ...subtask, status: 'running', updatedAt: Date.now() });

      const code = await this.inference.generate({
        id: subtask.id,
        prompt,
        systemPrompt: `You are an expert ${subtask.language} developer. Generate only clean, production-ready code. No markdown, no explanations — just the code.`,
        maxTokens: 2048,
        temperature: 0.2,
      });

      // Strip markdown code fences if present
      const cleanCode = this.extractCode(code);
      this.handleSubtaskResult(subtask, sessionId, true, cleanCode, null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.handleSubtaskResult(subtask, sessionId, false, null, msg);
    }
  }

  private extractCode(raw: string): string {
    const fenceMatch = raw.match(/```(?:\w+)?\s*([\s\S]+?)\s*```/);
    return fenceMatch ? fenceMatch[1] : raw.trim();
  }

  handleSubtaskResult(
    subtask: ProjectSubtask,
    sessionId: string,
    success: boolean,
    code: string | null,
    error: string | null,
  ): void {
    const store = useAppStore.getState();
    const session = store.projectSession;
    if (!session || session.id !== sessionId) return;

    this.activeAssignments.delete(subtask.id);
    store.updateNode(subtask.assignedNodeId || '', { currentTask: null });

    if (success && code) {
      store.upsertProjectSubtask({
        ...subtask,
        status: 'completed',
        result: code,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Write to virtual FS
      const existingFile = store.files.find((f) => f.path === subtask.outputFile);
      const file = {
        path: subtask.outputFile,
        content: code,
        language: subtask.language,
        lastModified: Date.now(),
        producedBy: subtask.assignedNodeId || undefined,
        version: existingFile ? existingFile.version + 1 : 1,
      };

      if (existingFile) {
        store.updateFile(subtask.outputFile, file);
      } else {
        store.addFile(file);
      }

      // Track completed file in session — read fresh state to avoid race conditions
      const freshSession = useAppStore.getState().projectSession;
      const newDone = (freshSession?.completedCount ?? session.completedCount) + 1;
      store.updateProjectSession({
        completedCount: newDone,
        completedFiles: { ...(freshSession?.completedFiles ?? session.completedFiles), [subtask.outputFile]: code },
      });

      this.appendAudit(
        sessionId, 'subtask_completed',
        subtask.id, subtask.assignedNodeId, subtask.assignedNodeName,
        `"${subtask.title}" → ${subtask.outputFile}`,
      );
      this.log(sessionId, 'done',
        `[DONE] ${subtask.assignedNodeName || 'node'} completed "${subtask.title}" → ${subtask.outputFile} (${code.length} chars)`,
        { node: subtask.assignedNodeName || undefined, file: subtask.outputFile, done: newDone, total: session.totalSubtasks },
      );

      store.addEvent({
        id: `proj-done-${Date.now()}-${subtask.id.slice(-4)}`,
        type: 'success',
        message: `Generated: ${subtask.outputFile}`,
        nodeId: subtask.assignedNodeId || undefined,
        timestamp: Date.now(),
      });

    } else {
      // Handle failure
      const retryCount = subtask.retryCount + 1;
      if (retryCount <= MAX_RETRY_COUNT) {
        store.upsertProjectSubtask({
          ...subtask,
          status: 'requeued',
          retryCount,
          error: error || 'Unknown error',
          assignedNodeId: null,
          assignedNodeName: null,
          updatedAt: Date.now(),
        });

        this.appendAudit(
          sessionId, 'subtask_requeued',
          subtask.id, subtask.assignedNodeId, subtask.assignedNodeName,
          `"${subtask.title}" requeued (attempt ${retryCount}/${MAX_RETRY_COUNT}): ${error}`,
        );
        this.log(sessionId, 'requeue',
          `[REQUEUE] "${subtask.title}" failed on ${subtask.assignedNodeName || 'node'} — retry ${retryCount}/${MAX_RETRY_COUNT}: ${(error || '').slice(0, 80)}`,
          { node: subtask.assignedNodeName || undefined },
        );

        // Re-mark as pending after a short delay so it gets picked up
        setTimeout(() => {
          const st = useAppStore.getState().projectSession?.subtasks.find((s) => s.id === subtask.id);
          if (st && st.status === 'requeued') {
            useAppStore.getState().upsertProjectSubtask({ ...st, status: 'pending', updatedAt: Date.now() });
            this.scheduleNextSubtasks();
          }
        }, 2000);

      } else {
        store.upsertProjectSubtask({
          ...subtask,
          status: 'failed',
          error: error || 'Max retries exceeded',
          updatedAt: Date.now(),
        });

        store.updateProjectSession({ failedCount: session.failedCount + 1 });

        this.appendAudit(
          sessionId, 'subtask_failed',
          subtask.id, subtask.assignedNodeId, subtask.assignedNodeName,
          `"${subtask.title}" permanently failed: ${error}`,
        );
        this.log(sessionId, 'fail',
          `[FAILED] "${subtask.title}" — max retries exceeded: ${(error || '').slice(0, 100)}`,
          { node: subtask.assignedNodeName || undefined, file: subtask.outputFile },
        );

        store.addEvent({
          id: `proj-fail-${Date.now()}-${subtask.id.slice(-4)}`,
          type: 'error',
          message: `Failed: ${subtask.title} — ${error?.slice(0, 80)}`,
          timestamp: Date.now(),
        });
      }
    }

    EventBus.emit(MeshEvents.PROJECT_SUBTASK_UPDATED, { subtaskId: subtask.id });

    this.saveSession();
    // Keep all peer terminals in sync after every result
    try { this.broadcastSessionState(); } catch { /* non-critical */ }
    this.scheduleNextSubtasks();
    this.checkSessionCompletion();
  }

  private checkSessionCompletion(): void {
    const store = useAppStore.getState();
    const session = store.projectSession;
    if (!session || session.status !== 'running') return;

    const subtasks = session.subtasks;
    const allDone = subtasks.every((s) =>
      s.status === 'completed' || s.status === 'failed',
    );
    const hasActive = subtasks.some((s) =>
      s.status === 'pending' || s.status === 'assigned' || s.status === 'running' || s.status === 'requeued',
    );

    if (!allDone || hasActive) return;

    const completedAt = Date.now();
    store.updateProjectSession({ status: 'completed', completedAt });

    this.appendAudit(
      session.id, 'session_completed', null, null, null,
      `Build complete: ${session.completedCount + 1}/${session.totalSubtasks} subtasks succeeded`,
    );

    const finalSession = useAppStore.getState().projectSession!;
    this.log(session.id, 'complete',
      `[BUILD COMPLETE] ${finalSession.completedCount}/${session.totalSubtasks} subtasks succeeded${session.failedCount > 0 ? `, ${session.failedCount} failed` : ''} — ${Object.keys(session.completedFiles).length} files generated`,
      { done: finalSession.completedCount, total: session.totalSubtasks },
    );

    store.addEvent({
      id: `proj-complete-${completedAt}`,
      type: 'success',
      message: `Project build complete! ${Object.keys(session.completedFiles).length} files generated.`,
      timestamp: completedAt,
    });

    // Broadcast final result to all peers
    const files = Object.entries(session.completedFiles).map(([path, content]) => ({
      path,
      content,
      language: this.guessLanguage(path),
    }));
    this.p2p.broadcast({
      type: 'project-broadcast',
      payload: {
        sessionId: session.id,
        prompt: session.prompt,
        files,
        auditLog: finalSession.auditLog,
        totalSubtasks: session.totalSubtasks,
        completedCount: finalSession.completedCount,
        failedCount: finalSession.failedCount,
        completedAt,
      },
    });

    EventBus.emit(MeshEvents.PROJECT_SESSION_COMPLETED, { sessionId: session.id });
    this.saveSession();

    // Auto-open the entry-point file in the editor
    this.openEntryPointFile(session.completedFiles);
  }

  private openEntryPointFile(completedFiles: Record<string, string>): void {
    if (Object.keys(completedFiles).length === 0) return;

    // Priority order for entry-point detection
    const entryPointCandidates = [
      'index.html',
      'src/index.html',
      'public/index.html',
      'index.tsx',
      'src/index.tsx',
      'src/main.tsx',
      'main.tsx',
      'index.ts',
      'src/index.ts',
      'src/main.ts',
      'main.ts',
      'index.js',
      'src/index.js',
      'src/main.js',
      'main.js',
      'app.js',
      'App.tsx',
      'src/App.tsx',
      'app.py',
      'main.py',
    ];

    const paths = Object.keys(completedFiles);

    // Find first matching candidate
    let entryPoint: string | null = null;
    for (const candidate of entryPointCandidates) {
      const match = paths.find(
        (p) => p === candidate || p.endsWith('/' + candidate),
      );
      if (match) { entryPoint = match; break; }
    }

    // Fallback: first .html, then first .tsx, then first file
    if (!entryPoint) {
      entryPoint =
        paths.find((p) => p.endsWith('.html')) ||
        paths.find((p) => p.endsWith('.tsx')) ||
        paths.find((p) => p.endsWith('.ts')) ||
        paths[0];
    }

    if (entryPoint) {
      const store = useAppStore.getState();
      store.setActiveFilePath(entryPoint);
      store.setActiveView('ide');
      store.addEvent({
        id: `proj-open-${Date.now()}`,
        type: 'info',
        message: `Opened entry point: ${entryPoint}`,
        timestamp: Date.now(),
      });
    }
  }

  // ------------------------------------------
  // Node Selection
  // ------------------------------------------

  private pickFreeNode(): PeerNode | null {
    const availableNodes = this.taskDistributor.getAvailableNodes();
    // Exclude nodes already handling a project subtask
    const busyNodeIds = new Set(
      Array.from(this.activeAssignments.values()).map((a) => a.nodeId),
    );

    const free = availableNodes.filter((n) => !busyNodeIds.has(n.id));
    if (free.length === 0) return null;

    // Prefer self if model is loaded
    const selfId = this.p2p.getSelfId();
    const store = useAppStore.getState();
    if (store.modelLoaded) {
      const self = free.find((n) => n.id === selfId);
      if (self) return self;
    }

    // Pick node with lowest VRAM usage
    return free.sort((a, b) => (a.vramUsed / Math.max(a.vram, 1)) - (b.vramUsed / Math.max(b.vram, 1)))[0];
  }

  // ------------------------------------------
  // Fault Tolerance
  // ------------------------------------------

  private setupListeners(): void {
    // Receive full session snapshot from master — keeps every peer's UI in sync
    this.p2p.on('project-state-sync', (message) => {
      const { session } = message.payload;
      if (!session) return;
      const store = useAppStore.getState();
      const selfId = this.p2p.getSelfId();

      // Workers (non-master) apply the full session so their terminal/Project Builder
      // shows the same subtask list, audit log, and progress as the master.
      if (session.masterNodeId === selfId) return; // master ignores its own broadcast

      const existing = store.projectSession;
      if (!existing || existing.id !== session.id) {
        store.setProjectSession(session);
      } else {
        // Merge: update subtasks, counters, audit log
        store.updateProjectSession({
          status: session.status,
          subtasks: session.subtasks,
          auditLog: session.auditLog,
          totalSubtasks: session.totalSubtasks,
          completedCount: session.completedCount,
          failedCount: session.failedCount,
          completedAt: session.completedAt,
        });
      }

      // Emit PROJECT_SESSION_STARTED so the terminal creates the live build card
      // if it hasn't already (idempotent — terminal checks by sessionId)
      EventBus.emit(MeshEvents.PROJECT_SESSION_STARTED, {
        sessionId: session.id,
        prompt: session.prompt,
      });
    });

    // Worker receives a subtask assignment from master
    // Execute it and send the result back to the sender (master)
    this.p2p.on('project-subtask', (message) => {
      const { sessionId, subtask, dependencyOutputs } = message.payload;
      const store = useAppStore.getState();
      const masterId = message.senderId;

      // Mirror the session so the worker UI can show progress
      if (!store.projectSession || store.projectSession.id !== sessionId) {
        store.setProjectSession({
          id: sessionId,
          prompt: '',
          status: 'running',
          subtasks: [subtask],
          auditLog: [],
          completedFiles: {},
          totalSubtasks: 0,
          completedCount: 0,
          failedCount: 0,
          startedAt: Date.now(),
          completedAt: null,
          masterNodeId: masterId,
        });
      } else {
        store.upsertProjectSubtask(subtask);
      }

      // Execute and send result back to master
      this.executeSubtaskForRemote(subtask, dependencyOutputs, sessionId, masterId);
    });

    // Master receives result from worker
    this.p2p.on('project-result', (message) => {
      const { sessionId, subtaskId, success, code, error } = message.payload;
      const store = useAppStore.getState();
      const session = store.projectSession;
      if (!session || session.id !== sessionId) return;

      const subtask = session.subtasks.find((s) => s.id === subtaskId);
      if (!subtask) return;

      this.handleSubtaskResult(subtask, sessionId, success, code, error);
    });

    // All peers receive final broadcast
    this.p2p.on('project-broadcast', (message) => {
      const { sessionId, files, auditLog, completedCount, failedCount, completedAt } = message.payload;
      const store = useAppStore.getState();

      // Merge generated files into local virtual FS
      for (const f of files) {
        const existing = store.files.find((vf) => vf.path === f.path);
        if (existing) {
          store.updateFile(f.path, { content: f.content, lastModified: completedAt, version: existing.version + 1 });
        } else {
          store.addFile({ path: f.path, content: f.content, language: f.language, lastModified: completedAt, version: 1 });
        }
      }

      // Update session if we have one
      if (store.projectSession?.id === sessionId) {
        store.updateProjectSession({ status: 'completed', completedAt, completedCount, failedCount });
      }

      store.addEvent({
        id: `proj-broadcast-${Date.now()}`,
        type: 'success',
        message: `Project build received: ${files.length} files from master`,
        timestamp: completedAt,
      });

      this.appendAudit(sessionId, 'broadcast_received', null, message.senderId, null, `${files.length} files received`);
    });

    // Handle peer disconnections — re-queue their subtasks
    EventBus.on(MeshEvents.PEER_DISCONNECTED, (nodeId: string) => {
      this.handleNodeDisconnect(nodeId);
    });

    // On master change, attempt session recovery
    EventBus.on(MeshEvents.MASTER_CHANGED, (newMasterId: string) => {
      const selfId = this.p2p.getSelfId();
      if (newMasterId === selfId) {
        this.recoverSession();
      }
    });
  }

  private async executeSubtaskForRemote(
    subtask: ProjectSubtask,
    dependencyOutputs: Record<string, string>,
    sessionId: string,
    masterId: string,
  ): Promise<void> {
    const depContext = Object.values(dependencyOutputs).length > 0
      ? `\n\nExisting code to reference:\n${Object.entries(dependencyOutputs)
          .map(([, code]) => `\`\`\`\n${code.slice(0, 800)}\n\`\`\``)
          .join('\n')}`
      : '';

    const prompt = `${subtask.description}${depContext}\n\nGenerate the complete ${subtask.language} file for: ${subtask.outputFile}\nRespond with ONLY the code, no explanation.`;

    try {
      let code: string;
      if (this.inference?.isModelLoaded()) {
        const raw = await this.inference.generate({
          id: subtask.id,
          prompt,
          systemPrompt: `You are an expert ${subtask.language} developer. Generate only clean, production-ready code.`,
          maxTokens: 2048,
          temperature: 0.2,
        });
        code = this.extractCode(raw);
      } else {
        code = `// ${subtask.title}\n// TODO: Implement ${subtask.description}`;
      }

      this.p2p.send(masterId, {
        type: 'project-result',
        payload: {
          sessionId,
          subtaskId: subtask.id,
          success: true,
          code,
          error: null,
          outputFile: subtask.outputFile,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.p2p.send(masterId, {
        type: 'project-result',
        payload: {
          sessionId,
          subtaskId: subtask.id,
          success: false,
          code: null,
          error: msg,
          outputFile: subtask.outputFile,
        },
      });
    }
  }

  private handleNodeDisconnect(nodeId: string): void {
    const store = useAppStore.getState();
    const session = store.projectSession;
    if (!session || session.status !== 'running') return;

    const lostSubtasks = session.subtasks.filter(
      (s) => s.assignedNodeId === nodeId && (s.status === 'assigned' || s.status === 'running'),
    );

    for (const subtask of lostSubtasks) {
      this.activeAssignments.delete(subtask.id);

      store.upsertProjectSubtask({
        ...subtask,
        status: 'pending',
        assignedNodeId: null,
        assignedNodeName: null,
        updatedAt: Date.now(),
      });

      this.appendAudit(
        session.id, 'node_disconnected',
        subtask.id, nodeId, null,
        `Node disconnected — "${subtask.title}" re-queued`,
      );
      this.log(session.id, 'warn',
        `[NODE LOST] ${nodeId.slice(0, 12)} disconnected — "${subtask.title}" re-queued`,
        { node: nodeId.slice(0, 12) },
      );

      store.addEvent({
        id: `proj-disconnect-${Date.now()}-${subtask.id.slice(-4)}`,
        type: 'warning',
        message: `Node disconnected — re-queuing "${subtask.title}"`,
        timestamp: Date.now(),
      });
    }

    if (lostSubtasks.length > 0) {
      this.saveSession();
      this.scheduleNextSubtasks();
    }
  }

  private startAssignmentMonitor(): void {
    this.assignmentMonitor = setInterval(() => {
      if (this.destroyed) return;
      const now = Date.now();
      const store = useAppStore.getState();
      const session = store.projectSession;

      // --- Timeout check: re-queue tasks that have been assigned too long ---
      for (const [subtaskId, assignment] of this.activeAssignments) {
        if (now - assignment.assignedAt > SUBTASK_TIMEOUT_MS) {
          this.activeAssignments.delete(subtaskId);

          if (!session) continue;

          const subtask = session.subtasks.find((s) => s.id === subtaskId);
          if (!subtask) continue;

          store.upsertProjectSubtask({
            ...subtask,
            status: 'pending',
            assignedNodeId: null,
            assignedNodeName: null,
            updatedAt: now,
          });

          this.appendAudit(
            session.id, 'subtask_requeued',
            subtaskId, assignment.nodeId, null,
            `"${subtask.title}" timed out — re-queued`,
          );
          this.log(session.id, 'warn',
            `[TIMEOUT] "${subtask.title}" on ${assignment.nodeId.slice(0, 12)} exceeded 3min — re-queued`,
            { node: assignment.nodeId.slice(0, 12) },
          );

          this.scheduleNextSubtasks();
        }
      }

      // --- Stuck-pending rescue: if the session is running and there are pending
      // tasks whose deps are all done but no active assignments, the node may have
      // freed up without triggering a reschedule. Retry scheduling every tick. ---
      if (!session || session.status !== 'running') return;

      const hasPending = session.subtasks.some((s) => s.status === 'pending');
      const hasActive = this.activeAssignments.size > 0;

      if (hasPending && !hasActive) {
        this.scheduleNextSubtasks();
      }
    }, 3_000); // Poll every 3s (was 15s) so single-node builds don't stall
  }

  // ------------------------------------------
  // Status Broadcast
  // ------------------------------------------

  private broadcastStatus(): void {
    const store = useAppStore.getState();
    const session = store.projectSession;
    if (!session) return;

    const activeNodes = Array.from(this.activeAssignments.entries()).map(([subtaskId, a]) => {
      const subtask = session.subtasks.find((s) => s.id === subtaskId);
      const node = store.nodes.find((n) => n.id === a.nodeId);
      return {
        nodeId: a.nodeId,
        nodeName: node?.name || a.nodeId,
        subtaskTitle: subtask?.title || subtaskId,
      };
    });

    this.p2p.broadcast({
      type: 'project-status',
      payload: {
        sessionId: session.id,
        completedCount: session.completedCount,
        totalSubtasks: session.totalSubtasks,
        activeNodes,
      },
    });
  }

  // ------------------------------------------
  // Persistence
  // ------------------------------------------

  private async saveSession(): Promise<void> {
    const session = useAppStore.getState().projectSession;
    if (!session) {
      await del(IDB_PROJECT_KEY);
      return;
    }
    await set(IDB_PROJECT_KEY, session);
  }

  // ------------------------------------------
  // Audit Log
  // ------------------------------------------

  private appendAudit(
    sessionId: string,
    event: ProjectAuditEvent,
    subtaskId: string | null,
    nodeId: string | null,
    nodeName: string | null,
    detail: string,
  ): void {
    const entry: ProjectAuditEntry = {
      id: `audit-${generateId()}`,
      sessionId,
      timestamp: Date.now(),
      event,
      subtaskId,
      nodeId,
      nodeName,
      detail,
    };
    useAppStore.getState().appendProjectAuditEntry(entry);
  }

  // ------------------------------------------
  // Helpers
  // ------------------------------------------

  private guessLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      css: 'css', scss: 'scss', json: 'json', md: 'markdown',
      html: 'html', py: 'python', go: 'go', rs: 'rust',
    };
    return map[ext] || 'plaintext';
  }

  destroy(): void {
    this.destroyed = true;
    if (this.assignmentMonitor) {
      clearInterval(this.assignmentMonitor);
      this.assignmentMonitor = null;
    }
  }
}
