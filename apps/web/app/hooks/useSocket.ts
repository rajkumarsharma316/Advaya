'use client';

/**
 * @deprecated
 * ─────────────────────────────────────────────────────────────────────────────
 * useSocket is DEPRECATED. Socket.io has been removed from Advaya.
 *
 * All real-time events previously handled by Socket.io are now delivered
 * peer-to-peer via Waku P2P:
 *
 *   Chat messages          → useWaku.ts subscribeToChatMessages()
 *   Conversation requests  → useWaku.ts subscribeToSystemEvents()
 *   Approval notifications → useWaku.ts subscribeToSystemEvents()
 *
 * This file remains as a stub that logs a warning but does not crash.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback } from 'react';

export function useSocket(_walletAddress: string | null) {
  console.warn(
    '[Advaya] useSocket() is deprecated. ' +
    'Socket.io has been replaced by Waku P2P. ' +
    'Use useWaku() from hooks/useWaku.ts instead.'
  );

  const noop = useCallback((..._: any[]) => {}, []);
  const noopOff = useCallback((..._: any[]) => () => {}, []);

  return {
    socket: null,
    joinConversation: noop,
    leaveConversation: noop,
    sendTyping: noop,
    emitMessage: noop,
    emitConversationRequest: noop,
    on: noopOff,
    isConnected: false,
  };
}
