-- Async VH task teardown after user cancel (no sync delete on cancel path).
CREATE TABLE IF NOT EXISTS vh_teardown_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vh_task_id TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vh_teardown_queue_vh_task_id_key UNIQUE (vh_task_id)
);

CREATE INDEX IF NOT EXISTS idx_vh_teardown_next_retry
  ON vh_teardown_queue (next_retry_at);
