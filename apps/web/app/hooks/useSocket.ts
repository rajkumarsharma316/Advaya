'use client';

import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

let globalSocket: Socket | null = null;

export function useSocket(walletAddress: string | null) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!walletAddress) return;

    // Reuse existing connection
    if (!globalSocket || !globalSocket.connected) {
      globalSocket = io(SOCKET_URL, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
      });
    }

    socketRef.current = globalSocket;

    const socket = globalSocket;

    const onConnect = () => {
      socket.emit('identify', { walletAddress });
    };

    // If already connected, identify immediately
    if (socket.connected) {
      socket.emit('identify', { walletAddress });
    }

    socket.on('connect', onConnect);

    return () => {
      socket.off('connect', onConnect);
    };
  }, [walletAddress]);

  const joinConversation = useCallback((conversationId: number) => {
    globalSocket?.emit('join_conversation', { conversationId });
  }, []);

  const leaveConversation = useCallback((conversationId: number) => {
    globalSocket?.emit('leave_conversation', { conversationId });
  }, []);

  const sendTyping = useCallback((conversationId: number, isTyping: boolean) => {
    globalSocket?.emit('typing', { conversationId, isTyping });
  }, []);

  const emitMessage = useCallback((data: {
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
    globalSocket?.emit('send_message', data);
  }, []);

  const emitConversationRequest = useCallback((data: {
    receiverWallet: string;
    conversationId: number;
    senderWallet: string;
    note?: string;
  }) => {
    globalSocket?.emit('conversation_request', data);
  }, []);

  const on = useCallback(<T>(event: string, handler: (data: T) => void) => {
    globalSocket?.on(event, handler);
    return () => { globalSocket?.off(event, handler); };
  }, []);

  return {
    socket: socketRef.current,
    joinConversation,
    leaveConversation,
    sendTyping,
    emitMessage,
    emitConversationRequest,
    on,
    isConnected: globalSocket?.connected ?? false,
  };
}
