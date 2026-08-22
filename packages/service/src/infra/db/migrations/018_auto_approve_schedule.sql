-- task-130fcbfa: auto-approve moves from submit-trigger to scheduled ticks.
-- Schedule is configurable in scan_config (admin Settings); read fresh each tick.
ALTER TABLE scan_config
  ADD COLUMN IF NOT EXISTS auto_approve_schedule_mode TEXT NOT NULL DEFAULT 'off'
    CHECK (auto_approve_schedule_mode IN ('off', 'interval', 'daily')),
  ADD COLUMN IF NOT EXISTS auto_approve_interval_minutes INTEGER NOT NULL DEFAULT 10
    CHECK (auto_approve_interval_minutes >= 1 AND auto_approve_interval_minutes <= 1440),
  ADD COLUMN IF NOT EXISTS auto_approve_daily_at TEXT NOT NULL DEFAULT '09:00'
    CHECK (auto_approve_daily_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
