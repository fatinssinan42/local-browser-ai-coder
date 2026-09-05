// ============================================
// AgentSystem — Real Multi-Agent Orchestration
// ============================================
// Agents use the REAL loaded LLM via InferenceService.
// Tasks are distributed across mesh peers via TaskDistributor.
// Live progress is emitted via EventBus so the terminal shows
// real-time updates (spinners, streaming tokens, status changes).

import { useAppStore } from '../stores/appStore';
import { inferenceService } from './InferenceService';
import { getMeshOrchestrator } from './MeshOrchestrator';
import { EventBus, MeshEvents } from './EventBus';
import { generateId } from '../utils/helpers';
import type { Agent, AgentRole, AgentStatus } from '../types';

// ============================================
// Agent Definitions
// ============================================

interface AgentDef {
  role: AgentRole;
  name: string;
  description: string;
  systemPrompt: string;
}

const AGENT_DEFS: AgentDef[] = [
  {
    role: 'coder',
    name: 'Coder Agent',
    description: 'Generates code from task descriptions and writes to files',
    systemPrompt: `You are a senior software engineer agent. Your job is to generate clean, production-quality code.
Output EXACTLY ONE fenced code block with the correct language tag.
The code must be COMPLETE and RUNNABLE. Never truncate with "...".`,
  },
  {
    role: 'debugger',
    name: 'Debug Agent',
    description: 'Analyzes code for bugs, errors, and security issues',
    systemPrompt: `You are a debugging specialist agent. Analyze code for:
1. Logic errors and bugs
2. Security vulnerabilities
3. Performance issues
4. Edge cases not handled
List each issue with severity (CRITICAL/HIGH/MEDIUM/LOW) and a fix suggestion.
Be concise — max 3 sentences per issue.`,
  },
  {
    role: 'reviewer',
    name: 'Review Agent',
    description: 'Reviews code quality, patterns, and best practices',
    systemPrompt: `You are a code review specialist agent. Review code for:
1. Code quality and readability
2. Best practices and design patterns
3. Naming conventions
4. Function size and complexity
5. Error handling completeness
Provide actionable feedback. Be concise.`,
  },
  {
    role: 'tester',
    name: 'Test Agent',
    description: 'Generates test cases and test files for code',
    systemPrompt: `You are a testing specialist agent. Generate comprehensive test cases.
Output EXACTLY ONE fenced code block with test code.
Cover: happy path, edge cases, error scenarios.
Use the appropriate test framework for the language.`,
  },
  {
    role: 'architect',
    name: 'Architect Agent',
    description: 'Analyzes project structure and suggests improvements',
    systemPrompt: `You are a software architect agent. Analyze the project for:
1. Overall structure and organization
2. Module coupling and cohesion
3. Scalability concerns
4. Suggested improvements
Be concise and actionable.`,
  },
  {
    role: 'context',
    name: 'Context Agent',
    description: 'Manages large context distribution across mesh nodes',
    systemPrompt: `You are a context management agent. Your job is to:
1. Summarize large codebases into digestible context
2. Identify key dependencies between files
3. Create context maps for distributed processing
Output structured summaries.`,
  },
];

// ============================================
// Agent Task — tracks each background job
// ============================================

export interface AgentTask {
  id: string;
  agentRole: AgentRole;
  prompt: string;
  targetFile: string | null;
  status: 'queued' | 'running' | 'done' | 'error';
  result: string | null;
  progress: number;
  assignedNode: string | null;
  streamedTokens: string;
  createdAt: number;
}

let taskQueue: AgentTask[] = [];
let isProcessing = false;

// ============================================
// Public API
// ============================================

export function getAgentDefs(): AgentDef[] {
  return AGENT_DEFS;
}

export function initializeAgents(): void {
  const store = useAppStore.getState();
  const existing = store.agents;

  for (const def of AGENT_DEFS) {
    if (!existing.find((a) => a.role === def.role)) {
      store.addAgent({
        id: `agent-${def.role}`,
        name: def.name,
        role: def.role,
        status: 'idle',
        description: def.description,
        currentTask: null,
        lastResult: null,
        tasksCompleted: 0,
        createdAt: Date.now(),
      });
    }
  }
}

