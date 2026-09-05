// ============================================
// P2PManager — WebRTC Mesh Networking
// ============================================
// Manages peer-to-peer connections via WebRTC DataChannels
// Connects to signaling server for peer discovery

import { io, Socket } from 'socket.io-client';
import { useAppStore } from '../stores/appStore';
import { generateId } from '../utils/helpers';
import { EventBus, MeshEvents } from './EventBus';
import type { PeerNode } from '../types';
import type { P2PMessage } from './P2PTypes';
// With vite-plugin-node-polyfills providing events, util, buffer, stream,
// simple-peer's CJS code runs correctly in the browser.
import SimplePeerImport from 'simple-peer';

// Vite CJS interop: unwrap if needed
const SimplePeer: any = (SimplePeerImport as any).default ?? SimplePeerImport;

function loadSimplePeer(): Promise<any> {
  return Promise.resolve(typeof SimplePeer === 'function' ? SimplePeer : null);
}

export type { P2PMessage } from './P2PTypes';

interface PeerConnection {
  id: string;
  name: string;
  peer: InstanceType<typeof SimplePeer> | null;
  connected: boolean;
  lastHeartbeat: number;
  // Track whether we are the initiator for this connection
  isInitiator: boolean;
}

export interface DiscoveredPeer {
  id: string;
  name: string;
}

type MessageHandler = (message: P2PMessage, fromPeerId: string) => void;

