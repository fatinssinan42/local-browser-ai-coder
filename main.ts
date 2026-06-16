import { CreateMLCEngine, MLCEngine } from "@mlc-ai/web-llm";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
}

const modelSelect = document.getElementById("model") as HTMLSelectElement;
const loadBtn = document.getElementById("load") as HTMLButtonElement;
const statusDot = document.getElementById("status-dot") as HTMLDivElement;
const statusText = document.getElementById("status") as HTMLSpanElement;
const chatDiv = document.getElementById("chat") as HTMLDivElement;
const inputArea = document.getElementById("input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send") as HTMLButtonElement;
const clearBtn = document.getElementById("clear") as HTMLButtonElement;
const newChatBtn = document.getElementById("new-chat") as HTMLButtonElement;
const conversationsList = document.getElementById("conversations-list") as HTMLDivElement;
const sidebar = document.getElementById("sidebar") as HTMLDivElement;
const overlay = document.getElementById("overlay") as HTMLDivElement;
const menuToggle = document.getElementById("menu-toggle") as HTMLButtonElement;

let engine: MLCEngine | null = null;
let currentConversationId: string | null = null;
let history: Message[] = [];
let isLoadingModel = false;
let isGenerating = false;

const STORAGE_KEY = "coding-assistant-conversations";
const LAST_MODEL_KEY = "coding-assistant-last-model";
const AUTO_LOAD_KEY = "coding-assistant-auto-load";

const SYSTEM_PROMPT = `You are an expert coding assistant. Follow these rules strictly:

1. Write correct, working code. Test your logic mentally before responding.
2. Use markdown code blocks with the language specified.
3. Keep responses short. Code first, minimal explanation.
4. If the task is ambiguous, state your assumption in one line, then write code.
5. Never apologize or add filler text. Just provide the solution.`;

function setStatus(text: string, loading = false): void {
  statusText.textContent = text;
  statusDot.classList.toggle("loading", loading);
  statusDot.classList.toggle("ready", !loading && engine !== null);
}

function getNavigatorGPU(): GPU | undefined {
  return (navigator as Navigator & { gpu?: GPU }).gpu;
}

async function checkWebGPU(): Promise<boolean> {
  try {
    const gpu = getNavigatorGPU();
    if (!gpu) {
      setStatus("WebGPU not supported");
      loadBtn.disabled = true;
      sendBtn.disabled = true;
      return false;
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      setStatus("WebGPU adapter unavailable");
      loadBtn.disabled = true;
      sendBtn.disabled = true;
      return false;
    }
    return true;
  } catch {
    setStatus("WebGPU initialization failed");
    loadBtn.disabled = true;
    sendBtn.disabled = true;
    return false;
  }
}

function loadConversations(): Conversation[] {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : [];
}

function saveConversations(conversations: Conversation[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
}

function makeConversationTitle(messages: Message[]): string {
  const firstUserMessage = messages.find((m) => m.role === "user")?.content ?? "New Chat";
  return firstUserMessage.slice(0, 30) + (firstUserMessage.length > 30 ? "..." : "");
}

function saveCurrentConversation(): void {
  if (!currentConversationId || history.length === 0) return;

  const visibleMessages = history.filter((m) => m.role !== "system");
  if (visibleMessages.length === 0) return;

  const conversations = loadConversations();
  const index = conversations.findIndex((c) => c.id === currentConversationId);
  const title = makeConversationTitle(history);

  if (index >= 0) {
    conversations[index].messages = [...history];
    conversations[index].title = title;
  } else {
    conversations.unshift({
      id: currentConversationId,
      title,
      messages: [...history],
      createdAt: Date.now(),
    });
  }

  saveConversations(conversations);
  updateConversationsList();
}

function updateConversationsList(): void {
  const conversations = loadConversations();
  conversationsList.innerHTML = "";

  conversations.forEach((conv) => {
    const item = document.createElement("div");
    item.className = `conv-item${conv.id === currentConversationId ? " active" : ""}`;
    item.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="conv-title">${escapeHtml(conv.title)}</span>
      <button class="conv-delete" data-id="${conv.id}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    `;

    item.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".conv-delete")) {
        deleteChat(conv.id);
      } else {
        loadConversation(conv.id);
      }
    });

    conversationsList.appendChild(item);
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function loadConversation(id: string): void {
  const conversations = loadConversations();
  const conv = conversations.find((c) => c.id === id);

  if (!conv) return;

  currentConversationId = id;
  history = [...conv.messages];
  renderChat();
  updateConversationsList();
  closeSidebar();
}

