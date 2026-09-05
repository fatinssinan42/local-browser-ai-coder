// ============================================
// CommandInterpreter — AI-Powered Code Actions
// ============================================
// Like Claude Code: every command actually DOES the work.
// "write a function" → writes it INTO the file
// "debug this" → finds bugs AND applies fixes
// "refactor" → rewrites the file
// "create app.py with a Flask server" → creates + generates real code

import { useAppStore } from '../stores/appStore';
import { FileOps } from './FileOperations';
import { inferenceService } from './InferenceService';
import { getMeshOrchestrator } from './MeshOrchestrator';
import { MAX_CHUNK_CONTENT_TOKENS } from './ContextManager';
import {
  initializeAgents,
  getAgentsSummary,
  queueAgentTask,
  runAllAgentsOnFile,
  getAgentByRole,
} from './AgentSystem';
import type { AgentRole, VirtualFile } from '../types';

// ============================================
// Types
// ============================================

export interface CommandResult {
  type: 'success' | 'error' | 'info' | 'ai-stream';
  message: string;
}

// ============================================
// Project Build Intent Detection (exported)
// ============================================
// Used by CommandTerminal to intercept natural-language prompts BEFORE
// they reach the single-task distributor, routing them through the full
// distributed ProjectOrchestrator pipeline instead.

