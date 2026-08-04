import { createHmac } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type TestContext,
  cleanTables,
  seedProject,
  setupTestApp,
} from "../../test/setup-db.js";
import type { AuthUser } from "../../middleware/auth.js";
import * as gh from "./github-oauth.js";
import { requireRepoAccess } from "./permission.js";
import * as storage from "./storage.js";

describe("auth oauth state", () => {
  const secret = "test-state-secret";

  it("round-trips relative return_to", () => {
    const state = gh.signOAuthState("/p/acme/widget", secret);
    const v = gh.verifyOAuthState(state, secret);
    expect(v).toEqual({ returnTo: "/p/acme/widget" });
  });

  it("rejects tampered signature", () => {
    const state = gh.signOAuthState("/ok", secret);
    const [payload] = state.split(".");
    expect(gh.verifyOAuthState(`${payload}.deadbeef`, secret)).toBeNull();
  });

  it("rejects open redirect return_to", () => {
    const payload = Buffer.from(
      JSON.stringify({ r: "https://evil.example/", e: Date.now() + 60_000 }),
      "utf8",
    ).toString("base64url");
    const sig = createHmac("sha256", secret).update(payload).digest("base64url");
    expect(gh.verifyOAuthState(`${payload}.${sig}`, secret)).toBeNull();

    const payload2 = Buffer.from(
      JSON.stringify({ r: "//evil.example/phish", e: Date.now() + 60_000 }),
      "utf8",
    ).toString("base64url");
    const sig2 = createHmac("sha256", secret).update(payload2).digest("base64url");
    expect(gh.verifyOAuthState(`${payload2}.${sig2}`, secret)).toBeNull();
  });

  it("allows whitelisted cross-origin return_to", () => {
    const allowed = ["https://zai-org-openvuln.hf.space"];
    const r = "https://zai-org-openvuln.hf.space/submit";
    const state = gh.signOAuthState(r, secret);
    const v = gh.verifyOAuthState(state, secret, allowed);
    expect(v).toEqual({ returnTo: r });
  });

  it("rejects non-whitelisted cross-origin return_to", () => {
    const allowed = ["https://zai-org-openvuln.hf.space"];
    const r = "https://evil.example/phish";
    const state = gh.signOAuthState(r, secret);
    expect(gh.verifyOAuthState(state, secret, allowed)).toBeNull();
  });

  it("rejects expired state", () => {
    const payload = Buffer.from(
      JSON.stringify({ r: "/ok", e: Date.now() - 1 }),
      "utf8",
    ).toString("base64url");
    const sig = createHmac("sha256", secret).update(payload).digest("base64url");
    expect(gh.verifyOAuthState(`${payload}.${sig}`, secret)).toBeNull();
  });
});

describe("auth session storage", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  beforeEach(async () => {
    await cleanTables();
  });

  it("stores token server-side; lookup by raw cookie id only", async () => {
    await storage.upsertIdentity({
      userId: 4242,
      login: "alice",
      avatarUrl: "https://avatars.example/a",
    });
    const { rawId } = await storage.createSession({
      githubUserId: 4242,
      githubToken: "gho_secret_token_xyz",
      ttlDays: 7,
    });

    const sess = await storage.getSessionByRawId(rawId);
    expect(sess).toMatchObject({
      githubUserId: 4242,
      login: "alice",
      githubToken: "gho_secret_token_xyz",
    });

    expect(await storage.getSessionByRawId("not-the-raw-id")).toBeNull();

    const me = await ctx.app.request("/api/me", {
      headers: { cookie: `ov_session=${rawId}` },
    });
    expect(me.status).toBe(200);
    const body = (await me.json()) as {
      authenticated: boolean;
      user: { login: string; id: number };
    };
    expect(body.authenticated).toBe(true);
    expect(body.user.login).toBe("alice");
    expect(JSON.stringify(body)).not.toContain("gho_secret");
    expect(JSON.stringify(body)).not.toContain("githubToken");

    await storage.deleteSessionByRawId(rawId);
    expect(await storage.getSessionByRawId(rawId)).toBeNull();
  });

  it("GET /api/me unauthenticated", async () => {
    const res = await ctx.app.request("/api/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: false, user: null });
  });
});

