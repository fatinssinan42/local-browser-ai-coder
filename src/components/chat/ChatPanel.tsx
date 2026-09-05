import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import { inferenceService } from '../../services/InferenceService';
import { Send, Bot, User, Loader2, Trash2, X, MessageSquare, Plus, Save, Terminal } from 'lucide-react';
import './ChatPanel.css';

interface ChatPanelProps {
  onClose?: () => void;
  onOpenLogs?: () => void;
}

const SYSTEM_PROMPT = `You are SouthStack AI, a helpful coding assistant. Provide concise, practical help with:
- Code generation and debugging
- Architecture recommendations
- Explaining concepts
- Best practices

Format code with proper syntax. Be direct and helpful.`;

export function ChatPanel({ onClose, onOpenLogs }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentResponse, setCurrentResponse] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const responseBufferRef = useRef('');

  const messages = useAppStore((s) => s.messages);
  const addMessage = useAppStore((s) => s.addMessage);
  const updateMessage = useAppStore((s) => s.updateMessage);
  const clearMessages = useAppStore((s) => s.clearMessages);
  const modelLoaded = useAppStore((s) => s.modelLoaded);
  const modelLoading = useAppStore((s) => s.modelLoading);
  const selectedModelId = useAppStore((s) => s.selectedModelId);
  const availableModels = useAppStore((s) => s.availableModels);
  const addEvent = useAppStore((s) => s.addEvent);
  const saveChatSession = useAppStore((s) => s.saveChatSession);
  const startNewChat = useAppStore((s) => s.startNewChat);
  const activeChatSessionId = useAppStore((s) => s.activeChatSessionId);
  const nodes = useAppStore((s) => s.nodes);
  const projectSession = useAppStore((s) => s.projectSession);
  const toggleDrawer = useAppStore((s) => s.toggleDrawer);

  const selectedModel = availableModels.find(m => m.id === selectedModelId);

  // A model is "available" if loaded locally OR a connected peer has one
  const peerWithModel = nodes.find(n => !n.isSelf && n.status !== 'offline' && n.modelLoaded);
  const anyModelAvailable = modelLoaded || !!peerWithModel;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentResponse]);

  const generateResponse = async (userMessage: string, placeholderMsgId: string): Promise<string> => {
    try {
      const response = await inferenceService.generateStream(
        userMessage,
        SYSTEM_PROMPT,
        (token) => {
          responseBufferRef.current += token;
          setCurrentResponse(responseBufferRef.current);
          // Update the placeholder message in real-time so the response is always visible
          updateMessage(placeholderMsgId, { content: responseBufferRef.current });
        }
      );
      return response || responseBufferRef.current;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      // Surface the error as the response so the user sees what happened
      return `⚠️ ${msg}`;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isGenerating) return;

    const userMessage = input.trim();
    setInput('');
    setIsGenerating(true);
    setCurrentResponse('');
    responseBufferRef.current = '';

    // Add user message
    addMessage({
      id: `user-${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    // Create placeholder for assistant
    const assistantMsgId = `assistant-${Date.now()}`;
    addMessage({
      id: assistantMsgId,
      role: 'assistant',
      content: 'Thinking...',
      timestamp: Date.now(),
    });

    try {
      const response = await generateResponse(userMessage, assistantMsgId);

      // Update the placeholder with the final response; fall back to whatever
      // onToken accumulated in case the return value is unexpectedly empty
      const finalContent = response || responseBufferRef.current || '(No response received)';
      updateMessage(assistantMsgId, { content: finalContent });

      addEvent({
        id: `event-${Date.now()}`,
        type: 'success',
        message: modelLoaded
          ? 'Response generated (local AI)'
          : peerWithModel
          ? `Response generated (peer: ${peerWithModel.name})`
          : 'Response generated (fallback)',
        timestamp: Date.now(),
      });

      // Auto-save session after first exchange
      if (!useAppStore.getState().activeChatSessionId) {
        saveChatSession();
      }

    } catch (error: any) {
      console.error('Chat error:', error);
      updateMessage(assistantMsgId, {
        content: `Sorry, I encountered an error: ${error.message}`,
      });
    } finally {
      setIsGenerating(false);
      setCurrentResponse('');
      responseBufferRef.current = '';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        <div className="chat-panel-title">
          <MessageSquare size={16} />
          <span>AI Assistant</span>
          {modelLoaded && (
            <span className="model-indicator">{selectedModel?.name || 'Model'}</span>
          )}
          {!modelLoaded && peerWithModel && (
            <span className="model-indicator peer-model-indicator">via {peerWithModel.name}</span>
          )}
          {!anyModelAvailable && !modelLoading && (
            <span className="no-model-indicator">No Model</span>
          )}
        </div>
        <div className="chat-panel-actions">
          <button className="chat-action-btn" onClick={() => startNewChat()} title="New chat">
            <Plus size={14} />
          </button>
          {messages.length > 0 && !activeChatSessionId && (
            <button className="chat-action-btn" onClick={() => saveChatSession()} title="Save chat">
              <Save size={14} />
            </button>
          )}
          <button className="chat-action-btn" onClick={clearMessages} title="Clear chat">
            <Trash2 size={14} />
          </button>
          {onClose && (
            <button className="chat-action-btn" onClick={onClose} title="Close chat">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {!anyModelAvailable && !modelLoading && (
        <div className="chat-model-warning">
          <p>No model loaded on any connected machine.</p>
          <p>Load a model in Settings on any laptop in the mesh to enable AI responses.</p>
        </div>
      )}
      {!modelLoaded && peerWithModel && (
        <div className="chat-peer-model-info">
          Using model on peer: <strong>{peerWithModel.name}</strong>
          {peerWithModel.modelId && <span> ({peerWithModel.modelId.split('/').pop()})</span>}
        </div>
      )}

      <div className="chat-panel-messages">
        {messages.length === 0 && (
          <div className="chat-empty-state">
            <Bot size={32} />
            <p>Ask me anything about coding, debugging, or your project.</p>
            <div className="chat-suggestions">
              <button onClick={() => setInput("Explain P2P mesh networking")}>P2P Mesh</button>
              <button onClick={() => setInput("Help me debug an error")}>Debug Help</button>
              <button onClick={() => setInput("Write a React component")}>Write Code</button>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`chat-msg ${msg.role}`}>
            <div className="chat-msg-avatar">
              {msg.role === 'user' ? <User size={12} /> : <Bot size={12} />}
            </div>
            <div className="chat-msg-content">
              <div className="chat-msg-text">{msg.content}</div>
              <div className="chat-msg-time">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}

        {isGenerating && (
          <div className="chat-msg assistant">
            <div className="chat-msg-avatar"><Bot size={12} /></div>
            <div className="chat-msg-content">
              <div className="chat-msg-text">
                <Loader2 size={12} className="spin" /> Generating...
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="chat-panel-input" onSubmit={handleSubmit}>
        <button
          type="button"
          className={`chat-logs-btn${projectSession?.status === 'running' ? ' active' : ''}`}
          onClick={() => { if (onOpenLogs) onOpenLogs(); else toggleDrawer(); }}
          title={projectSession ? `Build logs: ${projectSession.completedCount}/${projectSession.totalSubtasks} done` : 'Open build terminal'}
        >
          <Terminal size={14} />
          {projectSession?.status === 'running' && (
            <span className="chat-logs-badge">{projectSession.completedCount}/{projectSession.totalSubtasks}</span>
          )}
        </button>
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
        />
        <button
          type="submit"
          className="chat-send-btn"
          disabled={!input.trim() || isGenerating}
        >
          {isGenerating ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
        </button>
      </form>
    </div>
  );
}
