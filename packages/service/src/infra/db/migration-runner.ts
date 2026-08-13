import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./client.js";
import { logger } from "../logger.js";

const MIGRATIONS_DIR = join(fileURLToPath(import.meta.url), "..", "migrations");

export async function runMigrations(): Promise<void> {
  const db = getDb();

  // Serialize concurrent migrators (e.g. parallel vitest workers)
  await db`SELECT pg_advisory_lock(${87236401})`;
  try {
    await db.unsafe(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied = await db<{ version: string }[]>`
      SELECT version FROM schema_migrations ORDER BY version
    `;
    const appliedSet = new Set(applied.map((r) => r.version));

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let count = 0;
    for (const file of files) {
      const version = file.replace(".sql", "");
      if (appliedSet.has(version)) continue;

      logger.info({ migration: file }, "Applying migration");
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf-8");

      await db.begin(async (tx) => {
        await tx.unsafe(sql);
        await tx`INSERT INTO schema_migrations (version) VALUES (${version})`;
      });

      count++;
      logger.info({ migration: file }, "Migration applied");
    }

    if (count === 0) {
      logger.info("DB schema up to date");
    } else {
      logger.info({ count }, "Migrations applied");
    }
  } finally {
    await db`SELECT pg_advisory_unlock(${87236401})`;
  }
}
