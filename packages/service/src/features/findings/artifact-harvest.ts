import { randomUUID } from "node:crypto";
import { encryptForAdmin } from "@openvuln/shared/crypto";
import { logger } from "../../infra/logger.js";
import { loadConfig } from "../../infra/config.js";
import type { VhArtifactFileEntry } from "../vulnhunter/client.js";
import { getVulnHunterClient } from "../vulnhunter/index.js";
import {
  ARTIFACT_CONTENT_MAX_CHARS,
  deleteArtifactsForProject,
  insertArtifact,
} from "./artifacts-storage.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlLike = any;

export interface HarvestFindingRef {
  findingId: string;
  findingKey: string;
}

/**
 * After findings rows are written in the completed txn, harvest poc/exp text.
 * Best-effort: list/preview failures log and skip; never fails the whole scan.
 *
 * VH path convention:
 *   list returns paths relative to findings/<id>/  (e.g. poc/poc.md)
 *   preview expects full tree path findings/<id>/poc/poc.md
 */
export async function harvestFindingArtifacts(opts: {
  projectId: string;
  scanJobId: string;
  vhTaskId: string;
  findings: HarvestFindingRef[];
  sql?: SqlLike;
}): Promise<{ files: number; truncated: number; errors: number }> {
  const vh = getVulnHunterClient();
  const cfg = loadConfig();
  if (!cfg.adminPublicKeyPem) {
    logger.warn("ADMIN_PUBLIC_KEY missing — skip artifact harvest (cannot encrypt)");
    return { files: 0, truncated: 0, errors: 1 };
  }
  const sql = opts.sql;
  let files = 0;
  let truncated = 0;
  let errors = 0;

  // Clean previous harvest for project (same lifecycle as findings replace)
  if (sql) {
    await deleteArtifactsForProject(opts.projectId, sql);
  } else {
    await deleteArtifactsForProject(opts.projectId);
  }

  for (const f of opts.findings) {
    let groups;
    try {
      groups = await vh.listFindingArtifacts(opts.vhTaskId, f.findingKey);
    } catch (err) {
      errors += 1;
      logger.warn({ err, findingKey: f.findingKey }, "listFindingArtifacts failed — skip finding");
      continue;
    }

    for (const kind of ["poc", "exp"] as const) {
      const entries: VhArtifactFileEntry[] = groups[kind]?.files ?? [];
      for (const entry of entries) {
        try {
          const relUnderFinding = entry.path.replace(/^\/+/, "");
          // Normalize to task-tree path for preview API
          const treePath = relUnderFinding.startsWith("findings/")
            ? relUnderFinding
            : `findings/${f.findingKey}/${relUnderFinding}`;
          const fileName = relUnderFinding.split("/").pop() || relUnderFinding;
          const isText = entry.kind === "text" || entry.previewable === true;

          let content: string | null = null;
          let mime: string | null = null;
          let isBinary = !isText;
          let wasTruncated = false;
          let sizeBytes = entry.size ?? 0;

          if (isText) {
            const preview = await vh.getArtifactFilePreview(opts.vhTaskId, treePath);
            if (preview) {
              mime = preview.mime ?? null;
              sizeBytes = preview.size ?? sizeBytes;
              if (preview.kind === "text" && typeof preview.content === "string") {
                let text = preview.content;
                wasTruncated = Boolean(preview.truncated);
                if (text.length > ARTIFACT_CONTENT_MAX_CHARS) {
                  text = text.slice(0, ARTIFACT_CONTENT_MAX_CHARS);
                  wasTruncated = true;
                }
                content = text;
                isBinary = false;
              } else if (preview.kind === "binary" || preview.kind === "image") {
                isBinary = true;
                content = null;
                mime = preview.mime ?? mime;
              }
            }
          }

          if (wasTruncated) truncated += 1;

          const artifactId = randomUUID();
          let encContent: string | null = null;
          if (content != null) {
            // AAD = artifact id (same pattern as findings); body is { text, path, kind }
            encContent = encryptForAdmin(cfg.adminPublicKeyPem, artifactId, {
              title: fileName,
              primary_file: treePath,
              detail: { kind, text: content, finding_key: f.findingKey },
            });
          }

          await insertArtifact(
            {
              id: artifactId,
              findingId: f.findingId,
              projectId: opts.projectId,
              scanJobId: opts.scanJobId,
              kind,
              relPath: treePath,
              fileName,
              mime,
              sizeBytes,
              encContent,
              truncated: wasTruncated,
              isBinary,
            },
            sql,
          );
          files += 1;
        } catch (err) {
          errors += 1;
          logger.warn(
            { err, findingKey: f.findingKey, path: entry.path },
            "artifact harvest file failed — skip",
          );
        }
      }
    }
  }

  logger.info(
    {
      projectId: opts.projectId,
      scanJobId: opts.scanJobId,
      findings: opts.findings.length,
      files,
      truncated,
      errors,
    },
    "Artifact harvest finished",
  );
  return { files, truncated, errors };
}
