// ============================================
// InferenceService — Unified inference bridge
// ============================================
// Singleton facade used by UI components (ChatPanel, etc.)
// Delegates to the MeshOrchestrator's InferenceEngine for real inference,
// with a fallback response system when no model is loaded.

import { useAppStore } from '../stores/appStore';
import { getMeshOrchestrator } from './MeshOrchestrator';
import { generateId } from '../utils/helpers';

class InferenceService {
  /**
   * Load a model via the orchestrator's InferenceEngine.
   */
  async loadModel(modelId: string): Promise<boolean> {
    const orchestrator = getMeshOrchestrator();
    const success = await orchestrator.inference.loadModel(modelId);
    if (success) {
      orchestrator.wireInferenceEngine();
    }
    return success;
  }

  /**
   * Unload the current model.
   */
  async unload(): Promise<void> {
    const orchestrator = getMeshOrchestrator();
    await orchestrator.inference.unloadModel();
  }

  /**
   * Check if any model is available — local or via a mesh peer.
   */
  isLoaded(): boolean {
    try {
      const orchestrator = getMeshOrchestrator();
      if (orchestrator.inference.isModelLoaded()) return true;
      // Check if any connected peer has a model loaded
      const { nodes } = useAppStore.getState();
      return nodes.some((n) => !n.isSelf && n.status !== 'offline' && n.modelLoaded);
    } catch {
      return false;
    }
  }

  /**
   * Check if inference is currently in progress.
   */
  isLoading(): boolean {
    return useAppStore.getState().modelLoading;
  }

  /**
   * Get the engine type description.
   */
  getEngineType(): string {
    if (this.isLoaded()) return 'WebLLM';
    return 'None';
  }

  /**
   * Generate a response (non-streaming).
   * Uses local model if loaded; offloads to a peer with a model otherwise.
   */
  async generate(prompt: string, systemPrompt?: string): Promise<string> {
    if (!this.isLoaded()) {
      return this.simulateResponse(prompt);
    }

    const orchestrator = getMeshOrchestrator();
    // InferenceEngine.generate() automatically offloads to a peer when no local model
    return orchestrator.inference.generate({
      id: generateId(),
      prompt,
      systemPrompt,
    });
  }

  /**
   * Generate a streaming response. Calls onToken for each token.
   * Uses local model if loaded; offloads to a peer with a model otherwise.
   * Note: peer offloading does not stream tokens — the full result arrives at once.
   */
  async generateStream(
    prompt: string,
    systemPrompt: string,
    onToken: (token: string) => void,
  ): Promise<string> {
    // If no model is available (locally or via peers), return fallback
    if (!this.isLoaded()) {
      const response = this.simulateResponse(prompt);
      const words = response.split(' ');
      for (let i = 0; i < words.length; i++) {
        await new Promise(r => setTimeout(r, 20));
        onToken(words[i] + (i < words.length - 1 ? ' ' : ''));
      }
      return response;
    }

    const orchestrator = getMeshOrchestrator();
    // Always pass onToken — offloadGeneration calls it with the full result,
    // local streaming calls it per token. Both paths are covered.
    return orchestrator.inference.generate({
      id: generateId(),
      prompt,
      systemPrompt,
      onToken,
    });
  }

  /**
   * Fallback response when no model is loaded.
   */
  simulateResponse(prompt: string): string {
    const q = prompt.toLowerCase();

    if (q.includes('hello') || q.includes('hi')) {
      return `Hello! I'm SouthStack AI Assistant.\n\n**What I can do:**\n- Code generation & debugging\n- Architecture guidance\n- Best practices review\n\nLoad a model in Settings for real AI responses.`;
    }

    if (q.includes('debug') || q.includes('error')) {
      return `**Debugging Help:**\n\n1. Check DevTools console (F12)\n2. Note the exact error message\n3. Use the Debug panel to track issues\n4. Check network requests for P2P errors`;
    }

    if (q.includes('code') || q.includes('write') || q.includes('function')) {
      return `**Code Generation:**\n\nOpen the **Shared IDE** to write code.\nUse the **Tasks** panel for distributed work.\nLoad a model for real AI code generation.`;
    }

    if (q.includes('p2p') || q.includes('mesh') || q.includes('peer')) {
      return `**P2P Mesh Network:**\n\n- Direct WebRTC peer connections\n- No internet needed on local WiFi\n- Master/Worker architecture\n- Automatic failover & re-election\n\nCheck the Dashboard for live cluster status.`;
    }

    return `I understand your request: "${prompt.slice(0, 60)}..."\n\nFor AI-powered responses, load a model in Settings.\nCurrently running in fallback mode.`;
  }
}

export const inferenceService = new InferenceService();
