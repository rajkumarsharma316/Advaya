'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getConversations, Conversation } from '../lib/api';
import { useSocket } from './useSocket';

export function useConversations(walletAddress: string | null) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { on } = useSocket(walletAddress);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchConversations = useCallback(async () => {
    if (!walletAddress) return;
    setLoading(true);
    setError(null);
    try {
      const { conversations } = await getConversations(walletAddress);
      if (mountedRef.current) setConversations(conversations);
    } catch (err: any) {
      if (mountedRef.current) setError(err.message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Real-time: new conversation request
  useEffect(() => {
    const off = on<{ conversationId: number; senderWallet: string; note?: string }>(
      'new_conversation_request',
      () => {
        // Refetch to get latest
        fetchConversations();
      }
    );
    return off;
  }, [on, fetchConversations]);

  // Real-time: notification (approved/rejected)
  useEffect(() => {
    const off = on<{ type: string }>('notification', (data) => {
      if (data.type === 'approved' || data.type === 'rejected') {
        fetchConversations();
      }
    });
    return off;
  }, [on, fetchConversations]);

  const updateConversation = useCallback((updated: Conversation) => {
    setConversations(prev =>
      prev.map(c => c.id === updated.id ? updated : c)
    );
  }, []);

  const addConversation = useCallback((conv: Conversation) => {
    setConversations(prev => {
      if (prev.find(c => c.id === conv.id)) return prev;
      return [conv, ...prev];
    });
  }, []);

  const pendingRequests = conversations.filter(
    c => c.status === 'pending' && c.receiver === walletAddress
  );
  const activeConversations = conversations.filter(c => c.status === 'approved');

  return {
    conversations,
    activeConversations,
    pendingRequests,
    loading,
    error,
    refetch: fetchConversations,
    updateConversation,
    addConversation,
  };
}
