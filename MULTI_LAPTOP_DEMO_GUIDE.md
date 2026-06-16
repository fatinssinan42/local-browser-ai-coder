# 🚀 Multi-Laptop Testing Guide - See Distributed Work in Action

**Goal**: Connect your main PC + laptop, create tasks, watch them execute across the mesh

**Time Required**: 15 minutes

---

## 📋 PREREQUISITES

**You need**:
- ✅ Main PC (Gaming PC / Desktop with good GPU)
- ✅ Laptop (any laptop, even without GPU)
- ✅ Both on **same WiFi network**
- ✅ Project installed on **both machines**
- ✅ Chrome or Edge browser on both

---

## 🖥️ STEP 1: Setup Main PC (Server)

### 1A: Install & Start

```bash
# On Main PC - Open PowerShell in project folder
cd "F:\CSE327 Project\SouthStack_Offline_AI_IDE"

# Terminal 1: Start signaling server
node server/index.js
```

**✅ Expected Output**:
```
╔═══════════════════════════════════════════════════════════╗
║     SouthStack Signaling Server                          ║
║     Listening on 0.0.0.0:3001                            ║
╠═══════════════════════════════════════════════════════════╣
║  ✓ LAN:        http://192.168.1.100:3001                ║  ← Write this down!
║  ✓ Localhost:  http://localhost:3001                    ║
╚═══════════════════════════════════════════════════════════╝
```

**📝 IMPORTANT**: Write down the **LAN IP** (e.g., `192.168.1.100`)

---

### 1B: Start Development Server

```bash
# Terminal 2 (new PowerShell window)
npm run dev
```

**✅ Expected Output**:
```
VITE v6.0.7  ready in 892 ms

➜  Local:   http://localhost:5173/
➜  Network: http://192.168.1.100:5173/
```

**Keep both terminals running!**

---

### 1C: Open Browser on Main PC

1. Open **Chrome** or **Edge**
2. Go to: `http://localhost:5173`
3. Press **F12** (open DevTools, keep Console visible)

**✅ You should see**:
- IDE loads
- Console shows: `[P2PManager] Connected to signaling server`
- Status bar: `📡 0 peers` (no peers yet)

---

### 1D: Load AI Model on Main PC

1. Click **Settings (⚙️)** in bottom-right
2. Select **Qwen2.5-Coder-1.5B-Instruct** (smallest model)
3. Click **Load Model**
4. Wait 2-10 minutes (downloads ~2GB model)

**✅ Progress**:
```
Loading: 0%   — Initializing...
Loading: 15%  — Downloading...
Loading: 45%  — Loading weights...
Loading: 100% — Model ready!
```

**✅ After success**:
- Status bar shows: `💻 Qwen2.5-Coder-1.5B`
- Status bar shows: `💾 1800MB VRAM` (or similar)

**Leave this browser open!**

---

## 💻 STEP 2: Setup Laptop (Client)

### 2A: Configure Connection

**On your laptop**:

1. Copy project folder to laptop (or git clone)
2. Open PowerShell in project folder
3. **Create `.env` file**:

```bash
# Create .env file with signaling server IP
echo "VITE_SIGNALING_SERVER=http://192.168.1.100:3001" > .env
```

**Replace `192.168.1.100` with YOUR Main PC's LAN IP from Step 1A!**

---

### 2B: Start Dev Server on Laptop

```bash
npm run dev
```

**✅ Expected Output**:
```
VITE v6.0.7  ready in 892 ms

➜  Local:   http://localhost:5173/
➜  Network: http://192.168.1.101:5173/
```

---

### 2C: Open Browser on Laptop

1. Open **Chrome** or **Edge**
2. Go to: `http://localhost:5173`
3. Press **F12** (open DevTools)

**✅ Expected Console**:
```
[P2PManager] Connecting to signaling server at http://192.168.1.100:3001...
[P2PManager] Connected to signaling server
[P2PManager] Peer joined: node-abc123
[P2PManager] WebRTC connection established with node-abc123
[P2PManager] DataChannel open: node-abc123
```

---

## 🔗 STEP 3: Verify Connection

### On BOTH Machines (Main PC + Laptop)

**Check Status Bar** (bottom of screen):
- Should say: `📡 1 peer` (meaning 1 other machine connected)

**In Terminal** (the bottom panel), type:
```
/nodes
```