export function getAgentByRole(role: AgentRole): Agent | undefined {
  return useAppStore.getState().agents.find((a) => a.role === role);
}

/**
 * Queue a task for a specific agent.
 * Uses the real LLM and distributes across mesh peers.
 */
export function queueAgentTask(
  role: AgentRole,
  prompt: string,
  targetFile?: string | null,
): string {
  const taskId = `atask-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const task: AgentTask = {
    id: taskId,
    agentRole: role,
    prompt,
    targetFile: targetFile || null,
    status: 'queued',
    result: null,
    progress: 0,
    assignedNode: null,
    streamedTokens: '',
    createdAt: Date.now(),
  };
  taskQueue.push(task);

  // Emit queued event for live terminal
  EventBus.emit(MeshEvents.AGENT_STARTED, {
    taskId,
    role,
    agentName: AGENT_DEFS.find(d => d.role === role)?.name || role,
    status: 'queued',
  });

  processQueue();
  return taskId;
}

/**
 * Run debug, review, and test agents on a file in parallel.
 */
export function runAllAgentsOnFile(filePath: string): string[] {
  const store = useAppStore.getState();
  const file = store.files.find((f) => f.path === filePath);
  if (!file) return [];

  const taskIds: string[] = [];
  const content = file.content;
  const lang = file.language;

  taskIds.push(
    queueAgentTask('debugger', `Analyze this ${lang} file for bugs:\n\`\`\`${lang}\n${content}\`\`\``, filePath),
  );
  taskIds.push(
    queueAgentTask('reviewer', `Review this ${lang} code:\n\`\`\`${lang}\n${content}\`\`\``, filePath),
  );
  taskIds.push(
    queueAgentTask('tester', `Generate tests for this ${lang} file:\n\`\`\`${lang}\n${content}\`\`\``, filePath),
  );

  return taskIds;
}

/**
 * Get all tasks (for status display).
 */
export function getAgentTasks(): AgentTask[] {
  return [...taskQueue];
}

/**
 * Get a single task by ID.
 */
export function getAgentTask(taskId: string): AgentTask | undefined {
  return taskQueue.find(t => t.id === taskId);
}

/**
 * Get formatted status summary of all agents.
 */
export function getAgentsSummary(): string {
  const store = useAppStore.getState();
  const agents = store.agents;
  if (agents.length === 0) return 'No agents initialized. Use `/agents init` to start.';

  let msg = '**Background Agents:**\n\n';
  for (const agent of agents) {
    const icon = agent.status === 'idle' ? '⚪' : agent.status === 'working' ? '🔵' : agent.status === 'done' ? '🟢' : '🔴';
    msg += `${icon} **${agent.name}** — ${agent.status}`;
    if (agent.currentTask) msg += ` — ${agent.currentTask}`;
    msg += ` — ${agent.tasksCompleted} tasks done\n`;
  }

  const pending = taskQueue.filter((t) => t.status === 'queued').length;
  const running = taskQueue.filter((t) => t.status === 'running').length;
  if (pending > 0 || running > 0) {
    msg += `\nQueue: ${running} running, ${pending} pending`;
  }

  // Show mesh info
  const peers = store.nodes.filter(n => !n.isSelf && n.status === 'online');
  if (peers.length > 0) {
    msg += `\n\n**Mesh:** ${peers.length} peer(s) available for task distribution`;
    for (const p of peers) {
      const busy = p.currentTask ? ` — working on: ${p.currentTask}` : ' — idle';
      msg += `\n  ${p.name}${busy}`;
    }
  }

  return msg;
}

// ============================================
// Internal Queue Processor — real LLM + mesh
// ============================================

