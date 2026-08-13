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

// Mock GitHub network calls only; keep real sign/verify for state.
vi.mock("./github-oauth.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./github-oauth.js")>();
  return {
    ...orig,
    exchangeCodeForToken: vi.fn().mockResolvedValue("gho_test_token"),
    fetchGithubUser: vi.fn().mockResolvedValue({
      id: 4242,
      login: "relay-user",
      avatar_url: "https://avatars.example/relay",
    }),
    fetchGithubPrimaryEmail: vi.fn().mockResolvedValue("relay@example.com"),
  };
});

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

describe("oauth callback domain relay", () => {
  let ctx: TestContext;
  const CANONICAL = "https://openvuln.example";
  const CHATGLM = "https://security.chatglm.site";
  const HF = "https://zai-org-openvuln.static.hf.space";

  beforeAll(async () => {
    ctx = await setupTestApp();
    ctx.config.githubOAuth.canonicalOrigin = CANONICAL;
    ctx.config.githubOAuth.exchangeOrigins = [CHATGLM];
    ctx.config.corsAllowedOrigins = [CHATGLM, HF];
  });

  beforeEach(async () => {
    await cleanTables();
    vi.mocked(gh.exchangeCodeForToken).mockClear();
  });

  function signState(returnTo: string): string {
    return gh.signOAuthState(returnTo, ctx.config.githubOAuth.stateSecret);
  }

  function callbackUrl(params: Record<string, string>): string {
    const q = new URLSearchParams(params);
    return `/api/auth/github/callback?${q.toString()}`;
  }

  it("chatglm origin + HF return_to → 302 relay to canonical with relay=1 (no exchange)", async () => {
    const state = signState(`${HF}/`);
    const res = await ctx.app.request(
      callbackUrl({ code: "c1", state }),
      { headers: { host: "security.chatglm.site", "x-forwarded-proto": "https" } },
    );
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc.startsWith(`${CANONICAL}/api/auth/github/callback?`)).toBe(true);
    const u = new URL(loc);
    expect(u.searchParams.get("relay")).toBe("1");
    expect(u.searchParams.get("code")).toBe("c1");
    expect(u.searchParams.get("state")).toBe(state);
    expect(vi.mocked(gh.exchangeCodeForToken)).not.toHaveBeenCalled();
  });

  it("chatglm origin + relative return_to → 302 relay to canonical", async () => {
    const state = signState("/my");
    const res = await ctx.app.request(
      callbackUrl({ code: "c2", state }),
      { headers: { host: "security.chatglm.site", "x-forwarded-proto": "https" } },
    );
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc.startsWith(`${CANONICAL}/api/auth/github/callback?`)).toBe(true);
    expect(new URL(loc).searchParams.get("relay")).toBe("1");
    expect(vi.mocked(gh.exchangeCodeForToken)).not.toHaveBeenCalled();
  });

  it("chatglm origin + chatglm return_to → exchange in place, cookie set, redirect to return_to", async () => {
    const state = signState(`${CHATGLM}/app`);
    const res = await ctx.app.request(
      callbackUrl({ code: "c3", state }),
      { headers: { host: "security.chatglm.site", "x-forwarded-proto": "https" } },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${CHATGLM}/app`);
    expect(res.headers.get("set-cookie") ?? "").toContain("ov_session=");
    expect(vi.mocked(gh.exchangeCodeForToken)).toHaveBeenCalledTimes(1);
  });

  it("relay=1 forces exchange regardless of origin (loop guard)", async () => {
    const state = signState(`${HF}/done`);
    const res = await ctx.app.request(
      callbackUrl({ code: "c4", state, relay: "1" }),
      { headers: { host: "security.chatglm.site", "x-forwarded-proto": "https" } },
    );
    expect(res.status).toBe(302);
    // Final redirect goes to return_to, NOT another callback hop
    expect(res.headers.get("location")).toBe(`${HF}/done`);
    expect(vi.mocked(gh.exchangeCodeForToken)).toHaveBeenCalledTimes(1);
  });

  it("non-whitelisted return_to still rejected (no relay, no exchange)", async () => {
    const state = signState("https://evil.example/phish");
    const res = await ctx.app.request(
      callbackUrl({ code: "c5", state }),
      { headers: { host: "security.chatglm.site", "x-forwarded-proto": "https" } },
    );
    expect(res.status).toBe(502);
    expect(vi.mocked(gh.exchangeCodeForToken)).not.toHaveBeenCalled();
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
