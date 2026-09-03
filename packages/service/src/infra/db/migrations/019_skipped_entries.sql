-- task-08627338: archive filter skip audit trail on the job row
ALTER TABLE scan_jobs
  ADD COLUMN IF NOT EXISTS skipped_entries jsonb;
