/**
 * Post-OVENC1 E2E: plaintext sync → package → signed disclose (legacy) → public title.
 * Also covers disclosure retain-by-key on retry.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  signDiscloseBody,
  type DiscloseBody,
  newNonce,
} from "@openvuln/shared/crypto";
import {
  setupTestApp,
  cleanTables,
  seedProject,
  type TestContext,
} from "../../test/setup-db.js";
import { scanStorage, scanQueueInternal } from "../scans/index.js";

describe("plaintext + disclose e2e", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  beforeEach(async () => {
    await cleanTables();
  });

  it("scan stores plaintext findings; package has title; disclose reveals publicly", async () => {
    const { projectId } = await seedProject({ fullName: "acme/crypto" });
    const job = await scanStorage.createScanJob(projectId, "deadbeef");
    await scanStorage.approveScanJob(job.id);
    await scanQueueInternal.dispatchOnce(2);
    const after = await scanStorage.getScanJob(job.id);
    ctx.mockVh.forceState(after!.vulnhunter_task_id!, "completed");
    await scanQueueInternal.pollOnce();

    const pkgRes = await ctx.app.request(
      `/api/admin/projects/${projectId}/report-package`,
      { headers: { authorization: "Bearer test-admin-token" } },
    );
    expect(pkgRes.status).toBe(200);
    const pkg = (await pkgRes.json()) as {
      items: Array<{
        id: string;
        finding_key: string;
        title: string;
        disclosure_state: string;
      }>;
    };
    expect(pkg.items.length).toBeGreaterThanOrEqual(1);
    expect(pkg.items[0].title.length).toBeGreaterThan(0);
    // no OVENC1 envelopes in package
    expect(JSON.stringify(pkg)).not.toContain("OVENC1.");

    const first = pkg.items[0];

    const pub0 = await ctx.app.request(`/api/projects/acme/crypto`);
    const body0 = (await pub0.json()) as { disclosed_findings: unknown[] };
    expect(body0.disclosed_findings).toHaveLength(0);

    // Legacy signed admin disclose still works while ADMIN_PUBLIC_KEY present
    const body: DiscloseBody = {
      action: "disclose",
      project_id: projectId,
      items: [
        {
          finding_id: first.id,
          title: first.title,
          cwe: "CWE-89",
          summary: "Operator confirmed",
        },
      ],
      timestamp: Math.floor(Date.now() / 1000),
      nonce: newNonce(),
    };
    const sig = signDiscloseBody(ctx.adminKeys.privateKeyPem, body);
    const dRes = await ctx.app.request(`/api/admin/projects/${projectId}/disclose`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-admin-token",
        "content-type": "application/json",
        "x-ov-signature": sig,
      },
      body: JSON.stringify(body),
    });
    expect(dRes.status).toBe(200);

    const replay = await ctx.app.request(`/api/admin/projects/${projectId}/disclose`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-admin-token",
        "content-type": "application/json",
        "x-ov-signature": sig,
      },
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(409);

    const pub1 = await ctx.app.request(`/api/projects/acme/crypto`);
    const body1 = (await pub1.json()) as {
      disclosed_findings: Array<{ title: string }>;
    };
    expect(body1.disclosed_findings.some((f) => f.title === first.title)).toBe(true);
  });

  it("C8b: retry/rescan keeps disclosed by stable finding_key", async () => {
    const { projectId, fullName } = await seedProject({ fullName: "acme/retain" });
    const job = await scanStorage.createScanJob(projectId, "sha1");
    await scanStorage.approveScanJob(job.id);
    await scanQueueInternal.dispatchOnce(2);
    let row = await scanStorage.getScanJob(job.id);
    ctx.mockVh.forceState(row!.vulnhunter_task_id!, "completed");
    await scanQueueInternal.pollOnce();

    const pkgRes = await ctx.app.request(
      `/api/admin/projects/${projectId}/report-package`,
      { headers: { authorization: "Bearer test-admin-token" } },
    );
    const pkg = (await pkgRes.json()) as {
      items: Array<{ id: string; finding_key: string; title: string }>;
    };
    const sqli = pkg.items.find((i) => i.finding_key === "mock-sqli");
    expect(sqli).toBeTruthy();

    const body: DiscloseBody = {
      action: "disclose",
      project_id: projectId,
      items: [{ finding_id: sqli!.id, title: sqli!.title, cwe: "CWE-89" }],
      timestamp: Math.floor(Date.now() / 1000),
      nonce: newNonce(),
    };
    const sig = signDiscloseBody(ctx.adminKeys.privateKeyPem, body);
    const dRes = await ctx.app.request(`/api/admin/projects/${projectId}/disclose`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-admin-token",
        "content-type": "application/json",
        "x-ov-signature": sig,
      },
      body: JSON.stringify(body),
    });
    expect(dRes.status).toBe(200);

    await ctx.db`
      UPDATE scan_jobs SET state = 'failed', fail_reason_internal = 'boom', finished_at = now()
      WHERE id = ${job.id}::uuid
    `;
    await scanStorage.retryScanJob(job.id);
    await scanQueueInternal.dispatchOnce(2);
    row = await scanStorage.getScanJob(job.id);
    ctx.mockVh.forceState(row!.vulnhunter_task_id!, "completed");
    await scanQueueInternal.pollOnce();

    const [owner, repo] = fullName.split("/");
    const pub = await ctx.app.request(`/api/projects/${owner}/${repo}`);
    const pubBody = (await pub.json()) as {
      disclosed_findings: Array<{ title: string; finding_key: string }>;
      severity_counts: Record<string, number>;
    };
    expect(pubBody.disclosed_findings.some((f) => f.title === sqli!.title)).toBe(true);
    const total =
      (pubBody.severity_counts.critical ?? 0) +
      (pubBody.severity_counts.high ?? 0) +
      (pubBody.severity_counts.medium ?? 0) +
      (pubBody.severity_counts.low ?? 0);
    expect(total).toBe(3);
  });

  it("rejects bad signature", async () => {
    const { projectId } = await seedProject({ fullName: "acme/badsig" });
    const body: DiscloseBody = {
      action: "disclose",
      project_id: projectId,
      items: [
        {
          finding_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          title: "x",
        },
      ],
      timestamp: Math.floor(Date.now() / 1000),
      nonce: newNonce(),
    };
    const res = await ctx.app.request(`/api/admin/projects/${projectId}/disclose`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-admin-token",
        "content-type": "application/json",
        "x-ov-signature": "not-a-real-signature",
      },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(401);
  });
});
