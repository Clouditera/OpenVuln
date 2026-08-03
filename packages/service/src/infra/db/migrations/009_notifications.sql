-- 009: in-app + email notifications on scan completed

ALTER TABLE github_identities ADD COLUMN IF NOT EXISTS email text;

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  github_user_id bigint NOT NULL REFERENCES github_identities (user_id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL,
  read_at timestamptz,
  email_attempts int NOT NULL DEFAULT 0,
  email_sent_at timestamptz,
  email_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications (github_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_email_pending
  ON notifications (id)
  WHERE email_sent_at IS NULL;
