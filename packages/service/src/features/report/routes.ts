import { Hono } from "hono";
import { AppError } from "../../middleware/error-handler.js";
import { findingsStorage } from "../findings/index.js";
import * as service from "./service.js";

/**
 * Public report download — disclosed findings only, no auth.
 * Mounted at /api/projects/:id/report
 *
 * GET /                         ?format=markdown|json|zip
 * GET /:findingKey              default: full markdown from report.yaml
 *                               ?format=markdown|yaml|json|zip|markdown-summary
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

// Single disclosed finding
reportRouter.get("/:findingKey", async (c) => {
  const projectId = c.req.param("id")!;
  const findingKey = decodeURIComponent(c.req.param("findingKey")!);
  const formatRaw = (c.req.query("format") ?? "markdown").toLowerCase();
  if (
    formatRaw !== "yaml" &&
    formatRaw !== "markdown" &&
    formatRaw !== "md" &&
    formatRaw !== "json" &&
    formatRaw !== "zip" &&
    formatRaw !== "markdown-summary"
  ) {
    throw new AppError("ERR_VALIDATION", {
      field: "format",
      reason: "invalid_format",
      message: "format must be markdown, yaml, json, zip, or markdown-summary",
    });
  }

  const report = await service.buildSingleFindingReport(projectId, findingKey);
  const safeKey = findingKey.replace(/[^A-Za-z0-9._-]+/g, "-");
  const yaml = await findingsStorage.getDisclosedReportYaml(projectId, findingKey);

  if (formatRaw === "yaml") {
    if (!yaml) {
      throw new AppError("ERR_NOT_FOUND", {
        resource: "report_yaml",
        reason: "no_fidelity_payload",
        message:
          "Original report.yaml not available for this disclosure (re-disclose with fidelity pack).",
      });
    }
    return attachment(yaml, {
      contentType: "application/yaml; charset=utf-8",
      filename: `${safeKey}.report.yaml`,
    });
  }

  if (formatRaw === "zip") {
    const { bytes, filename } = await service.buildSingleFindingZip(projectId, findingKey);
    const out = new Uint8Array(bytes.byteLength);
    out.set(bytes);
    return attachment(out, { contentType: "application/zip", filename });
  }

  if (formatRaw === "json") {
    const structured = service.buildDisclosedFindingDetail(report, yaml);
    return attachment(JSON.stringify(structured, null, 2), {
      contentType: "application/json; charset=utf-8",
      filename: `${safeKey}.report.json`,
    });
  }

  if (formatRaw === "markdown-summary") {
    return attachment(service.renderSingleMarkdown(report), {
      contentType: "text/markdown; charset=utf-8",
      filename: service.singleFilenameFor(report, "markdown"),
    });
  }

  // default markdown = full report from yaml (information-equivalent)
  if (!yaml) {
    return attachment(service.renderSingleMarkdown(report), {
      contentType: "text/markdown; charset=utf-8",
      filename: `${safeKey}.report.md`,
    });
  }
  const md = service.renderFullReportMarkdown(yaml, {
    findingKey,
    projectFullName: report.project.full_name,
  });
  return attachment(md, {
    contentType: "text/markdown; charset=utf-8",
    filename: `${safeKey}.report.md`,
  });
});
