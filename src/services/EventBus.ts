type EventCallback = (...args: any[]) => void;

class EventBusClass {
  private listeners: Map<string, Set<EventCallback>> = new Map();

  on(event: string, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  off(event: string, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  emit(event: string, ...args: any[]): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((cb) => {
        try {
          cb(...args);
        } catch (err) {
          console.error(`EventBus: Error in handler for "${event}":`, err);
        }
      });
    }
  }

  once(event: string, callback: EventCallback): void {
    const wrapper: EventCallback = (...args: any[]) => {
      this.off(event, wrapper);
      callback(...args);
    };
    this.on(event, wrapper);
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

export const EventBus = new EventBusClass();

export const MeshEvents = {
  PEER_CONNECTED: 'mesh:peer-connected',
  PEER_DISCONNECTED: 'mesh:peer-disconnected',
  MASTER_CHANGED: 'mesh:master-changed',
  STATE_SYNC: 'mesh:state-sync',
  TASK_ASSIGNED: 'task:assigned',
  TASK_PROGRESS: 'task:progress',
  TASK_COMPLETED: 'task:completed',
  TASK_FAILED: 'task:failed',
  MODEL_LOADED: 'model:loaded',
  MODEL_UNLOADED: 'model:unloaded',
  INFERENCE_COMPLETE: 'inference:complete',
  // Agent system events — consumed by CommandTerminal for live updates
  AGENT_STARTED: 'agent:started',
  AGENT_PROGRESS: 'agent:progress',
  AGENT_TOKEN: 'agent:token',
  AGENT_COMPLETED: 'agent:completed',
  AGENT_ERROR: 'agent:error',
  // Chat history events
  CHAT_SESSION_LOADED: 'chat:session-loaded',
  // Project builder events
  PROJECT_SESSION_STARTED: 'project:session-started',
  PROJECT_SESSION_COMPLETED: 'project:session-completed',
  PROJECT_SESSION_FAILED: 'project:session-failed',
  PROJECT_SUBTASK_UPDATED: 'project:subtask-updated',
  // Micro-detail log line for terminal streaming
  // payload: { sessionId, level, text, node?, file?, done?, total? }
  PROJECT_LOG_LINE: 'project:log-line',
} as const;
