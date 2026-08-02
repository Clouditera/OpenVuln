-- Public disclosed fidelity: original report.yaml + poc/exp file bodies
-- (plaintext only after operator-signed disclose; never for owner_only rows)

ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS disclosed_report_yaml text NULL;

CREATE TABLE IF NOT EXISTS disclosed_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('poc', 'exp', 'report', 'other')),
  rel_path text NOT NULL,
  file_name text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (finding_id, rel_path)
);

CREATE INDEX IF NOT EXISTS idx_disclosed_files_finding
  ON disclosed_files (finding_id);

CREATE INDEX IF NOT EXISTS idx_disclosed_files_project
  ON disclosed_files (project_id);
