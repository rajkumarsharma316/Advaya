'use client';

import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useConversations } from '../../hooks/useConversations';
import { RequestCard } from '../../components/RequestCard';

export default function ChatsPage() {
  const { walletAddress } = useAuth();
  const { pendingRequests, updateConversation, activeConversations } = useConversations(walletAddress);

  return (
    <div className="chat-area">
      {pendingRequests.length > 0 ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          <div style={{ maxWidth: 480, margin: '0 auto' }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
              📬 Pending Requests
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
              Accept or reject conversation requests.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {pendingRequests.map(req => (
                <RequestCard
                  key={req.id}
                  conversation={req}
                  onUpdate={updateConversation}
                />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state-icon">💬</div>
          <h2 className="empty-state-title">
            {activeConversations.length > 0
              ? 'Select a conversation'
              : 'No conversations yet'}
          </h2>
          <p className="empty-state-desc">
            {activeConversations.length > 0
              ? 'Choose a conversation from the sidebar to start messaging.'
              : 'Start a new encrypted chat by clicking + in the sidebar.'}
          </p>
        </div>
      )}
    </div>
  );
}
