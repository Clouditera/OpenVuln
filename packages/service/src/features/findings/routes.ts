import { Hono } from "hono";
import { requireAuth, requireGrant } from "../../middleware/auth.js";
import * as service from "./service.js";

/**
 * Owner findings routes — ALL behind requireGrant.
 * Mounted at /api/projects/:id/findings
 * Public routes MUST NOT import from this module's storage detail accessors.
 */
export const findingsRouter = new Hono();

findingsRouter.use("*", requireAuth);
findingsRouter.use("*", requireGrant());

// GET /api/projects/:id/findings
findingsRouter.get("/", async (c) => {
  const projectId = c.req.param("id")!;
  const result = await service.listOwnerFindings(projectId);
  return c.json(result);
});

// GET /api/projects/:id/findings/:key
findingsRouter.get("/:key", async (c) => {
  const projectId = c.req.param("id")!;
  const key = c.req.param("key")!;
  const result = await service.getOwnerFinding(projectId, key);
  return c.json(result);
});
