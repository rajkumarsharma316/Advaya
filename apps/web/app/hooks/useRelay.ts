'use client';

/**
 * useRelay — Socket.io Relay Fallback
 * ────────────────────────────────────
 * When Waku P2P is unreachable, this hook connects to a lightweight
 * Socket.io relay server (backend/src/relay.ts) for cross-browser
 * message delivery.
 *
 * The relay stores pending events in memory so receivers get them
 * even if they connect later.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const RELAY_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

let relaySocket: Socket | null = null;

function getRelaySocket(): Socket {
  if (!relaySocket) {
    relaySocket = io(RELAY_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });
  }
  return relaySocket;
}

export function useRelay(walletAddress: string | null) {
  const [isConnected, setIsConnected] = useState(false);
  const identifiedRef = useRef(false);
  const listenersRef = useRef<Map<string, (data: any) => void>>(new Map());

  // Connect and identify
  useEffect(() => {
    if (!walletAddress) return;

    const socket = getRelaySocket();

    const onConnect = () => {
      console.log('[Relay] Connected to relay server');
      setIsConnected(true);
      // Identify ourselves
      socket.emit('identify', { walletAddress });
    };

    const onIdentified = () => {
      console.log('[Relay] Identified as', walletAddress.slice(0, 8));
      identifiedRef.current = true;
    };

    const onDisconnect = () => {
      console.log('[Relay] Disconnected from relay server');
      setIsConnected(false);
      identifiedRef.current = false;
    };

    socket.on('connect', onConnect);
    socket.on('identified', onIdentified);
    socket.on('disconnect', onDisconnect);

    // If already connected, identify immediately
    if (socket.connected) {
      onConnect();
    } else {
      socket.connect();
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('identified', onIdentified);
      socket.off('disconnect', onDisconnect);
    };
  }, [walletAddress]);

  // Send a system event via the relay
  const relaySendSystemEvent = useCallback(
    async (targetWallet: string, event: any) => {
      const socket = getRelaySocket();

      // Try Socket.io first (real-time)
      if (socket.connected) {
        socket.emit('system_event', { targetWallet, event });
        console.log('[Relay] System event sent via Socket.io to', targetWallet.slice(0, 8));
      }

      // Also send via HTTP POST (for persistence if receiver is offline)
      try {
        await fetch(`${RELAY_URL}/api/relay/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetWallet, event }),
        });
      } catch (err) {
        console.warn('[Relay] HTTP fallback failed:', err);
      }
    },
    []
  );

  // Subscribe to system events from the relay
  const relaySubscribeToSystemEvents = useCallback(
    (callback: (event: any) => void) => {
      const socket = getRelaySocket();

      const handler = (event: any) => {
        console.log('[Relay] Received system event:', event.type);
        callback(event);
      };

      socket.on('system_event', handler);
      listenersRef.current.set('system_event', handler);

      return () => {
        socket.off('system_event', handler);
        listenersRef.current.delete('system_event');
      };
    },
    []
  );

  // Fetch any pending events from the relay (HTTP)
  const relayFetchPendingEvents = useCallback(
    async (wallet: string): Promise<any[]> => {
      try {
        const res = await fetch(`${RELAY_URL}/api/relay/events/${wallet}`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.events || [];
      } catch {
        return [];
      }
    },
    []
  );

  // Acknowledge events were processed
  const relayAckEvents = useCallback(() => {
    const socket = getRelaySocket();
    if (socket.connected) {
      socket.emit('ack_events');
    }
    if (walletAddress) {
      fetch(`${RELAY_URL}/api/relay/events/${walletAddress}`, { method: 'DELETE' }).catch(() => {});
    }
  }, [walletAddress]);

  // Send a chat message via relay
  const relaySendChatMessage = useCallback(
    (conversationId: string, message: any) => {
      const socket = getRelaySocket();
      if (socket.connected) {
        socket.emit('chat_message', { conversationId, message });
      }
    },
    []
  );

  // Join a conversation room for chat messages
  const relayJoinConversation = useCallback((conversationId: string) => {
    const socket = getRelaySocket();
    if (socket.connected) {
      socket.emit('join_conversation', { conversationId });
    }
  }, []);

  // Subscribe to chat messages in a conversation
  const relaySubscribeToChatMessages = useCallback(
    (callback: (message: any) => void) => {
      const socket = getRelaySocket();

      const handler = (message: any) => {
        callback(message);
      };

      socket.on('chat_message', handler);

      return () => {
        socket.off('chat_message', handler);
      };
    },
    []
  );

  return {
    isConnected,
    relaySendSystemEvent,
    relaySubscribeToSystemEvents,
    relayFetchPendingEvents,
    relayAckEvents,
    relaySendChatMessage,
    relayJoinConversation,
    relaySubscribeToChatMessages,
  };
}
