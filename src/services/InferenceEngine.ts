// ============================================
// InferenceEngine — WebGPU Model Lifecycle
// ============================================
// Manages local LLM inference using WebLLM.
// Supports Phi-3.5, Gemma-2b, Qwen-2.5-Coder.
// Detects VRAM, prevents crashes, offloads when limits reached.

import { useAppStore } from '../stores/appStore';
import { generateId } from '../utils/helpers';
import { EventBus, MeshEvents } from './EventBus';
import type { P2PManager } from './P2PManager';

interface InferenceRequest {
  id: string;
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  onToken?: (token: string) => void;
  onComplete?: (result: string) => void;
  onError?: (error: string) => void;
}

export class InferenceEngine {
  private engine: any = null;
  private p2p: P2PManager;
  private currentRequest: InferenceRequest | null = null;
  // Serialized inference queue — WebLLM engine cannot handle concurrent requests.
  // Without this, simultaneous calls (e.g. DebugManager + TaskDistributor) cause
  // "Object has already been disposed" / "valid external Instance" errors.
  private inferenceQueue: Promise<void> = Promise.resolve();

  constructor(p2p: P2PManager) {
    this.p2p = p2p;
    this.suppressGlobalGPUErrors();
  }

  /**
   * Suppress the browser's default GPUUncapturedErrorEvent logging.
   * WebLLM triggers these on some GPU drivers even when everything works.
   * We install a capturing listener at the window level so the event
   * never reaches the browser's default handler (which prints the red error).
   */
  private suppressGlobalGPUErrors(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('gpuuncapturederror', (e: Event) => {
      // Prevent the browser from printing the uncaptured error to console
      e.preventDefault();
      const gpuEvent = e as any;
      const errorMsg: string = gpuEvent?.error?.message ?? String(gpuEvent?.error ?? 'unknown GPU error');

      // Only surface as warning if it looks like a real problem
      if (
        errorMsg.includes('out-of-memory') ||
        errorMsg.includes('device lost') ||
        errorMsg.includes('Device is lost')
      ) {
        this.addEvent('error', `GPU error: ${errorMsg}. Try a smaller model.`);
      }
      // Validation warnings from WebLLM shader compilation are normal — ignore them
    }, true); // 'true' = capture phase, fires before any other handler
  }

  /**
   * After the WebLLM engine is created, try to register a device-level
   * pushErrorScope/popErrorScope wrapper for future inference calls.
   * This is best-effort — not all WebLLM versions expose the device.
   */
  private registerGPUErrorHandler(): void {
    try {
      const device: GPUDevice | undefined = this.engine?.device ?? this.engine?.getDevice?.();
      if (!device) return;
      device.addEventListener('uncapturederror', (e: Event) => {
        e.preventDefault();
      });
    } catch {
      // Not all WebLLM versions expose the GPUDevice — safe to ignore
    }
  }

  // ------------------------------------------
  // Model lifecycle
  // ------------------------------------------

