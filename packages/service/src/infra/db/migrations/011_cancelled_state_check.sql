-- 011: Add 'cancelled' to scan_jobs state CHECK constraint
-- BUG-VB-1: migration 010 added cancelled to app type but not DB constraint

ALTER TABLE scan_jobs DROP CONSTRAINT IF EXISTS scan_jobs_state_check;
ALTER TABLE scan_jobs ADD CONSTRAINT scan_jobs_state_check
  CHECK (state = ANY (ARRAY['queued', 'dispatching', 'scanning', 'completed', 'failed', 'cancelled']));
