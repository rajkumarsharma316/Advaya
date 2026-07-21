-- Unified Conversations schema for group chats
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE conversations ALTER COLUMN receiver DROP NOT NULL;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS no_self_convo;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_sender_receiver_key;

CREATE TABLE IF NOT EXISTS group_members (
  group_id      BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  wallet        TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member',    -- admin | member
  joined_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, wallet)
);

CREATE INDEX IF NOT EXISTS idx_group_members_wallet ON group_members(wallet);
