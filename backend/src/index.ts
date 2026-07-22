/**
 * Advaya Relay Server — Lightweight Fallback
 * ────────────────────────────────────────────
 * A minimal Socket.io relay that works WITHOUT PostgreSQL or Redis.
 * Used as a fallback when Waku P2P network is unreachable.
 *
 * Run:  npm run dev (for development)
 * Or:   npm start (for production)
 */

import express from 'express';
import http from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 4000;
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
];

const app = express();
const server = http.createServer(app);

const io = new SocketServer(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// ─── In-memory stores ────────────────────────────────────────────────────────

// walletAddress -> socketId
const connectedUsers = new Map<string, string>();

// walletAddress -> pending events (conversation requests, approvals, etc.)
// These are kept until the receiver picks them up.
const pendingEvents = new Map<string, any[]>();

// conversationId -> messages (in-memory, cleared on restart)
const messageStore = new Map<string, any[]>();

// ─── REST endpoints ──────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    mode: 'relay',
    connectedUsers: connectedUsers.size,
    timestamp: new Date().toISOString(),
  });
});

// Get pending events for a wallet (used when receiver loads the page)
app.get('/api/relay/events/:walletAddress', (req, res) => {
  const events = pendingEvents.get(req.params.walletAddress) || [];
  res.json({ events });
});

// Post a conversation request or system event (HTTP fallback)
app.post('/api/relay/events', (req, res) => {
  const { targetWallet, event } = req.body;
  if (!targetWallet || !event) {
    return res.status(400).json({ error: 'Missing targetWallet or event' });
  }

  // Store for later pickup
  if (!pendingEvents.has(targetWallet)) {
    pendingEvents.set(targetWallet, []);
  }
  pendingEvents.get(targetWallet)!.push(event);

  // If user is online, push immediately via Socket.io
  const socketId = connectedUsers.get(targetWallet);
  if (socketId) {
    io.to(socketId).emit('system_event', event);
  }

  res.json({ status: 'ok', delivered: !!socketId });
});

// Clear events after receiver has processed them
app.delete('/api/relay/events/:walletAddress', (req, res) => {
  pendingEvents.delete(req.params.walletAddress);
  res.json({ status: 'ok' });
});

// ─── Socket.IO handlers ─────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`🔌 Relay: Socket connected: ${socket.id}`);

  // Client identifies itself with wallet address
  socket.on('identify', (data: { walletAddress: string }) => {
    if (!data?.walletAddress) return;
    connectedUsers.set(data.walletAddress, socket.id);
    socket.data.walletAddress = data.walletAddress;
    console.log(`✅ Relay: Identified ${data.walletAddress.slice(0, 8)}...`);
    socket.emit('identified', { status: 'ok' });

    // Deliver any pending events
    const pending = pendingEvents.get(data.walletAddress) || [];
    if (pending.length > 0) {
      console.log(`📬 Relay: Delivering ${pending.length} pending events to ${data.walletAddress.slice(0, 8)}...`);
      for (const event of pending) {
        socket.emit('system_event', event);
      }
      // Don't clear yet — let the client acknowledge
    }
  });

  // Relay a system event (conversation request, approval, etc.)
  socket.on('system_event', (data: { targetWallet: string; event: any }) => {
    if (!data?.targetWallet || !data?.event) return;

    // Store for later pickup
    if (!pendingEvents.has(data.targetWallet)) {
      pendingEvents.set(data.targetWallet, []);
    }
    pendingEvents.get(data.targetWallet)!.push(data.event);

    // If receiver is online, push immediately
    const targetSocketId = connectedUsers.get(data.targetWallet);
    if (targetSocketId) {
      io.to(targetSocketId).emit('system_event', data.event);
      console.log(`📨 Relay: Event delivered to ${data.targetWallet.slice(0, 8)}`);
    } else {
      console.log(`📦 Relay: Event queued for ${data.targetWallet.slice(0, 8)} (offline)`);
    }
  });

  // Acknowledge events were processed (so we can clear them)
  socket.on('ack_events', () => {
    if (socket.data.walletAddress) {
      pendingEvents.delete(socket.data.walletAddress);
    }
  });

  // Join a specific conversation room for chat messages
  socket.on('join_conversation', (data: { conversationId: string }) => {
    if (!data?.conversationId) return;
    const room = `chat:${data.conversationId}`;
    socket.join(room);
  });

  // Relay a chat message to the conversation room
  socket.on('chat_message', (data: { conversationId: string; message: any }) => {
    if (!data?.conversationId || !data?.message) return;
    const room = `chat:${data.conversationId}`;

    // Store in memory
    if (!messageStore.has(data.conversationId)) {
      messageStore.set(data.conversationId, []);
    }
    messageStore.get(data.conversationId)!.push(data.message);

    // Broadcast to all others in room
    socket.to(room).emit('chat_message', data.message);
  });

  // Typing indicators
  socket.on('typing', (data: { conversationId: string; isTyping: boolean }) => {
    if (!data?.conversationId) return;
    socket.to(`chat:${data.conversationId}`).emit('typing', {
      walletAddress: socket.data.walletAddress,
      isTyping: data.isTyping,
    });
  });

  socket.on('disconnect', () => {
    if (socket.data.walletAddress) {
      connectedUsers.delete(socket.data.walletAddress);
      console.log(`❌ Relay: ${socket.data.walletAddress.slice(0, 8)} disconnected`);
    }
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n🚀 Advaya Relay Server running on http://localhost:${PORT}`);
  console.log(`📡 Mode: Lightweight relay (no database required)`);
  console.log(`🔌 Socket.io ready for cross-browser messaging\n`);
});
