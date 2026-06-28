'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../context/AuthContext';
import { useMessages } from '../../../hooks/useMessages';
import { useSocket } from '../../../hooks/useSocket';
import { getConversation, Conversation, Message } from '../../../lib/api';
import { MessageBubble, DateDivider, TypingIndicator, SentMessageBubble } from '../../../components/MessageBubble';
import { ChatInput } from '../../../components/ChatInput';
import { shortAddress, getAvatarText, getAvatarGradient, decryptMessage } from '../../../lib/crypto';

// Stored sent messages with plaintext (to display our own messages)
interface SentMessage {
  id: number;
  plaintext: string;
  sentAt: string;
  expiresAt?: string | null;
  readOnce?: boolean;
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
  const conversationId = params?.id ? Number(params.id) : null;
  const { walletAddress, keyPair } = useAuth();
  const { messages, loading, appendMessage } = useMessages(conversationId, walletAddress);
  const { on } = useSocket(walletAddress);

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [convoLoading, setConvoLoading] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track sent messages with plaintext for display
  const [sentMessages, setSentMessages] = useState<Map<number, SentMessage>>(new Map());

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch conversation metadata
  useEffect(() => {
    if (!conversationId || !walletAddress) return;
    setConvoLoading(true);
    getConversation(conversationId, walletAddress)
      .then(({ conversation }) => setConversation(conversation))
      .catch(() => router.push('/chats'))
      .finally(() => setConvoLoading(false));
  }, [conversationId, walletAddress, router]);

  // Listen for typing events
  useEffect(() => {
    const off = on<{ walletAddress: string; isTyping: boolean }>('typing', (data) => {
      if (data.walletAddress === walletAddress) return;
      setIsTyping(data.isTyping);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (data.isTyping) {
        typingTimer.current = setTimeout(() => setIsTyping(false), 3000);
      }
    });
    return off;
  }, [on, walletAddress]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleMessageSent = useCallback((
    plaintext: string,
    sentAt: string,
    messageId: number,
    expiresAt?: string | null
  ) => {
    setSentMessages(prev => {
      const next = new Map(prev);
      next.set(messageId, { id: messageId, plaintext, sentAt, expiresAt });
      return next;
    });
    // Also append to messages list so UI updates
    appendMessage({
      id: messageId,
      conversation_id: conversationId!,
      sender: walletAddress!,
      ciphertext: '',
      nonce: '',
      message_type: 'text',
      read_once: false,
      sent_at: sentAt,
      expires_at: expiresAt || null,
      read_at: null,
    });
  }, [appendMessage, conversationId, walletAddress]);

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
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', display: 'flex', padding: 4,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>

        <div className="avatar" style={{ background: gradient }}>
          {initials}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
            {displayName}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="enc-badge" style={{ fontSize: 10 }}>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
              </svg>
              E2E Encrypted
            </span>
            {!isApproved && (
              <span className="badge badge-pending" style={{ fontSize: 10 }}>
                Pending
              </span>
            )}
          </div>
        </div>

        {/* Address copy */}
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
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {loading && messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>
            Loading messages…
          </div>
        )}

        {!loading && messages.length === 0 && isApproved && (
          <div style={{
            textAlign: 'center', padding: '60px 20px',
            color: 'var(--text-muted)', fontSize: 13,
          }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🔐</div>
            <p>No messages yet.</p>
            <p style={{ marginTop: 4 }}>Send your first encrypted message below.</p>
          </div>
        )}

        {!isApproved && (
          <div style={{
            margin: 'auto', textAlign: 'center', padding: '40px 20px',
            maxWidth: 340,
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
            <h3 style={{ fontSize: 16, marginBottom: 8 }}>Waiting for approval</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {isSender
                ? `Your request is waiting for ${displayName} to accept.`
                : `${displayName} sent you a chat request.`}
            </p>
            {conversation.request_note && (
              <div style={{
                marginTop: 16, background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 12, padding: '12px 16px',
                fontSize: 13, color: 'var(--text-secondary)', fontStyle: 'italic',
                textAlign: 'left',
              }}>
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
                    />
                  );
                }
                // Fallback for messages we sent in a previous session
                return (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    senderPubKey={otherPubKey}
                    isConsecutive={!!isConsecutive}
                  />
                );
              }

              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  senderPubKey={otherPubKey}
                  isConsecutive={!!isConsecutive}
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
