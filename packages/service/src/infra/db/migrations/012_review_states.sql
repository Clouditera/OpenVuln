-- 012: Add pending_review and rejected states for admin approval workflow
ALTER TABLE scan_jobs DROP CONSTRAINT IF EXISTS scan_jobs_state_check;
ALTER TABLE scan_jobs ADD CONSTRAINT scan_jobs_state_check
  CHECK (state = ANY (ARRAY[
    'pending_review', 'queued', 'dispatching', 'scanning',
    'completed', 'failed', 'cancelled', 'rejected'
  ]));
