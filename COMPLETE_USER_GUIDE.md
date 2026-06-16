# 🚀 SouthStack Offline AI IDE - Complete Multi-Laptop Setup Guide

**Last Updated**: April 4, 2026

This is your **complete guide** to running a distributed AI coding mesh across multiple laptops on your local network.

---

## 📋 What You're Getting

A **VSCode-like IDE** that runs **AI models locally on your GPU** and can distribute work across **multiple laptops** connected via WiFi:

- **Unified IDE Interface** - File tree, Monaco code editor, terminal
- **AI Chat Terminal** - Talk to local AI, it writes code directly to files
- **P2P Mesh Network** - Multiple laptops work together
- **Local AI Models** - Runs on your GPU via WebGPU (no cloud needed)
- **Distributed Tasks** - Assign work to the laptop with the best GPU

---

## 🎯 PART 1: Single Laptop Setup (10 minutes)

### Step 1: Prerequisites Check

**Required**:
- ✅ Windows/Mac/Linux
- ✅ Chrome or Edge browser (version 113+)
- ✅ Node.js installed (check: `node --version`)
- ✅ GPU with WebGPU support (NVIDIA, AMD, or Apple Silicon)
- ✅ At least 4GB free disk space (for AI models)
- ✅ 8GB+ RAM recommended

**Check WebGPU Support**:
1. Open Chrome/Edge
2. Go to `chrome://gpu` (or `edge://gpu`)
3. Search for "WebGPU" - should say **"Hardware accelerated"**

---

### Step 2: Install Dependencies

```bash
# Navigate to project folder
cd "F:\CSE327 Project\SouthStack_Offline_AI_IDE"

# Install packages
npm install
```

**✅ Expected**: Installs ~500 packages, takes 1-2 minutes, no errors

**❌ If errors**: Try `npm install --legacy-peer-deps`

---

### Step 3: Start Signaling Server

```bash
# In Terminal 1
node server/index.js
```

**✅ Expected Output**:
```
╔═══════════════════════════════════════════════════════════╗
║     SouthStack Signaling Server                          ║
║     Listening on 0.0.0.0:3001                            ║
╠═══════════════════════════════════════════════════════════╣
║  ✓ LAN:        http://192.168.1.100:3001                ║
║  ✓ Localhost:  http://localhost:3001                    ║
╚═══════════════════════════════════════════════════════════╝
```

**📝 IMPORTANT**: Write down your **LAN IP address** (the 192.168.x.x one)
You'll need it for connecting other laptops!

**Keep this terminal running!**

---

### Step 4: Start the IDE

```bash
# In Terminal 2 (new terminal)
npm run dev
```

**✅ Expected Output**:
```
VITE v6.0.7  ready in 892 ms

➜  Local:   http://localhost:5173/
➜  Network: http://192.168.1.100:5173/
```

**Keep this terminal running too!**

---

### Step 5: Open the IDE in Browser

1. Open **Chrome** or **Edge**
2. Go to: `http://localhost:5173`
3. Press **F12** to open DevTools (keep Console visible for debugging)

**✅ You should see**:
```
┌─────────────────────────────────────────────┐
│ SouthStack          [icons on right]       │ ← Top bar
├──────┬──────────────────────────────────────┤
│FILES │ (Editor Area - Monaco)               │
│ 📁   │                                      │
│      │  Welcome screen or editor            │
│      │                                      │
├──────┴──────────────────────────────────────┤
│ > Terminal (AI Chat)                       │ ← Bottom panel
│   Type commands here...                     │
└─────────────────────────────────────────────┘
│ 📡 0 peers | 💻 No model | 💾 0MB VRAM      │ ← Status bar
└─────────────────────────────────────────────┘
```

**🔍 Check Browser Console** - should see:
```
[P2PManager] Connected to signaling server
[MeshOrchestrator] Initialized successfully
[P2PManager] Running in standalone mode (no peers)
```

---

## 🤖 PART 2: Load AI Model & Test Features

### Test 1: Load AI Model