function startNewChat(): void {
  currentConversationId = Date.now().toString();
  history = [];
  renderChat();
  updateConversationsList();
  closeSidebar();
  inputArea.focus();
}

function deleteChat(id?: string): void {
  const targetId = id || currentConversationId;
  if (!targetId) return;

  const conversations = loadConversations();
  const filtered = conversations.filter((c) => c.id !== targetId);
  saveConversations(filtered);

  if (targetId === currentConversationId) {
    startNewChat();
  }
  updateConversationsList();
}

function closeSidebar(): void {
  sidebar.classList.remove("open");
  overlay.classList.remove("active");
}

function toggleSidebar(): void {
  sidebar.classList.toggle("open");
  overlay.classList.toggle("active");
}

function renderEmptyState(): void {
  chatDiv.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5"/>
        </svg>
      </div>
      <h2>Ready to Code</h2>
      <p>Load a Qwen model and start asking questions. Your conversations stay private in your browser.</p>
      <div class="empty-features">
        <span class="feature-tag">Code Generation</span>
        <span class="feature-tag">Debugging Help</span>
        <span class="feature-tag">Refactoring</span>
        <span class="feature-tag">100% Offline</span>
      </div>
    </div>
  `;
}

function renderChat(): void {
  chatDiv.innerHTML = "";

  const visibleMessages = history.filter((msg) => msg.role !== "system");

  if (visibleMessages.length === 0) {
    renderEmptyState();
    return;
  }

  visibleMessages.forEach((msg) => {
    appendMessage(msg.role, msg.content);
  });
}

function formatCode(text: string): string {
  return text.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    const language = lang || "code";
    const trimmedCode = code.trim();
    return `<pre><div class="code-header"><span>${language}</span><button class="copy-btn" onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.textContent)">Copy</button></div><code>${escapeHtml(trimmedCode)}</code></pre>`;
  });
}

function appendMessage(role: "user" | "assistant" | "system" | string, text: string): HTMLDivElement {
  const div = document.createElement("div");
  div.className = `message ${role}`;
  
  const avatarText = role === "user" ? "You" : "AI";
  
  div.innerHTML = `
    <div class="message-header">
      <div class="avatar">${avatarText}</div>
    </div>
    <div class="message-content">${role === "assistant" ? formatCode(text) : escapeHtml(text)}</div>
  `;
  
  chatDiv.appendChild(div);
  chatDiv.scrollTop = chatDiv.scrollHeight;
  return div;
}

function setLoadingUI(loading: boolean): void {
  isLoadingModel = loading;
  loadBtn.disabled = loading;
  modelSelect.disabled = loading || !!engine;
  sendBtn.disabled = loading || !engine || isGenerating;
}

