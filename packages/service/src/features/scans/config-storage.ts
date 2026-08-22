import { getDb } from "../../infra/db/index.js";

export type AutoApproveScheduleMode = "off" | "interval" | "daily";

export interface ScanConfigRow {
  scan_timeout_hours: number;
  max_items_per_recon: number;
  agent_max_parallel: number;
  audit_focus: string | null;
  output_language: string;
  vuln_focus: string | null;
  enable_dynamic_verify: boolean;
  enable_dynamic_exploit: boolean;
  scan_concurrency: number;
  auto_approve_enabled: boolean;
  auto_approve_strategy: "stars_desc" | "fifo";
  auto_approve_schedule_mode: AutoApproveScheduleMode;
  auto_approve_interval_minutes: number;
  auto_approve_daily_at: string;
}

export async function getScanConfig(): Promise<ScanConfigRow> {
  const db = getDb();
  const rows = await db<ScanConfigRow[]>`
    SELECT scan_timeout_hours, max_items_per_recon, agent_max_parallel,
           audit_focus, output_language, vuln_focus,
           enable_dynamic_verify, enable_dynamic_exploit,
           scan_concurrency, auto_approve_enabled, auto_approve_strategy,
           auto_approve_schedule_mode, auto_approve_interval_minutes, auto_approve_daily_at
    FROM scan_config WHERE id = 1
  `;
  return rows[0];
}

export async function updateScanConfig(
  updates: Partial<
    Pick<
      ScanConfigRow,
      | "scan_timeout_hours"
      | "max_items_per_recon"
      | "agent_max_parallel"
      | "audit_focus"
      | "output_language"
      | "vuln_focus"
      | "enable_dynamic_verify"
      | "enable_dynamic_exploit"
      | "scan_concurrency"
      | "auto_approve_enabled"
      | "auto_approve_strategy"
      | "auto_approve_schedule_mode"
      | "auto_approve_interval_minutes"
      | "auto_approve_daily_at"
    >
  >,
): Promise<ScanConfigRow> {
  const db = getDb();
  let outputLanguage = updates.output_language ?? null;
  if (outputLanguage != null) {
    const v = String(outputLanguage).trim();
    if (v === "en" || v === "en-US" || v.toLowerCase() === "english") outputLanguage = "en";
    else if (v === "zh-CN" || v === "zh" || v === "zh_CN" || v.toLowerCase() === "chinese")
      outputLanguage = "zh-CN";
    else {
      const err = new Error(`invalid_output_language:${v}`);
      (err as Error & { code?: string }).code = "ERR_VALIDATION";
      throw err;
    }
  }
  let strategy = updates.auto_approve_strategy ?? null;
  if (strategy != null) {
    const s = String(strategy).trim();
    if (s !== "stars_desc" && s !== "fifo") {
      const err = new Error(`invalid_auto_approve_strategy:${s}`);
      (err as Error & { code?: string }).code = "ERR_VALIDATION";
      throw err;
    }
    strategy = s;
  }
  let scheduleMode = updates.auto_approve_schedule_mode ?? null;
  if (scheduleMode != null) {
    const m = String(scheduleMode).trim();
    if (m !== "off" && m !== "interval" && m !== "daily") {
      const err = new Error(`invalid_auto_approve_schedule_mode:${m}`);
      (err as Error & { code?: string }).code = "ERR_VALIDATION";
      throw err;
    }
    scheduleMode = m;
  }
  let intervalMinutes = updates.auto_approve_interval_minutes ?? null;
  if (intervalMinutes != null) {
    const n = Number(intervalMinutes);
    if (!Number.isInteger(n) || n < 1 || n > 1440) {
      const err = new Error(`invalid_auto_approve_interval_minutes:${intervalMinutes}`);
      (err as Error & { code?: string }).code = "ERR_VALIDATION";
      throw err;
    }
    intervalMinutes = n;
  }
  let dailyAt = updates.auto_approve_daily_at ?? null;
  if (dailyAt != null) {
    const v = String(dailyAt).trim();
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v)) {
      const err = new Error(`invalid_auto_approve_daily_at:${dailyAt}`);
      (err as Error & { code?: string }).code = "ERR_VALIDATION";
      throw err;
    }
    dailyAt = v;
  }

  const rows = await db<ScanConfigRow[]>`
    UPDATE scan_config SET
      scan_timeout_hours = COALESCE(${updates.scan_timeout_hours ?? null}, scan_timeout_hours),
      max_items_per_recon = COALESCE(${updates.max_items_per_recon ?? null}, max_items_per_recon),
      agent_max_parallel = COALESCE(${updates.agent_max_parallel ?? null}, agent_max_parallel),
      audit_focus = COALESCE(${updates.audit_focus ?? null}, audit_focus),
      output_language = COALESCE(${outputLanguage}, output_language),
      vuln_focus = COALESCE(${updates.vuln_focus ?? null}, vuln_focus),
      enable_dynamic_verify = COALESCE(${updates.enable_dynamic_verify ?? null}, enable_dynamic_verify),
      enable_dynamic_exploit = COALESCE(${updates.enable_dynamic_exploit ?? null}, enable_dynamic_exploit),
      scan_concurrency = COALESCE(${updates.scan_concurrency ?? null}, scan_concurrency),
      auto_approve_enabled = COALESCE(${updates.auto_approve_enabled ?? null}, auto_approve_enabled),
      auto_approve_strategy = COALESCE(${strategy}, auto_approve_strategy),
      auto_approve_schedule_mode = COALESCE(${scheduleMode}, auto_approve_schedule_mode),
      auto_approve_interval_minutes = COALESCE(${intervalMinutes}, auto_approve_interval_minutes),
      auto_approve_daily_at = COALESCE(${dailyAt}, auto_approve_daily_at),
      updated_at = now()
    WHERE id = 1
    RETURNING scan_timeout_hours, max_items_per_recon, agent_max_parallel,
              audit_focus, output_language, vuln_focus,
              enable_dynamic_verify, enable_dynamic_exploit,
              scan_concurrency, auto_approve_enabled, auto_approve_strategy,
              auto_approve_schedule_mode, auto_approve_interval_minutes, auto_approve_daily_at
  `;
  return rows[0];
}
