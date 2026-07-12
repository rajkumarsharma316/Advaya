'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Message, downloadEncryptedFile } from '../lib/api';
import { decryptMessage, decryptFile } from '../lib/crypto';
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType.includes('pdf')) return '📄';
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z')) return '📦';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return '📊';
  if (mimeType.includes('document') || mimeType.includes('word')) return '📝';
  return '📎';
}

// ─── File metadata parsed from decrypted ciphertext ──────────────────────

interface FileMetadata {
  fileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileNonce: string;
}

function tryParseFileMetadata(text: string): FileMetadata | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed.fileId && parsed.fileName && parsed.fileNonce) {
      return parsed as FileMetadata;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Image Bubble (decrypt + render inline) ──────────────────────────────

interface ImageBubbleContentProps {
  meta: FileMetadata;
  senderPubKey: string;
  isSent: boolean;
}

function ImageBubbleContent({ meta, senderPubKey, isSent }: ImageBubbleContentProps) {
  const { walletAddress, keyPair } = useAuth();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadImage() {
      if (!walletAddress || !keyPair) return;
      setLoading(true);
      setError(null);
      try {
        const encryptedBuffer = await downloadEncryptedFile(meta.fileId, walletAddress);
        const encryptedBytes = new Uint8Array(encryptedBuffer);
        const decryptedBytes = decryptFile(
          encryptedBytes,
          meta.fileNonce,
          senderPubKey,
          keyPair.secretKey
        );
        if (!decryptedBytes) {
          setError('Decryption failed');
          return;
        }
        if (cancelled) return;
        const blob = new Blob([decryptedBytes], { type: meta.mimeType });
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load image');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadImage();
    return () => { cancelled = true; };
  }, [meta, walletAddress, keyPair, senderPubKey]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  if (loading) {
    return (
      <div className="image-bubble-loading">
        <div className="file-loading-spinner" />
        <span>Decrypting image…</span>
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div className="image-bubble-error">
        <span>⚠️ {error || 'Could not load image'}</span>
      </div>
    );
  }

  return (
    <>
      <div
        className="image-bubble-content"
        onClick={() => setExpanded(true)}
        role="button"
        tabIndex={0}
      >
        <img src={blobUrl} alt={meta.fileName} className="image-bubble-img" />
        <div className="image-bubble-overlay">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
            <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
        </div>
      </div>
      <div className="image-bubble-name">{meta.fileName}</div>

      {/* Full-screen overlay */}
      {expanded && (
        <div className="image-lightbox" onClick={() => setExpanded(false)}>
          <button className="image-lightbox-close" onClick={() => setExpanded(false)}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          <img src={blobUrl} alt={meta.fileName} className="image-lightbox-img" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

// ─── File Bubble (download card) ─────────────────────────────────────────

interface FileBubbleContentProps {
  meta: FileMetadata;
  senderPubKey: string;
  isSent: boolean;
}

function FileBubbleContent({ meta, senderPubKey, isSent }: FileBubbleContentProps) {
  const { walletAddress, keyPair } = useAuth();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    if (!walletAddress || !keyPair || downloading) return;
    setDownloading(true);
    try {
      const encryptedBuffer = await downloadEncryptedFile(meta.fileId, walletAddress);
      const encryptedBytes = new Uint8Array(encryptedBuffer);
      const decryptedBytes = decryptFile(
        encryptedBytes,
        meta.fileNonce,
        senderPubKey,
        keyPair.secretKey
      );
      if (!decryptedBytes) {
        alert('Failed to decrypt file');
        return;
      }
      // Create download link
      const blob = new Blob([decryptedBytes], { type: meta.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = meta.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('Download failed: ' + (err.message || 'Unknown error'));
    } finally {
      setDownloading(false);
    }
  }, [meta, walletAddress, keyPair, senderPubKey, downloading]);

  return (
    <div className="file-bubble" onClick={handleDownload} role="button" tabIndex={0}>
      <div className="file-bubble-icon">
        {getFileIcon(meta.mimeType)}
      </div>
      <div className="file-bubble-info">
        <span className="file-bubble-name">{meta.fileName}</span>
        <span className="file-bubble-size">{formatFileSize(meta.fileSize)}</span>
      </div>
      <button className="file-download-btn" disabled={downloading} title="Download & decrypt">
        {downloading ? (
          <div className="file-loading-spinner" />
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        )}
      </button>
    </div>
  );
}

// ─── Main MessageBubble ──────────────────────────────────────────────────

export function MessageBubble({ message, senderPubKey, isConsecutive }: MessageBubbleProps) {
  const { walletAddress, keyPair } = useAuth();
  const isSent = message.sender === walletAddress;

  const plaintext = useMemo(() => {
    if (!keyPair) return null;
    // Skip decryption for locally appended sent messages (they have empty ciphertext)
    if (!message.ciphertext || !message.nonce) return null;
    try {
      // Decrypt: ciphertext was encrypted by sender (or by us for recipient).
      // Since nacl.box computes the same shared secret (recipientPubKey * senderSecKey == senderPubKey * recipientSecKey),
      // we can use the same decryptMessage function for both sent and received messages.
      // If we sent it, `senderPubKey` here is the recipient's public key (otherPubKey).
      const result = decryptMessage(
        message.ciphertext,
        message.nonce,
        senderPubKey,
        keyPair.secretKey
      );
      if (!result) {
        console.warn('[Decrypt] Failed for message', message.id, {
          ctLen: message.ciphertext.length,
          nonceLen: message.nonce.length,
          senderPubKeyLen: senderPubKey?.length,
          myPubKey: keyPair.publicKey,
          isSent,
        });
      }
      return result;
    } catch (e) {
      console.error('[Decrypt] Error for message', message.id, e);
      return null;
    }
  }, [message, keyPair, isSent, senderPubKey]);

  // Check if this is a file/image message
  const fileMeta = useMemo(() => {
    if (!plaintext) return null;
    if (message.message_type === 'file' || message.message_type === 'image') {
      return tryParseFileMetadata(plaintext);
    }
    // Also try parsing even for text type in case metadata is embedded
    return null;
  }, [plaintext, message.message_type]);

  const renderContent = () => {
    if (plaintext === null) {
      return (
        <span style={{ color: 'var(--status-danger)', fontSize: 12 }}>
          ⚠️ Could not decrypt
        </span>
      );
    }

    // File/image content
    if (fileMeta) {
      if (message.message_type === 'image') {
        return (
          <ImageBubbleContent
            meta={fileMeta}
            senderPubKey={senderPubKey}
            isSent={isSent}
          />
        );
      }
      return (
        <FileBubbleContent
          meta={fileMeta}
          senderPubKey={senderPubKey}
          isSent={isSent}
        />
      );
    }

    // Regular text
    return (
      <span>{plaintext === '[Sent encrypted]' ? (
        <span style={{ opacity: 0.8 }}>{plaintext}</span>
      ) : plaintext}</span>
    );
  };

  return (
    <div className={`message-row${isSent ? ' sent' : ''}`}
      style={{ marginTop: isConsecutive ? 2 : 8 }}>
      <div className={`bubble${isSent ? ' sent' : ' received'}${fileMeta ? ' has-file' : ''}`}>
        {renderContent()}

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
 * Plain-text message bubble for sent messages (we know the plaintext).
 * Also handles file/image messages sent by the current user.
 */
interface SentMessageBubbleProps {
  plaintext: string;
  sentAt: string;
  readOnce?: boolean;
  expiresAt?: string | null;
  messageType?: 'text' | 'file' | 'image';
  fileInfo?: { fileId: string; fileName: string; fileSize: number; fileNonce: string };
}

export function SentMessageBubble({ plaintext, sentAt, readOnce, expiresAt, messageType, fileInfo }: SentMessageBubbleProps) {
  const { walletAddress, keyPair } = useAuth();

  // For sent file/image messages, we have the file info directly
  const [localBlobUrl, setLocalBlobUrl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // If it's an image we sent, decrypt and show it
  useEffect(() => {
    if (messageType !== 'image' || !fileInfo || !walletAddress || !keyPair) return;
    let cancelled = false;
    async function loadSentImage() {
      try {
        // We have to fetch and decrypt our own image too
        // (we encrypted it for the recipient, same shared secret works)
        const encryptedBuffer = await downloadEncryptedFile(fileInfo!.fileId, walletAddress!);
        const encryptedBytes = new Uint8Array(encryptedBuffer);

        // Use our own pubkey as "sender" since we encrypted it
        // Actually, we need the recipient's pubkey. But since NaCl shared secret is symmetric,
        // we can get the same result. The file was encrypted with recipientPub * ourSec,
        // and we can decrypt with ourPub * ourSec? No — we need the counter-party pub key.
        // However for sent images we stored ciphertext with recipientPubKey * senderSecKey.
        // To decrypt, we need senderPubKey * recipientSecKey, but we don't have recipientSecKey.
        // Actually wait — we ARE the sender, so we have senderSecKey.
        // nacl.box.open(ct, nonce, otherPubKey, ourSecKey) — this is what we need.
        // The "senderPubKey" arg in decryptFile is actually "otherPubKey" — recipientPubKey.
        // We don't have recipientPubKey here directly. Let's just show a placeholder
        // and re-fetch from the metadata.
        
        // Actually, the metadata JSON in plaintext has all we need. Let's parse it.
        const meta = tryParseFileMetadata(plaintext);
        if (!meta) return;
        
        // For sent messages, we need the OTHER party's pub key to decrypt.
        // We don't have it here. So we'll show the image via re-downloading approach.
        // The crypto shared secret is: ourSecKey * theirPubKey = theirSecKey * ourPubKey
        // We have ourSecKey but need theirPubKey. 
        // This component doesn't have access to theirPubKey. Let's skip decryption 
        // for sent images in SentMessageBubble — the regular MessageBubble handles it 
        // when the message comes back from the server with full context.
        
        if (cancelled) return;
      } catch {
        // Silently fail — the regular MessageBubble will handle it on refetch
      }
    }
    loadSentImage();
    return () => { cancelled = true; };
  }, [messageType, fileInfo, walletAddress, keyPair, plaintext]);

  const isFileMessage = messageType === 'file' || messageType === 'image';
  const meta = isFileMessage ? tryParseFileMetadata(plaintext) : null;

  return (
    <div className="message-row sent" style={{ marginTop: 8 }}>
      <div className={`bubble sent${isFileMessage ? ' has-file' : ''}`}>
        {isFileMessage && meta ? (
          messageType === 'image' ? (
            <div className="sent-image-placeholder">
              <div className="file-bubble-icon" style={{ fontSize: 24 }}>🖼️</div>
              <div className="file-bubble-info">
                <span className="file-bubble-name">{meta.fileName}</span>
                <span className="file-bubble-size">{formatFileSize(meta.fileSize)}</span>
              </div>
              <span className="sent-file-badge">✓ Sent</span>
            </div>
          ) : (
            <div className="file-bubble sent-file">
              <div className="file-bubble-icon">{getFileIcon(meta.mimeType)}</div>
              <div className="file-bubble-info">
                <span className="file-bubble-name">{meta.fileName}</span>
                <span className="file-bubble-size">{formatFileSize(meta.fileSize)}</span>
              </div>
              <span className="sent-file-badge">✓ Sent</span>
            </div>
          )
        ) : (
          <span>{plaintext}</span>
        )}
        <div className="bubble-meta">
          <span className="bubble-time">{formatTime(sentAt)}</span>
          {readOnce && <span className="read-once-badge">👁 Once</span>}
          {expiresAt && <span className="expiry-badge">⏱ {timeUntilExpiry(expiresAt)}</span>}
        </div>
      </div>
    </div>
  );
}
