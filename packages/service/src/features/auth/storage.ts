import { createHash, randomBytes } from "node:crypto";
import { getDb } from "../../infra/db/index.js";

export function hashSessionId(rawId: string): string {
  return createHash("sha256").update(rawId).digest("hex");
}

export function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

export async function upsertIdentity(input: {
  userId: number;
  login: string;
  avatarUrl: string | null;
}): Promise<void> {
  const db = getDb();
  await db`
    INSERT INTO github_identities (user_id, login, avatar_url, first_seen_at, last_seen_at)
    VALUES (${input.userId}, ${input.login}, ${input.avatarUrl}, now(), now())
    ON CONFLICT (user_id) DO UPDATE SET
      login = EXCLUDED.login,
      avatar_url = EXCLUDED.avatar_url,
      last_seen_at = now()
  `;
}

export async function createSession(input: {
  githubUserId: number;
  githubToken: string;
  ttlDays: number;
}): Promise<{ rawId: string; expiresAt: Date }> {
  const db = getDb();
  const rawId = newSessionId();
  const idHash = hashSessionId(rawId);
  const expiresAt = new Date(Date.now() + input.ttlDays * 24 * 60 * 60 * 1000);
  await db`
    INSERT INTO sessions (id, id_hash, github_user_id, github_token, expires_at)
    VALUES (gen_random_uuid(), ${idHash}, ${input.githubUserId}, ${input.githubToken}, ${expiresAt})
  `;
  return { rawId, expiresAt };
}

export async function getSessionByRawId(rawId: string): Promise<{
  githubUserId: number;
  githubToken: string;
  login: string;
  avatarUrl: string | null;
  expiresAt: Date;
} | null> {
  const db = getDb();
  const idHash = hashSessionId(rawId);
  const rows = await db<
    {
      github_user_id: string;
      github_token: string;
      login: string;
      avatar_url: string | null;
      expires_at: Date;
    }[]
  >`
    SELECT s.github_user_id::text, s.github_token, i.login, i.avatar_url, s.expires_at
    FROM sessions s
    JOIN github_identities i ON i.user_id = s.github_user_id
    WHERE s.id_hash = ${idHash} AND s.expires_at > now()
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    githubUserId: Number(r.github_user_id),
    githubToken: r.github_token,
    login: r.login,
    avatarUrl: r.avatar_url,
    expiresAt: r.expires_at,
  };
}

export async function deleteSessionByRawId(rawId: string): Promise<void> {
  const db = getDb();
  const idHash = hashSessionId(rawId);
  await db`DELETE FROM sessions WHERE id_hash = ${idHash}`;
}

export async function touchSession(rawId: string, ttlDays: number): Promise<void> {
  const db = getDb();
  const idHash = hashSessionId(rawId);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  await db`UPDATE sessions SET expires_at = ${expiresAt} WHERE id_hash = ${idHash}`;
}

export async function getCachedGrant(
  userId: number,
  repoId: number,
  maxAgeHours: number,
): Promise<"admin" | "maintain" | null> {
  const db = getDb();
  const rows = await db<{ role: string }[]>`
    SELECT role FROM repo_access_grants
    WHERE github_user_id = ${userId}
      AND github_repo_id = ${repoId}
      AND verified_at > now() - make_interval(hours => ${maxAgeHours})
  `;
  const role = rows[0]?.role;
  if (role === "admin" || role === "maintain") return role;
  return null;
}

export async function upsertGrant(
  userId: number,
  repoId: number,
  role: "admin" | "maintain",
): Promise<void> {
  const db = getDb();
  await db`
    INSERT INTO repo_access_grants (github_user_id, github_repo_id, role, verified_at)
    VALUES (${userId}, ${repoId}, ${role}, now())
    ON CONFLICT (github_user_id, github_repo_id) DO UPDATE SET
      role = EXCLUDED.role,
      verified_at = now()
  `;
}

export async function bumpSubmitCount(userId: number): Promise<number> {
  const db = getDb();
  const rows = await db<{ count: number }[]>`
    INSERT INTO submit_rate_limits (github_user_id, day, count)
    VALUES (${userId}, CURRENT_DATE, 1)
    ON CONFLICT (github_user_id, day) DO UPDATE SET count = submit_rate_limits.count + 1
    RETURNING count
  `;
  return Number(rows[0]?.count ?? 1);
}
