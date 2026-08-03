import { Hono } from "hono";
import { requireAuth } from "../../middleware/auth.js";
import { AppError } from "../../middleware/error-handler.js";
import * as storage from "./storage.js";

export const notificationsRouter = new Hono();

notificationsRouter.use("*", requireAuth);

// GET /api/notifications?limit=
notificationsRouter.get("/", async (c) => {
  const user = c.get("user");
  if (!user) throw new AppError("ERR_UNAUTHORIZED", { reason: "login_required" });
  const limit = Number(c.req.query("limit") ?? "20");
  const result = await storage.listForUser(user.githubUserId, limit);
  return c.json({
    unread_count: result.unread_count,
    items: result.items.map((it) => ({
      id: it.id,
      type: it.type,
      payload: it.payload,
      read_at: it.read_at?.toISOString() ?? null,
      created_at: it.created_at.toISOString(),
    })),
  });
});

// POST /api/notifications/read { ids: string[] }
notificationsRouter.post("/read", async (c) => {
  const user = c.get("user");
  if (!user) throw new AppError("ERR_UNAUTHORIZED", { reason: "login_required" });
  const body = await c.req.json().catch(() => null);
  const ids = body?.ids;
  if (!Array.isArray(ids) || !ids.every((x: unknown) => typeof x === "string")) {
    throw new AppError("ERR_VALIDATION", { field: "ids" });
  }
  const n = await storage.markRead(user.githubUserId, ids as string[]);
  return c.json({ marked: n });
});

// POST /api/notifications/read-all
notificationsRouter.post("/read-all", async (c) => {
  const user = c.get("user");
  if (!user) throw new AppError("ERR_UNAUTHORIZED", { reason: "login_required" });
  const n = await storage.markReadAll(user.githubUserId);
  return c.json({ marked: n });
});
