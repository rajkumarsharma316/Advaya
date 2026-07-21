-- Group Conversations Schema
-- Stores metadata about group chats and participant memberships

CREATE TABLE IF NOT EXISTS group_conversations (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  created_by    TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id      BIGINT NOT NULL REFERENCES group_conversations(id) ON DELETE CASCADE,
  wallet        TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member',    -- admin | member
  joined_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, wallet)
);

CREATE INDEX IF NOT EXISTS idx_group_members_wallet ON group_members(wallet);