**Steps**:
1. Click **Settings icon (⚙️)** in the status bar (bottom-right)
2. Settings panel opens on the right
3. Under **"Select Model"**, you'll see:
   ```
   ○ Qwen2.5-Coder-1.5B-Instruct  (~2GB VRAM)  ← Start with this
   ○ Qwen2.5-Coder-3B-Instruct    (~3GB VRAM)
   ○ Phi-3.5-mini-instruct        (~3GB VRAM)
   ○ Qwen2.5-Coder-7B-Instruct    (~6GB VRAM)
   ```
4. Select **Qwen2.5-Coder-1.5B** (smallest, easiest to test)
5. Click **"Load Model"** button

**⏱️ First Time**: 2-10 minutes (downloads ~2GB model from internet)
**Next Time**: 10-30 seconds (loads from browser cache)

**✅ Progress Updates**:
```
Loading: 0%   — Initializing WebLLM...
Loading: 15%  — Downloading model files...
Loading: 45%  — Loading weights into VRAM...
Loading: 85%  — Compiling GPU shaders...
Loading: 100% — Model ready!
```

**✅ After Success**:
- Settings panel shows: ✅ **Model Loaded**
- Status bar shows: **💻 Qwen2.5-Coder-1.5B**
- Status bar shows: **💾 1800MB VRAM** (or similar)
- Green dot indicator

**❌ If Fails**:
- "WebGPU not supported" → Check browser supports WebGPU
- "Out of memory" → Close other tabs, try smaller model
- Stuck at 0% → Check internet connection (first download)

---

### Test 2: Chat with AI (Terminal)

**Steps**:
1. Click in the **Terminal panel** at the bottom
2. Type: `create a hello world function in Python`
3. Press **Enter**

**✅ Expected**:
```
> create a hello world function in Python

🤖 AI Agent (code-generation) — Running...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 100%

def hello_world():
    """Print Hello, World! to console"""
    print("Hello, World!")

if __name__ == "__main__":
    hello_world()

✅ Done in 2.3s
```

The AI response **streams in real-time** word-by-word!

**🔍 Console Check**:
```
[InferenceEngine] Generating response...
[AgentSystem] Agent task completed: code-generation
```

---

### Test 3: AI Writes Code Directly to Files

**THE KILLER FEATURE**: AI creates and edits files directly!

**Steps**:
1. In terminal, type:
   ```
   create app.py with a Flask REST API for a todo list
   ```
2. Press Enter

**✅ Expected**:
- AI generates the code
- **File automatically appears** in the file tree on the left: `app.py`
- File opens in the editor
- You see full Flask code!

**Try These Commands**:
```
create utils.py with helper functions for string manipulation
write a function to validate email addresses
explain this code
refactor this function to be more readable
debug (analyzes errors in your code)
```

---

### Test 4: Voice Input (Optional)

**Steps**:
1. In the terminal, look for the **microphone icon** (🎤) in the toolbar
2. Click it
3. Browser asks for microphone permission → **Allow**
4. Speak: "Create a function that calculates fibonacci numbers"
5. Speech converts to text → AI responds

**✅ When Working**:
- Mic icon turns red when listening
- Your speech appears as text
- AI processes and responds

**❌ Browser Security**: Voice only works on HTTPS or localhost

---

### Test 5: Upload Files

**Steps**:
1. In terminal toolbar, click **Upload icon** (📤)
2. Select a code file from your computer
3. File appears in the file tree

**Then Ask AI**:
```
explain the code in myfile.py
refactor this code to use type hints
find bugs in this file
```

---

### Test 6: File Tree Operations

**Left Sidebar** shows all files:

**Right-click a file**:
- Rename
- Delete
- Duplicate

**Right-click empty space**:
- New File
- New Folder

**Click a file**: Opens in Monaco editor (full VSCode-style editing)

---

### Test 7: Command Interpreter

The terminal accepts **special commands**:

```bash
/help                    # Show all commands
/clear                   # Clear terminal
/save                    # Save chat session
/load session-id         # Load previous chat
/nodes                   # Show connected laptops
/model info              # Show model details
/file list               # List all files
/file read app.py        # Read file content
/file write test.py content...  # Write to file
```

