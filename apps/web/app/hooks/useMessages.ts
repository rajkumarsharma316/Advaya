'use client';

/**
 * useMessages — Hybrid: Waku P2P + Relay Fallback
 * ─────────────────────────────────────────────────
 * Replaces GET /api/messages/:conversationId with:
 *   - Waku Store queries (historical messages, ~30 day retention)
 *   - Waku Filter subscriptions (real-time incoming messages)
 *   - Socket.io relay (fallback for real-time when Waku is down)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWaku, type WakuChatMessage } from './useWaku';
import { useRelay } from './useRelay';

// ─── Local Storage Cache ─────────────────────────────────────────────────────

const CACHE_PREFIX = 'advaya_msgs_';

function getLocalMessages(conversationId: string): Message[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(CACHE_PREFIX + conversationId);
    if (!data) return [];
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveLocalMessages(conversationId: string, messages: Message[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CACHE_PREFIX + conversationId, JSON.stringify(messages));
  } catch (err) {
    console.warn('[LocalCache] Failed to save messages', err);
  }
}

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
  const {
    isConnected: relayConnected,
    relayJoinConversation,
    relaySubscribeToChatMessages,
  } = useRelay(walletAddress);

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

      if (mountedRef.current) {
        setMessages(prev => {
          // Merge Waku history with our local cache to avoid losing relay messages
          const combined = [...prev, ...valid];
          // Deduplicate by message ID
          const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
          // Sort by date ascending
          return unique.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
        });
      }
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
    
    // 1. Load instantly from local storage cache
    const cached = getLocalMessages(conversationId);
    if (cached.length > 0) {
      setMessages(cached);
    }

    // 2. Try fetching from Waku Store in background
    if (wakuReady) {
      fetchMessages();
    }
  }, [conversationId, wakuReady, fetchMessages]);

  // Save to local storage whenever messages change
  useEffect(() => {
    if (conversationId && messages.length > 0) {
      saveLocalMessages(conversationId, messages);
    }
  }, [conversationId, messages]);

  // ─── Waku: Live subscription for real-time messages ────────────────────────

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

  // ─── Relay: Join conversation room + live subscription ─────────────────────

  useEffect(() => {
    if (!conversationId || !relayConnected) return;

    // Join the relay conversation room
    relayJoinConversation(conversationId);

    // Subscribe to chat messages from the relay
    const unsub = relaySubscribeToChatMessages((wakuMsg: WakuChatMessage) => {
      if (!mountedRef.current) return;
      if (wakuMsg.conversationId !== conversationId) return;

      // Ignore expired
      if (wakuMsg.expiresAt && new Date(wakuMsg.expiresAt).getTime() <= Date.now()) return;

      const msg = wakuMsgToMessage(wakuMsg);
      setMessages(prev => {
        if (prev.find(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    return unsub;
  }, [conversationId, relayConnected, relayJoinConversation, relaySubscribeToChatMessages]);

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