  async loadModel(modelId?: string): Promise<boolean> {
    const store = useAppStore.getState();
    const targetModel = modelId || store.selectedModelId;
    if (!targetModel) return false;

    // Check WebGPU support
    if (!this.checkWebGPUSupport()) {
      this.addEvent('error', 'WebGPU not supported in this browser');
      return false;
    }

    // Check VRAM availability (advisory — don't block on inaccurate estimates)
    const modelInfo = store.availableModels.find((m) => m.id === targetModel);
    if (modelInfo) {
      const available = await this.estimateAvailableVRAM();
      if (available > 0 && available < modelInfo.vramRequired) {
        // Warn but still attempt — browser VRAM estimates are often wrong
        this.addEvent('warning', `Low VRAM for ${modelInfo.name}: need ~${modelInfo.vramRequired}MB, estimated ~${available}MB. Attempting anyway...`);
      }
    }

    store.setModelLoading(true);
    store.setLoadProgress(0);

    try {
      // Dynamic import to avoid bundling web-llm if not needed
      const webllm = await import('@mlc-ai/web-llm');

      this.addEvent('info', `Initializing model engine for ${modelInfo?.name || targetModel}...`);

      // Use IndexedDB cache instead of Cache API.
      // Cache API's cache.add() fails under Cross-Origin-Embedder-Policy
      // headers (required for SharedArrayBuffer/WASM threading) because it
      // cannot cache cross-origin responses from HuggingFace CDN.
      // IndexedDB uses fetch() + manual storage, bypassing the COEP issue.
      const appConfig = {
        ...webllm.prebuiltAppConfig,
        useIndexedDBCache: true,
      } as any;

      // DO NOT override context_window_size or sliding_window_size here.
      // The prebuilt WASM binaries are compiled with a fixed context window
      // (typically 4096). Passing a larger value crashes the engine because
      // the KV cache allocation exceeds what the WASM was compiled for.
      // The prebuilt config already sets correct overrides per model.

      this.engine = await webllm.CreateMLCEngine(
        targetModel,
        {
          appConfig,
          initProgressCallback: (progress: any) => {
            const pct = typeof progress === 'object' ? Math.round((progress.progress || 0) * 100) : 0;
            store.setLoadProgress(pct);
            if (pct % 25 === 0) {
              this.addEvent('info', `Model loading: ${pct}%`);
            }
          },
        },
      );

      // Suppress GPUUncapturedErrorEvent — WebLLM uses experimental GPU features
      // that fire uncaptured GPU errors (validation, OOM warnings) which show as
      // scary red console errors even when the model is working fine.
      // We capture them here and route to our own event system.
      this.registerGPUErrorHandler();

      store.setModelLoaded(true);
      store.setModelLoading(false);
      store.setLoadProgress(100);
      store.setSelectedModelId(targetModel);

      // Update self node with VRAM usage
      const vramUsed = modelInfo?.vramRequired || 2000;
      store.updateNode(this.p2p.getSelfId(), { vramUsed });

      this.addEvent('success', `Model loaded: ${modelInfo?.name || targetModel}`);
      EventBus.emit(MeshEvents.MODEL_LOADED, { modelId: targetModel });
      return true;
    } catch (err: any) {
      // Clean up partially initialized engine
      if (this.engine) {
        try { await this.engine.unload(); } catch { /* ignore */ }
        this.engine = null;
      }

      store.setModelLoading(false);
      store.setModelLoaded(false);
      store.setLoadProgress(0);

      // Detailed error handling for common issues
      let errorMsg = err.message || 'Unknown error';

      if (errorMsg.includes('f16') || errorMsg.includes('extension') || errorMsg.includes('ShaderModule') || errorMsg.includes('GPUPipelineError')) {
        errorMsg = 'GPU does not support f16 shaders required by this model. This device cannot run AI models locally — use a peer with a capable GPU via the mesh network.';
      } else if (errorMsg.includes('Cache.add') || errorMsg.includes('network error') || errorMsg.includes('Failed to fetch')) {
        errorMsg = 'Network error downloading model weights. First download requires internet. ' + errorMsg;
      } else if (errorMsg.includes('GPU') || errorMsg.includes('WebGPU') || errorMsg.includes('adapter')) {
        errorMsg = 'WebGPU error. Use Chrome 113+ or Edge 113+. ' + errorMsg;
      } else if (errorMsg.includes('memory') || errorMsg.includes('VRAM') || errorMsg.includes('OOM') || errorMsg.includes('allocation')) {
        errorMsg = 'Out of GPU memory. Try a smaller model (Gemma 2B or Qwen 1.5B). ' + errorMsg;
      } else if (errorMsg.includes('context_window') || errorMsg.includes('sliding_window')) {
        errorMsg = 'Context window mismatch with compiled model. ' + errorMsg;
      }

      this.addEvent('error', `Failed to load model: ${errorMsg}`);
      console.error('Model loading error:', err);
      return false;
    }
  }

  async unloadModel(): Promise<void> {
    if (this.engine) {
      try {
        await this.engine.unload();
      } catch {
        // Engine may already be destroyed
      }
      this.engine = null;
    }
    const store = useAppStore.getState();
    store.setModelLoaded(false);
    store.setLoadProgress(0);
    store.updateNode(this.p2p.getSelfId(), { vramUsed: 0 });
    this.addEvent('info', 'Model unloaded');
    EventBus.emit(MeshEvents.MODEL_UNLOADED, {});
  }

  // ------------------------------------------
  // Inference
  // ------------------------------------------

  async generate(request: InferenceRequest): Promise<string> {
    if (!this.engine) {
      return this.offloadGeneration(request);
    }

    // Serialize all inference calls through a queue chain.
    // Each call waits for the previous one to finish before starting.
    // CRITICAL: always catch inside the chain so a failed request
    // doesn't break the queue for subsequent requests.
    return new Promise<string>((resolve, reject) => {
      this.inferenceQueue = this.inferenceQueue
        .then(async () => {
          try {
            const result = await this._executeGenerate(request);
            resolve(result);
          } catch (err) {
            reject(err);
          }
        })
        .catch(() => {
          // Swallow chain-level errors to keep the queue alive
        });
    });
  }

  private async _executeGenerate(request: InferenceRequest): Promise<string> {
    this.currentRequest = request;
    const store = useAppStore.getState();
    store.updateNode(this.p2p.getSelfId(), { currentTask: 'Inference' });

    try {
      const messages = [
        ...(request.systemPrompt
          ? [{ role: 'system' as const, content: request.systemPrompt }]
          : []),
        { role: 'user' as const, content: request.prompt },
      ];

      let fullResponse = '';

      if (request.onToken) {
        // Streaming
        const stream = await this.engine.chat.completions.create({
          messages,
          max_tokens: request.maxTokens || 2048,
          temperature: request.temperature || 0.7,
          stream: true,
        });

        for await (const chunk of stream) {
          const token = chunk.choices[0]?.delta?.content || '';
          fullResponse += token;
          request.onToken(token);
        }
      } else {
        // Non-streaming
        const response = await this.engine.chat.completions.create({
          messages,
          max_tokens: request.maxTokens || 2048,
          temperature: request.temperature || 0.7,
        });
        fullResponse = response.choices[0]?.message?.content || '';
      }

      request.onComplete?.(fullResponse);
      this.currentRequest = null;
      store.updateNode(this.p2p.getSelfId(), { currentTask: null });
      return fullResponse;
    } catch (err: any) {
      this.currentRequest = null;
      store.updateNode(this.p2p.getSelfId(), { currentTask: null });
      const errorMsg = err.message || 'Inference failed';
      request.onError?.(errorMsg);
      this.addEvent('error', `Inference error: ${errorMsg}`);
      throw err;
    }
  }