export function isProjectBuildPrompt(input: string): boolean {
  const lower = input.toLowerCase().trim();

  // Always exclude bare file-system ops (unambiguous, no project description)
  if (
    /^(?:delete|remove|rm)\s+\S+$/.test(lower) ||
    /^(?:rename|mv|move)\s+\S+\s+(?:to|->|→)\s+\S+$/.test(lower) ||
    /^(?:open|show|view|edit)\s+\S+$/.test(lower) ||
    /^(?:list|ls|files|dir)\s*(?:files)?$/.test(lower) ||
    /^(?:read|cat|print|type)\s+\S+$/.test(lower) ||
    /^(?:create|new|touch)\s+[a-zA-Z0-9_/.\-]+\.[a-zA-Z]{1,8}\s*$/.test(lower)
  ) return false;

  // Always exclude narrow per-file actions
  if (
    /^(?:debug|analyze|check|lint)\s*(?:this|current)?\s*(?:file|code)?$/.test(lower) ||
    /^(?:explain|what does|what is|describe|how does)\s*(?:this|current|the)?\s*(?:code|file)?/.test(lower) ||
    /^fix\s+(?:line\s+)?\d+/.test(lower)
  ) return false;

  // Project-build signals — any match routes through ProjectOrchestrator
  return [
    // Build verb + project noun
    /\b(?:build|create|make|develop|write|generate|implement|design|code)\b.{0,80}\b(?:app|application|system|website|web\s*app|api|backend|frontend|server|service|platform|tool|bot|cli|dashboard|portal|game|library|framework|sdk|project|software|program|editor|viewer|parser|compiler|interpreter)\b/,
    // "a/an/the ... app/system"
    /\b(?:a|an|the)\b.{0,50}\b(?:app|application|system|website|web\s*app|api|backend|frontend|server|service|platform|tool|bot|dashboard|portal|game|library|project|software|editor|viewer|parser)\b/,
    // Multi-feature or multi-file descriptions
    /\b(?:build|create|make|develop|implement|write|design)\b.{0,100}\b(?:feature|features|functionality|endpoints?|routes?|components?|pages?|modules?|database|schema|auth|authentication|parser|renderer|converter)\b/,
    // Architecture / stack keywords
    /\b(?:full[\s-]stack|rest\s*api|crud|saas|microservice|monolith|mvc|mvvm|real[\s-]time|real\s+time|single\s+page|spa|pwa)\b/,
    // Known app types
    /\b(?:todo|task\s*manager|chat\s*app|blog|e[-\s]?commerce|social\s*media|inventory|cms|crm|erp|pos|forum|marketplace|portfolio|booking|scheduler|kanban|trello[\s-]like|slack[\s-]like|twitter[\s-]like|markdown|live\s*preview|note[\s-]taking|file\s*manager)\b/,
    // Explicit multi-step build signals
    /\b(?:step[\s-]by[\s-]step|complete\s+project|from\s+scratch|end[\s-]to[\s-]end|production[\s-]ready|compile\s+it|working\s+project|single\s+working|file\s+structure|architectural\s+plan)\b/,
    // Tech stack + project noun
    /\b(?:react|vue|angular|next\.?js|nuxt|svelte|express|fastapi|django|flask|spring|laravel|rails|vanilla\s*js|plain\s*js)\b.{0,60}\b(?:app|application|project|website|with|that|and|editor|tool)\b/,
    // Intent phrases
    /^(?:i\s+want|i\s+need|i\'m\s+building|let\'s\s+build|can\s+you\s+build|please\s+build|please\s+create|please\s+make|help\s+me\s+build|help\s+me\s+create|help\s+me\s+implement)\b/,
    // Long descriptive prompts (>80 chars) that mention code/files — high confidence project request
    /^.{80,}$/.test(lower) && /\b(?:file|files|code|function|class|component|module|css|html|javascript|typescript|python)\b/.test(lower) ? /.*/ : /(?!)/,
  ].some((p) => p.test(lower));
}

type StreamCallback = (token: string) => void;

// ============================================
// System Prompts — instruct the model to produce actionable output
// ============================================

const CODE_GEN_PROMPT = `You are SouthStack AI, an expert coding assistant embedded in an IDE.
The user wants you to write or modify code that will be DIRECTLY written to their file.

CRITICAL RULES:
1. Output EXACTLY ONE fenced code block with the correct language tag
2. The code block must contain the COMPLETE, RUNNABLE file content
3. NEVER use "..." or "// rest of code" — include EVERY line
4. If modifying existing code, return the FULL updated file (not just changed lines)
5. Put the code block FIRST, then a brief 1-2 sentence explanation after it

Format:
\`\`\`language
<complete file content>
\`\`\`
Brief explanation of what was done.`;

const DEBUG_FIX_PROMPT = `You are SouthStack AI, a code debugger embedded in an IDE.
Analyze the code for bugs, errors, and issues. Then provide a FIXED version.

CRITICAL RULES:
1. First briefly list the issues found (numbered, 1-3 sentences each)
2. Then output EXACTLY ONE fenced code block with the COMPLETE FIXED file
3. The code block must contain ALL code — the full file with fixes applied
4. NEVER truncate with "..." — include every line

Format:
Issues found:
1. [issue description]
2. [issue description]

Fixed code:
\`\`\`language
<complete fixed file content>
\`\`\``;

const EXPLAIN_PROMPT = `You are SouthStack AI, a code explainer.
Explain what this code does clearly and concisely.
Cover: purpose, key functions/classes, data flow, and any notable patterns.
Keep it under 10 sentences unless the code is very complex.`;

const GENERAL_PROMPT = `You are SouthStack AI, an expert coding assistant running locally in the user's IDE.
You help with code generation, debugging, explanations, and any programming task.

When the user asks you to write, generate, or create code:
1. Output EXACTLY ONE fenced code block with the correct language
2. The code block should contain COMPLETE, RUNNABLE code
3. Put code FIRST, then brief explanation

When answering questions or explaining, be concise and practical.`;

// ============================================
// Code Block Extraction
// ============================================

interface CodeBlock {
  code: string;
  language: string;
}

function extractFirstCodeBlock(text: string): CodeBlock | null {
  // Match ```language\n...code...\n```
  const match = text.match(/```(\w*)\s*\n([\s\S]*?)```/);
  if (!match) return null;
  return {
    language: match[1] || 'plaintext',
    code: match[2].replace(/\n$/, ''), // trim trailing newline
  };
}

// ============================================
// Intent Detection — classify what the user wants
// ============================================

interface CodeGenIntent {
  kind: 'write' | 'create-with-ai' | 'refactor' | 'add-to-file';
  prompt: string;
  targetFile: string | null;
}

function detectCodeGenIntent(input: string): CodeGenIntent | null {
  const lower = input.toLowerCase().trim();

  // --- "create <file> with/that/containing <description>" → create file + AI content ---
  const createWithAI = input.match(
    /^(?:create|make|new)\s+([a-zA-Z0-9_/.\-]+\.[a-zA-Z]{1,8})\s+(?:with|that|which|having|containing|as|for|to)\s+(.+)/i
  );
  if (createWithAI) {
    return { kind: 'create-with-ai', prompt: createWithAI[2].trim(), targetFile: createWithAI[1].trim() };
  }

  // --- Refactor/rewrite/optimize/fix all ---
  if (/^(rewrite|refactor|optimize|improve|clean\s*up|modernize|convert|restructure)\b/.test(lower)) {
    const file = extractFileFromText(input);
    return { kind: 'refactor', prompt: input, targetFile: file };
  }

  // --- "add X to <file>" ---
  const addMatch = input.match(
    /^add\s+(.+?)\s+(?:to|into)\s+(?:the\s+)?(?:current\s+file|this\s+file|([a-zA-Z0-9_/.\-]+\.[a-zA-Z]{1,8}))/i
  );
  if (addMatch) {
    return { kind: 'add-to-file', prompt: input, targetFile: addMatch[2] || null };
  }

  // --- Write/generate/implement/build/code ---
  const writePatterns = [
    /^(write|generate|implement|build|code|program|develop)\s+/,
    /^(create\s+(?:a\s+)?(?:function|class|component|module|hook|route|endpoint|api|interface|type|enum|middleware|handler|helper|service|util|schema|model|struct|test))\b/,
    /^(add\s+(?:a\s+)?(?:function|class|method|component|feature|handler|test|route|endpoint|middleware|hook|type|interface))\b/,
    /^(make\s+(?:a\s+)?(?:function|class|component|page|form|modal|table|card|button|list|menu|nav|sidebar|header|footer))\b/,
  ];

  for (const pat of writePatterns) {
    if (pat.test(lower)) {
      const file = extractFileFromText(input);
      return { kind: 'write', prompt: input, targetFile: file };
    }
  }

  // --- Broad heuristic: if asking for code and a file is open ---
  if (/\b(write|generate|create|implement|give me|i need|can you)\b.*\b(function|class|code|component|script|program|module|method|api|endpoint|route)\b/.test(lower)) {
    const file = extractFileFromText(input);
    return { kind: 'write', prompt: input, targetFile: file };
  }

  return null;
}

function extractFileFromText(text: string): string | null {
  // "in app.py" / "to utils.ts" / "for Button.tsx" / "into main.go"
  const inMatch = text.match(/\b(?:in|to|into|for)\s+([a-zA-Z0-9_/.\-]+\.[a-zA-Z]{1,8})\b/i);
  if (inMatch) return inMatch[1];
  return null;
}

// ============================================
// Main Entry Point
// ============================================

export async function executeCommand(
  input: string,
  onToken?: StreamCallback,
): Promise<CommandResult> {
  const trimmed = input.trim();
  if (!trimmed) return { type: 'info', message: '' };

  useAppStore.getState().addCommandHistory(trimmed);

  // --- Slash commands ---
  if (trimmed.startsWith('/')) {
    return handleSlashCommand(trimmed);
  }

  const lower = trimmed.toLowerCase();

  // --- File operations (no AI needed) ---
  // Simple create (no description): "create app.py"
  const simpleCreateMatch = lower.match(/^(?:create|new|touch)\s+(?:a\s+)?(?:file\s+)?(?:named?\s+)?([a-zA-Z0-9_/.\-]+\.[a-zA-Z]{1,8})\s*$/);
  if (simpleCreateMatch && !lower.match(/\s+(with|that|which|having|containing|as|for|to)\s+/)) {
    const path = cleanPath(simpleCreateMatch[1]);
    return wrapFileOp(FileOps.create(path));
  }

  const deleteMatch = lower.match(/^(?:delete|remove|rm)\s+(?:file\s+)?(.+)/);
  if (deleteMatch) {
    return wrapFileOp(FileOps.delete(cleanPath(deleteMatch[1])));
  }

  const renameMatch = lower.match(/^(?:rename|mv|move)\s+(.+?)\s+(?:to|->|→)\s+(.+)/);
  if (renameMatch) {
    return wrapFileOp(FileOps.rename(cleanPath(renameMatch[1]), cleanPath(renameMatch[2])));
  }

  const openMatch = lower.match(/^(?:open|show|view|edit)\s+(?:file\s+)?(.+)/);
  if (openMatch) {
    return wrapFileOp(FileOps.open(cleanPath(openMatch[1])));
  }

  if (/^(?:list|ls|files|dir)\s*(?:files)?$/.test(lower)) {
    return { type: 'info', message: FileOps.list().message };
  }

  const readMatch = lower.match(/^(?:read|cat|print|type)\s+(?:file\s+)?(.+)/);
  if (readMatch) {
    const result = FileOps.read(cleanPath(readMatch[1]));
    if (!result.success) return { type: 'error', message: result.message };
    return { type: 'info', message: `\`\`\`${result.file!.language}\n${result.file!.content}\`\`\`` };
  }

  // --- Debug (with auto-fix) ---
  if (/^(?:debug|analyze|check|lint|review)\s*(?:this|current)?\s*(?:file)?$/.test(lower)) {
    return handleDebug(null, onToken);
  }
  const debugFileMatch = lower.match(/^(?:debug|analyze|check|lint|review)\s+([a-zA-Z0-9_/.\-]+\.[a-zA-Z]{1,8})/);
  if (debugFileMatch) {
    return handleDebug(cleanPath(debugFileMatch[1]), onToken);
  }

  // --- Explain ---
  if (/^(?:explain|what does|what is|describe|how does)\s*(?:this|current|the)?\s*(?:code|file)?/.test(lower)) {
    return handleExplain(onToken);
  }

  // --- Fix line ---
  const fixLineMatch = lower.match(/^fix\s+(?:line\s+)?(\d+)/);
  if (fixLineMatch) {
    return handleFixLine(parseInt(fixLineMatch[1]), onToken);
  }

  // --- Code generation intents (write/generate/refactor/add/create-with-ai) ---
  const codeIntent = detectCodeGenIntent(trimmed);
  if (codeIntent) {
    return handleCodeGen(codeIntent, onToken);
  }

  // --- Fallback: general AI prompt (also auto-applies code if the AI produces a code block) ---
  return handleGeneralAI(trimmed, onToken);
}

// ============================================
// Slash Commands
// ============================================

function handleSlashCommand(input: string): CommandResult {
  const parts = input.slice(1).split(/\s+/);
  const cmd = parts[0]?.toLowerCase();

  switch (cmd) {
    case 'help':
      return {
        type: 'info',
        message: `**SouthStack AI Terminal — Command Reference**

**File Operations** (no model needed):
  \`create <file>\`              Create file with boilerplate
  \`create <file> with <desc>\`  Create file with AI-generated code
  \`open <file>\`                Open file in editor
  \`delete <file>\`              Delete a file
  \`rename <old> to <new>\`      Rename a file
  \`list\` / \`ls\`                List all workspace files
  \`read <file>\`                Print file contents

**AI Code Actions** (writes directly to files):
  \`write <description>\`        Generate code → writes to current file
  \`generate <description>\`     Same as write
  \`add <thing> to <file>\`      Add code to a file
  \`rewrite\` / \`refactor\`       Rewrite current file
  \`debug\` / \`debug <file>\`     Find bugs and auto-fix
  \`explain\`                    Explain current file
  \`fix line <n>\`               Fix code at line number
  \`<any prompt>\`               AI answers with context — auto-applies code

**Slash Commands:**
  \`/help\`      Show this help
  \`/clear\`     Clear terminal
  \`/settings\`  Open settings
  \`/model\`     Model status
  \`/mesh\`      Mesh network status
  \`/theme\`     Toggle dark/light
  \`/apply\`     Re-apply last generated code
  \`/undo\`      Undo last AI edit to current file
  \`/build <prompt>\` Start a distributed project build

**Agent Commands:**
  \`/agents\`                  Show all agent statuses
  \`/agents init\`             Initialize background agents
  \`/agents analyze\`          Run all agents on current file
  \`/agents run <role> <task>\` Run a specific agent
  \`/agents code <desc>\`      Run coder agent
  \`/agents debug\`            Run debug agent on current file
  \`/agents review\`           Run review agent on current file
  \`/agents test\`             Run test agent on current file

**Toolbar:** Use voice (mic), file upload, and settings icons below the chat.`,
      };

    case 'clear':
      useAppStore.getState().clearMessages();
      return { type: 'info', message: '' };

    case 'settings':
      useAppStore.getState().setSettingsOpen(true);
      return { type: 'info', message: 'Settings opened.' };

    case 'model': {
      const store = useAppStore.getState();
      if (store.modelLoaded) {
        const model = store.availableModels.find((m) => m.id === store.selectedModelId);
        return { type: 'success', message: `Model loaded: **${model?.name || store.selectedModelId}** (${model?.size})` };
      }
      if (store.modelLoading) {
        return { type: 'info', message: `Model loading... ${store.loadProgress}%` };
      }
      return { type: 'info', message: 'No model loaded. Open /settings to load one.' };
    }

    case 'mesh': {
      const store = useAppStore.getState();
      const selfNode = store.nodes.find((n) => n.isSelf);
      const peers = store.nodes.filter((n) => !n.isSelf && n.status !== 'offline');
      let msg = `**Mesh Status:**\n`;
      msg += `  Self: ${selfNode?.name || 'Unknown'} (${selfNode?.status || 'unknown'})\n`;
      msg += `  Peers: ${peers.length} connected\n`;
      msg += `  Master: ${store.masterId || 'none'}\n`;
      if (peers.length > 0) {
        msg += `\n**Connected Peers:**\n`;
        for (const p of peers) {
          msg += `  ${p.name} — ${p.status} — ${p.vramUsed}MB VRAM used\n`;
        }
      }
      return { type: 'info', message: msg };
    }

    case 'theme':
      useAppStore.getState().toggleTheme();
      return { type: 'success', message: `Theme toggled to ${useAppStore.getState().theme}` };

    case 'apply': {
      const store = useAppStore.getState();
      if (!store.lastGeneratedCode) {
        return { type: 'error', message: 'No generated code to apply. Ask AI to write code first.' };
      }
      const targetArg = parts[1] ? cleanPath(parts[1]) : null;
      const targetPath = targetArg || store.lastGeneratedTarget || store.activeFilePath;
      if (!targetPath) {
        return { type: 'error', message: 'No target file. Specify: /apply <filename>' };
      }
      const existing = store.files.find((f) => f.path === targetPath);
      if (existing) {
        const result = FileOps.update(targetPath, store.lastGeneratedCode);
        return { type: result.success ? 'success' : 'error', message: result.message };
      } else {
        const result = FileOps.create(targetPath, store.lastGeneratedCode);
        return { type: result.success ? 'success' : 'error', message: result.message };
      }
    }

    case 'undo': {
      const store = useAppStore.getState();
      const path = store.activeFilePath;
      if (!path) return { type: 'error', message: 'No file open.' };
      const prev = store.fileUndoHistory[path];
      if (prev === undefined) return { type: 'info', message: 'No undo history for this file.' };
      FileOps.update(path, prev);
      store.clearFileUndo(path);
      return { type: 'success', message: `Reverted \`${path}\` to previous version.` };
    }

    case 'agents': {
      const subCmd = parts[1]?.toLowerCase();

      if (!subCmd) {
        return { type: 'info', message: getAgentsSummary() };
      }

      if (subCmd === 'init') {
        initializeAgents();
        return { type: 'success', message: 'Background agents initialized.' };
      }

      if (subCmd === 'analyze') {
        const store = useAppStore.getState();
        const path = store.activeFilePath;
        if (!path) return { type: 'error', message: 'No file open. Open a file first.' };
        const taskIds = runAllAgentsOnFile(path);
        return {
          type: 'success',
          message: `Queued ${taskIds.length} agents to analyze \`${path}\`:\n  - Debug Agent\n  - Review Agent\n  - Test Agent\n\nResults will appear when agents finish. Use \`/agents\` to check status.`,
        };
      }

      // /agents run <role> <prompt>
      if (subCmd === 'run' && parts[2]) {
        const role = parts[2] as AgentRole;
        const validRoles: AgentRole[] = ['coder', 'debugger', 'reviewer', 'tester', 'architect', 'context'];
        if (!validRoles.includes(role)) {
          return { type: 'error', message: `Unknown agent role: ${role}. Valid: ${validRoles.join(', ')}` };
        }
        const prompt = parts.slice(3).join(' ') || 'Analyze the current file';
        const store = useAppStore.getState();
        const path = store.activeFilePath;
        let fullPrompt = prompt;
        if (path) {
          const file = store.files.find((f) => f.path === path);
          if (file) {
            fullPrompt = `File: ${path} (${file.language}):\n\`\`\`${file.language}\n${file.content}\`\`\`\n\n${prompt}`;
          }
        }
        const taskId = queueAgentTask(role, fullPrompt, path);
        return { type: 'success', message: `Queued task for **${role}** agent (${taskId.slice(0, 12)}...)` };
      }

      // Shorthand: /agents code <desc>
      if (subCmd === 'code') {
        const desc = parts.slice(2).join(' ') || 'Generate code for the current file';
        queueAgentTask('coder', desc, useAppStore.getState().activeFilePath);
        return { type: 'success', message: `Queued **coder** agent: ${desc}` };
      }

      // Shorthand: /agents debug
      if (subCmd === 'debug') {
        const store = useAppStore.getState();
        const path = store.activeFilePath;
        if (!path) return { type: 'error', message: 'No file open.' };
        const file = store.files.find((f) => f.path === path);
        if (!file) return { type: 'error', message: `File not found: ${path}` };
        queueAgentTask('debugger', `Analyze this ${file.language} file for bugs:\n\`\`\`${file.language}\n${file.content}\`\`\``, path);
        return { type: 'success', message: `Queued **debug** agent on \`${path}\`` };
      }

      // Shorthand: /agents review
      if (subCmd === 'review') {
        const store = useAppStore.getState();
        const path = store.activeFilePath;
        if (!path) return { type: 'error', message: 'No file open.' };
        const file = store.files.find((f) => f.path === path);
        if (!file) return { type: 'error', message: `File not found: ${path}` };
        queueAgentTask('reviewer', `Review this ${file.language} code:\n\`\`\`${file.language}\n${file.content}\`\`\``, path);
        return { type: 'success', message: `Queued **review** agent on \`${path}\`` };
      }

      // Shorthand: /agents test
      if (subCmd === 'test') {
        const store = useAppStore.getState();
        const path = store.activeFilePath;
        if (!path) return { type: 'error', message: 'No file open.' };
        const file = store.files.find((f) => f.path === path);
        if (!file) return { type: 'error', message: `File not found: ${path}` };
        queueAgentTask('tester', `Generate tests for this ${file.language} file:\n\`\`\`${file.language}\n${file.content}\`\`\``, path);
        return { type: 'success', message: `Queued **test** agent on \`${path}\`` };
      }

      return { type: 'error', message: `Unknown agents subcommand: ${subCmd}. Try \`/agents\` or \`/agents init\`.` };
    }

    case 'build': {
      const buildPrompt = parts.slice(1).join(' ').trim();
      if (!buildPrompt) {
        useAppStore.getState().setActiveView('project-builder');
        return { type: 'info', message: 'Opening Project Builder. Enter your prompt there to start a distributed build.' };
      }
      useAppStore.getState().setActiveView('project-builder');
      getMeshOrchestrator().project.startSession(buildPrompt);
      return { type: 'success', message: `Project build started: *"${buildPrompt.slice(0, 80)}"*\n\nOpening Project Builder...` };
    }

    default:
      return { type: 'error', message: `Unknown command: /${cmd}. Type /help for commands.` };
  }
}

// ============================================
// Code Generation — writes AI code directly to files
// ============================================

async function handleCodeGen(
  intent: CodeGenIntent,
  onToken?: StreamCallback,
): Promise<CommandResult> {
  const store = useAppStore.getState();

  // Determine target file
  let targetPath = intent.targetFile ? cleanPath(intent.targetFile) : store.activeFilePath;
  let isNewFile = false;

  // Handle "create <file> with <description>"
  if (intent.kind === 'create-with-ai' && intent.targetFile) {
    targetPath = cleanPath(intent.targetFile);
    const existing = store.files.find((f) => f.path === targetPath);
    if (!existing) {
      // Create the file first with empty content — we'll fill it with AI code
      FileOps.create(targetPath, '// Generating...\n');
      isNewFile = true;
    }
  }

  if (!targetPath) {
    return { type: 'error', message: 'No file open. Open or create a file first, or say: `write <desc> in <filename>`' };
  }

  // If no model, create with boilerplate and inform user
  if (!inferenceService.isLoaded()) {
    if (isNewFile) {
      // Re-create with proper boilerplate
      FileOps.delete(targetPath);
      FileOps.create(targetPath);
      return { type: 'info', message: `Created \`${targetPath}\` with boilerplate.\n\nLoad a model in **/settings** for AI-generated code.` };
    }
    return { type: 'info', message: 'No model loaded. Open **/settings** to load a model for AI code generation.' };
  }

  // Build the prompt with file context
  const existingFile = store.files.find((f) => f.path === targetPath);
  const lang = existingFile?.language || FileOps.detectLanguage(targetPath);
  let fullPrompt: string;

  if (intent.kind === 'add-to-file' || intent.kind === 'refactor') {
    // Include existing content — AI must return full updated file
    const content = existingFile?.content || '';
    fullPrompt = content
      ? `Current file \`${targetPath}\` (${lang}):\n\`\`\`${lang}\n${content}\`\`\`\n\nTask: ${intent.prompt}\n\nReturn the COMPLETE updated file.`
      : `Create a new ${lang} file. Task: ${intent.prompt}`;
  } else if (intent.kind === 'create-with-ai') {
    fullPrompt = `Create a ${lang} file named \`${targetPath}\`.\nDescription: ${intent.prompt}\n\nWrite complete, production-quality code.`;
  } else {
    // write — if file has content, include it
    const content = existingFile?.content || '';
    if (content && content !== '// Generating...\n') {
      fullPrompt = `Current file \`${targetPath}\` (${lang}):\n\`\`\`${lang}\n${content}\`\`\`\n\nTask: ${intent.prompt}\n\nReturn the COMPLETE updated file with the requested code added/modified.`;
    } else {
      fullPrompt = `Write a ${lang} file. Task: ${intent.prompt}`;
    }
  }

  // Stream and accumulate
  const accumulated = await streamOrGenerate(fullPrompt, CODE_GEN_PROMPT, onToken);

  // Extract code block and write to file
  return applyCodeFromResponse(accumulated, targetPath, isNewFile ? 'Created' : 'Written', onToken);
}

// ============================================
// Debug — find bugs AND auto-fix the file
// ============================================

async function handleDebug(
  filePath: string | null,
  onToken?: StreamCallback,
): Promise<CommandResult> {
  const store = useAppStore.getState();
  const path = filePath || store.activeFilePath;
  if (!path) {
    return { type: 'error', message: 'No file open. Open a file or specify: `debug <filename>`' };
  }

  const fileResult = FileOps.read(path);
  if (!fileResult.success) return { type: 'error', message: fileResult.message };
  FileOps.open(path);

  // Switch to IDE view and reset editor scroll so user sees live edits
  const store2 = useAppStore.getState();
  store2.setActiveView('ide');
  store2.setLiveDebug({ editorScrollTo: { line: 1, filePath: path } });

  const file = fileResult.file!;

  if (!inferenceService.isLoaded()) {
    return { type: 'info', message: `File: \`${path}\` (${file.language}, ${file.content.split('\n').length} lines)\n\nLoad a model in **/settings** to analyze and auto-fix bugs.` };
  }

  const orchestrator = getMeshOrchestrator();
  const contextManager = orchestrator.context;
  const estimatedTokens = contextManager.estimateTokens(file.content);

  // Small files: single-pass debug + auto-fix (original behaviour)
  if (estimatedTokens <= MAX_CHUNK_CONTENT_TOKENS) {
    const prompt = `File: \`${path}\` (${file.language}):\n\`\`\`${file.language}\n${file.content}\`\`\`\n\nAnalyze for bugs, errors, and issues. Then provide the complete fixed file.`;
    const accumulated = await streamOrGenerate(prompt, DEBUG_FIX_PROMPT, onToken);
    return applyCodeFromResponse(accumulated, path, 'Fixed', onToken);
  }

  // Large files: chunk-by-chunk analysis with live progress, then synthesize a full fix
  return handleDebugLargeFile(file, path, onToken);
}

async function handleDebugLargeFile(
  file: VirtualFile,
  path: string,
  onToken?: StreamCallback,
): Promise<CommandResult> {
  const orchestrator = getMeshOrchestrator();
  const contextManager = orchestrator.context;
  const chunks = contextManager.chunkFile(file);
  const totalChunks = chunks.length;
  const totalLines = file.content.split('\n').length;
  const fileName = path.split('/').pop() || path;

  const emit = (text: string) => onToken?.(text);

  // Header
  emit(`\n🔍 **Analyzing \`${fileName}\`** — ${totalLines} lines, ${totalChunks} chunk${totalChunks !== 1 ? 's' : ''}\n`);
  emit(`${'─'.repeat(48)}\n\n`);

  const issuesByChunk: Array<{ lines: string; startLine: number; endLine: number; findings: string }> = [];
  // Work on a mutable copy so per-chunk fixes can be applied live
  const liveLines = file.content.split('\n');

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkContent = liveLines.slice(chunk.startLine, chunk.endLine).join('\n');
    const lineLabel = `${chunk.startLine + 1}–${chunk.endLine}`;
    const pct = Math.round(((i + 1) / totalChunks) * 100);
    const bar = '█'.repeat(Math.round(pct / 6.25)).padEnd(16, '░');

    // Section header
    emit(`**[${i + 1}/${totalChunks}]** Lines ${lineLabel}\n`);
    emit(`\`${bar}\` ${pct}%\n`);
    emit(`_Scanning..._\n`);

    const chunkPrompt = [
      `File: ${path} (${file.language}, lines ${lineLabel} of ${totalLines})`,
      `\`\`\`${file.language}`,
      chunkContent,
      '```',
      'Analyze this section for bugs, errors, logic issues, undefined variables, missing checks, and security problems.',
      'If issues exist: list each issue clearly, then provide a FIX: block with the complete corrected section.',
      'If no issues: respond with exactly: NO_ISSUES',
    ].join('\n');

    try {
      // Stream the AI response live so the user sees it character by character
      let accumulated = '';
      await orchestrator.inference.generate({
        id: `debug-chunk-${i}-${Date.now()}`,
        prompt: chunkPrompt,
        systemPrompt: DEBUG_FIX_PROMPT,
        maxTokens: 1024,
        temperature: 0.1,
        onToken: (token: string) => {
          accumulated += token;
          emit(token); // stream each token to the terminal live
        },
      });

      emit('\n');

      const trimmed = accumulated.trim();
      const isClean = !trimmed || trimmed.toUpperCase() === 'NO_ISSUES' || trimmed.toUpperCase().startsWith('NO_ISSUES');

      if (isClean) {
        emit(`✅ **No issues** in lines ${lineLabel}\n\n`);
      } else {
        emit(`\n⚠️ **Issues found** in lines ${lineLabel}\n`);

        // Try to extract and apply fix immediately
        const fixMatch = trimmed.match(/FIX:\s*```(?:\w*\n)?([\s\S]*?)```/i)
          || trimmed.match(/```(?:\w+\n)?([\s\S]*?)```/);
        const fixedCode = fixMatch ? fixMatch[1].trimEnd() : null;

        if (fixedCode) {
          const fixedChunkLines = fixedCode.split('\n');
          liveLines.splice(chunk.startLine, chunk.endLine - chunk.startLine, ...fixedChunkLines);
          // Write to store immediately so Monaco updates live
          const updatedContent = liveLines.join('\n');
          const store = useAppStore.getState();
          const currentFile = store.files.find(f => f.path === path);
          store.updateFile(path, {
            content: updatedContent,
            lastModified: Date.now(),
            version: (currentFile?.version ?? 1) + 1,
          });
          // Scroll editor to this fix
          store.setLiveDebug({
            editorScrollTo: { line: chunk.startLine + 1, filePath: path },
          });
          emit(`✅ **Auto-fixed** lines ${lineLabel} (${fixedChunkLines.length} lines updated)\n\n`);
        } else {
          issuesByChunk.push({
            lines: lineLabel,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            findings: trimmed,
          });
          emit(`⚡ Manual review needed for lines ${lineLabel}\n\n`);
        }
      }
    } catch (err: any) {
      emit(`\n❌ **Error** on chunk ${i + 1}: ${err?.message || 'unknown'}\n\n`);
    }
  }

  // Final summary
  emit(`${'─'.repeat(48)}\n`);

  const autoFixed = totalChunks - issuesByChunk.length;
  if (issuesByChunk.length === 0) {
    emit(`✅ **\`${fileName}\` is clean** — ${totalChunks} section${totalChunks !== 1 ? 's' : ''} scanned, all auto-fixed or no issues found.\n`);
  } else {
    emit(`⚠️ **${issuesByChunk.length} section${issuesByChunk.length !== 1 ? 's' : ''} need manual review** in \`${fileName}\`\n`);
    issuesByChunk.forEach((ic) => emit(`  • Lines ${ic.lines}\n`));
  }

  // Sync final content to store
  const finalContent = liveLines.join('\n');
  const finalFile = useAppStore.getState().files.find(f => f.path === path);
  if (finalFile && finalContent !== file.content) {
    useAppStore.getState().updateFile(path, {
      content: finalContent,
      lastModified: Date.now(),
      version: (finalFile.version ?? 1) + 1,
    });
    useAppStore.getState().setLastGeneratedCode(finalContent, file.language, path);
  }

  return { type: 'success', message: '' };
}

