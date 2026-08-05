import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { ServiceConfig } from "../../infra/config.js";
import { AppError } from "../../middleware/error-handler.js";
import {
  exchangeCodeForToken,
  fetchGithubPrimaryEmail,
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
  const returnToRaw = c.req.query("return_to") || "/";
  // Allow relative paths or whitelisted absolute origins (cross-origin deploy)
  let safeReturn = "/";
  if (returnToRaw.startsWith("/") && !returnToRaw.startsWith("//")) {
    safeReturn = returnToRaw;
  } else {
    try {
      const u = new URL(returnToRaw);
      const origin = `${u.protocol}//${u.host}`;
      if (cfg.corsAllowedOrigins.includes(origin)) safeReturn = returnToRaw;
    } catch {
      // invalid URL → fallback
    }
  }
  const state = signOAuthState(safeReturn, cfg.githubOAuth.stateSecret);
  const params = new URLSearchParams({
    client_id: cfg.githubOAuth.clientId,
    redirect_uri: cfg.githubOAuth.callbackUrl,
    scope: "read:user read:org public_repo user:email",
    state,
  });
  return c.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

authRouter.get("/github/callback", async (c) => {
  const cfg = c.get("config") as ServiceConfig;
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) throw new AppError("ERR_VALIDATION", { reason: "missing_code_or_state" });
  const verified = verifyOAuthState(state, cfg.githubOAuth.stateSecret, cfg.corsAllowedOrigins);
  if (!verified) throw new AppError("ERR_VALIDATION", { reason: "invalid_oauth_state" });

  const token = await exchangeCodeForToken(code, cfg);
  const ghUser = await fetchGithubUser(token);
  let email: string | null = null;
  try {
    email = await fetchGithubPrimaryEmail(token);
  } catch {
    email = null;
  }
  await storage.upsertIdentity({
    userId: ghUser.id,
    login: ghUser.login,
    avatarUrl: ghUser.avatar_url,
    email,
  });
  const { rawId, expiresAt } = await storage.createSession({
    githubUserId: ghUser.id,
    githubToken: token,
    ttlDays: SESSION_TTL_DAYS,
  });

  // Cross-origin: SameSite=None+Secure so HF-space pages can send cookie
  setCookie(c, COOKIE, rawId, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "None",
    expires: expiresAt,
  });
  return c.redirect(verified.returnTo);
});

authRouter.post("/logout", async (c) => {
  const raw = getCookie(c, COOKIE);
  if (raw) await storage.deleteSessionByRawId(raw);
  deleteCookie(c, COOKIE, {
    path: "/",
    secure: true,
    sameSite: "None",
  });
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
