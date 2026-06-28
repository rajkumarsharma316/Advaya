'use client';

import React, { useState } from 'react';
import { createConversation, Conversation } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';

interface NewConversationModalProps {
  onClose: () => void;
  onCreated: (conv: Conversation) => void;
}

export function NewConversationModal({ onClose, onCreated }: NewConversationModalProps) {
  const { walletAddress } = useAuth();
  const { emitConversationRequest } = useSocket(walletAddress);
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletAddress || !address.trim()) return;
    setLoading(true);
    setError('');

    try {
      const { conversation } = await createConversation(
        address.trim(),
        note.trim() || undefined,
        walletAddress
      );

      // Notify receiver via socket
      emitConversationRequest({
        receiverWallet: address.trim(),
        conversationId: conversation.id,
        senderWallet: walletAddress,
        note: note.trim() || undefined,
      });

      onCreated(conversation);
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
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: 4, marginLeft: 12,
            }}
          >
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
            <div style={{
              background: 'rgba(248,113,113,0.1)',
              border: '1px solid rgba(248,113,113,0.3)',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 13,
              color: 'var(--status-danger)',
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              style={{ flex: 1 }}
            >
              Cancel
            </button>
            <button
              id="send-request-btn"
              type="submit"
              className="btn btn-primary"
              disabled={loading || address.length !== 56}
              style={{ flex: 2 }}
            >
              {loading ? 'Sending…' : 'Send Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
