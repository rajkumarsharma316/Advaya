'use client';

import React, { useRef, useState, useCallback } from 'react';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../context/AuthContext';

interface FileAttachment {
  file: File;
  preview?: string;  // Object URL for image previews
  isImage: boolean;
}

interface ChatInputProps {
  conversationId: number;
  recipientPubKey: string;
  onMessageSent: (
    plaintext: string,
    sentAt: string,
    messageId: number,
    expiresAt?: string | null,
    messageType?: 'text' | 'file' | 'image',
    fileInfo?: { fileId: string; fileName: string; fileSize: number; fileNonce: string }
  ) => void;
  disabled?: boolean;
}

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
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
  const [attachment, setAttachment] = useState<FileAttachment | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      alert(`File too large. Maximum size is ${formatFileSize(MAX_FILE_SIZE)}.`);
      return;
    }

    const isImage = isImageMime(file.type);
    const att: FileAttachment = { file, isImage };

    if (isImage) {
      att.preview = URL.createObjectURL(file);
    }

    setAttachment(att);
    // Reset the input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const removeAttachment = useCallback(() => {
    if (attachment?.preview) {
      URL.revokeObjectURL(attachment.preview);
    }
    setAttachment(null);
  }, [attachment]);

  const handleSendFile = useCallback(async () => {
    if (!attachment || sending || !walletAddress || !keyPair) return;

    setSending(true);
    setUploadProgress('Encrypting…');
    try {
      const { encryptFile, encryptMessage } = await import('../lib/crypto');
      const { uploadEncryptedFile, sendMessage } = await import('../lib/api');

      // 1. Read file as bytes
      const arrayBuffer = await attachment.file.arrayBuffer();
      const fileBytes = new Uint8Array(arrayBuffer);

      // 2. Encrypt file bytes
      const { ciphertext: encryptedBytes, nonce: fileNonce } = encryptFile(
        fileBytes,
        recipientPubKey,
        keyPair.secretKey
      );

      // 3. Upload encrypted blob
      setUploadProgress('Uploading…');
      const encryptedBlob = new Blob([encryptedBytes]);
      const { fileId } = await uploadEncryptedFile(
        encryptedBlob,
        conversationId,
        attachment.file.name,
        attachment.file.type,
        attachment.file.size,
        walletAddress
      );

      // 4. Create metadata payload and encrypt it as the message ciphertext
      const metadataPayload = JSON.stringify({
        fileId,
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

      // 5. Send message with file type
      const messageType = attachment.isImage ? 'image' : 'file';
      const expiresInSeconds = expiresIn ? Number(expiresIn) * 60 : undefined;
      const { message } = await sendMessage({
        conversationId,
        ciphertext,
        nonce,
        messageType,
        readOnce,
        expiresInSeconds,
      }, walletAddress);

      // 6. Emit via socket for real-time delivery
      emitMessage({
        conversationId,
        messageId: message.id,
        ciphertext,
        nonce,
        sender: walletAddress,
        sentAt: message.sent_at,
        messageType,
        fileId,
        fileName: attachment.file.name,
        fileSize: attachment.file.size,
      });

      // 7. Notify parent
      onMessageSent(
        metadataPayload,
        message.sent_at,
        message.id,
        message.expires_at,
        messageType as 'file' | 'image',
        { fileId, fileName: attachment.file.name, fileSize: attachment.file.size, fileNonce }
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
  }, [attachment, sending, walletAddress, keyPair, recipientPubKey, conversationId, readOnce, expiresIn, emitMessage, onMessageSent, removeAttachment]);

  const handleSend = useCallback(async () => {
    // If there's an attachment, send the file
    if (attachment) {
      await handleSendFile();
      return;
    }

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
  }, [text, attachment, sending, walletAddress, keyPair, encrypt, conversationId, readOnce, expiresIn, emitMessage, onMessageSent, handleSendFile]);

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
            <img
              src={attachment.preview}
              alt="Preview"
              className="file-preview-thumb"
            />
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
            <button
              className="file-preview-remove"
              onClick={removeAttachment}
              title="Remove attachment"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
      )}

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

        {/* File attachment button */}
        <button
          className="btn-icon btn-ghost btn"
          onClick={() => fileInputRef.current?.click()}
          title="Attach file or image"
          disabled={disabled || sending}
          style={{
            color: attachment ? 'var(--brand-secondary)' : 'var(--text-muted)',
            background: attachment ? 'rgba(108,99,255,0.1)' : 'transparent',
            border: '1px solid var(--border-subtle)',
          }}
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
          onChange={e => { setText(e.target.value); autoResize(); handleTyping(); }}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled
              ? 'Conversation not approved yet'
              : attachment
                ? `Send ${attachment.isImage ? 'image' : 'file'}: ${attachment.file.name}`
                : 'Message… (Enter to send, Shift+Enter for newline)'
          }
          disabled={disabled || sending}
          rows={1}
        />

        <button
          className="btn-send"
          onClick={handleSend}
          disabled={(!text.trim() && !attachment) || sending || disabled}
          title={attachment ? `Send encrypted ${attachment.isImage ? 'image' : 'file'}` : 'Send encrypted message'}
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
