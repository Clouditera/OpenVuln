-- 010: Versioned scans — scan identity = (project, commit SHA)
-- Per architect task-4ba6938e: idempotent submit, single in-flight, cancel, version history

-- git_ref: user-supplied reference (branch/tag/SHA) for display
ALTER TABLE scan_jobs ADD COLUMN IF NOT EXISTS git_ref text;

-- cancelled state for scan_jobs
-- (no CHECK constraint on state in current schema; app-level validation only)

-- Single in-flight per project: DB-level strong constraint
CREATE UNIQUE INDEX IF NOT EXISTS one_inflight_per_project
  ON scan_jobs (project_id)
  WHERE state IN ('queued', 'dispatching', 'scanning');

-- Idempotent query index: (project_id, commit_sha) for completed
CREATE INDEX IF NOT EXISTS idx_scan_jobs_version_completed
  ON scan_jobs (project_id, commit_sha)
  WHERE state = 'completed';

-- Version history index
CREATE INDEX IF NOT EXISTS idx_scan_jobs_project_created
  ON scan_jobs (project_id, created_at DESC);
