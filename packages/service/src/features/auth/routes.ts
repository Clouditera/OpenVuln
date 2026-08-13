import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { ServiceConfig } from "../../infra/config.js";
import { logger } from "../../infra/logger.js";
import { AppError } from "../../middleware/error-handler.js";
import {
  exchangeCodeForToken,
  fetchGithubPrimaryEmail,
  fetchGithubUser,
  OAuthError,
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
  if (!code || !state) {
    // GitHub sends error param when user denies authorization
    const ghError = c.req.query("error");
    if (ghError === "access_denied") {
      return renderOAuthError(c, "authorization_cancelled", "You cancelled the GitHub authorization. You can close this tab and try again.");
    }
    return renderOAuthError(c, "missing_params", "Missing authorization code or state parameter.");
  }
  const verified = verifyOAuthState(state, cfg.githubOAuth.stateSecret, cfg.corsAllowedOrigins);
  if (!verified) {
    return renderOAuthError(c, "invalid_state", "Login session expired or invalid. Please try signing in again.");
  }

  // ── Domain relay (fish No.1890) ──────────────────────────────────────────
  // GitHub App has ONE registered callback domain, but the session cookie is
  // host-only: exchange must complete on the domain whose front-end will use
  // it. Exchange-origin front-ends (reverse-proxy /api/*) exchange on their
  // own domain; everyone else (HF, main site) exchanges on canonicalOrigin.
  const relay = c.req.query("relay") === "1";
  const targetOrigin = exchangeOriginFor(verified.returnTo, cfg);
  if (!relay) {
    // Compare by host: proxy chains may rewrite/lose the original proto
    // (web container serves plain HTTP behind TLS-terminating nginx).
    const current = requestOrigin(c);
    let targetHost = "";
    try {
      targetHost = new URL(targetOrigin).host;
    } catch {
      targetHost = targetOrigin;
    }
    if (requestHost(c) !== targetHost) {
      const url = new URL(`${targetOrigin}/api/auth/github/callback`);
      url.searchParams.set("code", code);
      url.searchParams.set("state", state);
      url.searchParams.set("relay", "1");
      logger.info({ from: current, to: targetOrigin }, "OAuth callback relay");
      return c.redirect(url.toString());
    }
  }
  // relay=1 → exchange unconditionally (loop guard; proxies may rewrite Host).

  try {
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

    setCookie(c, COOKIE, rawId, {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "None",
      expires: expiresAt,
    });
    return c.redirect(verified.returnTo);
  } catch (err) {
    if (err instanceof OAuthError) {
      return renderOAuthError(c, err.code, err.message);
    }
    logger.error({ err }, "OAuth callback unexpected error");
    return renderOAuthError(c, "internal", "An unexpected error occurred during sign-in. Please try again.");
  }
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

/** Host of the incoming request (best-effort behind reverse proxies). */
function requestHost(c: import("hono").Context): string {
  return (
    c.req.header("x-forwarded-host")?.split(",")[0]?.trim() ||
    c.req.header("host") ||
    ""
  );
}

/** Origin of the incoming request (logging only). */
function requestOrigin(c: import("hono").Context): string {
  const proto =
    c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  return `${proto}://${requestHost(c)}`;
}

/**
 * Where the OAuth code exchange must complete for a given return_to.
 * Relative paths → canonical; absolute origins in exchangeOrigins → that origin;
 * any other whitelisted origin (HF etc.) → canonical.
 */
function exchangeOriginFor(returnTo: string, cfg: ServiceConfig): string {
  if (returnTo.startsWith("/") && !returnTo.startsWith("//")) {
    return cfg.githubOAuth.canonicalOrigin;
  }
  try {
    const u = new URL(returnTo);
    const origin = `${u.protocol}//${u.host}`;
    if (cfg.githubOAuth.exchangeOrigins.includes(origin)) return origin;
  } catch {
    // fall through
  }
  return cfg.githubOAuth.canonicalOrigin;
}

/** Render a human-readable OAuth error page (for popup/redirect context). */
function renderOAuthError(c: import("hono").Context, code: string, message: string) {
  logger.warn({ code, message }, "OAuth error rendered to user");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign-in error — OpenVuln</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#000;color:#f0f2f6;font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:2rem}
.box{max-width:420px}
h1{font-size:1.25rem;font-weight:600;margin:0 0 .75rem}
p{color:#acacb0;font-size:.9rem;line-height:1.5;margin:0 0 1.5rem}
code{display:inline-block;padding:2px 6px;border-radius:4px;background:#1a1a1e;color:#696a70;font-size:.8rem;margin-top:.5rem}
</style>
</head>
<body>
<div class="box">
<h1>⚠️ Sign-in error</h1>
<p>${message.replace(/</g, "&lt;")}</p>
<code>${code}</code>
</div>
</body>
</html>`;
  return c.html(html, 502);
}
