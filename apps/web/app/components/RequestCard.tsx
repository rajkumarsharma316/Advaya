'use client';

import React, { useState } from 'react';
import { Conversation, approveConversation, rejectConversation } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { shortAddress, getAvatarText, getAvatarGradient } from '../lib/crypto';

interface RequestCardProps {
  conversation: Conversation;
  onUpdate: (updated: Conversation) => void;
}

export function RequestCard({ conversation, onUpdate }: RequestCardProps) {
  const { walletAddress } = useAuth();
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);

  const senderName = conversation.sender_name || shortAddress(conversation.sender);
  const initials = getAvatarText(conversation.sender_name || undefined, conversation.sender);
  const gradient = getAvatarGradient(conversation.sender);

  const handle = async (action: 'approve' | 'reject') => {
    if (!walletAddress || loading) return;
    setLoading(action);
    try {
      const fn = action === 'approve' ? approveConversation : rejectConversation;
      const { conversation: updated } = await fn(conversation.id, walletAddress);
      onUpdate(updated);
    } catch (err) {
      console.error(err);
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
          <div style={{
            fontSize: 11, color: 'var(--text-muted)',
            fontFamily: 'monospace', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {conversation.sender}
          </div>
        </div>
        <span className="badge badge-pending">Pending</span>
      </div>

      {/* Note */}
      {conversation.request_note && (
        <div style={{
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 10,
          padding: '10px 14px',
          fontSize: 13,
          color: 'var(--text-secondary)',
          fontStyle: 'italic',
        }}>
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
