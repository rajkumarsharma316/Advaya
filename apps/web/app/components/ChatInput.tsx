'use client';

import React, { useRef, useState, useCallback } from 'react';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../context/AuthContext';

interface ChatInputProps {
  conversationId: number;
  recipientPubKey: string;
  onMessageSent: (plaintext: string, sentAt: string, messageId: number, expiresAt?: string | null) => void;
  disabled?: boolean;
}

export function ChatInput({
  conversationId,
  recipientPubKey,
  onMessageSent,
  disabled,
}: ChatInputProps) {
  const { walletAddress, keyPair } = useAuth();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [readOnce, setReadOnce] = useState(false);
  const [expiresIn, setExpiresIn] = useState<number | ''>('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { sendTyping, emitMessage } = useSocket(walletAddress);

  // Import encryption lazily (client-only)
  const encrypt = useCallback(async (plaintext: string) => {
    const { encryptMessage } = await import('../lib/crypto');
    if (!keyPair) throw new Error('No keypair');
    return encryptMessage(plaintext, recipientPubKey, keyPair.secretKey);
  }, [keyPair, recipientPubKey]);

  const handleTyping = useCallback(() => {
    sendTyping(conversationId, true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => sendTyping(conversationId, false), 2000);
  }, [conversationId, sendTyping]);

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || !walletAddress || !keyPair) return;

    setSending(true);
    try {
      const { ciphertext, nonce } = await encrypt(trimmed);

      // Send to backend via REST
      const { sendMessage } = await import('../lib/api');
      const expiresInSeconds = expiresIn ? Number(expiresIn) * 60 : undefined;
      const { message } = await sendMessage({
        conversationId,
        ciphertext,
        nonce,
        messageType: 'text',
        readOnce,
        expiresInSeconds,
      }, walletAddress);

      // Emit via socket for real-time delivery
      emitMessage({
        conversationId,
        messageId: message.id,
        ciphertext,
        nonce,
        sender: walletAddress,
        sentAt: message.sent_at,
        messageType: 'text',
      });

      // Notify parent with plaintext so we can show it
      onMessageSent(trimmed, message.sent_at, message.id, message.expires_at);

      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      setReadOnce(false);
      setExpiresIn('');
    } catch (err: any) {
      console.error('Send failed:', err);
    } finally {
      setSending(false);
    }
  }, [text, sending, walletAddress, keyPair, encrypt, conversationId, readOnce, expiresIn, emitMessage, onMessageSent]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div>
      {/* Message options */}
      {showOptions && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '8px 0 12px',
          borderTop: '1px solid var(--border-subtle)',
          marginBottom: 12,
        }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={readOnce}
              onChange={e => setReadOnce(e.target.checked)}
              style={{ accentColor: 'var(--brand-primary)', width: 14, height: 14 }}
            />
            👁 Read once
          </label>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12, color: 'var(--text-secondary)',
          }}>
            ⏱ Expires in:
            <select
              value={expiresIn}
              onChange={e => setExpiresIn(e.target.value === '' ? '' : Number(e.target.value))}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 6,
                color: 'var(--text-primary)',
                padding: '2px 6px',
                fontSize: 12,
              }}
            >
              <option value="">Never</option>
              <option value={1}>1 min</option>
              <option value={5}>5 min</option>
              <option value={30}>30 min</option>
              <option value={60}>1 hour</option>
              <option value={1440}>1 day</option>
            </select>
          </label>
        </div>
      )}

      <div className="chat-input-wrapper">
        {/* Options toggle */}
        <button
          className="btn-icon btn-ghost btn"
          onClick={() => setShowOptions(s => !s)}
          title="Message options"
          style={{
            color: showOptions ? 'var(--brand-secondary)' : 'var(--text-muted)',
            background: showOptions ? 'rgba(108,99,255,0.1)' : 'transparent',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>
          </svg>
        </button>

        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={text}
          onChange={e => { setText(e.target.value); autoResize(); handleTyping(); }}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Conversation not approved yet' : 'Message… (Enter to send, Shift+Enter for newline)'}
          disabled={disabled || sending}
          rows={1}
        />

        <button
          className="btn-send"
          onClick={handleSend}
          disabled={!text.trim() || sending || disabled}
          title="Send encrypted message"
        >
          {sending ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.3"/>
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
              </path>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          )}
        </button>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        marginTop: 6,
      }}>
        <span className="enc-badge" style={{ fontSize: 10 }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
          </svg>
          End-to-end encrypted
        </span>
        {(readOnce || expiresIn) && (
          <span style={{ fontSize: 10, color: 'var(--status-pending)' }}>
            {readOnce && '👁 once'}{readOnce && expiresIn ? ' · ' : ''}{expiresIn ? `⏱ ${expiresIn}m` : ''}
          </span>
        )}
      </div>
    </div>
  );
}
