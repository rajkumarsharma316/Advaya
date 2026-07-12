import { Server, Socket } from 'socket.io';

interface ConnectedUser {
  walletAddress: string;
  socketId: string;
}

// In-memory map: walletAddress -> socketId
const connectedUsers = new Map<string, string>();

export function initSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    // Client identifies itself with wallet address
    socket.on('identify', (data: { walletAddress: string }) => {
      if (!data?.walletAddress) return;
      connectedUsers.set(data.walletAddress, socket.id);
      socket.data.walletAddress = data.walletAddress;
      console.log(`✅ Identified: ${data.walletAddress.slice(0, 8)}...`);
      socket.emit('identified', { status: 'ok' });
    });

    // Join a specific conversation room
    socket.on('join_conversation', (data: { conversationId: number }) => {
      if (!data?.conversationId) return;
      const room = `convo:${data.conversationId}`;
      socket.join(room);
      console.log(`📬 ${socket.data.walletAddress?.slice(0, 8)} joined room ${room}`);
    });

    // Leave a conversation room
    socket.on('leave_conversation', (data: { conversationId: number }) => {
      socket.leave(`convo:${data.conversationId}`);
    });

    // Real-time encrypted message delivery
    // The message is ALREADY encrypted by the sender's browser — we just relay it
    socket.on('send_message', (data: {
      conversationId: number;
      messageId: number;
      ciphertext: string;
      nonce: string;
      sender: string;
      sentAt: string;
      messageType: string;
      fileId?: string;
      fileName?: string;
      fileSize?: number;
    }) => {
      if (!data?.conversationId) return;
      const room = `convo:${data.conversationId}`;
      // Broadcast to all others in room (not sender)
      socket.to(room).emit('new_message', data);
    });

    // Typing indicators
    socket.on('typing', (data: { conversationId: number; isTyping: boolean }) => {
      socket.to(`convo:${data.conversationId}`).emit('typing', {
        walletAddress: socket.data.walletAddress,
        isTyping: data.isTyping,
      });
    });

    // Notify a specific wallet (e.g., conversation approved/rejected)
    socket.on('notify_wallet', (data: { targetWallet: string; type: string; payload: any }) => {
      const targetSocket = connectedUsers.get(data.targetWallet);
      if (targetSocket) {
        io.to(targetSocket).emit('notification', {
          type: data.type,
          payload: data.payload,
        });
      }
    });

    // Conversation request notification
    socket.on('conversation_request', (data: { receiverWallet: string; conversationId: number; senderWallet: string; note?: string }) => {
      const targetSocket = connectedUsers.get(data.receiverWallet);
      if (targetSocket) {
        io.to(targetSocket).emit('new_conversation_request', {
          conversationId: data.conversationId,
          senderWallet: data.senderWallet,
          note: data.note,
        });
      }
    });

    socket.on('disconnect', () => {
      if (socket.data.walletAddress) {
        connectedUsers.delete(socket.data.walletAddress);
      }
      console.log(`❌ Socket disconnected: ${socket.id}`);
    });
  });
}

// Helper to emit to a specific wallet from routes
export function emitToWallet(io: Server, walletAddress: string, event: string, data: any): void {
  const socketId = connectedUsers.get(walletAddress);
  if (socketId) {
    io.to(socketId).emit(event, data);
  }
}
