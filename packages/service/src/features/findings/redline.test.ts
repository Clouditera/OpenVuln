/**
 * RED LINE: public routes must not expose owner_only finding details.
 * Owner endpoints require auth (401 without session).
 */
import { randomUUID as cryptoRandomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type TestContext,
  cleanTables,
  seedFinding,
  seedProject,
  seedScanJob,
  setupTestApp,
} from "../../test/setup-db.js";
import { getDb } from "../../infra/db/index.js";
import { scanStorage } from "../scans/index.js";
import { findingsStorage } from "./index.js";

describe("findings red line", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  beforeEach(async () => {
    await cleanTables();
  });

  it("public project view only lists disclosed findings (no path/code)", async () => {
    const { projectId, fullName } = await seedProject({ fullName: "acme/widget" });
    const scanId = await seedScanJob(projectId);
    await seedFinding(projectId, scanId, {
      key: "secret-1",
      disclosure: "owner_only",
      title: "OWNER ONLY TITLE",
    });
    await seedFinding(projectId, scanId, {
      key: "public-1",
      disclosure: "disclosed",
      title: "Disclosed XSS",
    });

    const [owner, repo] = fullName.split("/");
    const res = await ctx.app.request(`/api/projects/${owner}/${repo}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      disclosed_findings: Array<{ title: string }>;
      severity_counts: { high: number; critical?: number };
    };

    expect(body.severity_counts.high).toBe(2);
    expect(body.disclosed_findings).toHaveLength(1);
    expect(body.disclosed_findings[0].title).toBe("Disclosed XSS");
    const dumped = JSON.stringify(body);
    expect(dumped).not.toContain("OWNER ONLY TITLE");
    expect(dumped).not.toContain("should never leak publicly");
    expect(dumped).not.toContain("src/secret.ts");
  });

  it("owner findings route requires auth (401)", async () => {
    const { projectId } = await seedProject();
    const res = await ctx.app.request(`/api/projects/${projectId}/findings`);
    expect(res.status).toBe(401);
  });

  it("owner disclose route requires auth (401)", async () => {
    const { projectId } = await seedProject();
    const res = await ctx.app.request(`/api/projects/${projectId}/disclose`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ finding_ids: ["00000000-0000-0000-0000-000000000001"] }),
    });
    expect(res.status).toBe(401);
  });

  it("submit requires auth (401)", async () => {
    const res = await ctx.app.request(`/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ git_url: "https://github.com/acme/widget" }),
    });
    expect(res.status).toBe(401);
  });

  it("info severity is not exposed in public counts", async () => {
    const { projectId, fullName } = await seedProject({ fullName: "acme/info-hide" });
    const scanId = await seedScanJob(projectId);
    await seedFinding(projectId, scanId, {
      key: "info-1",
      severity: "info",
      cvssScore: 0,
      disclosure: "disclosed",
      title: "Info only",
    });
    const [owner, repo] = fullName.split("/");
    const res = await ctx.app.request(`/api/projects/${owner}/${repo}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      disclosed_findings: unknown[];
      severity_counts: Record<string, number>;
    };
    expect(body.disclosed_findings).toHaveLength(0);
    expect(body.severity_counts.info ?? 0).toBe(0);
  });
});

// task: NUL sanitize (prod incident 2026-09-04..07) — \u0000 in finding text
// made upsertEncryptedFinding fail forever, wedging the harvest poll loop.
describe("upsertEncryptedFinding NUL sanitize", () => {
  it("strips \\u0000 from strings and nested detail JSON", async () => {
    const { projectId } = await seedProject({ fullName: "acme/nul-case" });
    const job = await scanStorage.createScanJob(projectId, "nulsha");
    await findingsStorage.upsertEncryptedFinding({
      id: cryptoRandomUUID(),
      projectId,
      scanJobId: job.id,
      findingKey: "nul-finding",
      severity: "high",
      cwe: "CWE-79",
      title: "bad\u0000title",
      primaryFile: "src/a\u0000b.ts",
      detailJson: { summary: "has\u0000nul", nested: { arr: ["x\u0000y", 1] } },
    });
    const db = getDb();
    const rows = await db<Array<Record<string, unknown>>>`
      SELECT title, primary_file, detail_json FROM findings WHERE scan_job_id = ${job.id}::uuid
    `;
    expect(rows.length).toBe(1);
    const row = rows[0] as { title: string; primary_file: string; detail_json: { summary: string; nested: { arr: unknown[] } } };
    expect(row.title).toBe("badtitle");
    expect(row.primary_file).toBe("src/ab.ts");
    expect(row.detail_json.summary).toBe("hasnul");
    expect(row.detail_json.nested.arr[0]).toBe("xy");
  });
});
