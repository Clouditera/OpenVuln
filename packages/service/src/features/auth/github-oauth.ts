import { createHmac, timingSafeEqual } from "node:crypto";
import type { ServiceConfig } from "../../infra/config.js";
import { logger } from "../../infra/logger.js";

export async function exchangeCodeForToken(
  code: string,
  cfg: ServiceConfig,
): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "OpenVuln",
    },
    body: JSON.stringify({
      client_id: cfg.githubOAuth.clientId,
      client_secret: cfg.githubOAuth.clientSecret,
      code,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`GitHub token exchange failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    throw new Error(`GitHub token exchange error: ${data.error ?? "no_token"}`);
  }
  return data.access_token;
}

export async function fetchGithubUser(token: string): Promise<{
  id: number;
  login: string;
  avatar_url: string | null;
}> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "OpenVuln",
    },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`GitHub /user failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const u = (await res.json()) as { id: number; login: string; avatar_url?: string };
  return { id: u.id, login: u.login, avatar_url: u.avatar_url ?? null };
}

export type GhPermission = "admin" | "maintain" | "write" | "triage" | "read" | "none";

export class GithubPermissionError extends Error {
  constructor(
    public readonly kind: "auth" | "upstream",
    public readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "GithubPermissionError";
  }
}

export async function fetchRepoPermission(
  token: string,
  owner: string,
  repo: string,
  username: string,
): Promise<GhPermission> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators/${encodeURIComponent(username)}/permission`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "OpenVuln",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, owner, repo }, "GitHub permission check network failure");
    throw new GithubPermissionError(
      "upstream",
      null,
      `GitHub permission API unreachable: ${msg.slice(0, 200)}`,
    );
  }
  if (res.status === 404) return "none";
  // 401 Bad credentials / 403 forbidden → treat as no access (caller maps to 403)
  if (res.status === 401 || res.status === 403) {
    const t = await res.text().catch(() => "");
    logger.warn({ status: res.status, owner, repo }, "GitHub permission denied/invalid token");
    throw new GithubPermissionError(
      "auth",
      res.status,
      `GitHub permission API ${res.status}: ${t.slice(0, 200)}`,
    );
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    logger.warn({ status: res.status, owner, repo }, "GitHub permission check failed");
    throw new GithubPermissionError(
      "upstream",
      res.status,
      `GitHub permission API ${res.status}: ${t.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as { permission?: string };
  const p = (data.permission ?? "none") as GhPermission;
  return p;
}

/** Sign OAuth state (return_to + nonce + exp). */
export function signOAuthState(returnTo: string, secret: string): string {
  const exp = Date.now() + 10 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ r: returnTo, e: exp }), "utf8").toString(
    "base64url",
  );
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyOAuthState(
  state: string,
  secret: string,
): { returnTo: string } | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expect = createHmac("sha256", secret).update(payload).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      r?: string;
      e?: number;
    };
    if (!data.r || !data.e || Date.now() > data.e) return null;
    // open redirect guard: only relative paths
    if (!data.r.startsWith("/") || data.r.startsWith("//")) return null;
    return { returnTo: data.r };
  } catch {
    return null;
  }
}
