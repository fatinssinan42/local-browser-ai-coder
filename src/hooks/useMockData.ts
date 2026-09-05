// ============================================
// Hooks — State Initialization (Legacy)
// ============================================
// Self-node initialization is now handled by P2PManager.registerSelfNode().
// This file is kept only for backward compatibility — it is a no-op.

export function useMockData(): void {
  // No-op: P2PManager is the sole source of truth for self-node identity.
}

export function initializeRealState(): void {
  // No-op: P2PManager is the sole source of truth for self-node identity.
}
