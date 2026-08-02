import { beforeEach, describe, expect, it } from "vitest";
import { type TestContext, cleanTables, seedProject, setupTestApp } from "../../test/setup-db.js";
import { scanQueueInternal } from "../scans/index.js";
import { countArtifactsForProject } from "./artifacts-storage.js";

describe("artifact harvest on completed sync", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestApp();
    await cleanTables();
  });

  it("stores mock poc/exp text for confirmed findings", async () => {
    const { projectId } = await seedProject({ fullName: "acme/art-harvest" });
    const jobId = crypto.randomUUID();
    await ctx.db`
      INSERT INTO scan_jobs (id, project_id, state)
      VALUES (${jobId}::uuid, ${projectId}::uuid, 'scanning')
    `;

    const { taskId } = await ctx.mockVh.createScanTask({
      gitUrl: "https://github.com/acme/art-harvest",
      displayName: "acme/art-harvest #test",
    });
    ctx.mockVh.forceState(taskId, "completed");

    await ctx.db`
      UPDATE scan_jobs SET vulnhunter_task_id = ${taskId}::uuid WHERE id = ${jobId}::uuid
    `;

    // Drive completed path via pollOnce
    await scanQueueInternal.pollOnce(3);

    const n = await countArtifactsForProject(projectId);
    // mock-rce: poc + exp; mock-sqli: poc → at least 3
    expect(n).toBeGreaterThanOrEqual(3);

    const rows = await ctx.db<
      { kind: string; file_name: string; content: string | null; is_binary: boolean }[]
    >`
      SELECT kind, file_name, content, is_binary FROM finding_artifacts
      WHERE project_id = ${projectId}::uuid
      ORDER BY kind, file_name
    `;
    const pocs = rows.filter((r) => r.kind === "poc");
    expect(pocs.length).toBeGreaterThanOrEqual(2);
    // Text stored as OVENC1 — never plaintext
    expect(pocs.every((r) => r.content && r.content.startsWith("OVENC1."))).toBe(true);
    expect(pocs.every((r) => r.content && !r.content.includes("PoC for"))).toBe(true);
    expect(rows.some((r) => r.kind === "exp" && r.file_name === "exp.py")).toBe(true);

    // report-package includes artifacts ciphertext
    const pkg = await ctx.app.request(`/api/admin/projects/${projectId}/report-package`, {
      headers: { authorization: "Bearer test-admin-token" },
    });
    expect(pkg.status).toBe(200);
    const body = (await pkg.json()) as { artifacts: Array<{ enc_content: string | null }> };
    expect(body.artifacts.length).toBeGreaterThanOrEqual(3);
    expect(
      body.artifacts.filter((a) => a.enc_content?.startsWith("OVENC1.")).length,
    ).toBeGreaterThanOrEqual(3);
  });
});
