'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getMessages, Message } from '../lib/api';
import { useSocket } from './useSocket';

interface RealTimeMessage {
  conversationId: number;
  messageId: number;
  ciphertext: string;
  nonce: string;
  sender: string;
  sentAt: string;
  messageType: string;
}

export function useMessages(
  conversationId: number | null,
  walletAddress: string | null
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { joinConversation, leaveConversation, on } = useSocket(walletAddress);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!conversationId || !walletAddress) return;
    setLoading(true);
    setError(null);
    try {
      const { messages } = await getMessages(conversationId, walletAddress);
      if (mountedRef.current) setMessages(messages);
    } catch (err: any) {
      if (mountedRef.current) setError(err.message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [conversationId, walletAddress]);

  // Fetch + join room when conversation changes
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    fetchMessages();
    joinConversation(conversationId);
    return () => { leaveConversation(conversationId); };
  }, [conversationId, fetchMessages, joinConversation, leaveConversation]);

  // Real-time incoming messages
  useEffect(() => {
    const off = on<RealTimeMessage>('new_message', (data) => {
      if (data.conversationId !== conversationId) return;
      // Build a partial Message object from socket data
      const msg: Message = {
        id: data.messageId,
        conversation_id: data.conversationId,
        sender: data.sender,
        ciphertext: data.ciphertext,
        nonce: data.nonce,
        message_type: (data.messageType as Message['message_type']) || 'text',
        read_once: false,
        sent_at: data.sentAt,
        expires_at: null,
        read_at: null,
      };
      if (mountedRef.current) {
        setMessages(prev => {
          // Avoid duplicates
          if (prev.find(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
    });
    return off;
  }, [on, conversationId]);

  const appendMessage = useCallback((msg: Message) => {
    setMessages(prev => {
      if (prev.find(m => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  return {
    messages,
    loading,
    error,
    refetch: fetchMessages,
    appendMessage,
  };
}
