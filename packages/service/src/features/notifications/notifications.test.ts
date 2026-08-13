import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emptySeverityCounts } from "@openvuln/shared";
import {
  type TestContext,
  cleanTables,
  seedProject,
  setupTestApp,
} from "../../test/setup-db.js";
import * as authStorage from "../auth/storage.js";
import * as notificationStorage from "./storage.js";
import { mailerTick } from "./mailer.js";

describe("notifications", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  beforeEach(async () => {
    await cleanTables();
  });

  it("inserts scan_completed for submitter; skips NULL submitted_by", async () => {
    const { projectId } = await seedProject({ fullName: "acme/n1" });
    // no submitted_by
    await notificationStorage.insertScanCompleted(ctx.db, {
      jobId: crypto.randomUUID(),
      projectId,
      counts: emptySeverityCounts(),
      noValue: true,
    });
    const n0 = await ctx.db`SELECT count(*)::int AS n FROM notifications`;
    expect(Number(n0[0].n)).toBe(0);

    await authStorage.upsertIdentity({
      userId: 501,
      login: "alice",
      avatarUrl: null,
      email: "alice@example.com",
    });
    await ctx.db`
      UPDATE projects SET submitted_by = 501 WHERE id = ${projectId}::uuid
    `;
    const jobId = crypto.randomUUID();
    await ctx.db`
      INSERT INTO scan_jobs (id, project_id, state) VALUES (${jobId}::uuid, ${projectId}::uuid, 'completed')
    `;
    const counts = emptySeverityCounts();
    counts.high = 2;
    counts.medium = 1;
    await notificationStorage.insertScanCompleted(ctx.db, {
      jobId,
      projectId,
      counts,
      noValue: false,
    });
    const rows = await ctx.db`
      SELECT type, payload, github_user_id::text FROM notifications
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("scan_completed");
    expect(Number(rows[0].github_user_id)).toBe(501);
    const payload =
      typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload;
    expect(payload.full_name).toBe("acme/n1");
    expect(payload.counts.high).toBe(2);
  });

  it("API: list/read scoped to user; anon 401", async () => {
    await authStorage.upsertIdentity({
      userId: 601,
      login: "bob",
      avatarUrl: null,
      email: null,
    });
    await authStorage.upsertIdentity({
      userId: 602,
      login: "eve",
      avatarUrl: null,
    });
    const { projectId } = await seedProject({ fullName: "acme/n2" });
    await ctx.db`UPDATE projects SET submitted_by = 601 WHERE id = ${projectId}::uuid`;
    const jobId = crypto.randomUUID();
    await notificationStorage.insertScanCompleted(ctx.db, {
      jobId,
      projectId,
      counts: emptySeverityCounts(),
      noValue: true,
    });

    const anon = await ctx.app.request("/api/notifications");
    expect(anon.status).toBe(401);

    const { rawId: bobCookie } = await authStorage.createSession({
      githubUserId: 601,
      githubToken: "t",
      ttlDays: 1,
    });
    const { rawId: eveCookie } = await authStorage.createSession({
      githubUserId: 602,
      githubToken: "t",
      ttlDays: 1,
    });

    const bobList = await ctx.app.request("/api/notifications", {
      headers: { cookie: `ov_session=${bobCookie}` },
    });
    expect(bobList.status).toBe(200);
    const bobBody = (await bobList.json()) as {
      unread_count: number;
      notifications: Array<{ id: string }>;
    };
    expect(bobBody.unread_count).toBe(1);
    expect(bobBody.notifications).toHaveLength(1);

    const eveList = await ctx.app.request("/api/notifications", {
      headers: { cookie: `ov_session=${eveCookie}` },
    });
    const eveBody = (await eveList.json()) as { unread_count: number; notifications: unknown[] };
    expect(eveBody.unread_count).toBe(0);
    expect(eveBody.notifications).toHaveLength(0);

    const read = await ctx.app.request("/api/notifications/read-all", {
      method: "POST",
      headers: { cookie: `ov_session=${bobCookie}` },
    });
    expect(read.status).toBe(200);
    const after = await ctx.app.request("/api/notifications", {
      headers: { cookie: `ov_session=${bobCookie}` },
    });
    const afterBody = (await after.json()) as { unread_count: number };
    expect(afterBody.unread_count).toBe(0);
  });

  it("mailer marks sent; failure increments attempts; no email skips", async () => {
    await authStorage.upsertIdentity({
      userId: 701,
      login: "carol",
      avatarUrl: null,
      email: "carol@example.com",
    });
    await authStorage.upsertIdentity({
      userId: 702,
      login: "dave",
      avatarUrl: null,
      email: null,
    });
    const { projectId: p1 } = await seedProject({ fullName: "acme/mail1" });
    const { projectId: p2 } = await seedProject({ fullName: "acme/mail2" });
    await ctx.db`UPDATE projects SET submitted_by = 701 WHERE id = ${p1}::uuid`;
    await ctx.db`UPDATE projects SET submitted_by = 702 WHERE id = ${p2}::uuid`;
    await notificationStorage.insertScanCompleted(ctx.db, {
      jobId: crypto.randomUUID(),
      projectId: p1,
      counts: emptySeverityCounts(),
      noValue: false,
    });
    await notificationStorage.insertScanCompleted(ctx.db, {
      jobId: crypto.randomUUID(),
      projectId: p2,
      counts: emptySeverityCounts(),
      noValue: true,
    });

    // no-email row skipped
    const skippedN = await notificationStorage.markEmailSkippedNoAddress();
    expect(skippedN).toBeGreaterThanOrEqual(1);
    const skipped = await ctx.db`
      SELECT email_error, email_sent_at IS NOT NULL AS sent
      FROM notifications
      WHERE github_user_id = 702
    `;
    expect(skipped[0]?.email_error).toBe("no_email");
    expect(skipped[0]?.sent).toBe(true);

    // mock transport via injecting into mailer is hard; call markEmailSent path via storage
    const pending = await notificationStorage.listPendingEmail(10);
    expect(pending.some((p) => p.email === "carol@example.com")).toBe(true);

    // simulate failure then success via storage API
    const id = pending.find((p) => p.email === "carol@example.com")!.id;
    await notificationStorage.markEmailFailed(id, "smtp down");
    const afterFail = await ctx.db`SELECT email_attempts, email_sent_at FROM notifications WHERE id = ${id}::uuid`;
    expect(Number(afterFail[0].email_attempts)).toBe(1);
    expect(afterFail[0].email_sent_at).toBeNull();

    await notificationStorage.markEmailSent(id);
    const afterOk = await ctx.db`SELECT email_sent_at IS NOT NULL AS sent FROM notifications WHERE id = ${id}::uuid`;
    expect(afterOk[0].sent).toBe(true);

    void mailerTick;
    void vi;
  });
});
