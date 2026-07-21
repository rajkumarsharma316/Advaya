'use client';

/**
 * useConversations — Fully Decentralized
 * ───────────────────────────────────────
 * Replaces all API calls and Socket.io events with:
 *   - Local state (localStorage via stellar.ts)
 *   - Soroban contract (on-chain approvals)
 *   - Waku P2P (real-time notifications of new requests & status changes)
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

export type { Conversation };

export function useConversations(walletAddress: string | null) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const { subscribeToSystemEvents, querySystemHistory, isReady: wakuReady } = useWaku(walletAddress);

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

  // ─── Replay Waku Store history (past system events) ───────────────────────
  // On first load, query Waku Store to discover any conversation requests
  // we may have missed while offline (up to ~30 days).

  useEffect(() => {
    if (!walletAddress || !wakuReady) return;

    (async () => {
      try {
        const history = await querySystemHistory(walletAddress);
        let changed = false;

        for (const event of history) {
          if (event.type === 'conversation_request') {
            const req = event as WakuConversationRequest;
            // Cache the sender's pub key
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
            changed = true;
          } else if (
            event.type === 'conversation_approved' ||
            event.type === 'conversation_rejected' ||
            event.type === 'conversation_deleted'
          ) {
            const upd = event as WakuConversationUpdate;
            const status = event.type === 'conversation_approved'
              ? 'approved'
              : event.type === 'conversation_rejected'
                ? 'rejected'
                : 'rejected';

            if (event.type === 'conversation_deleted') {
              // Remove locally
              await deleteConversationLocal(upd.conversationId, walletAddress);
            } else {
              receiveConversationUpdate(upd.conversationId, status as ConversationStatus);
            }
            changed = true;
          }
        }

        if (changed && mountedRef.current) {
          fetchConversations();
        }
      } catch (err) {
        console.warn('[useConversations] Waku history replay failed:', err);
      }
    })();
  }, [walletAddress, wakuReady, querySystemHistory, fetchConversations]);

  // ─── Live Waku subscriptions (real-time system events) ────────────────────

  useEffect(() => {
    if (!walletAddress || !wakuReady) return;

    let unsubFn: (() => void) | null = null;

    subscribeToSystemEvents(walletAddress, async (event) => {
      if (!mountedRef.current) return;

      if (event.type === 'conversation_request') {
        const req = event as WakuConversationRequest;
        // Cache sender's pub key
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
        fetchConversations();
      } else if (
        event.type === 'conversation_approved' ||
        event.type === 'conversation_rejected'
      ) {
        const upd = event as WakuConversationUpdate;
        const status: ConversationStatus =
          event.type === 'conversation_approved' ? 'approved' : 'rejected';
        receiveConversationUpdate(upd.conversationId, status);
        // Cache approver's pub key if provided
        if (upd.actorPubKey) {
          cacheWallet({
            address: upd.actorAddress,
            pub_key: upd.actorPubKey,
            display_name: upd.actorName || null,
            registered_at: upd.updatedAt,
          });
        }
        fetchConversations();
      } else if (event.type === 'conversation_deleted') {
        const upd = event as WakuConversationUpdate;
        await deleteConversationLocal(upd.conversationId, walletAddress);
        fetchConversations();
      }
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
