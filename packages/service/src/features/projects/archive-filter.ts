import JSZip from "jszip";
import { logger } from "../../infra/logger.js";

/**
 * Archive filter (task-08627338, fish No.2211):
 * GitHub zipballs can contain dangling symlinks and traversal-shaped paths;
 * VH archive validation rejects the whole upload (400 ERR_SOURCE_ARCHIVE_*).
 * Before upload we repack, skipping exactly those entries — normal files are
 * copied byte-for-byte untouched.
 */

/** Zip unix mode bits: entry is a symlink. */
function isSymlink(unixPermissions: number | string | null | undefined): boolean {
  // JSZip exposes unixPermissions as the full st_mode when present (may arrive as number or string)
  if (unixPermissions == null) return false;
  const mode = typeof unixPermissions === "string" ? parseInt(unixPermissions, 16) : unixPermissions;
  return (mode & 0o170000) === 0o120000;
}

/** Normalize a path inside the archive; null if it escapes the root (traversal). */
function normalizeInsideArchive(path: string): string | null {
  const parts: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null; // escapes root
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

export interface ArchiveFilterResult {
  buffer: Buffer;
  skipped: string[];
  /** Total entries before filtering. */
  totalEntries: number;
}

/** True if the entry path itself is unsafe (absolute / traversal / windows drive). Exported for tests. */
export function unsafeEntryPath(name: string): boolean {
  if (name.startsWith("/") || name.startsWith("\\")) return true;
  if (/^[a-zA-Z]:[\\/]/.test(name)) return true;
  // any '..' component anywhere — VH's traversal check is conservative
  return name.split(/[\\/]/).includes("..");
}

/**
 * Filter an archive: drop dangling symlinks and unsafe paths, keep everything
 * else byte-identical. Returns the repacked buffer plus the skipped list.
 */
export async function filterArchiveEntries(input: Buffer): Promise<ArchiveFilterResult> {
  const src = await JSZip.loadAsync(input);
  const names = Object.keys(src.files);

  // Set of all real file/dir paths (normalized) for symlink resolution
  const present = new Set<string>();
  for (const n of names) {
    const normalized = normalizeInsideArchive(n);
    if (normalized) present.add(normalized);
  }

  const skipped: string[] = [];
  const out = new JSZip();
  let totalEntries = 0;

  for (const name of names) {
    const entry = src.files[name];
    if (entry.dir) {
      totalEntries++;
      const normalized = normalizeInsideArchive(name);
      if (!normalized || unsafeEntryPath(name)) {
        skipped.push(`${name} (unsafe dir)`);
        continue;
      }
      out.folder(name);
      continue;
    }
    totalEntries++;
    if (unsafeEntryPath(name)) {
      skipped.push(`${name} (unsafe path)`);
      continue;
    }
    if (isSymlink(entry.unixPermissions)) {
      const targetRaw = (await entry.async("string")).trim();
      let resolved: string | null = null;
      if (targetRaw.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(targetRaw)) {
        resolved = null; // absolute target — always outside the archive
      } else {
        const baseParts = name.split("/").slice(0, -1);
        resolved = normalizeInsideArchive([...baseParts, targetRaw].join("/"));
      }
      const targetExists =
        resolved != null &&
        (present.has(resolved) ||
          // symlink to a dir: entry may be recorded as "path/" nowhere; check prefix form
          [...present].some((p) => p.startsWith(`${resolved}/`)));
      if (!targetExists) {
        const kind = resolved == null ? "absolute target" : "dangling target";
        skipped.push(`${name} → ${targetRaw} (${kind})`);
        continue;
      }
      // resolvable link — keep, byte-identical
      out.file(name, entry.async("nodebuffer"), {
        date: entry.date,
        unixPermissions: entry.unixPermissions,
        // JSZip re-deflates; content bytes identical, compression level default
      });
      continue;
    }
    // regular file — copy verbatim
    out.file(name, entry.async("nodebuffer"), {
      date: entry.date,
      unixPermissions: entry.unixPermissions,
    });
  }

  const buffer = await out.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: "UNIX",
  });

  if (skipped.length > 0) {
    logger.info({ skippedCount: skipped.length, sample: skipped.slice(0, 10) }, "Archive filtered before VH upload");
  }
  return { buffer, skipped, totalEntries };
}
