'use client';

import React, { useMemo } from 'react';
import { Message } from '../lib/api';
import { decryptMessage } from '../lib/crypto';
import { useAuth } from '../context/AuthContext';

interface MessageBubbleProps {
  message: Message;
  senderPubKey: string;  // public key of the other party
  isConsecutive?: boolean;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function timeUntilExpiry(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h`;
}

export function MessageBubble({ message, senderPubKey, isConsecutive }: MessageBubbleProps) {
  const { walletAddress, keyPair } = useAuth();
  const isSent = message.sender === walletAddress;

  const plaintext = useMemo(() => {
    if (!keyPair) return null;
    try {
      // Determine which keys to use for decryption
      if (isSent) {
        // We sent it — but we encrypted it for them.
        // We can't decrypt our own NaCl box messages without knowing recipient's secret key.
        // Show a placeholder for sent messages (or store plaintext in state when sending)
        return '[Sent encrypted]';
      } else {
        // Decrypt: ciphertext was encrypted by sender for us
        return decryptMessage(
          message.ciphertext,
          message.nonce,
          senderPubKey,
          keyPair.secretKey
        );
      }
    } catch {
      return null;
    }
  }, [message, keyPair, isSent, senderPubKey]);

  return (
    <div className={`message-row${isSent ? ' sent' : ''}`}
      style={{ marginTop: isConsecutive ? 2 : 8 }}>
      <div className={`bubble${isSent ? ' sent' : ' received'}`}>
        {plaintext !== null ? (
          <span>{plaintext === '[Sent encrypted]' ? (
            <span style={{ opacity: 0.8 }}>{plaintext}</span>
          ) : plaintext}</span>
        ) : (
          <span style={{ color: 'var(--status-danger)', fontSize: 12 }}>
            ⚠️ Could not decrypt
          </span>
        )}

        <div className="bubble-meta">
          <span className="bubble-time">{formatTime(message.sent_at)}</span>
          {message.read_once && (
            <span className="read-once-badge">👁 Once</span>
          )}
          {message.expires_at && (
            <span className="expiry-badge">⏱ {timeUntilExpiry(message.expires_at)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

interface DateDividerProps {
  dateStr: string;
}

export function DateDivider({ dateStr }: DateDividerProps) {
  const label = useMemo(() => {
    const d = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  }, [dateStr]);

  return (
    <div className="date-divider">
      <span>{label}</span>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="message-row" style={{ marginTop: 8 }}>
      <div className="typing-indicator">
        <div className="typing-dot" />
        <div className="typing-dot" />
        <div className="typing-dot" />
      </div>
    </div>
  );
}

/**
 * Plain-text message bubble for sent messages (we know the plaintext)
 */
interface SentMessageBubbleProps {
  plaintext: string;
  sentAt: string;
  readOnce?: boolean;
  expiresAt?: string | null;
}

export function SentMessageBubble({ plaintext, sentAt, readOnce, expiresAt }: SentMessageBubbleProps) {
  return (
    <div className="message-row sent" style={{ marginTop: 8 }}>
      <div className="bubble sent">
        <span>{plaintext}</span>
        <div className="bubble-meta">
          <span className="bubble-time">{formatTime(sentAt)}</span>
          {readOnce && <span className="read-once-badge">👁 Once</span>}
          {expiresAt && <span className="expiry-badge">⏱ {timeUntilExpiry(expiresAt)}</span>}
        </div>
      </div>
    </div>
  );
}
