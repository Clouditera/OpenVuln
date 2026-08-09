import { getDb } from "../../infra/db/index.js";

export interface ScanConfigRow {
  scan_timeout_hours: number;
  max_items_per_recon: number;
  agent_max_parallel: number;
  audit_focus: string | null;
  enable_dynamic_verify: boolean;
  enable_dynamic_exploit: boolean;
  scan_concurrency: number;
}

export async function getScanConfig(): Promise<ScanConfigRow> {
  const db = getDb();
  const rows = await db<ScanConfigRow[]>`
    SELECT scan_timeout_hours, max_items_per_recon, agent_max_parallel,
           audit_focus, enable_dynamic_verify, enable_dynamic_exploit,
           scan_concurrency
    FROM scan_config WHERE id = 1
  `;
  return rows[0];
}

export async function updateScanConfig(
  updates: Partial<Pick<ScanConfigRow, 
    'scan_timeout_hours' | 'max_items_per_recon' | 'agent_max_parallel' |
    'audit_focus' | 'enable_dynamic_verify' | 'enable_dynamic_exploit' |
    'scan_concurrency'
  >>,
): Promise<ScanConfigRow> {
  const db = getDb();
  const rows = await db<ScanConfigRow[]>`
    UPDATE scan_config SET
      scan_timeout_hours = COALESCE(${updates.scan_timeout_hours ?? null}, scan_timeout_hours),
      max_items_per_recon = COALESCE(${updates.max_items_per_recon ?? null}, max_items_per_recon),
      agent_max_parallel = COALESCE(${updates.agent_max_parallel ?? null}, agent_max_parallel),
      audit_focus = COALESCE(${updates.audit_focus ?? null}, audit_focus),
      enable_dynamic_verify = COALESCE(${updates.enable_dynamic_verify ?? null}, enable_dynamic_verify),
      enable_dynamic_exploit = COALESCE(${updates.enable_dynamic_exploit ?? null}, enable_dynamic_exploit),
      scan_concurrency = COALESCE(${updates.scan_concurrency ?? null}, scan_concurrency),
      updated_at = now()
    WHERE id = 1
    RETURNING scan_timeout_hours, max_items_per_recon, agent_max_parallel,
              audit_focus, enable_dynamic_verify, enable_dynamic_exploit,
              scan_concurrency
  `;
  return rows[0];
}
