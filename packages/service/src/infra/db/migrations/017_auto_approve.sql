-- Auto-approve: admin Settings toggle + strategy
ALTER TABLE scan_config
  ADD COLUMN IF NOT EXISTS auto_approve_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_approve_strategy TEXT NOT NULL DEFAULT 'fifo'
    CHECK (auto_approve_strategy IN ('stars_desc', 'fifo'));
