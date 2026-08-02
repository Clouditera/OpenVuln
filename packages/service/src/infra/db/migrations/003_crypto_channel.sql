-- Crypto admin channel (docs/crypto-admin-channel.md)
-- Encrypt finding detail at rest; public columns use disclosed_* after operator sign-off.

ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS enc_payload TEXT,
  ADD COLUMN IF NOT EXISTS disclosed_title TEXT,
  ADD COLUMN IF NOT EXISTS disclosed_summary TEXT,
  ADD COLUMN IF NOT EXISTS disclosed_detail JSONB;

-- Allow legacy rows during migration; new inserts require enc_payload.
-- Backfill empty envelope marker for any leftover plain rows (demo reseed will replace).
UPDATE findings SET enc_payload = 'OVENC1.pending' WHERE enc_payload IS NULL;
ALTER TABLE findings ALTER COLUMN enc_payload SET NOT NULL;

-- title/primary_file/detail_json become optional (legacy / cleartext staging)
ALTER TABLE findings ALTER COLUMN title DROP NOT NULL;
ALTER TABLE findings ALTER COLUMN title SET DEFAULT NULL;

CREATE TABLE IF NOT EXISTS admin_nonces (
  nonce    TEXT PRIMARY KEY,
  used_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_nonces_used ON admin_nonces (used_at);
