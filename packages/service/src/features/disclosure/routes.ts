import { Hono } from "hono";
import { requireAuth, requireGrant } from "../../middleware/auth.js";
import { AppError } from "../../middleware/error-handler.js";
import * as findingsService from "../findings/service.js";

/**
 * Owner disclosure — behind requireGrant.
 * POST /api/projects/:id/disclose
 */
export const disclosureRouter = new Hono();

disclosureRouter.use("*", requireAuth);
disclosureRouter.use("*", requireGrant());

disclosureRouter.post("/", async (c) => {
  const projectId = c.req.param("id")!;
  const user = c.get("user");
  if (!user) throw new AppError("ERR_UNAUTHORIZED");

  const body = await c.req.json().catch(() => null);
  const findingIds = body?.finding_ids;
  if (!Array.isArray(findingIds)) {
    throw new AppError("ERR_VALIDATION", { field: "finding_ids" });
  }

  const result = await findingsService.disclose(
    projectId,
    findingIds.filter((x: unknown) => typeof x === "string"),
    user.githubUserId,
  );
  return c.json(result);
});
