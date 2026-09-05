import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import os from 'os';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const peers = new Map();
const rooms = new Map();

// ------------------------------------------
// Network interface detection
// ------------------------------------------

/**
 * Detect all usable network addresses for this machine.
 * Returns { tailscale, lan, all } where each is an IP string or null.
 */
function detectNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = { tailscale: null, lan: [], all: [] };

  for (const [name, nets] of Object.entries(interfaces)) {
    if (!nets) continue;
    for (const net of nets) {
      // Skip internal (loopback) and IPv6 for simplicity
      if (net.internal || net.family !== 'IPv4') continue;

      addresses.all.push({ name, address: net.address });

      // Tailscale interfaces:
      //   - Windows: adapter name contains "Tailscale"
      //   - Linux/macOS: interface named "tailscale0" or CGNAT range 100.x.x.x
      const isTailscale =
        name.toLowerCase().includes('tailscale') ||
        net.address.startsWith('100.');

      if (isTailscale) {
        addresses.tailscale = net.address;
      } else {
        addresses.lan.push(net.address);
      }
    }
  }

  return addresses;
}

// Health endpoint — useful for clients to verify server is reachable
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    peers: peers.size,
    uptime: process.uptime(),
  });
});

// Network info endpoint — clients can discover the server's addresses
app.get('/network', (_req, res) => {
  const addrs = detectNetworkAddresses();
  res.json({
    tailscale: addrs.tailscale,
    lan: addrs.lan,
    all: addrs.all,
  });
});

console.log('SouthStack Signaling Server starting...');

io.on('connection', (socket) => {
  const { nodeId, nodeName } = socket.handshake.query;
  const peerId = nodeId || socket.id;
  const name = nodeName || `Node-${socket.id.slice(0, 6)}`;

  console.log(`[+] Node connected: ${peerId} (${name})`);

  peers.set(peerId, {
    id: peerId,
    name,
    socketId: socket.id,
    connectedAt: Date.now(),
    rooms: new Set()
  });

  // Send peer list to the newly connected node
  socket.emit('peers', getPeerList().filter(p => p.id !== peerId));

  // Notify existing peers about the new node
  socket.broadcast.emit('peer-joined', {
    id: peerId,
    name,
  });

  socket.on('join-room', ({ roomId }) => {
    const peer = peers.get(peerId);
    if (peer) {
      socket.join(roomId);
      peer.rooms.add(roomId);

      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
      }
      rooms.get(roomId).add(peerId);

      socket.to(roomId).emit('peer-joined-room', {
        peerId,
        name,
        roomPeers: Array.from(rooms.get(roomId))
      });

      console.log(`[+] ${name} joined room: ${roomId}`);
    }
  });

  socket.on('leave-room', ({ roomId }) => {
    const peer = peers.get(peerId);
    if (peer) {
      socket.leave(roomId);
      peer.rooms.delete(roomId);

      if (rooms.has(roomId)) {
        rooms.get(roomId).delete(peerId);
      }

      socket.to(roomId).emit('peer-left-room', { peerId });
      console.log(`[-] ${name} left room: ${roomId}`);
    }
  });

  socket.on('signal', ({ to, signal }) => {
    const targetPeer = peers.get(to);
    if (targetPeer) {
      io.to(targetPeer.socketId).emit('signal', {
        from: peerId,
        signal
      });
    }
  });

  socket.on('offer', ({ to, offer }) => {
    const targetPeer = peers.get(to);
    if (targetPeer) {
      io.to(targetPeer.socketId).emit('offer', {
        from: peerId,
        offer
      });
    }
  });

  socket.on('answer', ({ to, answer }) => {
    const targetPeer = peers.get(to);
    if (targetPeer) {
      io.to(targetPeer.socketId).emit('answer', {
        from: peerId,
        answer
      });
    }
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    const targetPeer = peers.get(to);
    if (targetPeer) {
      io.to(targetPeer.socketId).emit('ice-candidate', {
        from: peerId,
        candidate
      });
    }
  });

  socket.on('message', ({ to, message }) => {
    const targetPeer = peers.get(to);
    if (targetPeer) {
      io.to(targetPeer.socketId).emit('message', {
        from: peerId,
        message
      });
    }
  });

  socket.on('broadcast', ({ message }) => {
    socket.broadcast.emit('message', {
      from: peerId,
      message
    });
  });

  socket.on('room-message', ({ roomId, message }) => {
    socket.to(roomId).emit('room-message', {
      from: peerId,
      message
    });
  });

  socket.on('get-peers', () => {
    socket.emit('peers', getPeerList().filter(p => p.id !== peerId));
  });

  socket.on('disconnect', () => {
    console.log(`[-] Node disconnected: ${peerId} (${name})`);

    const peer = peers.get(peerId);
    if (peer) {
      for (const roomId of peer.rooms) {
        if (rooms.has(roomId)) {
          rooms.get(roomId).delete(peerId);
          io.to(roomId).emit('peer-left-room', { peerId });
        }
      }
    }

    peers.delete(peerId);

    socket.broadcast.emit('peer-left', {
      peerId,
    });
  });
});

function getPeerList() {
  return Array.from(peers.values()).map(p => ({
    id: p.id,
    name: p.name,
    connectedAt: p.connectedAt
  }));
}

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0'; // Bind to all interfaces (Tailscale + LAN + localhost)

httpServer.listen(PORT, HOST, () => {
  const addrs = detectNetworkAddresses();

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║     SouthStack Signaling Server                          ║
║     Listening on ${HOST}:${PORT}                              ║
╠═══════════════════════════════════════════════════════════╣`);

  if (addrs.tailscale) {
    console.log(`║  ✓ Tailscale:  http://${addrs.tailscale}:${PORT}`.padEnd(60) + '║');
  }
  for (const ip of addrs.lan) {
    console.log(`║  ✓ LAN:        http://${ip}:${PORT}`.padEnd(60) + '║');
  }
  console.log(`║  ✓ Localhost:   http://localhost:${PORT}`.padEnd(60) + '║');

  console.log(`╠═══════════════════════════════════════════════════════════╣
║  Clients should connect using the Tailscale IP above     ║
║  for cross-network mesh. LAN IP works for same network.  ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