**✅ Expected Output on Main PC**:
```
📡 Mesh Nodes (2 total)

Node: node-abc123 (Main-PC)
  Status: online ✓ (MASTER)
  VRAM: 1800 / 8192 MB
  Latency: 0ms (self)
  Model: Qwen2.5-Coder-1.5B-Instruct
  Capabilities: webgpu, inference

Node: node-def456 (Laptop)
  Status: online ✓ (WORKER)
  VRAM: 0 / 4096 MB
  Latency: 12ms
  Model: None
  Capabilities: -
```

**✅ Expected Output on Laptop**:
```
📡 Mesh Nodes (2 total)

Node: node-abc123 (Main-PC)
  Status: online ✓ (MASTER)
  VRAM: 1800 / 8192 MB
  Latency: 12ms
  Model: Qwen2.5-Coder-1.5B-Instruct

Node: node-def456 (Laptop)
  Status: online ✓ (WORKER)
  VRAM: 0 / 4096 MB
  Latency: 0ms (self)
  Model: None
```

**🎉 SUCCESS! Both machines see each other!**

---

## 🧪 STEP 4: Test Distributed Work

### Test 1: Create Task on Laptop (Executes on Main PC)

**On LAPTOP**, in the terminal panel, type:
```
create a Python function to calculate fibonacci numbers
```

Press **Enter**

**✅ What You'll See**:

**ON LAPTOP**:
```
> create a Python function to calculate fibonacci numbers

🤖 AI Agent (code-generation) — Assigned to node-abc123
🔄 Running on remote node... 0%
━━━━━━━━━━━━━━━━━━━━━━━━━━ 15%
━━━━━━━━━━━━━━━━━━━━━━━━━━ 45%
━━━━━━━━━━━━━━━━━━━━━━━━━━ 85%
━━━━━━━━━━━━━━━━━━━━━━━━━━ 100%

def fibonacci(n):
    """Calculate nth Fibonacci number"""
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

# Example usage
print(fibonacci(10))  # Output: 55

✅ Done in 3.2s (Ran on node-abc123)
```

**ON MAIN PC**:
- You see the SAME output streaming in real-time!
- Console shows: `[TaskDistributor] Received task assignment`

**🎯 This proves**:
- Task created on Laptop
- Routed to Main PC (has model)
- Executed on Main PC's GPU
- Result streamed back to both machines

---

### Test 2: Create Task on Main PC (Executes Locally)

**On MAIN PC**, type:
```
write a JavaScript function to sort an array
```

**✅ Expected**:
```
> write a JavaScript function to sort an array

🤖 AI Agent (code-generation) — Running locally
━━━━━━━━━━━━━━━━━━━━━━━━━━ 100%

function sortArray(arr) {
    return arr.sort((a, b) => a - b);
}

// Example
console.log(sortArray([3, 1, 4, 1, 5, 9, 2, 6]));
// Output: [1, 1, 2, 3, 4, 5, 6, 9]

✅ Done in 2.1s (Ran on self)
```

**ON LAPTOP**:
- You see the SAME output appear!
- Task synced across mesh

---

### Test 3: Watch Real-Time Streaming

**On LAPTOP**, type:
```
create app.py with a Flask REST API for a todo list
```

**✅ Watch Both Screens**:
- **Laptop**: Shows "Assigned to node-abc123"
- **Main PC**: Starts generating code
- **BOTH**: Code appears **word-by-word** in real-time
- **Progress bar** updates live on both: 0% → 100%

**✅ After completion**:
- File `app.py` created on BOTH machines
- File appears in file tree on left
- Can open and edit on either machine

---

### Test 4: Large File Debugging (50K tokens)

**On MAIN PC**, create a large file:

1. Click **File Tree** → Right-click → **New File**
2. Name it: `large_code.py`
3. Paste a large codebase (~200+ lines, or upload a real file)

**On LAPTOP**, type:
```
debug large_code.py
```

**✅ Watch Progress**:
```
🤖 AI Agent (debugging) — Assigned to node-abc123

Analyzing chunk 1/5... ━━━━━━━━━━━ 20%
Analyzing chunk 2/5... ━━━━━━━━━━━━━━━ 40%
Analyzing chunk 3/5... ━━━━━━━━━━━━━━━━━━ 60%
Analyzing chunk 4/5... ━━━━━━━━━━━━━━━━━━━━━ 80%
Analyzing chunk 5/5... ━━━━━━━━━━━━━━━━━━━━━━━ 100%

Consolidating findings... ━━━━━━━━━━━━━━━━━━━━━━━━━━ 100%

### Debug Report

**Critical Issues**:
1. Line 45: Undefined variable `user_id` (should be `userId`)
2. Line 78: Division by zero when `total == 0`

**Warnings**:
1. Line 23: Missing type hint for function parameter
2. Line 102: Unused import `datetime`

✅ Done in 12.5s (Analyzed 5 chunks, 247 lines)
```