**Try**:
```
/nodes
```

**✅ Output (Single Laptop)**:
```
📡 Mesh Nodes (1 total)

Node: node-abc123
  Status: online ✓ (MASTER)
  VRAM: 1800 / 8192 MB
  Latency: 0ms (self)
  Uptime: 120s
  Model: Qwen2.5-Coder-1.5B-Instruct
```

---

## 🌐 PART 3: Multi-Laptop Mesh Setup

Now the **real power** - connect multiple laptops!

### Prerequisites

- ✅ **2+ laptops on the SAME WiFi network**
- ✅ Signaling server running on one laptop (from Step 3)
- ✅ Know the signaling server's **LAN IP** (from Step 3 output)

**Example IPs**:
- Laptop 1 (server): `192.168.1.100`
- Laptop 2 (client): `192.168.1.101`
- Laptop 3 (client): `192.168.1.102`

---

### Laptop 1 (Server Machine) - Already Running

**Status**: You already have:
- ✅ Signaling server on port 3001
- ✅ Dev server on port 5173
- ✅ Browser open to `http://localhost:5173`
- ✅ Model loaded (optional but recommended)

**Keep both terminals running!**

---

### Laptop 2 (Client Machine) - Setup

#### Option A: Same Project Code (Recommended)

1. **Copy project folder** to Laptop 2, OR **git clone** the repo
2. Run `npm install`
3. **Create `.env` file** in project root:
   ```bash
   VITE_SIGNALING_SERVER=http://192.168.1.100:3001
   ```
   Replace `192.168.1.100` with **Laptop 1's LAN IP** from Step 3

4. **Start dev server**:
   ```bash
   npm run dev
   ```

5. **Open browser** to: `http://localhost:5173`

#### Option B: Connect to Laptop 1's Dev Server

