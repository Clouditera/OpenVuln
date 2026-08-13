import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  setupTestApp,
  cleanTables,
  seedProject,
  seedScanJob,
  seedFinding,
  type TestContext,
} from "../../test/setup-db.js";

describe("public disclosure report", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  beforeEach(async () => {
    await cleanTables();
  });

  it("downloads markdown with only disclosed findings", async () => {
    const { projectId } = await seedProject({ fullName: "acme/report-me" });
    const scanId = await seedScanJob(projectId);
    await seedFinding(projectId, scanId, {
      key: "secret",
      disclosure: "owner_only",
      title: "OWNER ONLY SECRET TITLE",
    });
    await seedFinding(projectId, scanId, {
      key: "public",
      disclosure: "disclosed",
      title: "Public XSS",
    });

    const res = await ctx.app.request(
      `/api/projects/${projectId}/report?format=markdown`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/markdown/);
    expect(res.headers.get("content-disposition")).toMatch(/attachment/);
    expect(res.headers.get("content-disposition")).toMatch(/\.md/);

    const text = await res.text();
    expect(text).toContain("# OpenVuln Disclosure Report");
    expect(text).toContain("acme/report-me");
    expect(text).toContain("Public XSS");
    expect(text).not.toContain("OWNER ONLY SECRET TITLE");
    expect(text).not.toContain("src/secret.ts");
    expect(text).not.toContain("should never leak publicly");
  });

  it("downloads json without sensitive fields", async () => {
    const { projectId } = await seedProject({ fullName: "acme/json-report" });
    const scanId = await seedScanJob(projectId);
    await seedFinding(projectId, scanId, {
      key: "d1",
      disclosure: "disclosed",
      title: "Disclosed Bug",
    });

    const res = await ctx.app.request(`/api/projects/${projectId}/report?format=json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/json/);
    expect(res.headers.get("content-disposition")).toMatch(/\.json/);

    const body = (await res.json()) as {
      disclosed_count: number;
      findings: Array<Record<string, unknown>>;
    };
    expect(body.disclosed_count).toBe(1);
    expect(body.findings[0].title).toBe("Disclosed Bug");
    expect(body.findings[0].finding_key).toBe("d1");
    expect(body.findings[0]).not.toHaveProperty("primary_file");
    expect(body.findings[0]).not.toHaveProperty("detail");
    expect(body.findings[0]).not.toHaveProperty("detail_json");
    const dumped = JSON.stringify(body);
    expect(dumped).not.toContain("src/secret.ts");
  });

  it("downloads single disclosed finding report", async () => {
    const { projectId } = await seedProject({ fullName: "acme/single" });
    const scanId = await seedScanJob(projectId);
    await seedFinding(projectId, scanId, {
      key: "only-public",
      disclosure: "disclosed",
      title: "Solo Finding",
    });
    await seedFinding(projectId, scanId, {
      key: "hidden",
      disclosure: "owner_only",
      title: "HIDDEN TITLE",
    });

    const res = await ctx.app.request(
      `/api/projects/${projectId}/report/only-public?format=markdown`,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("# Solo Finding");
    expect(text).toContain("only-public");
    expect(text).not.toContain("HIDDEN TITLE");
    expect(text).not.toContain("src/secret.ts");

    const jsonRes = await ctx.app.request(
      `/api/projects/${projectId}/report/only-public?format=json`,
    );
    expect(jsonRes.status).toBe(200);
    const body = (await jsonRes.json()) as { finding: { title: string } };
    expect(body.finding.title).toBe("Solo Finding");
  });

  it("404 for owner_only finding key (no existence leak)", async () => {
    const { projectId } = await seedProject({ fullName: "acme/hidden-key" });
    const scanId = await seedScanJob(projectId);
    await seedFinding(projectId, scanId, {
      key: "secret-key",
      disclosure: "owner_only",
      title: "Secret",
    });

    const res = await ctx.app.request(
      `/api/projects/${projectId}/report/secret-key?format=markdown`,
    );
    expect(res.status).toBe(404);
  });

  it("zip packs index + per-finding files, disclosed only", async () => {
    const { projectId } = await seedProject({ fullName: "acme/zip-me" });
    const scanId = await seedScanJob(projectId);
    await seedFinding(projectId, scanId, {
      key: "a-public",
      disclosure: "disclosed",
      title: "Alpha Bug",
    });
    await seedFinding(projectId, scanId, {
      key: "b-public",
      disclosure: "disclosed",
      title: "Beta Bug",
    });
    await seedFinding(projectId, scanId, {
      key: "c-secret",
      disclosure: "owner_only",
      title: "SECRET IN ZIP",
    });

    const res = await ctx.app.request(`/api/projects/${projectId}/report?format=zip`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/zip/);
    expect(res.headers.get("content-disposition")).toMatch(/\.zip/);

    const buf = new Uint8Array(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files).sort();

    expect(names).toContain("index.md");
    expect(names).toContain("index.json");
    expect(names).toContain("README.md");
    expect(names.some((n) => n.startsWith("findings/") && n.endsWith(".md"))).toBe(true);

    const indexMd = await zip.file("index.md")!.async("string");
    expect(indexMd).toContain("Alpha Bug");
    expect(indexMd).toContain("Beta Bug");
    expect(indexMd).not.toContain("SECRET IN ZIP");

    // two disclosed findings → 2 md + 2 json under findings/
    const findingFiles = names.filter((n) => n.startsWith("findings/") && !n.endsWith("/"));
    expect(findingFiles.length).toBe(4);

    const dumped = await Promise.all(
      findingFiles.map(async (n) => zip.file(n)!.async("string")),
    );
    const all = dumped.join("\n");
    expect(all).not.toContain("SECRET IN ZIP");
    expect(all).not.toContain("src/secret.ts");
  });

  it("rejects bad format and bad id", async () => {
    const { projectId } = await seedProject();
    const badFmt = await ctx.app.request(
      `/api/projects/${projectId}/report?format=pdf`,
    );
    expect(badFmt.status).toBe(422);

    const badId = await ctx.app.request(`/api/projects/not-a-uuid/report`);
    expect(badId.status).toBe(422);
  });

  it("404 for missing project", async () => {
    const res = await ctx.app.request(
      `/api/projects/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/report?format=json`,
    );
    expect(res.status).toBe(404);
  });
});