async function applyChunkedFixes(
  file: VirtualFile,
  path: string,
  issuesByChunk: Array<{ lines: string; startLine: number; endLine: number; findings: string }>,
  onToken?: StreamCallback,
): Promise<CommandResult> {
  const emit = (text: string) => onToken?.(text);
  const orchestrator = getMeshOrchestrator();
  const liveLines = file.content.split('\n');

  for (let i = 0; i < issuesByChunk.length; i++) {
    const issue = issuesByChunk[i];
    const { startLine, endLine } = issue;
    const sectionContent = liveLines.slice(startLine, endLine).join('\n');

    emit(`\n🔧 **Fixing lines ${issue.lines}** (${i + 1}/${issuesByChunk.length})...\n`);

    const fixPrompt = [
      `File: \`${path}\` (${file.language}, lines ${issue.lines}):`,
      `\`\`\`${file.language}`,
      sectionContent,
      '```',
      `Issues:\n${issue.findings}`,
      'Return ONLY the corrected version of this exact section. No explanations, no markdown outside the code block.',
    ].join('\n');

    try {
      let fixAccumulated = '';
      await orchestrator.inference.generate({
        id: `fix-chunk-${i}-${Date.now()}`,
        prompt: fixPrompt,
        systemPrompt: DEBUG_FIX_PROMPT,
        maxTokens: 1024,
        temperature: 0.1,
        onToken: (token: string) => {
          fixAccumulated += token;
          emit(token); // stream fix generation live
        },
      });
      emit('\n');

      const codeBlock = fixAccumulated.match(/```[\w]*\n?([\s\S]*?)```/);
      if (codeBlock) {
        const fixedSection = codeBlock[1].trimEnd().split('\n');
        liveLines.splice(startLine, endLine - startLine, ...fixedSection);
        // Apply to store live
        const store = useAppStore.getState();
        const currentFile = store.files.find(f => f.path === path);
        store.updateFile(path, {
          content: liveLines.join('\n'),
          lastModified: Date.now(),
          version: (currentFile?.version ?? 1) + 1,
        });
        store.setLiveDebug({ editorScrollTo: { line: startLine + 1, filePath: path } });
        emit(`\n✅ **Applied** fix for lines ${issue.lines}\n`);
      } else {
        emit(`\n⚠️ Could not extract fix for lines ${issue.lines} — manual review needed\n`);
      }
    } catch (err: any) {
      emit(`\n❌ Fix error for lines ${issue.lines}: ${err?.message || 'unknown'}\n`);
    }
  }

  const fixedContent = liveLines.join('\n');
  const store = useAppStore.getState();
  store.setLastGeneratedCode(fixedContent, file.language, path);
  emit(`\n✅ **All fixes applied to \`${path}\`**\n`);
  return { type: 'success', message: '' };
}