async function loadModel(auto = false): Promise<void> {
  if (isLoadingModel) return;
  const webGPUSupported = await checkWebGPU();
  if (!webGPUSupported) return;

  const selectedModel = modelSelect.value;

  setLoadingUI(true);
  setStatus(auto ? `Restoring ${selectedModel}...` : "Initializing...", true);

  try {
    localStorage.setItem(LAST_MODEL_KEY, selectedModel);
    localStorage.setItem(AUTO_LOAD_KEY, "true");

    // Context window sizes per model — must match their training context.
    // Without this, WebLLM defaults to 4096 which crashes on any non-trivial chat.
    const MODEL_CONTEXT_SIZES: Record<string, number> = {
      'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC': 32768,
      'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC': 32768,
      'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC': 32768,
      'Phi-3.5-mini-instruct-q4f16_1-MLC': 131072,
      'gemma-2b-it-q4f16_1-MLC': 8192,
    };
    const contextSize = MODEL_CONTEXT_SIZES[selectedModel] || 32768;

    engine = await CreateMLCEngine(
      selectedModel,
      {
        initProgressCallback: ({ progress, text }) => {
          setStatus(`Loading: ${Math.round(progress * 100)}% — ${text}`, true);
        },
      },
      {
        context_window_size: contextSize,
        sliding_window_size: contextSize,
      },
    );

    setStatus(`Ready — ${selectedModel}`);
    loadBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
      Model Loaded
    `;
    loadBtn.classList.add("loaded");
    loadBtn.disabled = false;
    modelSelect.disabled = false;
    sendBtn.disabled = false;
  } catch (error) {
    setStatus(`Error: ${String(error)}`);
    localStorage.removeItem(AUTO_LOAD_KEY);
    loadBtn.disabled = false;
    modelSelect.disabled = false;
    sendBtn.disabled = true;
  } finally {
    isLoadingUI(false);
  }
}

function isLoadingUI(loading: boolean): void {
  isLoadingModel = loading;
}

async function send(): Promise<void> {
  const userText = inputArea.value.trim();
  if (!userText || !engine || isGenerating) return;

  if (!currentConversationId) {
    currentConversationId = Date.now().toString();
  }

  const hadEmptyState = chatDiv.querySelector(".empty-state");
  if (hadEmptyState) {
    chatDiv.innerHTML = "";
  }

  inputArea.value = "";
  appendMessage("user", userText);
  history.push({ role: "user", content: userText });

  const assistantDiv = appendMessage("assistant", "");
  isGenerating = true;
  sendBtn.disabled = true;
  inputArea.disabled = true;
  loadBtn.disabled = true;
  modelSelect.disabled = true;

  try {
    // Truncate history to fit within context window.
    // Rough estimate: 1 token ≈ 4 chars. Reserve 2048 tokens for the response.
    // Keep the most recent messages that fit within the budget.
    const selectedModel = modelSelect.value;
    const MODEL_CTX: Record<string, number> = {
      'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC': 32768,
      'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC': 32768,
      'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC': 32768,
      'Phi-3.5-mini-instruct-q4f16_1-MLC': 131072,
      'gemma-2b-it-q4f16_1-MLC': 8192,
    };
    const maxCtxTokens = MODEL_CTX[selectedModel] || 32768;
    const reserveForResponse = 2048;
    const tokenBudget = maxCtxTokens - reserveForResponse;

    const systemTokens = Math.ceil(SYSTEM_PROMPT.length / 4);
    let usedTokens = systemTokens;
    const trimmedHistory: Message[] = [];

    // Walk backwards from the most recent message to keep as much recent context as possible
    for (let i = history.length - 1; i >= 0; i--) {
      const msgTokens = Math.ceil(history[i].content.length / 4);
      if (usedTokens + msgTokens > tokenBudget) break;
      usedTokens += msgTokens;
      trimmedHistory.unshift(history[i]);
    }

    const stream = await engine.chat.completions.create({
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...trimmedHistory],
      stream: true,
      temperature: 0.1,
      max_tokens: reserveForResponse,
    });

    let reply = "";

    for await (const chunk of stream) {
      reply += chunk.choices[0]?.delta?.content || "";
      const contentDiv = assistantDiv.querySelector(".message-content");
      if (contentDiv) {
        contentDiv.innerHTML = formatCode(reply);
        chatDiv.scrollTop = chatDiv.scrollHeight;
      }
    }

    history.push({ role: "assistant", content: reply });
    saveCurrentConversation();
  } catch (error) {
    const contentDiv = assistantDiv.querySelector(".message-content");
    if (contentDiv) {
      contentDiv.textContent = `Error: ${String(error)}`;
    }
  } finally {
    isGenerating = false;
    sendBtn.disabled = !engine;
    inputArea.disabled = false;
    loadBtn.disabled = false;
    modelSelect.disabled = false;
    inputArea.focus();
  }
}

function clearChat(): void {
  history = [];
  chatDiv.innerHTML = "";
  renderEmptyState();

  if (currentConversationId) {
    const conversations = loadConversations();
    const filtered = conversations.filter((c) => c.id !== currentConversationId);
    saveConversations(filtered);
    updateConversationsList();
  }

  currentConversationId = null;
}

loadBtn.addEventListener("click", () => {
  void loadModel(false);
});

sendBtn.addEventListener("click", () => {
  void send();
});

clearBtn.addEventListener("click", clearChat);
newChatBtn.addEventListener("click", startNewChat);
menuToggle.addEventListener("click", toggleSidebar);
overlay.addEventListener("click", closeSidebar);

modelSelect.addEventListener("change", () => {
  localStorage.setItem(LAST_MODEL_KEY, modelSelect.value);
});

inputArea.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void send();
  }
});

async function initializeApp(): Promise<void> {
  updateConversationsList();
  renderChat();

  const lastModel = localStorage.getItem(LAST_MODEL_KEY);
  const shouldAutoLoad = localStorage.getItem(AUTO_LOAD_KEY) === "true";

  if (lastModel) {
    modelSelect.value = lastModel;
  }

  if (lastModel && shouldAutoLoad) {
    const webGPUSupported = await checkWebGPU();
    if (webGPUSupported) {
      void loadModel(true);
    }
  } else {
    setStatus("Select a model to begin");
  }
}

initializeApp();
