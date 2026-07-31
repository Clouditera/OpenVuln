/**
 * RED LINE: public routes must not expose owner_only finding details.
 * Requires Postgres (deploy/docker-compose.yml).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  setupTestApp,
  cleanTables,
  seedProject,
  seedScanJob,
  seedFinding,
  seedSession,
  type TestContext,
} from "../../test/setup-db.js";

describe("findings red line", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  beforeEach(async () => {
    await cleanTables();
  });

  afterAll(async () => {
    // leave db connection for other suites
  });

  it("public project view only lists disclosed findings", async () => {
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
      disclosed_findings: Array<{ title: string; finding_key: string }>;
      severity_counts: { high: number };
    };

    expect(body.severity_counts.high).toBe(2);
    expect(body.disclosed_findings).toHaveLength(1);
    expect(body.disclosed_findings[0].title).toBe("Disclosed XSS");
    const dumped = JSON.stringify(body);
    expect(dumped).not.toContain("OWNER ONLY TITLE");
    expect(dumped).not.toContain("should never leak publicly");
    expect(dumped).not.toContain("src/secret.ts");
  });

  it("anonymous cannot list owner findings", async () => {
    const { projectId } = await seedProject();
    const res = await ctx.app.request(`/api/projects/${projectId}/findings`);
    expect(res.status).toBe(401);
  });

  it("authenticated without grant gets 403", async () => {
    const { projectId } = await seedProject();
    const token = await seedSession("random-user", 1001);
    const res = await ctx.app.request(`/api/projects/${projectId}/findings`, {
      headers: { cookie: `ov_session=${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("owner with grant can list findings including owner_only", async () => {
    const { projectId, repoId } = await seedProject();
    const scanId = await seedScanJob(projectId);
    await seedFinding(projectId, scanId, {
      key: "secret-1",
      disclosure: "owner_only",
      title: "OWNER ONLY TITLE",
    });
    const token = await seedSession("owner-user", 2002, repoId);

    const res = await ctx.app.request(`/api/projects/${projectId}/findings`, {
      headers: { cookie: `ov_session=${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ title: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe("OWNER ONLY TITLE");
  });

  it("owner can disclose and public view then shows it", async () => {
    const { projectId, repoId, fullName } = await seedProject({ fullName: "acme/disclose-me" });
    const scanId = await seedScanJob(projectId);
    const findingId = await seedFinding(projectId, scanId, {
      key: "to-disclose",
      disclosure: "owner_only",
      title: "Now Public Bug",
    });
    const token = await seedSession("owner-user", 3003, repoId);

    const discloseRes = await ctx.app.request(`/api/projects/${projectId}/disclose`, {
      method: "POST",
      headers: {
        cookie: `ov_session=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ finding_ids: [findingId] }),
    });
    expect(discloseRes.status).toBe(200);
    const dBody = (await discloseRes.json()) as { disclosed_count: number };
    expect(dBody.disclosed_count).toBe(1);

    const [owner, repo] = fullName.split("/");
    const pub = await ctx.app.request(`/api/projects/${owner}/${repo}`);
    const pubBody = (await pub.json()) as { disclosed_findings: Array<{ title: string }> };
    expect(pubBody.disclosed_findings.some((f) => f.title === "Now Public Bug")).toBe(true);
  });
});