// ============================================
// Explain — streams explanation to terminal (no file write)
// ============================================

async function handleExplain(onToken?: StreamCallback): Promise<CommandResult> {
  const store = useAppStore.getState();
  const path = store.activeFilePath;
  if (!path) return { type: 'error', message: 'No file open.' };

  const fileResult = FileOps.read(path);
  if (!fileResult.success) return { type: 'error', message: fileResult.message };
  const file = fileResult.file!;

  if (!inferenceService.isLoaded()) {
    const lines = file.content.split('\n').length;
    return { type: 'info', message: `File: \`${path}\` (${file.language}, ${lines} lines)\n\nLoad a model in **/settings** for AI-powered explanations.` };
  }

  const prompt = `Explain this code:\n\nFile: \`${path}\`\n\`\`\`${file.language}\n${file.content}\`\`\``;
  const accumulated = await streamOrGenerate(prompt, EXPLAIN_PROMPT, onToken);

  if (!onToken) return { type: 'info', message: accumulated };
  return { type: 'ai-stream', message: '' };
}

// ============================================
// Fix Line — fix code around a specific line and apply
// ============================================

async function handleFixLine(lineNum: number, onToken?: StreamCallback): Promise<CommandResult> {
  const store = useAppStore.getState();
  const path = store.activeFilePath;
  if (!path) return { type: 'error', message: 'No file open.' };

  const fileResult = FileOps.read(path);
  if (!fileResult.success) return { type: 'error', message: fileResult.message };
  const file = fileResult.file!;

  if (!inferenceService.isLoaded()) {
    return { type: 'info', message: 'Load a model in **/settings** to auto-fix code.' };
  }

  // Include the FULL file so the AI can return the full fixed version
  const prompt = `File: \`${path}\` (${file.language}):\n\`\`\`${file.language}\n${file.content}\`\`\`\n\nFix the issue on or around line ${lineNum}. Return the COMPLETE file with the fix applied.`;

  const accumulated = await streamOrGenerate(prompt, DEBUG_FIX_PROMPT, onToken);
  return applyCodeFromResponse(accumulated, path, 'Fixed', onToken);
}

