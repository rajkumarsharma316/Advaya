'use client';

/**
 * useWaku — Fully Decentralized Messaging
 * ────────────────────────────────────────
 * Replaces Socket.io for ALL real-time communication.
 *
 * Uses Waku v2 Light Node (@waku/sdk ^0.0.36) with:
 *   - LightPush  → send messages to the Waku fleet
 *   - Filter     → subscribe to incoming messages (real-time)
 *   - Store      → query past messages (survives page refresh, ~30 days)
 *
 * Content Topics:
 *   Messages:         /advaya/1/chat-{conversationId}/proto
 *   System events:    /advaya/1/system-{walletAddress}/proto
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  createLightNode,
  waitForRemotePeer,
  Protocols,
} from '@waku/sdk';
// Codec helpers — use the node's built-in methods to avoid version-specific
// routing info requirements (v0.0.36 standalone createDecoder needs 2 args).
async function makeEncoder(contentTopic: string): Promise<any> {
  const node = await getWakuNode();
  return node.createEncoder({ contentTopic });
}

async function makeDecoder(contentTopic: string): Promise<any> {
  const node = await getWakuNode();
  return node.createDecoder({ contentTopic });
}

// ─── Singleton Waku Node ─────────────────────────────────────────────────────

let wakuNode: any = null;
let wakuInitPromise: Promise<any> | null = null;

async function getWakuNode(): Promise<any> {
  if (wakuNode) return wakuNode;
  if (wakuInitPromise) return wakuInitPromise;

  wakuInitPromise = (async () => {
    console.log('[Waku] Initializing light node…');
    const node = await createLightNode({ defaultBootstrap: true });
    await node.start();

    // Wait for at least one peer that supports all needed protocols
    // Added a 10 second timeout so it doesn't hang forever if firewalled
    await waitForRemotePeer(node, [
      Protocols.LightPush,
      Protocols.Filter,
      Protocols.Store,
    ], 10000).catch(err => {
      console.warn('[Waku] Timed out waiting for full peer support. Some features may be degraded.', err);
    });

    wakuNode = node;
    console.log('✅ Waku node ready (LightPush + Filter + Store)');
    return node;
  })();

  try {
    return await wakuInitPromise;
  } catch (err) {
    wakuInitPromise = null;
    throw err;
  }
}

// ─── Content Topic Helpers ───────────────────────────────────────────────────

/**
 * Per-conversation topic — only participants subscribe to this.
 * conversationId = the deterministic "<addrA>:<addrB>" string.
 */
export function chatTopic(conversationId: string): string {
  // Shorten long IDs to fit Waku's topic limits
  const safe = conversationId.replace(/:/g, '_').slice(0, 80);
  return `/advaya/1/chat-${safe}/proto`;
}

/**
 * Per-wallet system topic — for receiving conversation requests & approvals.
 * Only this wallet subscribes to its own system topic.
 */
export function systemTopic(walletAddress: string): string {
  return `/advaya/1/system-${walletAddress}/proto`;
}

// ─── Payload Types ───────────────────────────────────────────────────────────

export type WakuEventType =
  | 'chat_message'
  | 'conversation_request'
  | 'conversation_approved'
  | 'conversation_rejected'
  | 'conversation_deleted';

export interface WakuPayload {
  type: WakuEventType;
  [key: string]: any;
}

export interface WakuChatMessage extends WakuPayload {
  type: 'chat_message';
  conversationId: string;
  messageId: string; // UUID generated client-side (no server needed)
  ciphertext: string; // 'IPFS_BLOB' when content is on IPFS
  nonce: string;
  ipfsCid?: string;
  sender: string;
  sentAt: string;
  messageType: 'text' | 'file' | 'image';
  readOnce?: boolean;
  expiresAt?: string | null;
  // File metadata fields
  fileId?: string;
  fileName?: string;
  fileSize?: number;
}

export interface WakuConversationRequest extends WakuPayload {
  type: 'conversation_request';
  conversationId: string; // deterministic ID
  senderAddress: string;
  receiverAddress: string;
  senderPubKey: string;
  senderName: string | null;
  requestNote: string | null;
  createdAt: string;
}

