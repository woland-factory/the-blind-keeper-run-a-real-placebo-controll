import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Db } from "./index.js";

// Migrations live as plain .sql files applied in filename order and tracked in
// schema_migrations. Application is idempotent: already-applied versions are
// skipped. Forward-only.
function defaultMigrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/db -> ../../migrations resolves to server/migrations.
  return path.resolve(here, "..", "..", "migrations");
}

export async function runMigrations(db: Db, dir = defaultMigrationsDir()): Promise<string[]> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`
  );

  const applied = new Set(
    (await db.query<{ version: string }>("SELECT version FROM schema_migrations")).map(
      (r) => r.version
    )
  );

  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const ran: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    await db.exec(sql);
    await db.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
    ran.push(version);
  }
  return ran;
}