// ============================================
// General AI — free-form prompt, auto-applies code if AI produces a block
// ============================================

async function handleGeneralAI(
  prompt: string,
  onToken?: StreamCallback,
): Promise<CommandResult> {
  const store = useAppStore.getState();

  // Build context from current file
  let fullPrompt = prompt;
  const path = store.activeFilePath;
  if (path) {
    const fileResult = FileOps.read(path);
    if (fileResult.success && fileResult.file) {
      fullPrompt = `Current file: \`${path}\` (${fileResult.file.language}):\n\`\`\`${fileResult.file.language}\n${fileResult.file.content}\`\`\`\n\nUser: ${prompt}`;
    }
  }

  if (!inferenceService.isLoaded()) {
    return { type: 'info', message: inferenceService.simulateResponse(prompt) };
  }

  const accumulated = await streamOrGenerate(fullPrompt, GENERAL_PROMPT, onToken);

  // Smart auto-apply: if the response contains a code block and there's an active file,
  // check if it looks like a full file (not just a snippet example)
  const codeBlock = extractFirstCodeBlock(accumulated);
  if (codeBlock && path) {
    const currentFile = store.files.find((f) => f.path === path);
    // Heuristic: auto-apply if the code block is substantial (>3 lines) and
    // the prompt seems to be asking for code changes
    const looksLikeCodeRequest = /\b(write|add|create|fix|change|update|modify|implement|make|refactor|convert|replace|rewrite|build|generate)\b/i.test(prompt);
    const isSubstantial = codeBlock.code.split('\n').length > 3;

    if (looksLikeCodeRequest && isSubstantial && currentFile) {
      const lineCount = codeBlock.code.split('\n').length;
      store.saveFileUndo(path, currentFile.content);
      FileOps.update(path, codeBlock.code);
      store.setLastGeneratedCode(codeBlock.code, codeBlock.language, path);

      if (onToken) {
        return { type: 'success', message: `Applied ${lineCount} lines to \`${path}\`` };
      }
      return { type: 'success', message: `${accumulated}\n\nApplied ${lineCount} lines to \`${path}\`` };
    }
  }

  if (!onToken) return { type: 'info', message: accumulated };
  return { type: 'ai-stream', message: '' };
}

