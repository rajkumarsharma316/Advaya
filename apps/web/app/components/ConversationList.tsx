'use client';

import React from 'react';
import { Conversation } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { shortAddress, getAvatarText, getAvatarGradient } from '../lib/crypto';
import { useRouter, useParams } from 'next/navigation';

interface ConversationListProps {
  conversations: Conversation[];
  pendingRequests: Conversation[];
  loading: boolean;
  onNewChat: () => void;
  activeTab?: 'chats' | 'requests';
  onTabChange?: (tab: 'chats' | 'requests') => void;
  onUpdate?: (conv: Conversation) => void;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function ConvoItem({
  convo,
  isActive,
  myAddress,
}: {
  convo: Conversation;
  isActive: boolean;
  myAddress: string;
}) {
  const router = useRouter();
  const isSender = convo.sender === myAddress;
  const otherAddress = isSender ? convo.receiver : convo.sender;
  const otherName = isSender ? convo.receiver_name : convo.sender_name;
  const displayName = otherName || shortAddress(otherAddress);
  const initials = getAvatarText(otherName || undefined, otherAddress);
  const gradient = getAvatarGradient(otherAddress);

  return (
    <div
      className={`convo-item${isActive ? ' active' : ''}`}
      onClick={() => router.push(`/chats/${convo.id}`)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && router.push(`/chats/${convo.id}`)}
    >
      <div className="avatar" style={{ background: gradient }}>
        {initials}
      </div>
      <div className="convo-item-content">
        <div className="convo-item-top">
          <span className="convo-item-name">{displayName}</span>
          <span className="convo-item-time">
            {timeAgo(convo.last_message_at || convo.created_at)}
          </span>
        </div>
        <div className="convo-item-preview" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '10px' }}>🔒</span>
          <span>Encrypted conversation</span>
        </div>
      </div>
    </div>
  );
}

function SkeletonItem() {
  return (
    <div className="convo-item" style={{ cursor: 'default', pointerEvents: 'none' }}>
      <div className="skeleton" style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0 }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="skeleton" style={{ width: '60%', height: 13 }} />
        <div className="skeleton" style={{ width: '80%', height: 11 }} />
      </div>
    </div>
  );
}

export function ConversationList({
  conversations,
  pendingRequests,
  loading,
  onNewChat,
  activeTab = 'chats',
  onTabChange,
}: ConversationListProps) {
  const { walletAddress } = useAuth();
  const params = useParams();
  const activeId = params?.id ? Number(params.id) : null;

  if (loading) {
    return (
      <>
        <SkeletonItem />
        <SkeletonItem />
        <SkeletonItem />
      </>
    );
  }

  if (activeTab === 'requests') {
    if (pendingRequests.length === 0) {
      return (
        <div style={{ padding: '40px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📬</div>
          <p className="text-secondary text-sm">No pending requests.</p>
        </div>
      );
    }
    return (
      <>
        <div className="section-label" style={{ marginTop: 8 }}>
          📬 Requests ({pendingRequests.length})
        </div>
        {pendingRequests.map(convo => (
          <ConvoItem
            key={convo.id}
            convo={convo}
            isActive={activeId === convo.id}
            myAddress={walletAddress!}
          />
        ))}
      </>
    );
  }

  // Active Chats tab
  if (conversations.length === 0) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: '40px 20px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 40 }}>💬</div>
        <p className="text-secondary text-sm">No conversations yet.</p>
        <button className="btn btn-primary" onClick={onNewChat} style={{ fontSize: 13 }}>
          Start a chat
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="section-label" style={{ marginTop: 8 }}>Messages</div>
      {conversations.map(convo => (
        <ConvoItem
          key={convo.id}
          convo={convo}
          isActive={activeId === convo.id}
          myAddress={walletAddress!}
        />
      ))}
    </>
  );
}
