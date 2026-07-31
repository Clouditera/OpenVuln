import { createHash, randomBytes } from "node:crypto";
import { getDb } from "../../infra/db/index.js";
import { loadConfig } from "../../infra/config.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function hashToken(token: string): string {
  const secret = loadConfig().sessionSecret;
  return createHash("sha256").update(`${secret}:${token}`).digest("hex");
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface SessionRow {
  id: string;
  githubUserId: number;
  login: string;
  avatarUrl: string | null;
  expiresAt: Date;
}

export async function createSession(githubUserId: number): Promise<{ token: string; expiresAt: Date }> {
  const db = getDb();
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db`
    INSERT INTO sessions (token_hash, github_user_id, expires_at)
    VALUES (${tokenHash}, ${githubUserId}, ${expiresAt})
  `;

  return { token, expiresAt };
}

export async function findValidSession(token: string): Promise<SessionRow | null> {
  const db = getDb();
  const tokenHash = hashToken(token);
  const rows = await db<{
    id: string;
    github_user_id: string;
    login: string;
    avatar_url: string | null;
    expires_at: Date;
  }[]>`
    SELECT s.id, s.github_user_id::text, g.login, g.avatar_url, s.expires_at
    FROM sessions s
    JOIN github_identities g ON g.user_id = s.github_user_id
    WHERE s.token_hash = ${tokenHash} AND s.expires_at > now()
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    githubUserId: Number(r.github_user_id),
    login: r.login,
    avatarUrl: r.avatar_url,
    expiresAt: r.expires_at,
  };
}

export async function maybeSlideExpiry(sessionId: string, expiresAt: Date): Promise<void> {
  const remaining = expiresAt.getTime() - Date.now();
  if (remaining > SESSION_TTL_MS / 2) return;
  const db = getDb();
  const newExpiry = new Date(Date.now() + SESSION_TTL_MS);
  await db`UPDATE sessions SET expires_at = ${newExpiry} WHERE id = ${sessionId}::uuid`;
}

export async function revokeSession(token: string): Promise<void> {
  const db = getDb();
  const tokenHash = hashToken(token);
  await db`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
}

export async function revokeAllUserSessions(githubUserId: number): Promise<void> {
  const db = getDb();
  await db`DELETE FROM sessions WHERE github_user_id = ${githubUserId}`;
}