export class P2PManager {
  private selfId: string;
  private selfName: string;
  private connections: Map<string, PeerConnection> = new Map();
  // Tracks peers currently being set up to prevent duplicate connections
  private pendingConnections: Set<string> = new Set();
  // Queue signals that arrive while a connection is still being set up
  private pendingSignals: Map<string, any[]> = new Map();
  private socket: Socket | null = null;
  private messageHandlers: Map<string, MessageHandler[]> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private nodeUpdateInterval: ReturnType<typeof setInterval> | null = null;
  private signalingUrl: string;
  private destroyed = false;
  private isStandalone = false;
  private connected = false;
  private discoveredPeers: DiscoveredPeer[] = [];
  // Peer color assignments for cursor rendering
  private readonly PEER_COLORS = [
    '#4fc3f7', '#81c784', '#ffb74d', '#f06292',
    '#ce93d8', '#80cbc4', '#fff176', '#ff8a65',
  ];
  private peerColorMap: Map<string, string> = new Map();
  // Debounce timer for cursor broadcasts
  private cursorBroadcastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(signalingUrl?: string) {
    this.selfId = `node-${generateId()}`;
    this.selfName = `Node-${this.selfId.slice(5, 13)}`;
    // Priority: explicit URL > env variable > localStorage > fallback to current hostname
    this.signalingUrl =
      signalingUrl ||
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SIGNALING_SERVER) ||
      `http://${window.location.hostname}:3001`;
  }

  // ------------------------------------------
  // Connection lifecycle
  // ------------------------------------------

  async connect(): Promise<boolean> {
    try {
      this.addEvent('info', `Connecting to signaling server at ${this.signalingUrl}...`);

      // Disable socket.io's built-in reconnection — we manage retries ourselves
      // so the Promise resolves cleanly and doesn't leave zombie reconnect loops.
      this.socket = io(this.signalingUrl, {
        query: { nodeId: this.selfId, nodeName: this.selfName },
        transports: ['websocket', 'polling'],
        reconnection: false,
        timeout: 8000,
      });

      return new Promise((resolve) => {
        if (!this.socket) {
          this.goStandalone();
          resolve(false);
          return;
        }

        let resolved = false;
        const done = (value: boolean) => {
          if (resolved) return;
          resolved = true;
          resolve(value);
        };

        this.socket.on('connect', () => {
          this.connected = true;
          this.isStandalone = false;
          this.addEvent('success', 'Connected to signaling server');

          // Register self-node in store (sole source of truth)
          this.registerSelfNode();
          this.startHeartbeat();
          this.startReconnectWatch();

          done(true);
        });

        this.socket.on('disconnect', (reason) => {
          this.connected = false;
          this.addEvent('warning', `Disconnected from signaling server: ${reason}`);
          // Attempt one reconnect after brief delay
          this.scheduleReconnect();
        });

        this.socket.on('connect_error', (error) => {
          const msg = error.message || String(error);
          this.addEvent('warning', `Signaling server unreachable (${msg}) — retrying or going standalone`);
          if (!resolved) {
            // Failed to connect initially — go standalone immediately
            this.socket?.disconnect();
            this.goStandalone();
            done(false);
          }
        });

        // Server sends peer list on connection
        this.socket.on('peers', (peers: DiscoveredPeer[]) => {
          this.handlePeerList(peers);
        });

        // Server notifies when a new peer joins (shape: {id, name})
        this.socket.on('peer-joined', (peer: DiscoveredPeer) => {
          if (peer.id === this.selfId) return; // Ignore self
          if (this.discoveredPeers.some(p => p.id === peer.id)) return; // Dedup
          // Also skip if we already have a connection or pending connection
          if (this.connections.has(peer.id) || this.pendingConnections.has(peer.id)) return;
          this.addEvent('info', `New peer discovered: ${peer.name || peer.id.slice(0, 8)}`);
          this.discoveredPeers.push(peer);
          // Only the higher-ID peer initiates to avoid simultaneous offer collision
          if (this.selfId > peer.id) {
            this.connectToPeer(peer.id, peer.name, true);
          }
        });

        // Server notifies when a peer leaves
        this.socket.on('peer-left', (data: { peerId: string }) => {
          this.handlePeerDisconnect(data.peerId);
          this.discoveredPeers = this.discoveredPeers.filter(p => p.id !== data.peerId);
        });

        // WebRTC signaling
        this.socket.on('signal', (data: { from: string; signal: any }) => {
          this.handleIncomingSignal(data.from, data.signal).catch((err) => {
            this.addEvent('error', `Signal handler error: ${err.message}`);
          });
        });

        this.socket.on('offer', (data: { from: string; offer: any }) => {
          this.handleIncomingSignal(data.from, data.offer).catch((err) => {
            this.addEvent('error', `Offer handler error: ${err.message}`);
          });
        });

        this.socket.on('answer', (data: { from: string; answer: any }) => {
          this.handleIncomingSignal(data.from, data.answer).catch((err) => {
            this.addEvent('error', `Answer handler error: ${err.message}`);
          });
        });

        this.socket.on('ice-candidate', (_data: { from: string; candidate: RTCIceCandidate }) => {
          // SimplePeer handles ICE candidates internally with trickle
        });

        // Hard fallback: if neither connect nor connect_error fires within 12s, go standalone
        setTimeout(() => {
          if (!resolved) {
            this.addEvent('warning', 'Connection timed out — running standalone');
            this.socket?.disconnect();
            this.goStandalone();
            done(false);
          }
        }, 12000);
      });
    } catch (error: any) {
      this.addEvent('error', `Failed to connect: ${error.message}`);
      this.goStandalone();
      return false;
    }
  }

  // ------------------------------------------
  // Reconnect logic
  // ------------------------------------------

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.addEvent('warning', 'Max reconnect attempts reached — staying standalone');
      return;
    }
    const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    this.addEvent('info', `Reconnecting to signaling server in ${delay / 1000}s (attempt ${this.reconnectAttempts})...`);
    this.reconnectTimer = setTimeout(() => {
      if (this.destroyed || this.connected) return;
      this.socket?.connect();
    }, delay);
  }

  private startReconnectWatch(): void {
    // Reset reconnect counter on successful connection
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private goStandalone(): void {
    this.isStandalone = true;
    this.addEvent('info', 'Running in standalone mode (no peer mesh)');
    this.registerSelfNode();
    this.startHeartbeat();
  }

  /**
   * Register self-node in the store — sole source of truth for identity.
   * Called exactly once on connect() or goStandalone().
   * Also purges all stale nodes from previous sessions — real peers will
   * re-appear when they connect via WebRTC and send heartbeats.
   */
  private registerSelfNode(): void {
    const store = useAppStore.getState();
    store.setSelfId(this.selfId);

    // Remove ALL existing nodes — they're stale from a previous session.
    // The current self-node will be added fresh below, and real peers will
    // be added when they connect and send introduce/heartbeat messages.
    for (const node of store.nodes) {
      store.removeNode(node.id);
    }

    const selfNode = this.createSelfNode();
    store.addNode(selfNode);
  }

  // ------------------------------------------
  // Peer connection management
  // ------------------------------------------

  private handlePeerList(peers: DiscoveredPeer[]): void {
    this.discoveredPeers = peers.filter(p => p.id !== this.selfId);
    this.addEvent('info', `Discovered ${this.discoveredPeers.length} peer(s)`);

    for (const peer of this.discoveredPeers) {
      // Only the peer with the lexicographically higher ID acts as initiator.
      // This prevents both sides from simultaneously sending offers.
      if (this.selfId > peer.id) {
        this.connectToPeer(peer.id, peer.name, true);
      }
      // The lower-ID peer waits for an incoming signal and becomes non-initiator.
    }
  }

  private async connectToPeer(peerId: string, peerName?: string, initiator = true): Promise<void> {
    if (!peerId || peerId === this.selfId || this.destroyed) return;
    if (this.connections.has(peerId) || this.pendingConnections.has(peerId)) return;

    this.pendingConnections.add(peerId);
    const name = peerName || `Peer-${peerId.slice(0, 8)}`;

    try {
      const SP = await loadSimplePeer();
      if (!SP) {
        this.addEvent('error', `SimplePeer module not available`);
        return;
      }

      const conn: PeerConnection = {
        id: peerId,
        name,
        peer: null,
        connected: false,
        lastHeartbeat: Date.now(),
        isInitiator: initiator,
      };

      const peer = new SP({
        initiator,
        trickle: true,
        config: {
          iceServers: [],
          iceTransportPolicy: 'all',
        },
      });

      conn.peer = peer;
      this.connections.set(peerId, conn);
      this.setupPeerEvents(peer, conn, peerId);

      // Flush any signals that arrived while we were setting up
      const queued = this.pendingSignals.get(peerId);
      if (queued) {
        this.pendingSignals.delete(peerId);
        for (const sig of queued) {
          try { peer.signal(sig); } catch { /* ignore stale signals */ }
        }
      }
    } catch (error: any) {
      this.addEvent('error', `Failed to create peer connection: ${error.message}`);
    } finally {
      this.pendingConnections.delete(peerId);
    }
  }

  private setupPeerEvents(peer: InstanceType<typeof SimplePeer>, conn: PeerConnection, peerId: string): void {
    peer.on('signal', (signal: any) => {
      this.socket?.emit('signal', { to: peerId, signal });
    });

    peer.on('connect', () => {
      conn.connected = true;
      this.addEvent('success', `WebRTC connected to ${conn.name}`);
      this.updatePeerNode(peerId, { status: 'online' });
      EventBus.emit(MeshEvents.PEER_CONNECTED, peerId);

      // Introduce self
      this.send(peerId, {
        type: 'state-sync',
        payload: {
          action: 'introduce',
          node: this.createSelfNode(),
        },
      });

      // Assign a color to this peer for cursor rendering
      if (!this.peerColorMap.has(peerId)) {
        const idx = this.peerColorMap.size % this.PEER_COLORS.length;
        this.peerColorMap.set(peerId, this.PEER_COLORS[idx]);
      }

      // Push all local files to the newly connected peer
      const store = useAppStore.getState();
      if (store.files.length > 0) {
        this.send(peerId, {
          type: 'file-request',
          payload: {
            action: 'respond-all',
            files: store.files.map((f) => ({
              path: f.path,
              content: f.content,
              language: f.language,
              lastModified: f.lastModified,
              version: f.version,
            })),
          },
        });
      }

      // Request all files from the peer in case they have files we don't
      this.send(peerId, {
        type: 'file-request',
        payload: { action: 'request-all' },
      });
    });

    peer.on('data', (data: Uint8Array) => {
      try {
        const message: P2PMessage = JSON.parse(new TextDecoder().decode(data));
        this.handleMessage(message, peerId);
      } catch {
        // Silently ignore malformed messages
      }
    });

    peer.on('close', () => {
      this.handlePeerDisconnect(peerId);
    });

    peer.on('error', (err: Error) => {
      // Classify the error before logging/surfacing it
      const msg = err.message || '';
      const isCleanClose =
        msg.includes('User-Initiated Abort') ||
        msg.includes('Close called') ||
        msg.includes('Connection closed') ||
        msg.includes('wrong state');

      if (isCleanClose) {
        // Normal disconnect — debug-level only, no red error in the UI
        console.debug(`[P2P] Peer ${conn.name} closed:`, msg);
      } else {
        console.warn(`[P2P] Peer ${conn.name} error:`, err);
        this.addEvent('error', `Peer ${conn.name} error: ${msg}`);
      }
      this.updatePeerNode(peerId, { status: 'warning' });
    });
  }

  /**
   * Handle incoming WebRTC signal from signaling server.
   * The lower-ID peer is always the non-initiator and creates the connection here.
   * The higher-ID peer already created the connection in connectToPeer().
   */
  private async handleIncomingSignal(peerId: string, signal: any): Promise<void> {
    if (peerId === this.selfId) return;

    let conn = this.connections.get(peerId);

    if (!conn) {
      // If peer is currently being set up, queue the signal for later
      if (this.pendingConnections.has(peerId)) {
        if (!this.pendingSignals.has(peerId)) this.pendingSignals.set(peerId, []);
        this.pendingSignals.get(peerId)!.push(signal);
        return;
      }

      this.pendingConnections.add(peerId);
      try {
        const SP = await loadSimplePeer();
        if (!SP) {
          this.addEvent('error', `SimplePeer module not available for incoming signal`);
          return;
        }

        const name = this.discoveredPeers.find(p => p.id === peerId)?.name || `Peer-${peerId.slice(0, 8)}`;
        const newConn: PeerConnection = {
          id: peerId,
          name,
          peer: null,
          connected: false,
          lastHeartbeat: Date.now(),
          isInitiator: false,
        };

        const peer = new SP({
          initiator: false,
          trickle: true,
          config: {
            iceServers: [],
            iceTransportPolicy: 'all',
          },
        });

        newConn.peer = peer;
        this.connections.set(peerId, newConn);
        this.setupPeerEvents(peer, newConn, peerId);
        conn = newConn;

        // Flush any signals that arrived while we were setting up
        const queued = this.pendingSignals.get(peerId);
        if (queued) {
          this.pendingSignals.delete(peerId);
          for (const sig of queued) {
            try { peer.signal(sig); } catch { /* ignore stale */ }
          }
        }
      } catch (err: any) {
        this.addEvent('error', `Failed to create peer for signal: ${err.message}`);
        return;
      } finally {
        this.pendingConnections.delete(peerId);
      }
    }

    try {
      conn.peer!.signal(signal);
    } catch (err: any) {
      if (!err.message.includes('wrong state')) {
        this.addEvent('error', `Signal error for ${peerId.slice(0, 8)}: ${err.message}`);
      }
    }
  }

  /** Track peers we've already processed disconnect for to avoid duplicate events */
  private disconnectedPeers: Set<string> = new Set();

  private handlePeerDisconnect(peerId: string): void {
    // Guard against duplicate disconnect handling (both WebRTC close and socket peer-left fire)
    if (this.disconnectedPeers.has(peerId)) return;
    this.disconnectedPeers.add(peerId);
    // Clean up the guard after a short delay so future reconnects can be handled
    setTimeout(() => this.disconnectedPeers.delete(peerId), 5000);

    const conn = this.connections.get(peerId);
    if (conn) {
      if (conn.peer) {
        try { conn.peer.destroy(); } catch { /* already destroyed */ }
      }
      this.connections.delete(peerId);
    }
    this.pendingSignals.delete(peerId);
    this.pendingConnections.delete(peerId);

    // Remove cursor decorations for this peer immediately
    useAppStore.getState().removePeerCursor(peerId);
    this.peerColorMap.delete(peerId);

    // Mark offline briefly, then remove the node entirely after a short delay.
    // If the peer reconnects within 10s, the new connection will re-add it.
    this.updatePeerNode(peerId, { status: 'offline' });
    this.addEvent('warning', `Peer ${peerId.slice(0, 8)} disconnected`);
    EventBus.emit(MeshEvents.PEER_DISCONNECTED, peerId);

    // Remove stale node from the store so ghost entries don't accumulate
    setTimeout(() => {
      const store = useAppStore.getState();
      const node = store.nodes.find(n => n.id === peerId);
      if (node && node.status === 'offline') {
        store.removeNode(peerId);
      }
    }, 10000);
  }

  // ------------------------------------------
  // Messaging
  // ------------------------------------------

  send(peerId: string, message: Omit<P2PMessage, 'senderId' | 'timestamp'>): void {
    const conn = this.connections.get(peerId);
    if (!conn?.connected || !conn.peer) return;

    const fullMessage: P2PMessage = {
      ...message,
      senderId: this.selfId,
      timestamp: Date.now(),
    };

    try {
      conn.peer.send(JSON.stringify(fullMessage));
    } catch {
      // Silently ignore send failures
    }
  }

  broadcast(message: Omit<P2PMessage, 'senderId' | 'timestamp'>): void {
    for (const [peerId] of this.connections) {
      this.send(peerId, message);
    }
  }

  private handleMessage(message: P2PMessage, fromPeerId: string): void {
    const conn = this.connections.get(fromPeerId);
    if (conn) conn.lastHeartbeat = Date.now();

    if (message.type === 'heartbeat') {
      this.handleHeartbeat(message, fromPeerId);
      return;
    }

    if (message.type === 'state-sync' && message.payload?.action === 'introduce') {
      const node = message.payload.node as PeerNode;
      this.updatePeerNode(fromPeerId, {
        ...node,
        isSelf: false, // Never trust remote claim of isSelf
      });

      // Update connection name
      const peerConn = this.connections.get(fromPeerId);
      if (peerConn) peerConn.name = node.name;
      return;
    }

    if (message.type === 'file-sync') {
      const action = message.payload?.action;
      if (action === 'create' || action === 'update' || action === 'delete') {
        this.handleFileSync(message.payload, fromPeerId);
        return;
      }
    }

    if (message.type === 'cursor') {
      this.handleCursorMessage(message.payload, fromPeerId);
      return;
    }

    if (message.type === 'file-request') {
      this.handleFileRequest(message.payload, fromPeerId);
      return;
    }

    // Dispatch to registered handlers
    const handlers = this.messageHandlers.get(message.type);
    if (handlers) {
      for (const handler of handlers) {
        handler(message, fromPeerId);
      }
    }
  }

  on(type: string, handler: MessageHandler): void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type)!.push(handler);
  }

  off(type: string, handler: MessageHandler): void {
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }
  }

  // ------------------------------------------
  // Heartbeat & health monitoring
  // ------------------------------------------

  private startHeartbeat(): void {
    // Heartbeat every 5 seconds
    this.heartbeatInterval = setInterval(() => {
      if (this.destroyed) return;

      const store = useAppStore.getState();
      const selfNode = store.nodes.find(n => n.id === this.selfId);
      if (!selfNode) return;

      const uptime = selfNode.uptime + 5;
      store.updateNode(this.selfId, {
        status: 'online',  // Always ensure self shows as online
        uptime,
        ramUsed: this.getRAMUsage(),
        lastHeartbeat: Date.now(),
      });

      const store2 = useAppStore.getState();
      this.broadcast({
        type: 'heartbeat',
        payload: {
          vramUsed: selfNode.vramUsed,
          ramUsed: this.getRAMUsage(),
          status: 'online',
          uptime,
          modelId: store2.modelLoaded ? store2.selectedModelId : null,
          modelLoaded: store2.modelLoaded,
        },
      });

      // Check for stale peers.
      // Peers running long AI tasks send heartbeats less frequently than 5s intervals,
      // so we extend the disconnect threshold for peers with active tasks to avoid
      // false-positive disconnects that would trigger costly reassignment.
      const now = Date.now();
      for (const [peerId, conn] of this.connections) {
        const peerNode = store.nodes.find((n) => n.id === peerId);
        const isBusy = peerNode?.currentTask != null;
        // Busy = up to 3 minutes before warning / 6 minutes before disconnect
        // Idle  = 15 seconds warning / 30 seconds disconnect
        const warnThreshold    = isBusy ? 180_000 : 15_000;
        const disconnectThresh = isBusy ? 360_000 : 30_000;

        if (now - conn.lastHeartbeat > warnThreshold) {
          this.updatePeerNode(peerId, { status: 'warning' });
        }
        if (now - conn.lastHeartbeat > disconnectThresh) {
          this.handlePeerDisconnect(peerId);
        }
      }
    }, 5000);

    // Full node update every 30 seconds
    this.nodeUpdateInterval = setInterval(() => {
      if (this.destroyed) return;

      this.broadcast({
        type: 'state-sync',
        payload: {
          action: 'update',
          node: this.createSelfNode(),
        },
      });
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.nodeUpdateInterval) {
      clearInterval(this.nodeUpdateInterval);
      this.nodeUpdateInterval = null;
    }
  }

  // ------------------------------------------
  // File sync
  // ------------------------------------------

  private handleFileSync(payload: any, _fromPeerId: string): void {
    if (payload.action === 'create' || payload.action === 'update') {
      const file = payload.file;
      const store = useAppStore.getState();
      const existing = store.files.find(f => f.path === file.path);

      if (!existing || file.lastModified > existing.lastModified) {
        if (existing) {
          store.updateFile(file.path, file);
        } else {
          store.addFile(file);
          this.addEvent('info', `File synced: ${file.path}`);
        }
        // Don't log every keystroke update — only log new files
      }
    }

    if (payload.action === 'delete') {
      const store = useAppStore.getState();
      const existed = store.files.some(f => f.path === payload.path);
      store.closeTab(payload.path);
      store.removeFile(payload.path);
      if (existed) {
        this.addEvent('info', `File deleted by peer: ${payload.path}`);
      }
    }
  }

  // ------------------------------------------
  // Cursor sharing
  // ------------------------------------------

  private handleCursorMessage(payload: any, fromPeerId: string): void {
    if (!payload?.filePath) return;
    const color = this.peerColorMap.get(fromPeerId) ?? '#4fc3f7';
    const conn = this.connections.get(fromPeerId);
    useAppStore.getState().upsertPeerCursor(fromPeerId, {
      peerId: fromPeerId,
      peerName: conn?.name ?? `Peer-${fromPeerId.slice(0, 6)}`,
      color,
      filePath: payload.filePath,
      line: payload.line ?? 1,
      column: payload.column ?? 1,
      selection: payload.selection ?? null,
    });
  }

  broadcastCursor(filePath: string, line: number, column: number, selection: any): void {
    // Debounce at 80ms — cursor events fire very frequently
    if (this.cursorBroadcastTimer) clearTimeout(this.cursorBroadcastTimer);
    this.cursorBroadcastTimer = setTimeout(() => {
      this.broadcast({
        type: 'cursor',
        payload: {
          filePath,
          line,
          column,
          selection,
          peerName: this.selfName,
          color: '', // peers use their own color map
        },
      });
    }, 80);
  }

  getPeerColor(peerId: string): string {
    if (!this.peerColorMap.has(peerId)) {
      const idx = this.peerColorMap.size % this.PEER_COLORS.length;
      this.peerColorMap.set(peerId, this.PEER_COLORS[idx]);
    }
    return this.peerColorMap.get(peerId)!;
  }

  // ------------------------------------------
  // File request protocol
  // ------------------------------------------

  private handleFileRequest(payload: any, fromPeerId: string): void {
    if (payload?.action === 'request-all') {
      // Peer is asking for all our files — respond with everything we have
      const store = useAppStore.getState();
      if (store.files.length > 0) {
        this.send(fromPeerId, {
          type: 'file-request',
          payload: {
            action: 'respond-all',
            files: store.files.map((f) => ({
              path: f.path,
              content: f.content,
              language: f.language,
              lastModified: f.lastModified,
              version: f.version,
            })),
          },
        });
      }
      return;
    }

    if (payload?.action === 'respond-all') {
      // Peer sent us their full file list — merge with last-write-wins
      const store = useAppStore.getState();
      const files: any[] = payload.files ?? [];
      for (const file of files) {
        const existing = store.files.find((f) => f.path === file.path);
        if (!existing) {
          store.addFile(file);
        } else if (file.lastModified > existing.lastModified) {
          store.updateFile(file.path, file);
        }
      }
      if (files.length > 0) {
        this.addEvent('info', `Received ${files.length} file(s) from peer`);
      }
    }
  }

  syncFile(file: { path: string; content: string; language: string }): void {
    const store = useAppStore.getState();
    const existing = store.files.find(f => f.path === file.path);
    const now = Date.now();

    const virtualFile = {
      path: file.path,
      content: file.content,
      language: file.language,
      lastModified: now,
      version: existing ? existing.version + 1 : 1,
    };

    if (existing) {
      store.updateFile(file.path, virtualFile);
    } else {
      store.addFile(virtualFile);
    }

    this.broadcast({
      type: 'file-sync',
      payload: {
        action: existing ? 'update' : 'create',
        file: virtualFile,
      },
    });
  }

  deleteFile(path: string): void {
    const store = useAppStore.getState();
    store.removeFile(path);

    this.broadcast({
      type: 'file-sync',
      payload: { action: 'delete', path },
    });
  }

  // ------------------------------------------
  // Heartbeat handler
  // ------------------------------------------

  private handleHeartbeat(message: P2PMessage, fromPeerId: string): void {
    const store = useAppStore.getState();
    const existing = store.nodes.find(n => n.id === fromPeerId);
    const patch: Partial<PeerNode> = {
      vramUsed: message.payload.vramUsed ?? existing?.vramUsed ?? 0,
      ramUsed: message.payload.ramUsed ?? existing?.ramUsed ?? 0,
      status: message.payload.status ?? 'online',
      uptime: message.payload.uptime ?? existing?.uptime ?? 0,
      lastHeartbeat: Date.now(),
      latency: Math.max(0, Date.now() - message.timestamp),
    };
    // Track which model the peer has loaded
    if (message.payload.modelId !== undefined) {
      patch.modelId = message.payload.modelId;
    }
    if (message.payload.modelLoaded !== undefined) {
      patch.modelLoaded = message.payload.modelLoaded;
    }
    if (existing) {
      store.updateNode(fromPeerId, patch);
    } else {
      // Peer sent heartbeat before we got the introduce message — create stub
      this.updatePeerNode(fromPeerId, patch);
    }
  }

  // ------------------------------------------
  // Capability detection
  // ------------------------------------------

  private createSelfNode(): PeerNode {
    const store = useAppStore.getState();
    return {
      id: this.selfId,
      name: this.selfName,
      role: 'worker',
      status: 'online',
      vram: this.detectVRAM(),
      vramUsed: store.modelLoaded ? (store.availableModels.find(m => m.id === store.selectedModelId)?.vramRequired ?? 0) : 0,
      ramTotal: this.detectRAM(),
      ramUsed: this.getRAMUsage(),
      latency: 0,
      uptime: 0,
      lastHeartbeat: Date.now(),
      currentTask: null,
      capabilities: this.detectCapabilities(),
      isSelf: true,
      modelLoaded: store.modelLoaded,
      modelId: store.selectedModelId || null,
    };
  }

  private detectVRAM(): number {
    // navigator.deviceMemory gives system RAM in GB (approximate)
    // GPU VRAM is typically ~25-100% of system RAM for integrated GPUs
    // For dedicated GPUs we can't know, so estimate conservatively
    const deviceMemory = (navigator as any).deviceMemory || 4; // GB
    return Math.min(deviceMemory * 1024, 8192); // Cap at 8GB
  }

  private detectRAM(): number {
    const deviceMemory = (navigator as any).deviceMemory || 4; // GB
    return deviceMemory * 1024; // Convert to MB
  }

  private getRAMUsage(): number {
    if ((performance as any).memory) {
      return Math.round((performance as any).memory.usedJSHeapSize / (1024 * 1024));
    }
    return 0;
  }

  private detectCapabilities(): string[] {
    const caps: string[] = ['inference'];
    if ('gpu' in navigator) caps.push('webgpu');
    if ('serviceWorker' in navigator) caps.push('offline');
    caps.push('debug');
    return caps;
  }

  private updatePeerNode(peerId: string, patch: Partial<PeerNode>): void {
    const store = useAppStore.getState();
    const exists = store.nodes.find(n => n.id === peerId);
    if (exists) {
      store.updateNode(peerId, patch);
    } else {
      store.addNode({
        id: peerId,
        name: patch.name || `Peer-${peerId.slice(0, 8)}`,
        role: 'worker',
        status: 'online',
        vram: 4096,
        vramUsed: 0,
        ramTotal: 8192,
        ramUsed: 0,
        latency: 0,
        uptime: 0,
        lastHeartbeat: Date.now(),
        currentTask: null,
        capabilities: ['inference'],
        isSelf: false,
        ...patch,
      });
    }
  }

  // ------------------------------------------
  // Event helper
  // ------------------------------------------

  private addEvent(type: 'info' | 'success' | 'warning' | 'error' | 'mesh', message: string): void {
    useAppStore.getState().addEvent({
      id: generateId(),
      type,
      message,
      timestamp: Date.now(),
    });
  }

  // ------------------------------------------
  // Public API
  // ------------------------------------------

  getSelfId(): string {
    return this.selfId;
  }

  getSelfName(): string {
    return this.selfName;
  }

  getConnectedPeers(): string[] {
    return Array.from(this.connections.entries())
      .filter(([, conn]) => conn.connected)
      .map(([id]) => id);
  }

  getPeerCount(): number {
    return this.getConnectedPeers().length;
  }

  isConnected(peerId: string): boolean {
    return this.connections.get(peerId)?.connected ?? false;
  }

  isMeshConnected(): boolean {
    return this.connected && !this.isStandalone;
  }

  isStandaloneMode(): boolean {
    return this.isStandalone;
  }

  /**
   * Attempt to reconnect to the signaling server from standalone mode.
   * Called by the UI "Retry" button.
   */
  async reconnect(): Promise<boolean> {
    if (this.connected) return true;
    if (this.destroyed) return false;

    this.isStandalone = false;
    this.reconnectAttempts = 0;

    // If socket exists, try to reconnect it
    const sock = this.socket;
    if (sock) {
      return new Promise<boolean>((resolve) => {
        let resolved = false;
        const done = (v: boolean) => { if (!resolved) { resolved = true; resolve(v); } };

        const onConnect = () => {
          sock.off('connect', onConnect);
          sock.off('connect_error', onError);
          this.connected = true;
          this.isStandalone = false;
          this.addEvent('success', 'Reconnected to signaling server');
          this.startReconnectWatch();
          done(true);
        };
        const onError = () => {
          sock.off('connect', onConnect);
          sock.off('connect_error', onError);
          this.isStandalone = true;
          done(false);
        };

        sock.once('connect', onConnect);
        sock.once('connect_error', onError);
        sock.connect();

        setTimeout(() => {
          sock.off('connect', onConnect);
          sock.off('connect_error', onError);
          if (!resolved) {
            this.isStandalone = true;
            done(false);
          }
        }, 8000);
      });
    }

    // No socket — do a full connect
    return this.connect();
  }

  getDiscoveredPeers(): DiscoveredPeer[] {
    return this.discoveredPeers;
  }

  destroy(): void {
    this.destroyed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.cursorBroadcastTimer) {
      clearTimeout(this.cursorBroadcastTimer);
      this.cursorBroadcastTimer = null;
    }
    for (const [, conn] of this.connections) {
      if (conn.peer) {
        try { conn.peer.destroy(); } catch { /* already destroyed */ }
      }
    }
    this.connections.clear();
    this.socket?.disconnect();
    this.socket = null;
  }
}
