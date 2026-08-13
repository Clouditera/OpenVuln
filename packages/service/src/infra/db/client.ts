import postgres from "postgres";
import { logger } from "../logger.js";

let _db: postgres.Sql | null = null;

export function getDb(): postgres.Sql {
  if (!_db) {
    throw new Error("DB not initialized — call initDb() first");
  }
  return _db;
}

export async function initDb(url: string): Promise<postgres.Sql> {
  logger.info({ url: url.replace(/:[^:@]+@/, ":***@") }, "Connecting to database");

  _db = postgres(url, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: (notice) => logger.debug({ notice }, "PG notice"),
  });

  await _db`SELECT 1`;
  logger.info("Database connected");
  return _db;
}

export async function closeDb(): Promise<void> {
  if (_db) {
    await _db.end();
    _db = null;
    logger.info("Database connection closed");
  }
}
