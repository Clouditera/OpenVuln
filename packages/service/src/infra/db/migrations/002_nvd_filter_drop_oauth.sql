-- NVD severity + finding filters + drop OAuth tables + admin token era
-- task-7057d1e1 + task-697b903c

-- scan_jobs: live finding count while scanning
ALTER TABLE scan_jobs
  ADD COLUMN IF NOT EXISTS findings_so_far INT NOT NULL DEFAULT 0;

-- findings: CVSS + poc_status + raw VH severity + item_type
ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS cvss_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS cvss_vector TEXT,
  ADD COLUMN IF NOT EXISTS poc_status TEXT,
  ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'finding',
  ADD COLUMN IF NOT EXISTS vh_severity TEXT;

-- Expand severity check to include critical (NVD). Keep info for storage/back-compat.
ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_severity_check;
ALTER TABLE findings ADD CONSTRAINT findings_severity_check CHECK (
  severity IN ('critical', 'high', 'medium', 'low', 'info')
);

-- Drop OAuth / owner-grant tables (no longer used)
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS repo_access_grants CASCADE;
DROP TABLE IF EXISTS github_identities CASCADE;

-- disclosed_by was GitHub user id; keep column but no longer FK
-- (already BIGINT nullable, no FK in 001 — ok)
