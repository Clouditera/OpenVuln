-- Harvested VH poc/exp text artifacts (completed sync).
-- Binary: mime + path only, content NULL. Text: content may be truncated.

CREATE TABLE IF NOT EXISTS finding_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scan_job_id uuid NOT NULL REFERENCES scan_jobs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('poc', 'exp', 'other')),
  rel_path text NOT NULL,
  file_name text NOT NULL,
  mime text NULL,
  size_bytes int NOT NULL DEFAULT 0,
  content text NULL,
  truncated boolean NOT NULL DEFAULT false,
  is_binary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (finding_id, rel_path)
);

CREATE INDEX IF NOT EXISTS idx_finding_artifacts_finding
  ON finding_artifacts (finding_id);

CREATE INDEX IF NOT EXISTS idx_finding_artifacts_project
  ON finding_artifacts (project_id);
