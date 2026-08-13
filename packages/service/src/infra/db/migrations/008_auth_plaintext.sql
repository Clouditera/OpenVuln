-- 008: GitHub OAuth sessions + plaintext findings (owner self-service)

CREATE TABLE IF NOT EXISTS github_identities (
  user_id bigint PRIMARY KEY,
  login text NOT NULL,
  avatar_url text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_hash text UNIQUE NOT NULL,
  github_user_id bigint NOT NULL REFERENCES github_identities (user_id) ON DELETE CASCADE,
  github_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (github_user_id);

CREATE TABLE IF NOT EXISTS repo_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  github_user_id bigint NOT NULL REFERENCES github_identities (user_id) ON DELETE CASCADE,
  github_repo_id bigint NOT NULL,
  role text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (github_user_id, github_repo_id)
);
CREATE INDEX IF NOT EXISTS idx_grants_user_repo ON repo_access_grants (github_user_id, github_repo_id);

-- Plaintext finding columns (dual-write period; enc_payload kept until 009)
ALTER TABLE findings ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS primary_file text;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS detail_json jsonb;

ALTER TABLE finding_artifacts ADD COLUMN IF NOT EXISTS content_text text;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS submitted_by bigint NULL;

-- Daily submit rate limit counter (simple)
CREATE TABLE IF NOT EXISTS submit_rate_limits (
  github_user_id bigint NOT NULL,
  day date NOT NULL DEFAULT (CURRENT_DATE),
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (github_user_id, day)
);
