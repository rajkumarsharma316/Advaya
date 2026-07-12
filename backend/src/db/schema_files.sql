-- File Attachments Schema (Phase 1: local disk storage)
-- Stores metadata about encrypted file uploads

CREATE TABLE IF NOT EXISTS file_attachments (
  id              TEXT PRIMARY KEY,                  -- UUID
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  uploader        TEXT NOT NULL REFERENCES wallets(address),
  original_name   TEXT NOT NULL,                     -- Original filename
  mime_type       TEXT NOT NULL,                     -- Original MIME type
  file_size       BIGINT NOT NULL,                   -- Original file size in bytes
  stored_path     TEXT NOT NULL,                     -- Path on disk (relative to uploads/)
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_file_attachments_conversation ON file_attachments(conversation_id);
CREATE INDEX IF NOT EXISTS idx_file_attachments_uploader ON file_attachments(uploader);
