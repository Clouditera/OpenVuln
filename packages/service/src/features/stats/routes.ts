import type {
  CweTopItem,
  LiveScanItem,
  OverviewStats,
  RecentActivityItem,
  TrendDay,
} from "@openvuln/shared";
import { emptySeverityCounts } from "@openvuln/shared";
import { Hono } from "hono";
import { getDb } from "../../infra/db/index.js";
import { findingsStorage } from "../findings/index.js";
import { projectStorage } from "../projects/index.js";

export const statsRouter = new Hono();

const CWE_NAMES: Record<string, string> = {
  "CWE-79": "XSS",
  "CWE-89": "SQL Injection",
  "CWE-22": "Path Traversal",
  "CWE-78": "OS Command Injection",
  "CWE-352": "CSRF",
  "CWE-918": "SSRF",
  "CWE-287": "Auth Bypass",
  "CWE-502": "Deserialization",
  "CWE-611": "XXE",
  "CWE-94": "Code Injection",
  "CWE-200": "Info Exposure",
  "CWE-601": "Open Redirect",
  "CWE-798": "Hard-coded Credentials",
  "CWE-862": "Missing Authorization",
};

function emptyTrendDay(date: string): TrendDay {
  return { date, critical: 0, high: 0, medium: 0, low: 0 };
}

function buildTrend(realByDate: Map<string, TrendDay>): TrendDay[] {
  const days: TrendDay[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push(realByDate.get(key) ?? emptyTrendDay(key));
  }
  return days;
}