  async generateForChat(
    userMessage: string,
    onToken?: (token: string) => void,
  ): Promise<string> {
    const store = useAppStore.getState();

    // Add user message to store
    store.addMessage({
      id: generateId(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    const result = await this.generate({
      id: generateId(),
      prompt: userMessage,
      systemPrompt: 'You are SouthStack AI, a helpful coding assistant running locally via WebGPU. Provide clear, concise code solutions and explanations.',
      onToken,
    });

    // Add assistant response to store
    store.addMessage({
      id: generateId(),
      role: 'assistant',
      content: result,
      timestamp: Date.now(),
    });

    return result;
  }

  // ------------------------------------------
  // Offloading
  // ------------------------------------------

  private async requestOffload(modelId: string): Promise<boolean> {
    // Find a peer with enough VRAM
    const store = useAppStore.getState();
    const modelInfo = store.availableModels.find((m) => m.id === modelId);
    if (!modelInfo) return false;

    const peers = store.nodes.filter(
      (n) => !n.isSelf && n.status === 'online' && (n.vram - n.vramUsed) >= modelInfo.vramRequired,
    );

    if (peers.length === 0) {
      this.addEvent('warning', 'No peers with sufficient VRAM for offloading');
      return false;
    }

    this.addEvent('info', `Requesting model offload to ${peers[0].name}`);
    this.p2p.send(peers[0].id, {
      type: 'task',
      payload: { action: 'load-model', modelId },
    });

    return true;
  }

  private async offloadGeneration(request: InferenceRequest): Promise<string> {
    // Find a peer with a loaded model — prefer modelLoaded flag, fall back to vramUsed > 0
    const store = useAppStore.getState();
    const peers = store.nodes.filter(
      (n) => !n.isSelf && n.status !== 'offline' && (n.modelLoaded || n.vramUsed > 0),
    );

    if (peers.length === 0) {
      const errorMsg = 'No model loaded locally and no connected peers have a model loaded. Load a model on at least one machine via Settings.';
      request.onError?.(errorMsg);
      throw new Error(errorMsg);
    }

    // Pick the peer with the most free VRAM (or first available)
    const best = peers.reduce((a, b) => (b.vram - b.vramUsed) > (a.vram - a.vramUsed) ? b : a);

    return new Promise((resolve, reject) => {
      const requestId = request.id;

      const timeout = setTimeout(() => {
        this.p2p.off('result', handler);
        reject(new Error('Inference offload timed out (120s)'));
      }, 120000);

      // Named handler so we can remove it after receiving the matching response
      const handler = (message: import('./P2PTypes').P2PMessage) => {
        if (message.payload.requestId !== requestId) return;
        clearTimeout(timeout);
        this.p2p.off('result', handler);

        if (message.payload.error) {
          reject(new Error(message.payload.error));
        } else {
          const result: string = message.payload.result ?? '';
          // Deliver as a streaming token so ChatPanel updates in real time
          request.onToken?.(result);
          request.onComplete?.(result);
          resolve(result);
        }
      };

      this.p2p.on('result', handler);

      this.p2p.send(best.id, {
        type: 'task',
        payload: {
          action: 'inference',
          requestId,
          prompt: request.prompt,
          systemPrompt: request.systemPrompt,
          maxTokens: request.maxTokens,
          temperature: request.temperature,
        },
      });

      this.addEvent('info', `Offloading inference to peer: ${best.name}`);
    });
  }

  // ------------------------------------------
  // WebGPU & VRAM detection
  // ------------------------------------------

  checkWebGPUSupport(): boolean {
    return 'gpu' in navigator;
  }

  async estimateAvailableVRAM(): Promise<number> {
    if (!('gpu' in navigator)) return 0;

    try {
      const adapter = await (navigator as any).gpu.requestAdapter();
      if (!adapter) return 0;

      // WebGPU doesn't expose exact VRAM, so estimate from device memory
      const deviceMemory = (navigator as any).deviceMemory || 4;
      // Rough estimate: GPU usually has 25-100% of system memory as VRAM
      return Math.round(deviceMemory * 1024 * 0.5);
    } catch {
      return 2048; // Conservative default
    }
  }

  // ------------------------------------------
  // Status
  // ------------------------------------------

  isModelLoaded(): boolean {
    return this.engine !== null;
  }

  isProcessing(): boolean {
    return this.currentRequest !== null;
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
    this.unloadModel();
    this.inferenceQueue = Promise.resolve();
  }
}
