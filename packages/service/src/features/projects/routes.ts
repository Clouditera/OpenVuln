import { Hono } from "hono";
import { AppError } from "../../middleware/error-handler.js";
import * as service from "./service.js";

export const projectsRouter = new Hono();

// GET /api/projects?sort=newest|stars&page=
projectsRouter.get("/", async (c) => {
  const sort = c.req.query("sort") ?? "newest";
  const page = Number(c.req.query("page") ?? "1");
  const pageSize = Number(c.req.query("page_size") ?? "20");
  const result = await service.listProjects({ sort, page, pageSize });
  return c.json(result);
});

// POST /api/projects { git_url }
projectsRouter.post("/", async (c) => {
  const config = c.get("config");
  const body = await c.req.json().catch(() => null);
  const gitUrl = body?.git_url;
  if (typeof gitUrl !== "string" || !gitUrl.trim()) {
    throw new AppError("ERR_VALIDATION", { field: "git_url" });
  }
  const result = await service.submitProject(gitUrl.trim(), config);
  return c.json(result, 201);
});

// GET /api/projects/:owner/:repo  — public view
projectsRouter.get("/:owner/:repo", async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const result = await service.getPublicView(owner, repo);
  return c.json(result);
});