**🎯 This proves**:
- Large file automatically chunked
- Analyzed chunk-by-chunk
- Results consolidated
- Distributed across mesh

---

## 🔄 STEP 5: Test Fault Tolerance

### Test 5A: Worker Failure Recovery

**Setup**: Main PC has a task running

1. **On LAPTOP**: Type: `create a complex Python web scraper with BeautifulSoup`
2. Wait for it to start: `🔄 Running on node-abc123...`
3. **On MAIN PC**: **Close the browser tab** immediately
4. **On LAPTOP**: Watch what happens

**✅ Expected**:
```
🔄 Running on node-abc123... 25%
⚠️ Node disconnected: node-abc123
🔄 Reassigning task... (Retry #1)
⚠️ No available nodes with model loaded
❌ Task failed: No nodes available

[Alternative if you quickly reconnect Main PC]
🔄 Reassigning task... (Retry #1)
✅ Assigned to node-abc123 (reconnected)
━━━━━━━━━━━━━━━━━━━━━━━━━━ 100%
```

**🎯 This proves**: Task reassignment works

---

### Test 5B: Master Failover

**Find out who is Master**:
```
/nodes
```

**If Main PC is Master**:

1. **On MAIN PC**: Close browser
2. **On LAPTOP**: Watch console

**✅ Expected Console Output**:
```
[P2PManager] Peer disconnected: node-abc123
[LeaderElection] Master disconnected — triggering re-election
[LeaderElection] Starting election...
[LeaderElection] Broadcasting vote with score: 15.2
[LeaderElection] Elected as MASTER (only remaining node)
```

**Status bar changes**: `📡 0 peers` (alone now)

**Terminal shows**:
```
⚠️ Master node disconnected
🔄 Triggering re-election...
✅ New master elected: self (score: 15.2)
```

**🎯 This proves**: Master failover works

---

### Test 5C: State Recovery (Browser Restart)

1. **On LAPTOP**: Create 3 tasks, run them
2. **Close browser completely**
3. **Wait 5 seconds**
4. **Reopen**: `http://localhost:5173`

**✅ Expected**:
- Terminal shows: `[RecoveryManager] Recovering previous session state...`
- All 3 tasks restored
- Running tasks are re-queued
- Completed tasks stay completed
- Model selection remembered (if any)

**🎯 This proves**: State persistence works

---

## 📊 STEP 6: Monitor Live Progress

### View Real-Time Stats

**On EITHER machine**, type:
```
/mesh stats
```

**✅ Output**:
```
📡 Mesh Statistics

Nodes: 2 online, 0 offline
Master: node-abc123 (Main-PC)
Workers: 1 (node-def456)

Total VRAM: 1800 / 12288 MB (14.6% used)
Average Latency: 12ms
Total Uptime: 15m 32s

Tasks Executed: 5
  Completed: 4
  Failed: 1
  Success Rate: 80%

Network Status:
  Main-PC ↔ Laptop: 12ms (WebRTC active)
  Heartbeat: Every 10s
  Last sync: 2s ago
```

---

### View Task History

```
/tasks
```

**✅ Output**:
```
📋 Tasks (5 total)

1. ✅ create fibonacci function
   Status: completed
   Executed on: node-abc123 (Main-PC)
   Duration: 3.2s
   Created: 2 minutes ago

2. ✅ write JavaScript sort
   Status: completed
   Executed on: self
   Duration: 2.1s
   Created: 5 minutes ago

3. ✅ Flask REST API
   Status: completed
   Executed on: node-abc123
   Duration: 8.7s
   Created: 8 minutes ago

4. ✅ debug large_code.py
   Status: completed
   Executed on: node-abc123
   Duration: 12.5s (5 chunks analyzed)
   Created: 12 minutes ago

5. ❌ web scraper
   Status: failed (node disconnected)
   Retries: 3/3
   Created: 15 minutes ago
```

---

## 🎥 STEP 7: Visual Demonstration Checklist

**For your demo/video**:

### Setup Phase (1 minute)
- [ ] Show Main PC terminal with signaling server running
- [ ] Show Main PC browser with IDE loaded
- [ ] Show Laptop browser connecting
- [ ] Show status bar changing from "0 peers" → "1 peer"