1. On Laptop 2, open browser
2. Go to: `http://192.168.1.100:5173`
   (Replace with Laptop 1's LAN IP)
3. **Different browser profile needed** for separate node identity:
   - Chrome: Use Incognito or create new Profile
   - Edge: Use InPrivate or new Profile

---

### Laptop 3, 4, 5... (Additional Clients)

**Repeat Laptop 2 steps** on each machine.

**OR** on same machine: Open **multiple browser profiles** (Incognito windows count as separate nodes)

---

### Verify Mesh Connection

**Wait 5-10 seconds after all laptops open the IDE**

**✅ On ALL Laptops**:

1. Check **Status Bar** (bottom):
   ```
   📡 2 peers | 💻 Qwen... | 💾 1800MB VRAM
   ```
   "2 peers" means 2 other laptops connected!

2. In **Terminal**, type:
   ```
   /nodes
   ```

**✅ Expected Output**:
```
📡 Mesh Nodes (3 total)

Node: laptop-1-node-abc
  Status: online ✓ (MASTER)
  VRAM: 1800 / 8192 MB
  Latency: 0ms (self)
  Model: Qwen2.5-Coder-1.5B-Instruct

Node: laptop-2-node-def
  Status: online ✓ (WORKER)
  VRAM: 0 / 6144 MB
  Latency: 12ms
  Model: None

Node: laptop-3-node-ghi
  Status: online ✓ (WORKER)
  VRAM: 2800 / 8192 MB
  Latency: 8ms
  Model: Phi-3.5-mini-instruct
```

**🎯 SUCCESS INDICATORS**:
- All nodes show `online ✓`
- One node marked `(MASTER)`
- Others marked `(WORKER)`
- Latency shows real ping times
- VRAM shows real usage

**🔍 Browser Console (on any laptop)**:
```
[P2PManager] Peer joined: node-def123
[P2PManager] WebRTC connection established with node-def123
[P2PManager] DataChannel open: node-def123
[LeaderElection] Master elected: node-abc123 (score: 52.3)
```

---

## 🚀 PART 4: Using the Distributed Mesh

### Scenario 1: Load Models on Different Laptops

**Laptop 1** (Gaming PC, RTX 4090):
- Load **Qwen2.5-Coder-7B** (large, powerful)

**Laptop 2** (MacBook, M2):
- Load **Phi-3.5-mini** (medium)

**Laptop 3** (Old laptop, integrated GPU):
- **Don't load any model** (just UI)

**Result**: Laptops 1 & 2 can execute AI tasks, Laptop 3 delegates work to them!

---

### Scenario 2: Create Task on Laptop 3 (No Model)

**On Laptop 3**:
1. Type in terminal:
   ```
   create a Python script for web scraping with BeautifulSoup
   ```
2. Press Enter

**✅ What Happens** (Distributed Execution):
1. **Laptop 3** creates the task
2. **Master node** (probably Laptop 1 with best GPU) **assigns task** to Laptop 1
3. **Laptop 1** executes AI generation using its GPU
4. **Result streams** to all 3 laptops in real-time!
5. File `scraper.py` appears on **all 3 laptops** simultaneously

**🔍 Console (Laptop 3)**:
```
[TaskDistributor] Created task: task-xyz
[TaskDistributor] Assigned to: node-abc (Laptop 1)
[P2PManager] Waiting for remote result...
[P2PManager] Received result from node-abc
```

**🔍 Console (Laptop 1)**:
```
[P2PManager] Received task assignment: task-xyz
[InferenceEngine] Generating response...
[InferenceEngine] Generation complete (4.2s)
[P2PManager] Sending result to mesh
```

---

### Scenario 3: Master Failover Test

**Test Fault Tolerance**:

1. Check which laptop is **MASTER** (use `/nodes`)
2. On the master laptop: **Close browser tab**
3. On worker laptops: **Watch the terminal**

**✅ Expected (Worker Laptop)**:
```
⚠️ Peer disconnected: laptop-1-node-abc
🔄 Master disconnected — triggering re-election
📊 Starting leader election...
✅ New master elected: laptop-2-node-def (score: 48.1)
```

**Result**: System continues working, new master takes over!

---

### Scenario 4: Shared Workspace

**All laptops share the same file tree!**

**On Laptop 1**:
```
create utils.py with a hash function
```

**On Laptop 2**: File `utils.py` appears in file tree automatically!

**On Laptop 3**: Edit the file → changes sync to others (eventually)

**⚠️ Note**: File content sync has basic implementation, conflict resolution is limited

---

### Scenario 5: Chat Sessions Sync

**On Laptop 1**:
1. Have a conversation with AI
2. Type `/save` to save the session

**On Laptop 2**:
1. Type `/load <session-id>`
2. Previous conversation appears!

**Or**: Click **History icon** (top-right) to see all sessions from all laptops

---

## 🎛️ PART 5: Advanced Features

### Agent System

The terminal uses an **agent system** that routes tasks intelligently:

**Agent Types**:
- `code-generation` - Creates new code
- `code-explanation` - Explains existing code
- `debugging` - Analyzes errors
- `refactoring` - Improves code quality
- `testing` - Generates tests

**How it Works**:
1. Your command is analyzed
2. Best agent type is selected
3. Task is assigned to laptop with best model
4. Agent executes, streams results back

**View Agent Activity**:
```
/agents
```

Shows currently running agents across the mesh!

---

### Model Management

**See Available Models**:
```
/model list
```

**Model Info**:
```
/model info
```

Output:
```
📦 Current Model: Qwen2.5-Coder-1.5B-Instruct
  Size: 1.8GB
  VRAM: 1843 MB
  Context: 32,768 tokens
  Status: Loaded ✓
  Capabilities: code-generation, debugging, explanation
```

---

### Mesh Statistics

**Real-Time Stats**:
```
/mesh stats
```

Output:
```
📡 Mesh Statistics

Nodes: 3 online, 0 offline
Master: laptop-1-node-abc
Total VRAM: 4643 / 22528 MB (20.6% used)
Average Latency: 10ms
Uptime: 1h 23m
Tasks Executed: 47
Success Rate: 95.7%
```

---

### Performance Monitoring

**Status Bar** shows real-time:
- **Peers connected** (📡 icon)
- **Model loaded** (💻 icon)
- **VRAM usage** (💾 icon)

**Click Settings (⚙️)** to see:
- Node list with details
- VRAM usage per node
- Network latency
- Model selection

---

## 🐛 PART 6: Troubleshooting

### Issue: Laptops Don't See Each Other

**Check**:
1. ✅ All laptops on **same WiFi network**
2. ✅ Signaling server running on Laptop 1
3. ✅ Firewall allows port **3001**
4. ✅ All laptops point to **same signaling server IP**

**Test Connection**:
1. On Laptop 2, open browser to: `http://192.168.1.100:3001/health`
2. Should see: `{"status":"ok","peers":1,"uptime":123}`

**Fix**:
```bash
# On Windows - Allow port through firewall
netsh advfirewall firewall add rule name="SouthStack" dir=in action=allow protocol=TCP localport=3001

# Restart signaling server
```

---

### Issue: Model Won't Load

**Symptoms**: Stuck at "Loading: 0%"

**Fixes**:
1. **Check internet** (first download needs connection)
2. **Check disk space** (models are 2-7GB)
3. **Clear browser cache**:
   - F12 → Application → Storage → Clear site data
4. **Try smaller model** (Qwen 1.5B instead of 7B)
5. **Check WebGPU**: `chrome://gpu` → WebGPU should be enabled

---

### Issue: AI Doesn't Respond

**Check**:
1. Model is loaded (status bar shows model name)
2. No errors in console (F12)
3. Task isn't stuck (type `/clear` and retry)

**Force Retry**:
```
/clear
# Then retype your command
```

---

### Issue: High Memory Usage

**Browser eating RAM?**

**Fixes**:
1. **Close other tabs**
2. **Unload model**:
   - Settings → Click "Unload Model"
3. **Use smaller model**
4. **Restart browser**

---

### Issue: Slow Response Times

**Optimization**:
1. **Close unused apps** (free VRAM)
2. **Use smaller models** on weaker GPUs
3. **Better WiFi** (5GHz instead of 2.4GHz)
4. **Reduce active peers** (disconnect extra laptops)

---

### Issue: File Sync Not Working

**Current Status**: Basic file sync is implemented but has limitations

**What Works**:
- Creating files shows on all nodes eventually
- Editing files may not sync immediately

**Workaround**:
- Use `/file write path content` to force sync
- Refresh browser to see updates from other nodes

---

## 📊 PART 7: What Actually Works vs. What's Planned

### ✅ FULLY WORKING

- [x] P2P mesh networking (WebRTC)
- [x] Peer discovery via signaling server
- [x] Leader election and failover
- [x] Model loading (WebGPU + WebLLM)
- [x] Local AI inference (streaming)
- [x] AI chat in terminal
- [x] Code editor (Monaco)
- [x] File tree operations
- [x] Command interpreter
- [x] Task distribution across mesh
- [x] State persistence (browser restart)
- [x] Voice input (basic)
- [x] File upload
- [x] Settings panel
- [x] Status bar with live stats
- [x] Chat session save/load

### ⚠️ PARTIALLY WORKING

- [~] File synchronization (basic, no conflict resolution)
- [~] Agent system (routing works, some agents stubbed)
- [~] Distributed debugging (protocol ready, analysis basic)

### ❌ NOT YET IMPLEMENTED

- [ ] Real-time collaborative editing (like Google Docs)
- [ ] Video/voice chat between nodes
- [ ] Plugin system
- [ ] Git integration
- [ ] Advanced debugging with breakpoints

---

## 🎯 PART 8: Example Workflows

### Workflow 1: Generate Full Project

```
# Create project structure
create a Flask REST API with user authentication

# It creates: app.py, models.py, routes.py, etc.

# Then refine:
add JWT token authentication to the API
create database models for users and posts
write unit tests for the authentication endpoints
```

**Result**: Full project with multiple files, all AI-generated!

---

### Workflow 2: Debug Existing Code

```
# Upload your buggy file via Upload button
# Then:
debug myfile.py

# AI analyzes and suggests fixes:
# "Line 23: Division by zero when input is 0
#  Fix: Add input validation..."

# Apply fix:
fix the division by zero in myfile.py
```

---

### Workflow 3: Code Review

```
# Open a file in editor
# In terminal:
explain this code

# AI provides detailed explanation

# Then:
refactor this code to follow best practices
add type hints to all functions
add docstrings to this module
```

---

### Workflow 4: Multi-Laptop Team Coding

**Setup**:
- Laptop 1: Your main machine
- Laptop 2: Friend's laptop (same WiFi)
- Laptop 3: Another friend

**Workflow**:
1. **Laptop 1**: `create main.py with a todo app`
2. **Laptop 2**: `create tests.py with unit tests for todo app`
3. **Laptop 3**: `create ui.py with a simple web interface`

**Result**: Team builds app together, all files synced across all laptops!

---

## 🏆 Success Checklist

Copy and check off as you complete:

### Single Laptop
- [ ] Installed dependencies (`npm install`)
- [ ] Signaling server runs (`node server/index.js`)
- [ ] Dev server runs (`npm run dev`)
- [ ] Browser opens IDE without errors
- [ ] WebGPU detected (status bar)
- [ ] Model loads successfully
- [ ] AI responds to chat messages
- [ ] Files created via AI commands
- [ ] File tree shows files
- [ ] Monaco editor works
- [ ] Voice input works (optional)
- [ ] Settings panel opens
- [ ] Terminal commands execute

### Multi-Laptop Mesh
- [ ] Laptop 2 connects to signaling server
- [ ] Peers discover each other (status bar shows "X peers")
- [ ] `/nodes` command shows all laptops
- [ ] Leader election happens (one shows MASTER)
- [ ] Heartbeat syncs (VRAM stats update)
- [ ] Task created on Laptop 2 executes on Laptop 1
- [ ] Results appear on all laptops
- [ ] Master failover works (close master, new one elected)
- [ ] Files created on one laptop appear on others
- [ ] Chat sessions sync across laptops

---

## 📚 Quick Command Reference

```bash
# Terminal Commands
/help                    # Show all commands
/clear                   # Clear terminal
/nodes                   # Show connected laptops
/mesh stats              # Mesh statistics
/agents                  # Show running agents
/model info              # Model details
/model list              # Available models
/file list               # List all files
/file read <path>        # Read file
/file write <path> <content>  # Write file
/save                    # Save chat session
/load <session-id>       # Load session

# AI Commands (natural language)
create <file> with <description>
write a function that <task>
explain this code
debug <file>
refactor this function
add tests for <file>
fix <error description>
```

---

## 🆘 Getting Help

**Console Logs**: Press **F12** → Console tab (shows all system activity)

**Signaling Server Logs**: Check Terminal 1 (shows peer connections)

**Dev Server Logs**: Check Terminal 2 (shows HTTP requests)

**Common Issues**:
- No peers → Check signaling server, firewall, WiFi
- Model won't load → Check WebGPU, disk space, internet
- Slow AI → Use smaller model, close tabs, better GPU
- Files not syncing → Known limitation, use manual sync

---

## 🎉 You're Ready!

You now have a **fully functional distributed AI coding mesh**!

**What Makes This Special**:
- ✅ **100% Local** - No cloud APIs, no subscriptions
- ✅ **Peer-to-Peer** - Direct laptop-to-laptop connections
- ✅ **Fault Tolerant** - Automatic failover if nodes crash
- ✅ **Distributed** - Work assigned to best GPU automatically
- ✅ **Privacy First** - All data stays on your network
- ✅ **Offline Capable** - Works without internet (after model download)

**Built for CSE327** - Distributed Systems Project  
**Tech Stack**: React, TypeScript, WebRTC, WebGPU, WebLLM, Zustand  
**Architecture**: P2P Mesh with Leader Election & Task Distribution

---

**Happy Coding with your AI Mesh! 🚀**
