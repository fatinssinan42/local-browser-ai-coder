// ============================================
// LeaderElection — Master Failover
// ============================================
// Implements leader election using a scoring algorithm based on
// VRAM capacity, uptime, latency, and reliability.
// Automatically triggers re-election on master disconnect.

import { useAppStore } from '../stores/appStore';
import { generateId } from '../utils/helpers';
import type { P2PManager, P2PMessage } from './P2PManager';
import type { PeerNode } from '../types';
import { EventBus, MeshEvents } from './EventBus';

interface ElectionVote {
  candidateId: string;
  score: number;
  voterId: string;
}

export class LeaderElection {
  private p2p: P2PManager;
  private electionInProgress = false;
  private electionTimeout: ReturnType<typeof setTimeout> | null = null;
  private votes: ElectionVote[] = [];
  private readonly ELECTION_TIMEOUT = 5000;

  constructor(p2p: P2PManager) {
    this.p2p = p2p;
    this.setupListeners();
  }

  private setupListeners(): void {
    // Listen for election messages
    this.p2p.on('election', (message: P2PMessage) => {
      this.handleElectionMessage(message);
    });

    // Listen for peer disconnections via EventBus to check if master left
    EventBus.on(MeshEvents.PEER_DISCONNECTED, (disconnectedId: string) => {
      const store = useAppStore.getState();
      if (disconnectedId === store.masterId) {
        this.addEvent('warning', 'Master node disconnected — initiating re-election');
        this.startElection();
      }
    });
  }

  // ------------------------------------------
  // Election process
  // ------------------------------------------

  startElection(): void {
    if (this.electionInProgress) return;
    this.electionInProgress = true;
    this.votes = [];

    this.addEvent('mesh', 'Leader election started');

    // Calculate own score
    const store = useAppStore.getState();
    const selfNode = store.nodes.find((n) => n.id === this.p2p.getSelfId());
    if (!selfNode) {
      this.electionInProgress = false;
      return;
    }

    const selfScore = this.calculateScore(selfNode);

    // Cast own vote
    this.votes.push({
      candidateId: this.p2p.getSelfId(),
      score: selfScore,
      voterId: this.p2p.getSelfId(),
    });

    const peerCount = this.p2p.getPeerCount();

    if (peerCount === 0) {
      // Standalone: immediately self-promote, no peers to wait for
      this.addEvent('info', 'No peers — self-promoting as master');
      this.electionInProgress = false;
      this.applyNewMaster(this.p2p.getSelfId());
      return;
    }

    // Broadcast election call with own score
    this.p2p.broadcast({
      type: 'election',
      payload: {
        phase: 'call',
        candidateId: this.p2p.getSelfId(),
        score: selfScore,
      },
    });

    // Wait for votes, then decide
    this.electionTimeout = setTimeout(() => {
      this.resolveElection();
    }, this.ELECTION_TIMEOUT);
  }

  private handleElectionMessage(message: P2PMessage): void {
    const { phase, candidateId, score, winnerId } = message.payload;

    switch (phase) {
      case 'call': {
        // Another node started an election — respond with our score
        const store = useAppStore.getState();
        const selfNode = store.nodes.find((n) => n.id === this.p2p.getSelfId());
        if (!selfNode) return;

        const selfScore = this.calculateScore(selfNode);
        this.p2p.send(message.senderId, {
          type: 'election',
          payload: {
            phase: 'vote',
            candidateId: this.p2p.getSelfId(),
            score: selfScore,
            voterId: this.p2p.getSelfId(),
          },
        });

        // If we haven't started our own election, start one
        if (!this.electionInProgress) {
          this.electionInProgress = true;
          this.votes = [];
          this.votes.push({ candidateId, score, voterId: message.senderId });
          this.votes.push({ candidateId: this.p2p.getSelfId(), score: selfScore, voterId: this.p2p.getSelfId() });

          this.electionTimeout = setTimeout(() => {
            this.resolveElection();
          }, this.ELECTION_TIMEOUT);
        } else {
          this.votes.push({ candidateId, score, voterId: message.senderId });
        }
        break;
      }

      case 'vote': {
        if (this.electionInProgress) {
          this.votes.push({ candidateId, score, voterId: message.payload.voterId });
        }
        break;
      }

      case 'elected': {
        // Accept the election result
        this.electionInProgress = false;
        if (this.electionTimeout) clearTimeout(this.electionTimeout);
        this.applyNewMaster(winnerId);
        break;
      }
    }
  }

  private resolveElection(): void {
    if (!this.electionInProgress) return;
    this.electionInProgress = false;

    // Find highest-scoring candidate
    const scoreMap = new Map<string, number>();
    for (const vote of this.votes) {
      const current = scoreMap.get(vote.candidateId) || 0;
      scoreMap.set(vote.candidateId, Math.max(current, vote.score));
    }

    let bestId = this.p2p.getSelfId();
    let bestScore = 0;
    for (const [id, score] of scoreMap) {
      if (score > bestScore || (score === bestScore && id > bestId)) {
        bestId = id;
        bestScore = score;
      }
    }

    // Broadcast result
    this.p2p.broadcast({
      type: 'election',
      payload: {
        phase: 'elected',
        winnerId: bestId,
      },
    });

    this.applyNewMaster(bestId);
  }

  private applyNewMaster(masterId: string): void {
    const store = useAppStore.getState();
    const oldMasterId = store.masterId;

    // Demote old master
    if (oldMasterId && oldMasterId !== masterId) {
      store.updateNode(oldMasterId, { role: 'worker' });
    }

    // Promote new master
    store.setMasterId(masterId);
    store.updateNode(masterId, { role: 'master' });

    const masterNode = store.nodes.find((n) => n.id === masterId);
    const name = masterNode?.name || masterId.slice(0, 8);
    this.addEvent('success', `New master elected: ${name}`);

    // Emit event for other components
    EventBus.emit(MeshEvents.MASTER_CHANGED, { 
      masterId, 
      oldMasterId,
      isSelf: masterId === this.p2p.getSelfId() 
    });
  }

  // ------------------------------------------
  // Scoring
  // ------------------------------------------

  private calculateScore(node: PeerNode): number {
    // Higher is better
    let score = 0;

    // VRAM capacity (0–40 points)
    score += Math.min(40, (node.vram / 8192) * 40);

    // Available VRAM (0–20 points)
    const vramFree = (node.vram - node.vramUsed) / node.vram;
    score += vramFree * 20;

    // Uptime (0–20 points) — prefer nodes that have been stable longer
    score += Math.min(20, (node.uptime / 3600) * 20);

    // Low latency (0–10 points)
    score += Math.max(0, 10 - (node.latency / 100) * 10);

    // Bonus for WebGPU support
    if (node.capabilities.includes('webgpu')) score += 10;

    return Math.round(score * 100) / 100;
  }

  // ------------------------------------------
  // Public API
  // ------------------------------------------

  forceElection(): void {
    if (this.electionInProgress) return;
    this.startElection();
  }

  getCurrentMaster(): string | null {
    return useAppStore.getState().masterId;
  }

  isSelfMaster(): boolean {
    return useAppStore.getState().masterId === this.p2p.getSelfId();
  }

  private addEvent(type: 'info' | 'success' | 'warning' | 'error' | 'mesh', message: string): void {
    useAppStore.getState().addEvent({
      id: generateId(),
      type,
      message,
      timestamp: Date.now(),
    });
  }
}