### Work Distribution (3 minutes)
- [ ] Type command on Laptop
- [ ] Show it appears on Main PC console: "Received task assignment"
- [ ] Show progress bar updating on BOTH screens simultaneously
- [ ] Show code appearing word-by-word on both
- [ ] Show file created in file tree on both

### Large File Processing (2 minutes)
- [ ] Upload/create large file (200+ lines)
- [ ] Run debug command
- [ ] Show chunking: "Analyzing chunk 1/5... 20%"
- [ ] Show progress bars for each chunk
- [ ] Show consolidated report at end

### Fault Tolerance (2 minutes)
- [ ] Start task on Laptop
- [ ] Close Main PC browser mid-execution
- [ ] Show Laptop console: "Node disconnected"
- [ ] Show task reassignment attempt
- [ ] Reopen Main PC → show reconnection
- [ ] Show task completes after retry

### State Recovery (1 minute)
- [ ] Create tasks
- [ ] Close Laptop browser
- [ ] Reopen
- [ ] Show all tasks restored
- [ ] Show "Recovered 3 tasks" message

---

## 🐛 TROUBLESHOOTING

### Issue: "Nodes don't see each other"

**Check**:
1. Both on same WiFi? → Check network name
2. Signaling server running? → Check Terminal 1 on Main PC
3. Correct IP in `.env`? → Should match Main PC LAN IP
4. Firewall blocking? → Temporarily disable Windows Defender

**Fix**:
```bash
# On Main PC - Allow port through firewall
netsh advfirewall firewall add rule name="SouthStack" dir=in action=allow protocol=TCP localport=3001
```

---

### Issue: "Model won't load"

**Check**:
1. Internet connection (first download)
2. Disk space (need 3-4GB free)
3. WebGPU support: `chrome://gpu`

**Fix**:
- Try smaller model: Qwen-1.5B instead of 7B
- Clear browser cache: F12 → Application → Clear site data
- Restart browser

---

### Issue: "Task not executing"

**Check**:
1. Model loaded on at least one machine?
2. Console shows errors?
3. Node online? (check `/nodes`)

**Fix**:
```
/clear
# Then retry command
```

---

### Issue: "Connection timeout"

**Check**:
1. Signaling server IP correct?
2. Both machines can ping each other?

**Test**:
```bash
# On Laptop, test if server is reachable
ping 192.168.1.100
```

---

## 📝 QUICK COMMANDS REFERENCE

```bash
# View connected nodes
/nodes

# View mesh statistics
/mesh stats

# View task history
/tasks

# View running agents
/agents

# Clear terminal
/clear

# Show help
/help

# Toggle theme
/theme

# Save chat session
/save
```

---

## 🎯 SUCCESS INDICATORS

**You know it's working when**:

✅ Status bar shows: `📡 1 peer` (or more)
✅ `/nodes` shows both machines
✅ Task created on Laptop appears on Main PC
✅ Progress bars update on both screens simultaneously
✅ Code streams word-by-word on both
✅ Files created on one machine appear on other
✅ Console shows: `[P2PManager] DataChannel open`
✅ Latency shows real values (10-50ms)
✅ Master/Worker roles assigned

---

## 🎬 DEMO SCRIPT (5 Minutes)

**Minute 1**: Show Setup
- "Here's my Main PC with a 4090 GPU running the signaling server"
- "And my laptop connecting to it via WiFi"
- "Status bar shows 1 peer - they found each other"

**Minute 2**: Show Distribution
- "On my laptop, I'll ask AI to create a Python function"
- *Type command*
- "Watch - the task is assigned to my Main PC which has the GPU"
- *Point to both screens streaming simultaneously*

**Minute 3**: Show Large File
- "Now let's debug a large codebase - 250 lines of code"
- *Run debug command*
- "See how it chunks the file into 5 pieces"
- *Show progress bars for each chunk*
- "Then consolidates the findings"

**Minute 4**: Show Fault Tolerance
- "What happens if my Main PC crashes mid-task?"
- *Close Main PC browser*
- "The laptop detects it immediately"
- "Task gets reassigned - up to 3 retries"
- *Reopen Main PC*
- "Reconnects automatically, task completes"

**Minute 5**: Show Recovery
- "Even if I close the browser completely"
- *Close laptop browser*
- *Wait 3 seconds*
- "When I reopen, all my work is restored"
- "Tasks, files, everything persists"

---

**YOU'RE READY TO DEMONSTRATE YOUR DISTRIBUTED AI MESH!** 🎉

Show this to your professor/class and blow their minds! 🚀
