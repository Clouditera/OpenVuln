/**
 * Crypto channel E2E: encrypt on sync → package → sign disclose → public sees title.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  signDiscloseBody,
  decryptForAdmin,
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

describe("crypto admin channel e2e", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  beforeEach(async () => {
    await cleanTables();
  });

  it("scan encrypts findings; package has ciphertext; disclose reveals title", async () => {
    const { projectId } = await seedProject({ fullName: "acme/crypto" });
    const job = await scanStorage.createScanJob(projectId, "deadbeef");
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
        finding_id: string;
        finding_key: string;
        enc_payload: string;
        disclosure_state: string;
      }>;
    };
    expect(pkg.items.length).toBeGreaterThanOrEqual(1);
    expect(pkg.items[0].enc_payload.startsWith("OVENC1.")).toBe(true);
    const dumped = JSON.stringify(pkg);
    expect(dumped).not.toContain("descript");
    expect(dumped).not.toContain("primary_file");

    const first = pkg.items[0];
    const plain = decryptForAdmin(
      ctx.adminKeys.privateKeyPem,
      first.finding_id,
      first.enc_payload,
    );
    expect(plain.title.length).toBeGreaterThan(0);

    const pub0 = await ctx.app.request(`/api/projects/acme/crypto`);
    const body0 = (await pub0.json()) as { disclosed_findings: unknown[] };
    expect(body0.disclosed_findings).toHaveLength(0);

    const body: DiscloseBody = {
      action: "disclose",
      project_id: projectId,
      items: [
        {
          finding_id: first.finding_id,
          title: plain.title,
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
    expect(body1.disclosed_findings.some((f) => f.title === plain.title)).toBe(true);
    expect(JSON.stringify(body1)).not.toContain("enc_payload");
  });

  it("C8b: retry/rescan keeps disclosed by stable finding_key", async () => {
    const { projectId, fullName } = await seedProject({ fullName: "acme/retain" });
    const job = await scanStorage.createScanJob(projectId, "sha1");
    await scanQueueInternal.dispatchOnce(2);
    let row = await scanStorage.getScanJob(job.id);
    ctx.mockVh.forceState(row!.vulnhunter_task_id!, "completed");
    await scanQueueInternal.pollOnce();

    const pkgRes = await ctx.app.request(
      `/api/admin/projects/${projectId}/report-package`,
      { headers: { authorization: "Bearer test-admin-token" } },
    );
    const pkg = (await pkgRes.json()) as {
      items: Array<{ finding_id: string; finding_key: string; enc_payload: string }>;
    };
    const sqli = pkg.items.find((i) => i.finding_key === "mock-sqli");
    expect(sqli).toBeTruthy();
    const plain = decryptForAdmin(
      ctx.adminKeys.privateKeyPem,
      sqli!.finding_id,
      sqli!.enc_payload,
    );

    const body: DiscloseBody = {
      action: "disclose",
      project_id: projectId,
      items: [{ finding_id: sqli!.finding_id, title: plain.title, cwe: "CWE-89" }],
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

    // fail + retry + complete again (new VH task, same stable keys)
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
    expect(pubBody.disclosed_findings.some((f) => f.title === plain.title)).toBe(true);
    const total =
      (pubBody.severity_counts.critical ?? 0) +
      (pubBody.severity_counts.high ?? 0) +
      (pubBody.severity_counts.medium ?? 0) +
      (pubBody.severity_counts.low ?? 0);
    expect(total).toBe(3); // no double-count after retry
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
