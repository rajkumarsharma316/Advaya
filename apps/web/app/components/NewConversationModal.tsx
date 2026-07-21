'use client';

/**
 * NewConversationModal — Fully Decentralized
 * ────────────────────────────────────────────
 * Creates conversations on Soroban (local state) and broadcasts the
 * conversation request to the receiver via Waku P2P system topic.
 * No backend server call whatsoever.
 */

import React, { useState } from 'react';
import {
  createConversation,
  getWallet,
  conversationId,
  type Conversation,
} from '../lib/stellar';
import { useAuth } from '../context/AuthContext';
import { useWaku, type WakuConversationRequest } from '../hooks/useWaku';

interface NewConversationModalProps {
  onClose: () => void;
  onCreated: (conv: Conversation) => void;
}

export function NewConversationModal({ onClose, onCreated }: NewConversationModalProps) {
  const { walletAddress, keyPair, displayName } = useAuth();
  const { sendSystemEvent } = useWaku(walletAddress);
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const receiver = address.trim();
    if (!walletAddress || !receiver || !keyPair) return;
    if (walletAddress === receiver) {
      setError("You can't start a conversation with yourself.");
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Try to look up receiver's pub key (for caching purposes)
      let receiverPubKey = '';
      try {
        const walletRecord = await getWallet(receiver);
        receiverPubKey = walletRecord?.pub_key || '';
      } catch {
        // Receiver not yet in local cache — that's fine
      }

      // Create conversation locally + fire Soroban call
      const conv = await createConversation(
        walletAddress,
        receiver,
        note.trim() || undefined,
        keyPair.publicKey,
        displayName
      );

      // Broadcast conversation request via Waku to receiver's system topic
      const wakuRequest: WakuConversationRequest = {
        type: 'conversation_request',
        conversationId: conv.id,
        senderAddress: walletAddress,
        receiverAddress: receiver,
        senderPubKey: keyPair.publicKey,
        senderName: displayName,
        requestNote: note.trim() || null,
        createdAt: conv.created_at,
      };

      await sendSystemEvent(receiver, wakuRequest);
      console.log('[Waku] Conversation request sent to', receiver.slice(0, 8));

      onCreated(conv);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create conversation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box animate-slide-up">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h2 className="modal-title">New Conversation</h2>
            <p className="modal-subtitle">Enter a Stellar wallet address to start an encrypted chat.</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, marginLeft: 12 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="input-label">Stellar Wallet Address</label>
            <input
              id="new-convo-address"
              className="input-field"
              type="text"
              placeholder="G... (56 characters)"
              value={address}
              onChange={e => setAddress(e.target.value)}
              autoFocus
              maxLength={56}
              spellCheck={false}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
            {address.length > 0 && address.length !== 56 && (
              <p style={{ fontSize: 11, color: 'var(--status-pending)', marginTop: 4 }}>
                Stellar addresses are exactly 56 characters ({address.length}/56)
              </p>
            )}
          </div>

          <div>
            <label className="input-label">
              Introduction note{' '}
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea
              id="new-convo-note"
              className="chat-textarea"
              placeholder="Hey! I'd like to chat securely with you on Advaya…"
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={300}
              rows={2}
              style={{ width: '100%', resize: 'none' }}
            />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>
              {note.length}/300
            </p>
          </div>

          {error && (
            <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--status-danger)' }}>
              {error}
            </div>
          )}

          {/* P2P indicator */}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
            </svg>
            Request sent peer-to-peer via Waku · No server involved
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>
              Cancel
            </button>
            <button
              id="send-request-btn"
              type="submit"
              className="btn btn-primary"
              disabled={loading || address.length !== 56}
              style={{ flex: 2 }}
            >
              {loading ? 'Sending via Waku…' : 'Send Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
