-- Advaya Database Schema
-- Run this once to initialize the database

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- Wallets / User Identities
-- =============================================
CREATE TABLE IF NOT EXISTS wallets (
  address       TEXT PRIMARY KEY,                  -- Stellar public key (G...)
  pub_key       TEXT NOT NULL,                     -- X25519 public key for encryption (base64)
  display_name  TEXT,                              -- Optional alias (never required)
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- Conversation Contracts
-- =============================================
CREATE TABLE IF NOT EXISTS conversations (
  id            BIGSERIAL PRIMARY KEY,
  sender        TEXT NOT NULL REFERENCES wallets(address),
  receiver      TEXT NOT NULL REFERENCES wallets(address),
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  request_note  TEXT,                              -- Optional intro message
  contract_id   TEXT,                              -- Soroban contract ID (Phase 2)
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_status CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT no_self_convo CHECK (sender != receiver),
  UNIQUE(sender, receiver)
);

CREATE INDEX IF NOT EXISTS idx_conversations_receiver ON conversations(receiver);
CREATE INDEX IF NOT EXISTS idx_conversations_sender ON conversations(sender);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);

-- =============================================
-- Encrypted Messages
-- =============================================
CREATE TABLE IF NOT EXISTS messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender          TEXT NOT NULL REFERENCES wallets(address),
  ciphertext      TEXT NOT NULL,                   -- AES-256-GCM encrypted content (base64)
  nonce           TEXT NOT NULL,                   -- AES nonce (base64)
  ipfs_cid        TEXT,                            -- Phase 3: IPFS CID (replaces ciphertext)
  message_type    TEXT DEFAULT 'text',             -- text | file | image
  sent_at         TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,                     -- self-destruct timestamp
  read_once       BOOLEAN DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ                      -- soft delete for self-destruct
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sent_at);

-- =============================================
-- Notification Queue
-- =============================================
CREATE TABLE IF NOT EXISTS notifications (
  id            BIGSERIAL PRIMARY KEY,
  wallet        TEXT NOT NULL REFERENCES wallets(address),
  type          TEXT NOT NULL,                     -- new_request | message | approved
  payload       JSONB NOT NULL DEFAULT '{}',
  read          BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_wallet ON notifications(wallet);
