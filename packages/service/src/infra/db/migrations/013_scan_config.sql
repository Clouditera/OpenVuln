-- 013: Scan config stored in DB (overridable by admin, persistent across restarts)
CREATE TABLE IF NOT EXISTS scan_config (
  id int PRIMARY KEY DEFAULT 1,
  scan_timeout_hours numeric NOT NULL DEFAULT 5,
  max_items_per_recon int NOT NULL DEFAULT 10,
  agent_max_parallel int NOT NULL DEFAULT 5,
  audit_focus text,
  enable_dynamic_verify boolean NOT NULL DEFAULT true,
  enable_dynamic_exploit boolean NOT NULL DEFAULT true,
  scan_concurrency int NOT NULL DEFAULT 10,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scan_config_singleton CHECK (id = 1)
);

INSERT INTO scan_config (id) VALUES (1) ON CONFLICT DO NOTHING;
