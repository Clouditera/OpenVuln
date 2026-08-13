import { logger } from "../../infra/logger.js";
import { AppError } from "../../middleware/error-handler.js";

export class ZipballTooLargeError extends Error {
  constructor(
    public readonly sizeBytes: number,
    public readonly limitBytes: number,
  ) {
    super(
      `github_zipball_too_large: ${(sizeBytes / (1024 * 1024)).toFixed(1)}MB > limit ${(limitBytes / (1024 * 1024)).toFixed(0)}MB`,
    );
    this.name = "ZipballTooLargeError";
  }
}

/**
 * Download a GitHub repository zipball pinned to a commit SHA (or branch).
 * Uses codeload (not the slow git protocol).
 */
export async function downloadGithubZipball(opts: {
  owner: string;
  repo: string;
  /** commit SHA preferred; branch name also works */
  ref: string;
  /** hard cap bytes (default 500MB matches VH upload default) */
  maxBytes: number;
  /** optional GITHUB_SERVER_TOKEN for private/rate limit */
  token?: string;
  timeoutMs?: number;
}): Promise<{ buffer: Buffer; filename: string; bytes: number }> {
  const ref = opts.ref.trim();
  if (!ref) throw new Error("zipball ref required");

  // codeload.github.com/{owner}/{repo}/zip/{ref}
  const url = `https://codeload.github.com/${opts.owner}/${opts.repo}/zip/${encodeURIComponent(ref)}`;
  const headers: Record<string, string> = {
    accept: "application/zip",
    "user-agent": "OpenVuln/0.1",
  };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;

  const signal = AbortSignal.timeout(opts.timeoutMs ?? 120_000);
  logger.info(
    { owner: opts.owner, repo: opts.repo, ref: ref.slice(0, 12), maxMb: opts.maxBytes / (1024 * 1024) },
    "Downloading GitHub zipball",
  );

  const res = await fetch(url, { headers, signal, redirect: "follow" });
  if (res.status === 404) {
    throw new AppError("ERR_NOT_FOUND", {
      resource: "github_zipball",
      owner: opts.owner,
      repo: opts.repo,
      ref,
    });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`github_zipball_http_${res.status}: ${text.slice(0, 200)}`);
  }

  const cl = Number(res.headers.get("content-length") ?? 0);
  if (Number.isFinite(cl) && cl > opts.maxBytes) {
    throw new ZipballTooLargeError(cl, opts.maxBytes);
  }

  // Stream with size guard
  if (!res.body) {
    const ab = await res.arrayBuffer();
    if (ab.byteLength > opts.maxBytes) throw new ZipballTooLargeError(ab.byteLength, opts.maxBytes);
    const buffer = Buffer.from(ab);
    return {
      buffer,
      filename: `${opts.repo}-${ref.slice(0, 12)}.zip`,
      bytes: buffer.length,
    };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > opts.maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw new ZipballTooLargeError(total, opts.maxBytes);
      }
      chunks.push(value);
    }
  }
  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  logger.info(
    { owner: opts.owner, repo: opts.repo, bytes: buffer.length, ref: ref.slice(0, 12) },
    "GitHub zipball downloaded",
  );
  return {
    buffer,
    filename: `${opts.repo}-${ref.slice(0, 12)}.zip`,
    bytes: buffer.length,
  };
}
