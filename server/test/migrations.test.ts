import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";

describe("migrations", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createDb({ driver: "pglite" });
  });

  afterAll(async () => {
    await db.close();
  });

  it("applies once and is a no-op on re-run", async () => {
    const first = await runMigrations(db);
    expect(first).toContain("0001_init");

    const second = await runMigrations(db);
    expect(second).toHaveLength(0);
  });

  it("creates every core table", async () => {
    const rows = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const names = new Set(rows.map((r) => r.table_name));
    for (const t of [
      "users",
      "magic_tokens",
      "sessions",
      "experiments",
      "allocations",
      "check_ins",
      "verdicts",
      "schema_migrations",
    ]) {
      expect(names.has(t), `missing table ${t}`).toBe(true);
    }
  });
});