// GET /api/stats/overview
statsRouter.get("/overview", async (c) => {
  const db = getDb();
  const projectCount = await projectStorage.countActive();
  const scanRows = await db<{ completed: string; failed: string; in_progress: string }[]>`
    SELECT
      count(*) FILTER (WHERE j.state = 'completed')::text AS completed,
      count(*) FILTER (WHERE j.state = 'failed')::text AS failed,
      count(*) FILTER (WHERE j.state IN ('queued', 'dispatching', 'scanning'))::text AS in_progress
    FROM scan_jobs j
    JOIN projects p ON p.id = j.project_id AND p.removed_at IS NULL
  `;
  const findingTotals = await findingsStorage.platformFindingTotals();
  const severity_counts = await findingsStorage.platformSeverityCounts();

  const cweRows = await db<{ cwe: string; n: string }[]>`
    SELECT COALESCE(f.cwe, 'unknown') AS cwe, count(*)::text AS n
    FROM findings f
    JOIN projects p ON p.id = f.project_id
      AND p.removed_at IS NULL
      AND p.current_scan_job_id = f.scan_job_id
    WHERE f.severity IN ('critical', 'high', 'medium', 'low')
    GROUP BY COALESCE(f.cwe, 'unknown')
    ORDER BY count(*) DESC
    LIMIT 8
  `;
  const cwe_top: CweTopItem[] = cweRows.map((r) => ({
    cwe: r.cwe,
    name: CWE_NAMES[r.cwe] ?? null,
    count: Number(r.n),
  }));

  const liveRows = await db<
    {
      project_id: string;
      full_name: string;
      state: string;
      started_at: Date | null;
      created_at: Date;
      findings_so_far: number;
    }[]
  >`
    SELECT j.project_id::text, p.full_name, j.state, j.started_at, j.created_at,
           COALESCE(j.findings_so_far, 0) AS findings_so_far
    FROM scan_jobs j
    JOIN projects p ON p.id = j.project_id AND p.removed_at IS NULL
    WHERE j.state IN ('scanning', 'dispatching')
    ORDER BY COALESCE(j.started_at, j.created_at) ASC
    LIMIT 3
  `;
  const queuedRows = await db<{ n: string }[]>`
    SELECT count(*)::text AS n
    FROM scan_jobs j
    JOIN projects p ON p.id = j.project_id AND p.removed_at IS NULL
    WHERE j.state = 'queued'
  `;
  const now = Date.now();
  const scanning: LiveScanItem[] = liveRows.map((r) => {
    const start = (r.started_at ?? r.created_at).getTime();
    return {
      project_id: r.project_id,
      full_name: r.full_name,
      state: r.state === "dispatching" ? "dispatching" : "scanning",
      elapsed_sec: Math.max(0, Math.floor((now - start) / 1000)),
      findings_so_far: Number(r.findings_so_far) || 0,
    };
  });

  const recent: RecentActivityItem[] = [];
  const completedRecent = await db<{ ts: Date; full_name: string; extra: string }[]>`
    SELECT j.finished_at AS ts, p.full_name,
           (SELECT count(*)::text FROM findings f
            WHERE f.scan_job_id = j.id
              AND f.severity IN ('critical','high','medium','low')) AS extra
    FROM scan_jobs j
    JOIN projects p ON p.id = j.project_id AND p.removed_at IS NULL
    WHERE j.state = 'completed' AND j.finished_at IS NOT NULL
    ORDER BY j.finished_at DESC
    LIMIT 6
  `;
  for (const r of completedRecent) {
    recent.push({
      ts: r.ts.toISOString(),
      type: "scan_completed",
      text: `scan completed · ${r.full_name}`,
      full_name: r.full_name,
      meta: r.extra ? `+${r.extra} findings` : undefined,
    });
  }
  const submittedRecent = await db<{ ts: Date; full_name: string }[]>`
    SELECT created_at AS ts, full_name FROM projects
    WHERE removed_at IS NULL
    ORDER BY created_at DESC
    LIMIT 4
  `;
  for (const r of submittedRecent) {
    recent.push({
      ts: r.ts.toISOString(),
      type: "project_submitted",
      text: `project submitted · ${r.full_name}`,
      full_name: r.full_name,
    });
  }
  const disclosedRecent = await db<{ ts: Date; full_name: string; extra: string }[]>`
    SELECT f.disclosed_at AS ts, p.full_name, f.severity AS extra
    FROM findings f
    JOIN projects p ON p.id = f.project_id
      AND p.removed_at IS NULL
      AND p.current_scan_job_id = f.scan_job_id
    WHERE f.disclosure_state = 'disclosed'
      AND f.disclosed_at IS NOT NULL
      AND f.severity IN ('critical','high','medium','low')
    ORDER BY f.disclosed_at DESC
    LIMIT 4
  `;
  for (const r of disclosedRecent) {
    recent.push({
      ts: r.ts.toISOString(),
      type: "disclosed",
      text: `finding disclosed · ${r.full_name}`,
      full_name: r.full_name,
      meta: r.extra,
    });
  }
  recent.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  recent.splice(12);

  const trendRaw = await db<{ day: string; severity: string; n: string }[]>`
    SELECT
      to_char(date_trunc('day', COALESCE(j.finished_at, j.created_at) AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
      f.severity,
      count(*)::text AS n
    FROM findings f
    JOIN scan_jobs j ON j.id = f.scan_job_id
    JOIN projects p ON p.id = f.project_id
      AND p.removed_at IS NULL
      AND p.current_scan_job_id = f.scan_job_id
    WHERE COALESCE(j.finished_at, j.created_at) > now() - interval '30 days'
      AND f.severity IN ('critical','high','medium','low')
    GROUP BY 1, 2
  `;
  const realByDate = new Map<string, TrendDay>();
  for (const row of trendRaw) {
    const cur = realByDate.get(row.day) ?? emptyTrendDay(row.day);
    if (
      row.severity === "critical" ||
      row.severity === "high" ||
      row.severity === "medium" ||
      row.severity === "low"
    ) {
      cur[row.severity] = Number(row.n);
    }
    realByDate.set(row.day, cur);
  }

  const body: OverviewStats = {
    project_count: projectCount,
    scan_completed_count: Number(scanRows[0]?.completed ?? 0),
    scan_failed_count: Number(scanRows[0]?.failed ?? 0),
    scan_in_progress_count: Number(scanRows[0]?.in_progress ?? 0),
    finding_total: findingTotals.total,
    finding_disclosed_count: findingTotals.disclosed,
    severity_counts: severity_counts ?? emptySeverityCounts(),
    trend: buildTrend(realByDate),
    cwe_top,
    live: {
      scanning,
      queued_count: Number(queuedRows[0]?.n ?? 0),
    },
    recent,
  };
  return c.json(body);
});