// ============================================
// Shared Helpers
// ============================================

/**
 * Stream tokens to callback OR generate non-streaming. Returns full accumulated text.
 */
async function streamOrGenerate(
  prompt: string,
  systemPrompt: string,
  onToken?: StreamCallback,
): Promise<string> {
  if (onToken) {
    let accumulated = '';
    const wrappedOnToken = (token: string) => {
      accumulated += token;
      onToken(token);
    };
    await inferenceService.generateStream(prompt, systemPrompt, wrappedOnToken);
    return accumulated;
  }
  return inferenceService.generate(prompt, systemPrompt);
}

/**
 * Extract the first code block from AI response and write it to a file.
 * Returns a success result if code was applied, or ai-stream if no code found.
 */
function applyCodeFromResponse(
  response: string,
  targetPath: string,
  actionVerb: string,
  onToken?: StreamCallback,
): CommandResult {
  const codeBlock = extractFirstCodeBlock(response);

  if (codeBlock) {
    const store = useAppStore.getState();
    const finalCode = codeBlock.code;
    const lineCount = finalCode.split('\n').length;

    const existing = store.files.find((f) => f.path === targetPath);
    if (existing) {
      // saveFileUndo is called inside FileOps.update
      FileOps.update(targetPath, finalCode);
    } else {
      FileOps.create(targetPath, finalCode);
    }

    store.setLastGeneratedCode(finalCode, codeBlock.language, targetPath);

    return { type: 'success', message: `${actionVerb} ${lineCount} lines → \`${targetPath}\`` };
  }

  // No code block found — just show the streamed text
  if (onToken) return { type: 'ai-stream', message: '' };
  return { type: 'info', message: response };
}

function wrapFileOp(result: { success: boolean; message: string }): CommandResult {
  return { type: result.success ? 'success' : 'error', message: result.message };
}

function cleanPath(raw: string): string {
  return raw.trim().replace(/['"]/g, '').replace(/\\/g, '/');
}
