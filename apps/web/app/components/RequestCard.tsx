'use client';

/**
 * RequestCard — Fully Decentralized
 * ───────────────────────────────────
 * Approve/reject via Soroban contract + Waku notification to requester.
 * No backend server call.
 */

import React, { useState } from 'react';
import {
  approveConversation,
  rejectConversation,
  type Conversation,
} from '../lib/stellar';
import { useAuth } from '../context/AuthContext';
import { useWaku, type WakuConversationUpdate } from '../hooks/useWaku';
import { useRelay } from '../hooks/useRelay';
import { shortAddress, getAvatarText, getAvatarGradient } from '../lib/crypto';

interface RequestCardProps {
  conversation: Conversation;
  onUpdate: (updated: Conversation) => void;
}

export function RequestCard({ conversation, onUpdate }: RequestCardProps) {
  const { walletAddress, keyPair, displayName } = useAuth();
  const { sendSystemEvent } = useWaku(walletAddress);
  const { relaySendSystemEvent } = useRelay(walletAddress);
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);

  const senderName = conversation.sender_name || shortAddress(conversation.sender);
  const initials = getAvatarText(conversation.sender_name || undefined, conversation.sender);
  const gradient = getAvatarGradient(conversation.sender);

  const handle = async (action: 'approve' | 'reject') => {
    if (!walletAddress || !keyPair || loading) return;
    setLoading(action);
    try {
      let updated;
      if (action === 'approve') {
        // Pass the receiver's pub key so the sender can encrypt messages to us
        updated = await approveConversation(conversation.id, walletAddress, keyPair.publicKey, displayName);
      } else {
        updated = await rejectConversation(conversation.id, walletAddress);
      }
      onUpdate(updated);

      // Notify the sender via Waku (best-effort, don't block on failure)
      const eventType = action === 'approve' ? 'conversation_approved' : 'conversation_rejected';
      const wakuUpdate: WakuConversationUpdate = {
        type: eventType,
        conversationId: conversation.id,
        actorAddress: walletAddress,
        actorPubKey: keyPair.publicKey,
        actorName: displayName,
        updatedAt: new Date().toISOString(),
      };

      // Send via Waku (best-effort)
      try {
        await sendSystemEvent(conversation.sender, wakuUpdate);
        console.log(`[Waku] ${eventType} sent to`, conversation.sender.slice(0, 8));
      } catch (wakuErr) {
        console.warn(`[Waku] Failed to send ${eventType}:`, wakuErr);
      }

      // ALWAYS send via relay too (guaranteed delivery)
      try {
        await relaySendSystemEvent(conversation.sender, wakuUpdate);
        console.log(`[Relay] ${eventType} sent to`, conversation.sender.slice(0, 8));
      } catch (relayErr) {
        console.warn(`[Relay] Failed to send ${eventType}:`, relayErr);
      }
    } catch (err) {
      console.error('[RequestCard] Action failed:', err);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="request-card">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="avatar" style={{ background: gradient }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{senderName}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {conversation.sender}
          </div>
        </div>
        <span className="badge badge-pending">Pending</span>
      </div>

      {/* Note */}
      {conversation.request_note && (
        <div style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
          "{conversation.request_note}"
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          id={`reject-request-${conversation.id}`}
          className="btn btn-danger"
          onClick={() => handle('reject')}
          disabled={!!loading}
          style={{ flex: 1 }}
        >
          {loading === 'reject' ? 'Rejecting…' : '✕ Reject'}
        </button>
        <button
          id={`approve-request-${conversation.id}`}
          className="btn btn-primary"
          onClick={() => handle('approve')}
          disabled={!!loading}
          style={{ flex: 2 }}
        >
          {loading === 'approve' ? 'Approving…' : '✓ Accept'}
        </button>
      </div>
    </div>
  );
}
