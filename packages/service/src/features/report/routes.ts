import { Hono } from "hono";
import { AppError } from "../../middleware/error-handler.js";
import * as service from "./service.js";

/**
 * Public report download — disclosed findings only, no auth.
 * Mounted at /api/projects/:id/report
 *
 * GET /                         ?format=markdown|json|zip
 * GET /:findingKey              ?format=markdown|json
 */
export const reportRouter = new Hono();

function attachment(
  body: string | Uint8Array,
  opts: { contentType: string; filename: string },
): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": opts.contentType,
      "content-disposition": `attachment; filename="${opts.filename}"`,
      "cache-control": "no-store",
    },
  });
}

// Bundle / summary report
reportRouter.get("/", async (c) => {
  const projectId = c.req.param("id")!;
  const formatRaw = (c.req.query("format") ?? "markdown").toLowerCase();
  if (formatRaw !== "markdown" && formatRaw !== "json" && formatRaw !== "zip") {
    throw new AppError("ERR_VALIDATION", {
      field: "format",
      reason: "invalid_format",
      message: "format must be markdown, json, or zip",
    });
  }
  const format = formatRaw as service.ReportFormat;
  const report = await service.buildPublicReport(projectId);
  const filename = service.filenameFor(report, format);

  if (format === "zip") {
    const zip = await service.buildZipBundle(report);
    // Copy into a fresh ArrayBuffer-backed Uint8Array for Response body typing
    const bytes = new Uint8Array(zip.byteLength);
    bytes.set(zip);
    return attachment(bytes, {
      contentType: "application/zip",
      filename,
    });
  }

  if (format === "json") {
    return attachment(JSON.stringify(report, null, 2), {
      contentType: "application/json; charset=utf-8",
      filename,
    });
  }

  return attachment(service.renderMarkdown(report), {
    contentType: "text/markdown; charset=utf-8",
    filename,
  });
});

// Single disclosed finding report
reportRouter.get("/:findingKey", async (c) => {
  const projectId = c.req.param("id")!;
  const findingKey = decodeURIComponent(c.req.param("findingKey")!);
  const formatRaw = (c.req.query("format") ?? "markdown").toLowerCase();
  if (formatRaw !== "markdown" && formatRaw !== "json") {
    throw new AppError("ERR_VALIDATION", {
      field: "format",
      reason: "invalid_format",
      message: "format must be markdown or json",
    });
  }

  const report = await service.buildSingleFindingReport(projectId, findingKey);
  const filename = service.singleFilenameFor(
    report,
    formatRaw as "markdown" | "json",
  );

  if (formatRaw === "json") {
    return attachment(JSON.stringify(report, null, 2), {
      contentType: "application/json; charset=utf-8",
      filename,
    });
  }

  return attachment(service.renderSingleMarkdown(report), {
    contentType: "text/markdown; charset=utf-8",
    filename,
  });
});
