import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { SESSION_COOKIE } from "../../middleware/auth.js";
import { AppError } from "../../middleware/error-handler.js";
import * as service from "./service.js";
import * as sessionStore from "./session.js";

export const authRouter = new Hono();

// GET /api/auth/github/login?project=owner/repo
authRouter.get("/github/login", (c) => {
  const config = c.get("config");
  const project = service.parseProjectRef(c.req.query("project"));
  const { url } = service.beginOAuthLoginWithConfig(config, project);
  return c.redirect(url);
});

// GET /api/auth/github/callback?code=&state=
authRouter.get("/github/callback", async (c) => {
  const config = c.get("config");
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) throw new AppError("ERR_VALIDATION", { fields: ["code", "state"] });

  const result = await service.handleOAuthCallback(config, code, state);

  setCookie(c, SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: config.publicBaseUrl.startsWith("https"),
    expires: result.expiresAt,
  });

  return c.redirect(`${config.publicBaseUrl}${result.redirectPath}`);
});

// POST /api/auth/logout
authRouter.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await sessionStore.revokeSession(token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// GET /api/me
authRouter.get("/me", async (c) => {
  // mounted both under /api/auth and we also expose /api/me from server
  const user = c.get("user");
  if (!user) return c.json(service.anonymousMe());
  const me = await service.getMe(user.githubUserId, user.login, user.avatarUrl, user.isAdmin);
  return c.json(me);
});

export const meRouter = new Hono();
meRouter.get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json(service.anonymousMe());
  const me = await service.getMe(user.githubUserId, user.login, user.avatarUrl, user.isAdmin);
  return c.json(me);
});
