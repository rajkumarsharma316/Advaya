'use client';

/**
 * useMessages — Fully Decentralized
 * ───────────────────────────────────
 * Replaces GET /api/messages/:conversationId with:
 *   - Waku Store queries (historical messages, ~30 day retention)
 *   - Waku Filter subscriptions (real-time incoming messages)
 *
 * Message format on Waku:
 *   type: 'chat_message'
 *   ciphertext: 'IPFS_BLOB' (content stored on IPFS)
 *   ipfsCid: '<CID>'
 *   nonce: '<base64>'
 *   sender: '<walletAddress>'
 *   sentAt: '<ISO timestamp>'
 *   messageType: 'text' | 'file' | 'image'
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWaku, type WakuChatMessage } from './useWaku';

// ─── Message type exposed to the rest of the app ─────────────────────────────

export interface Message {
  id: string;            // UUID from Waku payload (no server-generated IDs)
  conversation_id: string;
  sender: string;
  ciphertext: string;
  nonce: string;
  message_type: 'text' | 'file' | 'image';
  read_once: boolean;
  sent_at: string;
  expires_at: string | null;
  read_at: string | null;
  ipfs_cid?: string;
  // File metadata (populated when message_type === 'file' | 'image')
  file_id?: string;
  file_name?: string;
  file_size?: number;
  file_nonce?: string;
}

function wakuMsgToMessage(w: WakuChatMessage): Message {
  return {
    id: w.messageId,
    conversation_id: w.conversationId,
    sender: w.sender,
    ciphertext: w.ciphertext,
    nonce: w.nonce,
    message_type: w.messageType,
    read_once: w.readOnce ?? false,
    sent_at: w.sentAt,
    expires_at: w.expiresAt ?? null,
    read_at: null,
    ipfs_cid: w.ipfsCid,
    file_id: w.fileId,
    file_name: w.fileName,
    file_size: w.fileSize,
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useMessages(
  conversationId: string | null,
  walletAddress: string | null
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const {
    subscribeToChatMessages,
    queryMessageHistory,
    isReady: wakuReady,
  } = useWaku(walletAddress);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ─── Load history from Waku Store ─────────────────────────────────────────

  const fetchMessages = useCallback(async () => {
    if (!conversationId || !walletAddress) return;
    setLoading(true);
    setError(null);
    try {
      const history = await queryMessageHistory(conversationId);
      const mapped = history.map(wakuMsgToMessage);

      // Filter out expired messages
      const now = Date.now();
      const valid = mapped.filter(m =>
        !m.expires_at || new Date(m.expires_at).getTime() > now
      );

      if (mountedRef.current) setMessages(valid);
    } catch (err: any) {
      if (mountedRef.current) setError(err.message || 'Failed to load messages');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [conversationId, walletAddress, queryMessageHistory]);

  // Load on mount + when conversation changes
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    if (wakuReady) {
      fetchMessages();
    }
  }, [conversationId, wakuReady, fetchMessages]);

  // ─── Live subscription for real-time messages ──────────────────────────────

  useEffect(() => {
    if (!conversationId || !wakuReady) return;

    let unsubFn: (() => void) | null = null;

    subscribeToChatMessages(conversationId, (wakuMsg) => {
      if (!mountedRef.current) return;

      // Ignore expired
      if (wakuMsg.expiresAt && new Date(wakuMsg.expiresAt).getTime() <= Date.now()) return;

      const msg = wakuMsgToMessage(wakuMsg);
      setMessages(prev => {
        if (prev.find(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    }).then(unsub => {
      unsubFn = unsub;
    });

    return () => {
      if (unsubFn) unsubFn();
    };
  }, [conversationId, wakuReady, subscribeToChatMessages]);

  // ─── Helper to optimistically add a sent message ───────────────────────────

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
