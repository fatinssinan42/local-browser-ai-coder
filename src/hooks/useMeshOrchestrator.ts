// ============================================
// useMeshOrchestrator — React hook for mesh services
// ============================================

import { useEffect, useRef } from 'react';
import { getMeshOrchestrator, destroyMeshOrchestrator } from '../services/MeshOrchestrator';
import type { MeshOrchestrator } from '../services/MeshOrchestrator';

/**
 * Hook to access and initialize the mesh orchestrator.
 * Initializes on first mount, cleans up on unmount.
 */
export function useMeshOrchestrator(signalingUrl?: string): MeshOrchestrator {
  const orchestratorRef = useRef<MeshOrchestrator>(getMeshOrchestrator(signalingUrl));

  useEffect(() => {
    const orch = orchestratorRef.current;
    orch.initialize().catch(console.error);

    return () => {
      destroyMeshOrchestrator();
    };
  }, []);

  return orchestratorRef.current;
}