describe("requireRepoAccess", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  beforeEach(async () => {
    await cleanTables();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const user: AuthUser = {
    githubUserId: 99,
    login: "bob",
    avatarUrl: null,
    githubToken: "gho_bob",
  };

  it("allows admin and caches grant", async () => {
    await storage.upsertIdentity({ userId: 99, login: "bob", avatarUrl: null });
    const spy = vi.spyOn(gh, "fetchRepoPermission").mockResolvedValue("admin");
    const role = await requireRepoAccess(user, "acme", "widget", 12345, ctx.config);
    expect(role).toBe("admin");
    expect(spy).toHaveBeenCalledTimes(1);

    const role2 = await requireRepoAccess(user, "acme", "widget", 12345, ctx.config);
    expect(role2).toBe("admin");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("allows maintain", async () => {
    await storage.upsertIdentity({ userId: 99, login: "bob", avatarUrl: null });
    vi.spyOn(gh, "fetchRepoPermission").mockResolvedValue("maintain");
    await expect(requireRepoAccess(user, "acme", "lib", 55, ctx.config)).resolves.toBe(
      "maintain",
    );
  });

  it("denies write/read/none", async () => {
    await storage.upsertIdentity({ userId: 99, login: "bob", avatarUrl: null });
    for (const perm of ["write", "read", "none", "triage"] as const) {
      vi.spyOn(gh, "fetchRepoPermission").mockResolvedValue(perm);
      try {
        await requireRepoAccess(user, "acme", `r-${perm}`, 1000 + perm.length, ctx.config);
        expect.fail(`expected forbid for ${perm}`);
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as { code?: string }).code).toBe("ERR_FORBIDDEN");
      }
      vi.restoreAllMocks();
      await storage.upsertIdentity({ userId: 99, login: "bob", avatarUrl: null });
    }
  });

  it("owner findings 401 without session; 403 with session but no grant", async () => {
    const { projectId } = await seedProject({ fullName: "acme/locked" });
    const unauth = await ctx.app.request(`/api/projects/${projectId}/findings`);
    expect(unauth.status).toBe(401);

    await storage.upsertIdentity({ userId: 77, login: "carol", avatarUrl: null });
    const { rawId } = await storage.createSession({
      githubUserId: 77,
      githubToken: "gho_carol",
      ttlDays: 1,
    });
    vi.spyOn(gh, "fetchRepoPermission").mockResolvedValue("write");
    const res = await ctx.app.request(`/api/projects/${projectId}/findings`, {
      headers: { cookie: `ov_session=${rawId}` },
    });
    expect(res.status).toBe(403);
  });

  it("BUG-AUTH-1: GitHub 401 Bad credentials → 403 not 500", async () => {
    const { projectId } = await seedProject({ fullName: "acme/stranger" });
    await storage.upsertIdentity({ userId: 88, login: "stranger", avatarUrl: null });
    const { rawId } = await storage.createSession({
      githubUserId: 88,
      githubToken: "gho_bad",
      ttlDays: 1,
    });
    vi.spyOn(gh, "fetchRepoPermission").mockRejectedValue(
      new gh.GithubPermissionError("auth", 401, "GitHub permission API 401: Bad credentials"),
    );
    const res = await ctx.app.request(`/api/projects/${projectId}/findings`, {
      headers: { cookie: `ov_session=${rawId}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; context?: { reason?: string } } };
    expect(body.error.code).toBe("ERR_FORBIDDEN");
    expect(body.error.context?.reason).toBe("repo_permission_denied");
  });

  it("GitHub upstream failure → 502", async () => {
    await storage.upsertIdentity({ userId: 99, login: "bob", avatarUrl: null });
    vi.spyOn(gh, "fetchRepoPermission").mockRejectedValue(
      new gh.GithubPermissionError("upstream", 502, "GitHub permission API 502"),
    );
    await expect(requireRepoAccess(user, "acme", "up", 777, ctx.config)).rejects.toMatchObject({
      code: "ERR_UPSTREAM",
    });
  });
});