async function processQueue(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  while (taskQueue.some((t) => t.status === 'queued')) {
    // Find tasks that can run in parallel (different agent roles)
    const runningRoles = new Set(
      taskQueue.filter(t => t.status === 'running').map(t => t.agentRole)
    );

    const nextTasks = taskQueue.filter(
      t => t.status === 'queued' && !runningRoles.has(t.agentRole)
    );

    if (nextTasks.length === 0) {
      // All roles busy — wait for one to finish
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    // Run available tasks in parallel
    const promises = nextTasks.map(task => executeAgentTask(task));
    await Promise.allSettled(promises);
  }

  isProcessing = false;
}

async function executeAgentTask(task: AgentTask): Promise<void> {
  const store = useAppStore.getState();
  const agentDef = AGENT_DEFS.find((d) => d.role === task.agentRole);
  if (!agentDef) {
    task.status = 'error';
    task.result = 'Unknown agent role';
    return;
  }

  // Mark running
  task.status = 'running';
  task.progress = 5;

  store.updateAgent(`agent-${task.agentRole}`, {
    status: 'working',
    currentTask: task.prompt.slice(0, 60) + '...',
  });

  EventBus.emit(MeshEvents.AGENT_STARTED, {
    taskId: task.id,
    role: task.agentRole,
    agentName: agentDef.name,
    status: 'running',
  });

  // Decide: use mesh peer or local inference
  const assignedNode = selectNodeForAgent(task);
  task.assignedNode = assignedNode;

  try {
    let result: string;

    if (assignedNode && assignedNode !== store.selfId) {
      // Distribute to a mesh peer via TaskDistributor
      result = await executeOnPeer(task, agentDef, assignedNode);
    } else if (inferenceService.isLoaded()) {
      // Run locally with streaming
      result = await executeLocally(task, agentDef);
    } else {
      // No model anywhere — clear error
      result = `[${agentDef.name}] No model loaded on any node.\n\nLoad a model in **Settings** to enable real AI agent analysis.\nOr connect peers with loaded models via the mesh network.`;
    }

    task.result = result;
    task.status = 'done';
    task.progress = 100;

    store.updateAgent(`agent-${task.agentRole}`, {
      status: 'idle',
      currentTask: null,
      lastResult: result.slice(0, 200),
      tasksCompleted: (getAgentByRole(task.agentRole)?.tasksCompleted || 0) + 1,
    });

    EventBus.emit(MeshEvents.AGENT_COMPLETED, {
      taskId: task.id,
      role: task.agentRole,
      agentName: agentDef.name,
      result,
      assignedNode: task.assignedNode,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    task.result = `Error: ${message}`;
    task.status = 'error';
    task.progress = 0;

    store.updateAgent(`agent-${task.agentRole}`, {
      status: 'error',
      currentTask: null,
      lastResult: `Error: ${message}`,
    });

    EventBus.emit(MeshEvents.AGENT_ERROR, {
      taskId: task.id,
      role: task.agentRole,
      agentName: agentDef.name,
      error: message,
    });
  }
}

/**
 * Select the best node for this agent task.
 * Prefers peers that have a model loaded and are idle.
 * Falls back to self if no peers available.
 */
function selectNodeForAgent(task: AgentTask): string | null {
  const store = useAppStore.getState();
  const selfId = store.selfId;
  const selfHasModel = inferenceService.isLoaded();

  // Find peers with loaded models and no current task
  const availablePeers = store.nodes.filter(n =>
    !n.isSelf &&
    n.status === 'online' &&
    !n.currentTask &&
    n.vramUsed > 0 // Proxy: if VRAM used > 0, peer likely has model loaded
  );

  if (availablePeers.length === 0) {
    return selfHasModel ? selfId : null;
  }

  // If self has model and is not busy, prefer local for lower latency
  const selfNode = store.nodes.find(n => n.isSelf);
  if (selfHasModel && selfNode && !selfNode.currentTask) {
    // Distribute to peers if multiple tasks are queued (load balancing)
    const runningLocally = taskQueue.filter(
      t => t.status === 'running' && (t.assignedNode === selfId || !t.assignedNode)
    ).length;

    if (runningLocally === 0) return selfId;
    // Self is busy — pick the best peer
  }

  // Score peers: lower latency + more free VRAM = better
  const bestPeer = availablePeers.sort((a, b) => {
    const scoreA = (a.vram - a.vramUsed) / a.vram + Math.max(0, 1 - a.latency / 500);
    const scoreB = (b.vram - b.vramUsed) / b.vram + Math.max(0, 1 - b.latency / 500);
    return scoreB - scoreA;
  })[0];

  return bestPeer?.id || (selfHasModel ? selfId : null);
}

/**
 * Execute agent task locally using the loaded model with streaming tokens.
 */
async function executeLocally(task: AgentTask, agentDef: AgentDef): Promise<string> {
  const store = useAppStore.getState();
  let tokenCount = 0;

  const result = await inferenceService.generateStream(
    task.prompt,
    agentDef.systemPrompt,
    (token: string) => {
      tokenCount++;
      task.streamedTokens += token;
      task.progress = Math.min(95, 5 + Math.round((tokenCount / 300) * 90));

      // Emit token event for live terminal streaming
      EventBus.emit(MeshEvents.AGENT_TOKEN, {
        taskId: task.id,
        role: task.agentRole,
        agentName: agentDef.name,
        token,
        progress: task.progress,
        tokenCount,
      });

      // Update store progress periodically (not every token — performance)
      if (tokenCount % 10 === 0) {
        store.updateAgent(`agent-${task.agentRole}`, {
          currentTask: `Generating... (${tokenCount} tokens)`,
        });
      }
    },
  );

  return result;
}

/**
 * Execute agent task on a mesh peer via P2P protocol.
 * Sends the task to the peer and waits for the result.
 */
async function executeOnPeer(
  task: AgentTask,
  agentDef: AgentDef,
  peerId: string,
): Promise<string> {
  const orchestrator = getMeshOrchestrator();
  const store = useAppStore.getState();
  const peerNode = store.nodes.find(n => n.id === peerId);
  const peerName = peerNode?.name || peerId.slice(0, 8);

  EventBus.emit(MeshEvents.AGENT_PROGRESS, {
    taskId: task.id,
    role: task.agentRole,
    agentName: agentDef.name,
    message: `Offloading to ${peerName}...`,
    progress: 10,
  });

  task.progress = 10;

  return new Promise<string>((resolve, reject) => {
    const requestId = task.id;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Peer ${peerName} timed out after 120s`));
    }, 120000);

    // Listen for result from peer
    const handler = (message: any) => {
      if (message.payload?.requestId === requestId) {
        clearTimeout(timeout);
        cleanup();

        if (message.payload.error) {
          reject(new Error(message.payload.error));
        } else {
          task.progress = 100;
          EventBus.emit(MeshEvents.AGENT_PROGRESS, {
            taskId: task.id,
            role: task.agentRole,
            agentName: agentDef.name,
            message: `Completed on ${peerName}`,
            progress: 100,
          });
          resolve(message.payload.result);
        }
      }
    };

    const cleanup = () => {
      orchestrator.p2p.off('result', handler);
    };

    orchestrator.p2p.on('result', handler);

    // Send inference request to peer
    orchestrator.p2p.send(peerId, {
      type: 'task',
      payload: {
        action: 'inference',
        requestId,
        prompt: task.prompt,
        systemPrompt: agentDef.systemPrompt,
        maxTokens: 2048,
        temperature: 0.7,
      },
    });

    // Progress updates while waiting
    let progressTick = 10;
    const progressInterval = setInterval(() => {
      progressTick = Math.min(90, progressTick + 5);
      task.progress = progressTick;
      EventBus.emit(MeshEvents.AGENT_PROGRESS, {
        taskId: task.id,
        role: task.agentRole,
        agentName: agentDef.name,
        message: `Running on ${peerName}... ${progressTick}%`,
        progress: progressTick,
      });
    }, 3000);

    // Clean up progress interval on resolve/reject
    const origResolve = resolve;
    const origReject = reject;
    resolve = (val) => { clearInterval(progressInterval); origResolve(val); };
    reject = (err) => { clearInterval(progressInterval); origReject(err); };
  });
}
