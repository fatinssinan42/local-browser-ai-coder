import { useEffect, useRef } from 'react';
import { useAppStore } from './stores/appStore';
import { UnifiedIDE } from './components/unified/UnifiedIDE';
import { getMeshOrchestrator } from './services/MeshOrchestrator';

export function App() {
  const theme = useAppStore((s) => s.theme);
  // Guard against React StrictMode double-invoke in development.
  // Without this, two socket connections, two model loads, and duplicate events occur.
  const initializedRef = useRef(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const savedUrl =
      localStorage.getItem('signalingServer') ||
      import.meta.env.VITE_SIGNALING_SERVER ||
      `http://${window.location.hostname}:3001`;
    const orchestrator = getMeshOrchestrator(savedUrl);
    orchestrator.initialize().catch((err) => {
      console.error('Failed to initialize mesh:', err);
    });

    // Do NOT destroy on cleanup — StrictMode unmounts then remounts,
    // and destroying kills the socket/WebRTC connections permanently.
    // The orchestrator singleton persists across the app lifecycle.
  }, []);

  return <UnifiedIDE />;
}
