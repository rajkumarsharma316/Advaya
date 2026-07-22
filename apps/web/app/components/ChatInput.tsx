'use client';

/**
 * ChatInput — Fully Decentralized
 * ────────────────────────────────
 * Sending messages now works completely without a backend server:
 *
 *   Text:  encrypt → pin ciphertext to IPFS → publish CID on Waku
 *   File:  encrypt → pin encrypted blob to IPFS → encrypt metadata → pin metadata → publish on Waku
 *
 * Replaces:
 *   - POST /api/messages   → Waku LightPush
 *   - POST /api/files/upload → Pinata IPFS
 */

import React, { useRef, useState, useCallback } from 'react';
import { useWaku } from '../hooks/useWaku';
import { useRelay } from '../hooks/useRelay';
import { useAuth } from '../context/AuthContext';
import { v4 as uuidv4 } from 'uuid';

interface FileAttachment {
  file: File;
  preview?: string;
  isImage: boolean;
  isVideo: boolean;
}

interface ChatInputProps {
  conversationId: string;
  recipientPubKey: string;
  onMessageSent: (
    plaintext: string,
    sentAt: string,
    messageId: string,
    expiresAt?: string | null,
    messageType?: 'text' | 'file' | 'image',
    fileInfo?: { fileId: string; fileName: string; fileSize: number; fileNonce: string },
    ciphertext?: string,
    nonce?: string
  ) => void;
  disabled?: boolean;
}

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageMime(mime: string): boolean { return mime.startsWith('image/'); }
function isVideoMime(mime: string): boolean { return mime.startsWith('video/'); }

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
  const [attachment, setAttachment] = useState<FileAttachment | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { sendChatMessage } = useWaku(walletAddress);
  const { relaySendChatMessage, relayJoinConversation } = useRelay(walletAddress);

  const encrypt = useCallback(async (plaintext: string) => {
    const { encryptMessage } = await import('../lib/crypto');
    if (!keyPair) throw new Error('No keypair');
    return encryptMessage(plaintext, recipientPubKey, keyPair.secretKey);
  }, [keyPair, recipientPubKey]);

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      alert(`File too large. Maximum size is ${formatFileSize(MAX_FILE_SIZE)}.`);
      return;
    }
    const isImage = isImageMime(file.type);
    const isVideo = isVideoMime(file.type);
    const att: FileAttachment = { file, isImage, isVideo };
    if (isImage || isVideo) att.preview = URL.createObjectURL(file);
    setAttachment(att);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const removeAttachment = useCallback(() => {
    if (attachment?.preview) URL.revokeObjectURL(attachment.preview);
    setAttachment(null);
  }, [attachment]);

  // ─── Send file (fully decentralized) ─────────────────────────────────────

  const handleSendFile = useCallback(async () => {
    if (!attachment || sending || !walletAddress || !keyPair) return;
    setSending(true);
    setUploadProgress('Encrypting…');
    try {
      const { encryptFile, encryptMessage } = await import('../lib/crypto');
      const { uploadToIpfs } = await import('../lib/ipfs');

      // 1. Read file as bytes
      const arrayBuffer = await attachment.file.arrayBuffer();
      const fileBytes = new Uint8Array(arrayBuffer);

      // 2. Encrypt file bytes
      const { ciphertext: encryptedBytes, nonce: fileNonce } = encryptFile(
        fileBytes,
        recipientPubKey,
        keyPair.secretKey
      );

      // 3. Upload encrypted blob to IPFS (+ Pinata pin)
      setUploadProgress('Uploading to IPFS…');
      const fileCid = await uploadToIpfs(encryptedBytes);

      // 4. Build + encrypt metadata payload
      const metadataPayload = JSON.stringify({
        fileId: fileCid,
        fileName: attachment.file.name,
        fileSize: attachment.file.size,
        mimeType: attachment.file.type,
        fileNonce,
      });

      const { ciphertext, nonce } = encryptMessage(
        metadataPayload,
        recipientPubKey,
        keyPair.secretKey
      );

      // 5. We don't need to pin the metadata to IPFS because it's tiny.
      // We will send the encrypted metadata directly in the message payload.
      const messageCid = undefined;

      // 6. Build Waku message (no backend needed)
      const messageId = uuidv4();
      const sentAt = new Date().toISOString();
      const expiresAt = expiresIn
        ? new Date(Date.now() + Number(expiresIn) * 60 * 1000).toISOString()
        : null;
      const messageType: 'text' | 'file' | 'image' = attachment.isImage ? 'image' : 'file';

      // 7. Publish to Waku P2P network (best-effort)
      const wakuPayload = {
        type: 'chat_message' as const,
        conversationId,
        messageId,
        ciphertext, // Send actual ciphertext instead of 'IPFS_BLOB'
        nonce,
        ipfsCid: messageCid,
        sender: walletAddress,
        sentAt,
        messageType,
        readOnce,
        expiresAt,
        fileId: fileCid,
        fileName: attachment.file.name,
        fileSize: attachment.file.size,
      };

      try {
        await sendChatMessage(wakuPayload);
      } catch (wakuErr) {
        console.warn('[Waku] Chat message send failed:', wakuErr);
      }

      // Also send via relay (guaranteed delivery)
      try {
        relaySendChatMessage(conversationId, wakuPayload);
      } catch (relayErr) {
        console.warn('[Relay] Chat message send failed:', relayErr);
      }

      // 8. Notify parent component
      onMessageSent(
        metadataPayload,
        sentAt,
        messageId,
        expiresAt,
        messageType,
        { fileId: fileCid, fileName: attachment.file.name, fileSize: attachment.file.size, fileNonce },
        ciphertext,
        nonce
      );

      removeAttachment();
      setReadOnce(false);
      setExpiresIn('');
    } catch (err: any) {
      console.error('File send failed:', err);
      alert('Failed to send file: ' + (err.message || 'Unknown error'));
    } finally {
      setSending(false);
      setUploadProgress(null);
    }
  }, [attachment, sending, walletAddress, keyPair, recipientPubKey, conversationId, readOnce, expiresIn, sendChatMessage, onMessageSent, removeAttachment]);

  // ─── Send text message (fully decentralized) ──────────────────────────────

  const handleSend = useCallback(async () => {
    if (attachment) {
      await handleSendFile();
      return;
    }

    const trimmed = text.trim();
    if (!trimmed || sending || !walletAddress || !keyPair) return;

    setSending(true);
    try {
      const { uploadToIpfs } = await import('../lib/ipfs');

      // 1. Encrypt the message
      const { ciphertext, nonce } = await encrypt(trimmed);

      // 2. (Skipped) We no longer pin text messages to IPFS. They are small
      // enough to travel directly in the Waku/Relay payload.

      // 3. Build Waku message
      const messageId = uuidv4();
      const sentAt = new Date().toISOString();
      const expiresAt = expiresIn
        ? new Date(Date.now() + Number(expiresIn) * 60 * 1000).toISOString()
        : null;

      // 4. Publish to Waku (best-effort)
      const wakuPayload = {
        type: 'chat_message' as const,
        conversationId,
        messageId,
        ciphertext, // Send actual ciphertext instead of 'IPFS_BLOB'
        nonce,
        ipfsCid: undefined,
        sender: walletAddress,
        sentAt,
        messageType: 'text' as const,
        readOnce,
        expiresAt,
      };

      try {
        await sendChatMessage(wakuPayload);
      } catch (wakuErr) {
        console.warn('[Waku] Chat message send failed:', wakuErr);
      }

      // Also send via relay (guaranteed delivery)
      try {
        relaySendChatMessage(conversationId, wakuPayload);
      } catch (relayErr) {
        console.warn('[Relay] Chat message send failed:', relayErr);
      }

      // 5. Notify parent with plaintext for immediate display
      onMessageSent(trimmed, sentAt, messageId, expiresAt, 'text', undefined, ciphertext, nonce);

      setText('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      setReadOnce(false);
      setExpiresIn('');
    } catch (err: any) {
      console.error('Send failed:', err);
      alert('Failed to send message: ' + (err.message || 'Unknown error'));
    } finally {
      setSending(false);
    }
  }, [text, attachment, sending, walletAddress, keyPair, encrypt, conversationId, readOnce, expiresIn, sendChatMessage, onMessageSent, handleSendFile]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div>
      {/* File attachment preview */}
      {attachment && (
        <div className="file-preview-bar">
          {attachment.isImage && attachment.preview ? (
            <img src={attachment.preview} alt="Preview" className="file-preview-thumb" />
          ) : attachment.isVideo && attachment.preview ? (
            <video src={attachment.preview} className="file-preview-thumb" muted />
          ) : (
            <div className="file-preview-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
          )}
          <div className="file-preview-info">
            <span className="file-preview-name">{attachment.file.name}</span>
            <span className="file-preview-size">{formatFileSize(attachment.file.size)}</span>
          </div>
          {uploadProgress ? (
            <span className="file-preview-progress">{uploadProgress}</span>
          ) : (
            <button className="file-preview-remove" onClick={removeAttachment} title="Remove attachment">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Message options */}
      {showOptions && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0 12px', borderTop: '1px solid var(--border-subtle)', marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={readOnce}
              onChange={e => setReadOnce(e.target.checked)}
              style={{ accentColor: 'var(--brand-primary)', width: 14, height: 14 }}
            />
            👁 Read once
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
            ⏱ Expires in:
            <select
              value={expiresIn}
              onChange={e => setExpiresIn(e.target.value === '' ? '' : Number(e.target.value))}
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 6, color: 'var(--text-primary)', padding: '2px 6px', fontSize: 12 }}
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
          style={{ color: showOptions ? 'var(--brand-secondary)' : 'var(--text-muted)', background: showOptions ? 'rgba(108,99,255,0.1)' : 'transparent', border: '1px solid var(--border-subtle)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>
          </svg>
        </button>

        {/* File attachment button */}
        <button
          className="btn-icon btn-ghost btn"
          onClick={() => fileInputRef.current?.click()}
          title="Attach file or image"
          disabled={disabled || sending}
          style={{ color: attachment ? 'var(--brand-secondary)' : 'var(--text-muted)', background: attachment ? 'rgba(108,99,255,0.1)' : 'transparent', border: '1px solid var(--border-subtle)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
          </svg>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar,.7z,.csv,.json,.xml,.mp3,.mp4,.mov,.avi"
        />

        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={text}
          onChange={e => { setText(e.target.value); autoResize(); }}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled
              ? 'Conversation not approved yet'
              : attachment
                ? `Send ${attachment.isImage ? 'image' : attachment.isVideo ? 'video' : 'file'}: ${attachment.file.name}`
                : 'Message… (Enter to send, Shift+Enter for newline)'
          }
          disabled={disabled || sending}
          rows={1}
        />

        <button
          className="btn-send"
          onClick={handleSend}
          disabled={(!text.trim() && !attachment) || sending || disabled}
          title={attachment ? `Send encrypted ${attachment.isImage ? 'image' : attachment.isVideo ? 'video' : 'file'}` : 'Send encrypted message'}
        >
          {sending ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.3"/>
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
              </path>
            </svg>
          ) : attachment ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          )}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6 }}>
        <span className="enc-badge" style={{ fontSize: 10 }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
          </svg>
          End-to-end encrypted · Stored on IPFS · Sent via Waku P2P
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
