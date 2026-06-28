'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../context/AuthContext';
import { useConversations } from '../hooks/useConversations';
import { ConversationList } from '../components/ConversationList';
import { NewConversationModal } from '../components/NewConversationModal';
import { shortAddress, getAvatarText, getAvatarGradient } from '../lib/crypto';
import { Conversation } from '../lib/api';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { walletAddress, displayName, logout, isAuthenticated, isLoading } = useAuth();
  const {
    activeConversations,
    pendingRequests,
    loading: convoLoading,
    refetch,
    addConversation,
  } = useConversations(walletAddress);

  const [showNewChat, setShowNewChat] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  // Auth guard
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'var(--bg-base)',
      }}>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔐</div>
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  const handleConversationCreated = (conv: Conversation) => {
    addConversation(conv);
    router.push(`/chats/${conv.id}`);
  };

  const initials = getAvatarText(displayName || undefined, walletAddress || undefined);
  const gradient = walletAddress ? getAvatarGradient(walletAddress) : undefined;

  return (
    <div className="app-shell">
      {/* ─── Sidebar ─────────────────────────────────── */}
      <aside className="sidebar">
        {/* Header */}
        <div className="sidebar-header">
          <div className="logo" style={{ flex: 1 }}>
            <div className="logo-icon">🔐</div>
            <span className="logo-text">Advaya</span>
          </div>
          <button
            id="new-chat-btn"
            onClick={() => setShowNewChat(true)}
            title="New conversation"
            style={{
              width: 34, height: 34, borderRadius: 9,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', transition: 'all var(--transition-fast)',
              flexShrink: 0,
            }}
            onMouseOver={e => {
              (e.currentTarget as HTMLElement).style.background = 'var(--bg-overlay)';
              (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
            }}
            onMouseOut={e => {
              (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)';
              (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>

        {/* Pending badge */}
        {pendingRequests.length > 0 && (
          <div
            onClick={() => router.push('/chats')}
            style={{
              margin: '8px 12px 0',
              background: 'rgba(251,191,36,0.08)',
              border: '1px solid rgba(251,191,36,0.25)',
              borderRadius: 10,
              padding: '10px 14px',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 13, color: 'var(--status-pending)',
            }}
          >
            <span>📬</span>
            <span style={{ flex: 1 }}>
              {pendingRequests.length} pending request{pendingRequests.length !== 1 ? 's' : ''}
            </span>
            <span style={{ fontSize: 11 }}>→</span>
          </div>
        )}

        {/* Conversation list */}
        <div className="sidebar-scroll">
          <ConversationList
            conversations={activeConversations}
            pendingRequests={pendingRequests}
            loading={convoLoading}
            onNewChat={() => setShowNewChat(true)}
          />
        </div>

        {/* Profile footer */}
        <div style={{
          borderTop: '1px solid var(--border-subtle)',
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div
            className="avatar avatar-sm"
            style={{ background: gradient, cursor: 'pointer' }}
            onClick={() => setShowProfile(s => !s)}
            title="Your profile"
          >
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
              {displayName || 'Anonymous'}
            </div>
            <div style={{
              fontSize: 10, color: 'var(--text-muted)',
              fontFamily: 'monospace',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {walletAddress}
            </div>
          </div>
          <button
            id="logout-btn"
            onClick={logout}
            title="Logout"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: 4,
              display: 'flex', alignItems: 'center',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </aside>

      {/* ─── Main Content ─────────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {children}
      </main>

      {/* ─── New Conversation Modal ────────────────────── */}
      {showNewChat && (
        <NewConversationModal
          onClose={() => setShowNewChat(false)}
          onCreated={handleConversationCreated}
        />
      )}
    </div>
  );
}
