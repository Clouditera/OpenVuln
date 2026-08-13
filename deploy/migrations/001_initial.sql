-- OpenVuln initial schema (architecture-prototype.md §3)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_repo_id  BIGINT UNIQUE NOT NULL,
  owner_login     TEXT NOT NULL,
  name            TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  html_url        TEXT NOT NULL,
  description     TEXT,
  language        TEXT,
  stars           INT NOT NULL DEFAULT 0,
  default_branch  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at      TIMESTAMPTZ
);

CREATE INDEX idx_projects_created_at ON projects (created_at DESC);
CREATE INDEX idx_projects_stars ON projects (stars DESC);
CREATE INDEX idx_projects_full_name ON projects (full_name);

CREATE TABLE scan_jobs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects (id),
  vulnhunter_task_id    UUID,
  state                 TEXT NOT NULL,
  commit_sha            TEXT,
  attempt               INT NOT NULL DEFAULT 1,
  fail_reason_internal  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at            TIMESTAMPTZ,
  finished_at           TIMESTAMPTZ,
  CONSTRAINT scan_jobs_state_check CHECK (
    state IN ('queued', 'dispatching', 'scanning', 'completed', 'failed')
  )
);

CREATE INDEX idx_scan_jobs_queue ON scan_jobs (state, created_at);
CREATE INDEX idx_scan_jobs_project ON scan_jobs (project_id, created_at DESC);

CREATE TABLE findings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects (id),
  scan_job_id       UUID NOT NULL REFERENCES scan_jobs (id),
  finding_key       TEXT NOT NULL,
  severity          TEXT NOT NULL,
  title             TEXT NOT NULL DEFAULT '',
  cwe               TEXT,
  primary_file      TEXT,
  detail_json       JSONB,
  disclosure_state  TEXT NOT NULL DEFAULT 'owner_only',
  disclosed_at      TIMESTAMPTZ,
  disclosed_by      BIGINT,
  UNIQUE (scan_job_id, finding_key),
  CONSTRAINT findings_severity_check CHECK (
    severity IN ('high', 'medium', 'low', 'info')
  ),
  CONSTRAINT findings_disclosure_check CHECK (
    disclosure_state IN ('owner_only', 'disclosed')
  )
);

CREATE INDEX idx_findings_project ON findings (project_id);
CREATE INDEX idx_findings_disclosure ON findings (project_id, disclosure_state);
CREATE INDEX idx_findings_severity ON findings (project_id, severity);

CREATE TABLE github_identities (
  user_id       BIGINT PRIMARY KEY,
  login         TEXT NOT NULL,
  avatar_url    TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE repo_access_grants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_user_id  BIGINT NOT NULL REFERENCES github_identities (user_id),
  github_repo_id  BIGINT NOT NULL,
  role            TEXT NOT NULL,
  verified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (github_user_id, github_repo_id),
  CONSTRAINT grants_role_check CHECK (role IN ('admin', 'maintain'))
);

CREATE INDEX idx_grants_user ON repo_access_grants (github_user_id);
CREATE INDEX idx_grants_repo ON repo_access_grants (github_repo_id);

CREATE TABLE sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      TEXT NOT NULL UNIQUE,
  github_user_id  BIGINT NOT NULL REFERENCES github_identities (user_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_sessions_token ON sessions (token_hash);
CREATE INDEX idx_sessions_user ON sessions (github_user_id);
