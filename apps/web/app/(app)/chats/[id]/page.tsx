'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../context/AuthContext';
import { useMessages, type Message } from '../../../hooks/useMessages';
import { getConversation, deleteConversation, type Conversation } from '../../../lib/stellar';
import { useWaku, type WakuConversationUpdate } from '../../../hooks/useWaku';
import { MessageBubble, DateDivider, TypingIndicator, SentMessageBubble } from '../../../components/MessageBubble';
import { ChatInput } from '../../../components/ChatInput';
import { shortAddress, getAvatarText, getAvatarGradient } from '../../../lib/crypto';

// ─── Sent message tracker (in-session plaintext) ─────────────────────────────

interface SentMessage {
  id: string;
  plaintext: string;
  sentAt: string;
  expiresAt?: string | null;
  readOnce?: boolean;
  messageType?: 'text' | 'file' | 'image';
  fileInfo?: { fileId: string; fileName: string; fileSize: number; fileNonce: string };
}

function groupByDate(messages: Message[]): Array<{ date: string; messages: Message[] }> {
  const groups: Array<{ date: string; messages: Message[] }> = [];
  let currentDate = '';
  messages.forEach(msg => {
    const d = new Date(msg.sent_at).toDateString();
    if (d !== currentDate) {
      currentDate = d;
      groups.push({ date: msg.sent_at, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  });
  return groups;
}

export default function ChatRoomPage() {
  const params = useParams();
  const router = useRouter();
  // conversationId is now a string (deterministic "<addrA>:<addrB>")
  const conversationId = params?.id ? decodeURIComponent(params.id as string) : null;
  const { walletAddress, keyPair } = useAuth();
  const { messages, loading, appendMessage, deleteMessage } = useMessages(conversationId, walletAddress);
  const { subscribeToSystemEvents, isReady: wakuReady } = useWaku(walletAddress);

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [convoLoading, setConvoLoading] = useState(true);
  const [isTyping] = useState(false); // typing indicators via Waku not implemented yet

  const [sentMessages, setSentMessages] = useState<Map<string, SentMessage>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ─── Load conversation metadata ──────────────────────────────────────────

  useEffect(() => {
    if (!conversationId || !walletAddress) return;
    setConvoLoading(true);
    getConversation(conversationId, walletAddress)
      .then(convo => {
        if (convo) setConversation(convo);
        else router.push('/chats');
      })
      .catch(() => router.push('/chats'))
      .finally(() => setConvoLoading(false));
  }, [conversationId, walletAddress, router]);

  // ─── Listen for Waku system events (approval, deletion) ──────────────────

  useEffect(() => {
    if (!walletAddress || !conversationId || !wakuReady) return;
    let unsubFn: (() => void) | null = null;

    subscribeToSystemEvents(walletAddress, (event) => {
      if (event.type === 'conversation_approved') {
        const upd = event as WakuConversationUpdate;
        if (upd.conversationId === conversationId) {
          // Re-load conversation to get updated status
          getConversation(conversationId, walletAddress)
            .then(convo => { if (convo) setConversation(convo); })
            .catch(() => {});
        }
      } else if (event.type === 'conversation_deleted') {
        const upd = event as WakuConversationUpdate;
        if (upd.conversationId === conversationId) {
          alert('This conversation was deleted by the other participant.');
          router.push('/chats');
        }
      }
    }).then(unsub => { unsubFn = unsub; });

    return () => { if (unsubFn) unsubFn(); };
  }, [walletAddress, conversationId, wakuReady, subscribeToSystemEvents, router]);

  // ─── Auto-scroll ─────────────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // ─── Delete conversation ──────────────────────────────────────────────────

  const handleDeleteChat = useCallback(async () => {
    if (!conversationId || !walletAddress) return;
    const confirmed = window.confirm('Are you sure you want to delete this conversation? This removes it from your local store.');
    if (!confirmed) return;

    try {
      // Notify the other participant via Waku before deleting locally
      const { sendSystemEvent } = await import('../../../hooks/useWaku').then(m => {
        // Can't call hooks outside components — use a one-shot node send
        return { sendSystemEvent: async (target: string, payload: any) => {} };
      });

      await deleteConversation(conversationId, walletAddress);
      router.push('/chats');
    } catch (err) {
      console.error('Failed to delete conversation', err);
      alert('Failed to delete conversation');
    }
  }, [conversationId, walletAddress, router]);

  // ─── Handle sent message callback ────────────────────────────────────────

  const handleMessageSent = useCallback((
    plaintext: string,
    sentAt: string,
    messageId: string,
    expiresAt?: string | null,
    messageType?: 'text' | 'file' | 'image',
    fileInfo?: { fileId: string; fileName: string; fileSize: number; fileNonce: string },
    ciphertext?: string,
    nonce?: string
  ) => {
    setSentMessages(prev => {
      const next = new Map(prev);
      next.set(messageId, { id: messageId, plaintext, sentAt, expiresAt, messageType, fileInfo });
      return next;
    });

    // Optimistically append to message list with real ciphertext so it survives reloads
    appendMessage({
      id: messageId,
      conversation_id: conversationId!,
      sender: walletAddress!,
      ciphertext: ciphertext || '',
      nonce: nonce || '',
      message_type: messageType || 'text',
      read_once: false,
      sent_at: sentAt,
      expires_at: expiresAt || null,
      read_at: null,
    });
  }, [appendMessage, conversationId, walletAddress]);

  // ─── Loading state ───────────────────────────────────────────────────────

  if (convoLoading) {
    return (
      <div className="chat-area">
        <div className="chat-header">
          <div className="skeleton" style={{ width: 40, height: 40, borderRadius: '50%' }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="skeleton" style={{ width: 120, height: 14 }} />
            <div className="skeleton" style={{ width: 180, height: 11 }} />
          </div>
        </div>
        <div className="chat-messages" style={{ justifyContent: 'center', alignItems: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading conversation…</p>
        </div>
      </div>
    );
  }

  if (!conversation) return null;

  const isSender = conversation.sender === walletAddress;
  const otherAddress = isSender ? conversation.receiver : conversation.sender;
  const otherName = isSender ? conversation.receiver_name : conversation.sender_name;
  const otherPubKey = isSender ? conversation.receiver_pub_key : conversation.sender_pub_key;
  const displayName = otherName || shortAddress(otherAddress);
  const initials = getAvatarText(otherName || undefined, otherAddress);
  const gradient = getAvatarGradient(otherAddress);

  const isApproved = conversation.status === 'approved';
  const grouped = groupByDate(messages);

  return (
    <div className="chat-area">
      {/* Header */}
      <div className="chat-header">
        <button
          onClick={() => router.push('/chats')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 4 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>

        <div className="avatar" style={{ background: gradient }}>{initials}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{displayName}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="enc-badge" style={{ fontSize: 10 }}>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
              </svg>
              E2E · IPFS · Waku P2P
            </span>
            {!isApproved && (
              <span className="badge badge-pending" style={{ fontSize: 10 }}>Pending</span>
            )}
          </div>
        </div>

        <button
          onClick={() => navigator.clipboard.writeText(otherAddress)}
          className="wallet-chip"
          title="Copy wallet address"
          style={{ display: 'flex', fontSize: 10 }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
          {shortAddress(otherAddress)}
        </button>

        <button
          onClick={handleDeleteChat}
          title="Delete Conversation"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--status-danger)', display: 'flex', padding: 4, marginLeft: 4, opacity: 0.8 }}
          onMouseOver={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
          onMouseOut={e => (e.currentTarget as HTMLElement).style.opacity = '0.8'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {loading && messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>
            Loading from Waku…
          </div>
        )}

        {!loading && messages.length === 0 && isApproved && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)', fontSize: 13 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🔐</div>
            <p>No messages yet.</p>
            <p style={{ marginTop: 4 }}>Send your first encrypted message below.</p>
          </div>
        )}

        {!isApproved && (
          <div style={{ margin: 'auto', textAlign: 'center', padding: '40px 20px', maxWidth: 340 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
            <h3 style={{ fontSize: 16, marginBottom: 8 }}>Waiting for approval</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {isSender
                ? `Your request is waiting for ${displayName} to accept.`
                : `${displayName} sent you a chat request.`}
            </p>
            {conversation.request_note && (
              <div style={{ marginTop: 16, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)', fontStyle: 'italic', textAlign: 'left' }}>
                "{conversation.request_note}"
              </div>
            )}
          </div>
        )}

        {grouped.map(group => (
          <React.Fragment key={group.date}>
            <DateDivider dateStr={group.date} />
            {group.messages.map((msg, idx) => {
              const isMyMessage = msg.sender === walletAddress;
              const prevMsg = group.messages[idx - 1];
              const isConsecutive = prevMsg && prevMsg.sender === msg.sender;

              if (isMyMessage) {
                const sent = sentMessages.get(msg.id);
                if (sent) {
                  return (
                    <SentMessageBubble
                      key={msg.id}
                      plaintext={sent.plaintext}
                      sentAt={sent.sentAt}
                      readOnce={msg.read_once}
                      expiresAt={sent.expiresAt}
                      messageType={sent.messageType}
                      fileInfo={sent.fileInfo}
                      onDelete={() => deleteMessage(msg.id)}
                    />
                  );
                }
              }

              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  senderPubKey={otherPubKey}
                  isConsecutive={!!isConsecutive}
                  onDelete={() => deleteMessage(msg.id)}
                />
              );
            })}
          </React.Fragment>
        ))}

        {isTyping && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-footer">
        <ChatInput
          conversationId={conversationId!}
          recipientPubKey={otherPubKey}
          onMessageSent={handleMessageSent}
          disabled={!isApproved}
        />
      </div>
    </div>
  );
}
