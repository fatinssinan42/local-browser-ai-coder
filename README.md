# SouthStack Offline AI IDE

A distributed browser-based P2P AI coding mesh built on WebRTC, WebGPU, and offline-first principles.

## Status: MVP Ready ✅

- ✅ Build infrastructure working (zero errors)
- ✅ Type system complete (strict throughout)
- ✅ Message protocols fully defined & validated
- ✅ P2P networking fully implemented (WebRTC + signaling)
- ✅ Model loading & inference wired (WebGPU + WebLLM)
- ✅ Task distribution & execution implemented (all 5 task types)
- ✅ Leader election & failover implemented
- ✅ Persistence layer ready (IndexedDB)
- ⏳ **VALIDATION IN PROGRESS:** Testing on 2+ machines via WiFi

**See:** [GETTING_STARTED.md](GETTING_STARTED.md) to run the distributed mesh

## What This Is

A next-generation AI coding environment where:
- Multiple browser tabs/machines work together as a single mesh
- One acts as Master/Orchestrator, others are Workers
- All computation is local (WebGPU) or distributed among peers
- No cloud backend required
- Fault-tolerant: continues if nodes fail
- Shared workspace across all nodes

## Current Capabilities

### ✅ Fully Implemented & Integrated
- Browser app compiles and runs (zero TypeScript errors)
- Type-safe message protocol (8 types, all validated)
- State management (Zustand, fully reactive)
- P2P networking (WebRTC + Socket.io signaling)
- Model loading (WebLLM integration complete)
- Model inference (streaming generation, VRAM-aware)
- Task creation, assignment, execution (all 5 task types)
- Leader election (scoring algorithm + failover)
- Persistence layer (IndexedDB configured)
- Test framework (Vitest, 34+ tests passing)
- UI shell with all views (14+ components)

### ⏳ Validation In Progress
- Multi-machine P2P connections (untested in production)
- Model download & inference (untested on real GPU)
- Task execution across mesh (untested end-to-end)
- Failover scenarios (untested)

### 🔜 Not Yet
- Voice input/output (stub only)
- Large context splitting (untested)
- File synchronization (untested)
- Distributed debugging (stub only)

See [STATUS.md](STATUS.md) for detailed breakdown.

## Quick Start

### Single Machine (Local Mode)
```bash
npm install
npm run dev
```
Opens at http://localhost:5173. Use chat panel with fallback responses (no model loaded).

### Multi-Machine Mesh (Real Distributed System)
```bash
# Terminal 1: Start signaling server
node server/index.js

# Terminal 2: Start dev server
npm run dev

# Open on multiple machines on same WiFi
# http://localhost:5173 (each machine)
```

See **[GETTING_STARTED.md](GETTING_STARTED.md)** for detailed setup, troubleshooting, and feature explanations.

## Architecture

See [ROADMAP.md](ROADMAP.md) for complete implementation plan.

### Components

1. **P2PManager** - WebRTC peer networking and signaling
2. **LeaderElection** - Master selection algorithm
3. **TaskDistributor** - Work assignment across mesh
4. **InferenceEngine** - Local WebGPU LLM execution
5. **RecoveryManager** - Persistence and fault tolerance
6. **MeshOrchestrator** - Service coordinator

### Message Types

- `heartbeat` - Vital stats (VRAM, latency, uptime)
- `state-sync` - Peer introduction and updates
- `task` - Work assignment and progress
- `result` - Completion and aggregation
- `file-sync` - Shared workspace updates
- `election` - Leader selection
- `debug` - Distributed debugging
- `chat` - Peer communication

See [P2PProtocol.ts](src/services/P2PProtocol.ts) for strict definitions.

## Key Features (Planned)

- **Local-First Inference** - WebGPU models load and run locally (Phi-3.5, Gemma-2b, Qwen)
- **P2P Coordination** - WebRTC DataChannels for peer-to-peer mesh
- **Leader Election** - Automatic master selection by capability
- **Smart Task Routing** - Assign work based on VRAM, latency, uptime
- **Fault Tolerance** - Recover from node failures, restart, crash
- **Shared Files** - Synchronized workspace across all nodes
- **Live Debugging** - Debug across the mesh
- **Voice Integration** - Optional speech input/output
- **No Backend** - Entirely browser-based

## Project Structure

```
src/
  components/        # React UI components
  core/             # Core subsystems
  services/         # P2P, coordination, execution
  stores/           # Zustand global state
  types/            # TypeScript definitions
  utils/            # Helpers
  hooks/            # React hooks
  __tests__/        # Unit & integration tests
server/            # Signaling server (WIP)
```

## Documentation

- **[GETTING_STARTED.md](GETTING_STARTED.md)** - How to run the distributed mesh, feature explanations, troubleshooting
- **[STATUS.md](STATUS.md)** - Detailed project status and what works
- **[ROADMAP.md](ROADMAP.md)** - Implementation plan for future batches
- **[BATCH_1_SUMMARY.md](BATCH_1_SUMMARY.md)** - What was fixed in Batch 1

## Development

### Running Tests

```bash
npm run test           # Run once
npm run test:watch    # Watch mode
```

### Type Checking

```bash
npx tsc --noEmit      # Verify types without build
```

### Building

```bash
npm run build         # Production build
npm run preview       # Preview build output
```

## Tech Stack

- **Frontend:** React 19, TypeScript, Zustand, Vite
- **P2P:** WebRTC (SimplePeer), Socket.io (signaling)
- **Inference:** WebLLM, @huggingface/transformers
- **Persistence:** IndexedDB (idb-keyval)
- **Editor:** Monaco React
- **Testing:** Vitest
- **Styling:** CSS with design tokens