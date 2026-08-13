-- Stability suite + architecture P1:
-- projects.current_scan_job_id = public visibility pointer
-- scan_jobs.consecutive_failures = VH failed grace counter
-- drop findings.title (public uses disclosed_title only)

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS current_scan_job_id uuid NULL
    REFERENCES scan_jobs(id) ON DELETE SET NULL;

ALTER TABLE scan_jobs
  ADD COLUMN IF NOT EXISTS consecutive_failures int NOT NULL DEFAULT 0;

-- Backfill: each project's latest completed job
UPDATE projects p
SET current_scan_job_id = sub.id
FROM (
  SELECT DISTINCT ON (j.project_id) j.project_id, j.id
  FROM scan_jobs j
  WHERE j.state = 'completed'
  ORDER BY j.project_id, j.finished_at DESC NULLS LAST, j.created_at DESC
) sub
WHERE p.id = sub.project_id
  AND p.current_scan_job_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_current_scan_job
  ON projects (current_scan_job_id)
  WHERE current_scan_job_id IS NOT NULL;

-- title column is redundant with disclosed_title / enc_payload
ALTER TABLE findings DROP COLUMN IF EXISTS title;
