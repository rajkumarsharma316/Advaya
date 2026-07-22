'use client';

/**
 * useConversations — Hybrid: Waku P2P + Relay Fallback
 * ─────────────────────────────────────────────────────
 * Uses Waku P2P for real-time notifications when available.
 * Falls back to the lightweight Socket.io relay server when Waku
 * peers are unreachable (e.g., firewalled networks).
 *
 *   - Local state (localStorage via stellar.ts)
 *   - Soroban contract (on-chain approvals)
 *   - Waku P2P (real-time notifications — primary)
 *   - Socket.io relay (real-time notifications — fallback)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getConversations,
  receiveConversationRequest,
  receiveConversationUpdate,
  deleteConversation as deleteConversationLocal,
  cacheWallet,
  type Conversation,
  type ConversationStatus,
} from '../lib/stellar';
import { useWaku, type WakuConversationRequest, type WakuConversationUpdate } from './useWaku';
import { useRelay } from './useRelay';

export type { Conversation };

// Helper to process a system event (shared between Waku and Relay paths)
function processSystemEvent(
  event: any,
  walletAddress: string,
  fetchConversations: () => Promise<void>,
  mountedRef: React.MutableRefObject<boolean>
) {
  if (event.type === 'conversation_request') {
    const req = event as WakuConversationRequest;
    if (req.senderPubKey) {
      cacheWallet({
        address: req.senderAddress,
        pub_key: req.senderPubKey,
        display_name: req.senderName,
        registered_at: req.createdAt,
      });
    }
    receiveConversationRequest({
      id: req.conversationId,
      sender: req.senderAddress,
      receiver: req.receiverAddress,
      status: 'pending',
      request_note: req.requestNote,
      created_at: req.createdAt,
      updated_at: req.createdAt,
      sender_pub_key: req.senderPubKey,
      sender_name: req.senderName,
      receiver_pub_key: '',
      receiver_name: null,
      message_count: '0',
      last_message_at: null,
    });
    if (mountedRef.current) fetchConversations();
  } else if (
    event.type === 'conversation_approved' ||
    event.type === 'conversation_rejected'
  ) {
    const upd = event as WakuConversationUpdate;
    const status: ConversationStatus =
      event.type === 'conversation_approved' ? 'approved' : 'rejected';
    receiveConversationUpdate(upd.conversationId, status, upd.actorPubKey, upd.actorName);
    if (upd.actorPubKey) {
      cacheWallet({
        address: upd.actorAddress,
        pub_key: upd.actorPubKey,
        display_name: upd.actorName || null,
        registered_at: upd.updatedAt,
      });
    }
    if (mountedRef.current) fetchConversations();
  } else if (event.type === 'conversation_deleted') {
    const upd = event as WakuConversationUpdate;
    deleteConversationLocal(upd.conversationId, walletAddress).then(() => {
      if (mountedRef.current) fetchConversations();
    });
  }
}

export function useConversations(walletAddress: string | null) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const { subscribeToSystemEvents, querySystemHistory, isReady: wakuReady } = useWaku(walletAddress);
  const {
    isConnected: relayConnected,
    relaySubscribeToSystemEvents,
    relayFetchPendingEvents,
    relayAckEvents,
  } = useRelay(walletAddress);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ─── Load from local store ─────────────────────────────────────────────────

  const fetchConversations = useCallback(async () => {
    if (!walletAddress) return;
    setLoading(true);
    setError(null);
    try {
      const convos = await getConversations(walletAddress);
      if (mountedRef.current) setConversations(convos);
    } catch (err: any) {
      if (mountedRef.current) setError(err.message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // ─── Relay: Fetch pending events on connect ───────────────────────────────

  useEffect(() => {
    if (!walletAddress || !relayConnected) return;

    (async () => {
      try {
        const pending = await relayFetchPendingEvents(walletAddress);
        if (pending.length > 0) {
          console.log(`[Relay] Processing ${pending.length} pending events`);
          for (const event of pending) {
            processSystemEvent(event, walletAddress, fetchConversations, mountedRef);
          }
          relayAckEvents();
        }
      } catch (err) {
        console.warn('[useConversations] Relay pending fetch failed:', err);
      }
    })();
  }, [walletAddress, relayConnected, relayFetchPendingEvents, relayAckEvents, fetchConversations]);

  // ─── Relay: Live subscriptions ─────────────────────────────────────────────

  useEffect(() => {
    if (!walletAddress || !relayConnected) return;

    const unsub = relaySubscribeToSystemEvents((event) => {
      if (!mountedRef.current) return;
      console.log('[Relay] Live event received:', event.type);
      processSystemEvent(event, walletAddress, fetchConversations, mountedRef);
    });

    return unsub;
  }, [walletAddress, relayConnected, relaySubscribeToSystemEvents, fetchConversations]);

  // ─── Waku: Replay Store history (past system events) ──────────────────────

  useEffect(() => {
    if (!walletAddress || !wakuReady) return;

    (async () => {
      try {
        const history = await querySystemHistory(walletAddress);
        let changed = false;

        for (const event of history) {
          processSystemEvent(event, walletAddress, fetchConversations, mountedRef);
          changed = true;
        }

        if (changed && mountedRef.current) {
          fetchConversations();
        }
      } catch (err) {
        console.warn('[useConversations] Waku history replay failed:', err);
      }
    })();
  }, [walletAddress, wakuReady, querySystemHistory, fetchConversations]);

  // ─── Waku: Live subscriptions (real-time system events) ───────────────────

  useEffect(() => {
    if (!walletAddress || !wakuReady) return;

    let unsubFn: (() => void) | null = null;

    subscribeToSystemEvents(walletAddress, async (event) => {
      if (!mountedRef.current) return;
      processSystemEvent(event, walletAddress, fetchConversations, mountedRef);
    }).then(unsub => {
      unsubFn = unsub;
    });

    return () => {
      if (unsubFn) unsubFn();
    };
  }, [walletAddress, wakuReady, subscribeToSystemEvents, fetchConversations]);

  // ─── Derived state ─────────────────────────────────────────────────────────

  const updateConversation = useCallback((updated: Conversation) => {
    setConversations(prev =>
      prev.map(c => c.id === updated.id ? { ...c, ...updated } : c)
    );
    // Also re-fetch from localStorage to ensure consistency
    fetchConversations();
  }, [fetchConversations]);

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