export interface WakuConversationUpdate extends WakuPayload {
  type: 'conversation_approved' | 'conversation_rejected' | 'conversation_deleted';
  conversationId: string;
  actorAddress: string;
  actorPubKey?: string;
  actorName?: string | null;
  updatedAt: string;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useWaku(walletAddress?: string | null) {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const subscriptionsRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Cleanup subscriptions on unmount
      subscriptionsRef.current.forEach(unsub => { try { unsub(); } catch {} });
      subscriptionsRef.current = [];
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await getWakuNode();
        if (!cancelled && mountedRef.current) setIsReady(true);
      } catch (err: any) {
        if (!cancelled && mountedRef.current) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ─── Send helpers ──────────────────────────────────────────────────────────

  /**
   * Send a message to a conversation topic.
   */
  const sendChatMessage = useCallback(async (payload: WakuChatMessage) => {
    const node = await getWakuNode();
    const encoder = await makeEncoder(chatTopic(payload.conversationId));
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    try {
      const res = await node.lightPush.send(encoder, { payload: bytes });
      if (res.failures && res.failures.length > 0) {
        throw new Error('Message not delivered to any Waku peers');
      }
    } catch (err: any) {
      console.warn('[Waku] LightPush send failed:', err);
      throw err;
    }
  }, []);

  /**
   * Send a system event to a specific wallet's topic
   * (e.g., conversation request, approval).
   */
  const sendSystemEvent = useCallback(async (
    targetWallet: string,
    payload: WakuConversationRequest | WakuConversationUpdate
  ) => {
    const node = await getWakuNode();
    const encoder = await makeEncoder(systemTopic(targetWallet));
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    try {
      const res = await node.lightPush.send(encoder, { payload: bytes });
      if (res.failures && res.failures.length > 0) {
        throw new Error('System event not delivered to any Waku peers');
      }
    } catch (err: any) {
      console.warn('[Waku] System event send failed:', err);
      throw err;
    }
  }, []);

  // ─── Subscribe helpers ─────────────────────────────────────────────────────

  /**
   * Subscribe to live messages in a conversation.
   * Returns an unsubscribe function.
   */
  const subscribeToChatMessages = useCallback(async (
    conversationId: string,
    callback: (msg: WakuChatMessage) => void
  ): Promise<() => void> => {
    const node = await getWakuNode();
    const decoder = await makeDecoder(chatTopic(conversationId));

    const observer = (wakuMsg: any) => {
      if (!wakuMsg?.payload) return;
      try {
        const data = JSON.parse(new TextDecoder().decode(wakuMsg.payload)) as WakuPayload;
        if (data.type === 'chat_message') callback(data as WakuChatMessage);
      } catch {}
    };

    let unsubFn: (() => void) | undefined;
    try {
      const sub = await node.filter.subscribe([decoder], observer);
      unsubFn = typeof sub === 'function' ? sub : (sub as any)?.unsubscribe ?? (() => {});
      if (unsubFn) subscriptionsRef.current.push(unsubFn);
    } catch (err) {
      console.warn('[Waku] Chat subscribe failed:', err);
    }

    return () => { if (unsubFn) unsubFn!(); };
  }, []);

  /**
   * Subscribe to system events for this wallet
   * (conversation requests, approvals, deletions).
   * Returns an unsubscribe function.
   */
  const subscribeToSystemEvents = useCallback(async (
    targetWallet: string,
    callback: (event: WakuConversationRequest | WakuConversationUpdate) => void
  ): Promise<() => void> => {
    const node = await getWakuNode();
    const decoder = await makeDecoder(systemTopic(targetWallet));

    const observer = (wakuMsg: any) => {
      if (!wakuMsg?.payload) return;
      try {
        const data = JSON.parse(new TextDecoder().decode(wakuMsg.payload)) as WakuPayload;
        if (
          data.type === 'conversation_request' ||
          data.type === 'conversation_approved' ||
          data.type === 'conversation_rejected' ||
          data.type === 'conversation_deleted'
        ) {
          callback(data as WakuConversationRequest | WakuConversationUpdate);
        }
      } catch {}
    };

    let unsubFn: (() => void) | undefined;
    try {
      const sub = await node.filter.subscribe([decoder], observer);
      unsubFn = typeof sub === 'function' ? sub : (sub as any)?.unsubscribe ?? (() => {});
      if (unsubFn) subscriptionsRef.current.push(unsubFn);
    } catch (err) {
      console.warn('[Waku] System subscribe failed:', err);
    }

    return () => { if (unsubFn) unsubFn!(); };
  }, []);

  // ─── Store (history) queries ───────────────────────────────────────────────

  /**
   * Query Waku Store for past messages in a conversation.
   * Returns decoded WakuChatMessage payloads sorted by timestamp.
   *
   * Waku Store retains messages for ~30 days on fleet nodes.
   */
  const queryMessageHistory = useCallback(async (
    conversationId: string,
    options?: { pageSize?: number }
  ): Promise<WakuChatMessage[]> => {
    const node = await getWakuNode();
    const decoder = await makeDecoder(chatTopic(conversationId));
    const results: WakuChatMessage[] = [];

    try {
      for await (const page of node.store.queryGenerator([decoder], {
        pageSize: options?.pageSize || 50,
      } as any)) {
        const messages = Array.isArray(page) ? await Promise.all(page) : [await page];
        for (const msg of messages) {
          if (!msg?.payload) continue;
          try {
            const data = JSON.parse(new TextDecoder().decode(msg.payload)) as WakuPayload;
            if (data.type === 'chat_message') results.push(data as WakuChatMessage);
          } catch {}
        }
      }
    } catch (err) {
      console.warn('[Waku] Store query failed (this is normal on first use):', err);
    }

    // Sort by sentAt ascending
    results.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
    // Deduplicate by messageId
    const seen = new Set<string>();
    return results.filter(m => {
      if (seen.has(m.messageId)) return false;
      seen.add(m.messageId);
      return true;
    });
  }, []);

  /**
   * Query Waku Store for past system events (conversation requests, etc.)
   * directed at this wallet.
   */
  const querySystemHistory = useCallback(async (
    targetWallet: string
  ): Promise<Array<WakuConversationRequest | WakuConversationUpdate>> => {
    const node = await getWakuNode();
    const decoder = await makeDecoder(systemTopic(targetWallet));
    const results: Array<WakuConversationRequest | WakuConversationUpdate> = [];

    try {
      for await (const page of node.store.queryGenerator([decoder], { pageSize: 100 } as any)) {
        const messages = Array.isArray(page) ? await Promise.all(page) : [await page];
        for (const msg of messages) {
          if (!msg?.payload) continue;
          try {
            const data = JSON.parse(new TextDecoder().decode(msg.payload)) as WakuPayload;
            if (
              data.type === 'conversation_request' ||
              data.type === 'conversation_approved' ||
              data.type === 'conversation_rejected' ||
              data.type === 'conversation_deleted'
            ) {
              results.push(data as WakuConversationRequest | WakuConversationUpdate);
            }
          } catch {}
        }
      }
    } catch (err) {
      console.warn('[Waku] System history query failed:', err);
    }

    return results;
  }, []);

  return {
    isReady,
    error,
    sendChatMessage,
    sendSystemEvent,
    subscribeToChatMessages,
    subscribeToSystemEvents,
    queryMessageHistory,
    querySystemHistory,
  };
}
