import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { ServiceConfig } from "../../infra/config.js";
import { AppError } from "../../middleware/error-handler.js";
import {
  exchangeCodeForToken,
  fetchGithubUser,
  signOAuthState,
  verifyOAuthState,
} from "./github-oauth.js";
import * as storage from "./storage.js";

export const authRouter = new Hono();

const COOKIE = "ov_session";
const SESSION_TTL_DAYS = 7;

authRouter.get("/github/login", async (c) => {
  const cfg = c.get("config") as ServiceConfig;
  if (!cfg.githubOAuth.clientId || !cfg.githubOAuth.clientSecret) {
    throw new AppError("ERR_INTERNAL", { reason: "oauth_not_configured" });
  }
  const returnTo = c.req.query("return_to") || "/";
  const safeReturn = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  const state = signOAuthState(safeReturn, cfg.githubOAuth.stateSecret);
  const params = new URLSearchParams({
    client_id: cfg.githubOAuth.clientId,
    redirect_uri: cfg.githubOAuth.callbackUrl,
    scope: "read:user read:org public_repo",
    state,
  });
  return c.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

authRouter.get("/github/callback", async (c) => {
  const cfg = c.get("config") as ServiceConfig;
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) throw new AppError("ERR_VALIDATION", { reason: "missing_code_or_state" });
  const verified = verifyOAuthState(state, cfg.githubOAuth.stateSecret);
  if (!verified) throw new AppError("ERR_VALIDATION", { reason: "invalid_oauth_state" });

  const token = await exchangeCodeForToken(code, cfg);
  const ghUser = await fetchGithubUser(token);
  await storage.upsertIdentity({
    userId: ghUser.id,
    login: ghUser.login,
    avatarUrl: ghUser.avatar_url,
  });
  const { rawId, expiresAt } = await storage.createSession({
    githubUserId: ghUser.id,
    githubToken: token,
    ttlDays: SESSION_TTL_DAYS,
  });

  setCookie(c, COOKIE, rawId, {
    path: "/",
    httpOnly: true,
    secure: cfg.publicBaseUrl.startsWith("https"),
    sameSite: "Lax",
    expires: expiresAt,
  });
  return c.redirect(verified.returnTo);
});

authRouter.post("/logout", async (c) => {
  const raw = getCookie(c, COOKIE);
  if (raw) await storage.deleteSessionByRawId(raw);
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

authRouter.get("/me", async (c) => {
  const raw = getCookie(c, COOKIE);
  if (!raw) return c.json({ authenticated: false, user: null });
  const sess = await storage.getSessionByRawId(raw);
  if (!sess) {
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ authenticated: false, user: null });
  }
  await storage.touchSession(raw, SESSION_TTL_DAYS);
  return c.json({
    authenticated: true,
    user: {
      id: sess.githubUserId,
      login: sess.login,
      avatar_url: sess.avatarUrl,
    },
  });
});

export { COOKIE as SESSION_COOKIE_NAME, SESSION_TTL_DAYS };
