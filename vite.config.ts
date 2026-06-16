import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// WebLLM requires SharedArrayBuffer for WASM threading.
// SharedArrayBuffer requires COOP + COEP headers (cross-origin isolation).
// IMPORTANT: Use 'credentialless' (not 'require-corp') for COEP so that
// cross-origin CDN fetches (HuggingFace model weights) are not blocked.
// 'credentialless' still satisfies the cross-origin isolation requirement
// in Chromium 96+ (Chrome, Edge) which is the WebGPU baseline anyway.
const webLLMHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  plugins: [
    react(),
    // simple-peer depends on Node.js built-ins (events, util, buffer,
    // readable-stream). Without polyfills Vite externalizes them,
    // producing "Cannot access events.EventEmitter" at runtime.
    nodePolyfills({
      include: ['events', 'util', 'buffer', 'process', 'stream'],
      globals: { Buffer: true, process: true },
    }),
    // Dev server: inject cross-origin isolation headers
    {
      name: 'coop-coep-headers',
      configureServer(server) {
        server.middlewares.use((_req, res, next) => {
          Object.entries(webLLMHeaders).forEach(([k, v]) => res.setHeader(k, v));
          next();
        });
      },
      // Preview server too
      configurePreviewServer(server) {
        server.middlewares.use((_req, res, next) => {
          Object.entries(webLLMHeaders).forEach(([k, v]) => res.setHeader(k, v));
          next();
        });
      },
    },
  ],
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ["monaco-editor", "simple-peer"],
    exclude: ["@mlc-ai/web-llm"],
  },
  server: {
    port: 5173,
    host: true,
    headers: webLLMHeaders,
  },
  preview: {
    headers: webLLMHeaders,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          monaco: ["monaco-editor"],
          vendor: ["react", "react-dom", "zustand"],
        },
      },
    },
  },
});
