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

  it("indexes every hot-path lookup so no read runs an unindexed scan", async () => {
    const rows = await db.query<{ indexname: string; tablename: string; indexdef: string }>(
      `SELECT indexname, tablename, indexdef FROM pg_indexes WHERE schemaname = 'public'`
    );
    const names = new Set(rows.map((r) => r.indexname));
    // The formulary list/export scope by user_id; the schedule reveal and export
    // scope by experiment_id.
    for (const idx of ["experiments_user_id_idx", "allocations_experiment_id_idx"]) {
      expect(names.has(idx), `missing index ${idx}`).toBe(true);
    }
    // The daily read hits the (experiment_id, check_date) unique index. The
    // constraint is anonymous in the migration, so match on its definition
    // rather than an auto-generated name.
    const checkInsIndex = rows.some(
      (r) =>
        r.tablename === "check_ins" &&
        /experiment_id/.test(r.indexdef) &&
        /check_date/.test(r.indexdef)
    );
    expect(checkInsIndex, "missing check_ins (experiment_id, check_date) index").toBe(true);
  });
});
