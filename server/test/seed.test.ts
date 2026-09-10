import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { loadEnv } from "../src/env.js";
import { DEMO_EMAIL, runSeed } from "../src/seed.js";

const silent = { info: () => {} };

describe("SEED_DEMO", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createDb({ driver: "pglite" });
    await runMigrations(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("is off by default in the environment", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      DB_DRIVER: "pglite",
      SESSION_COOKIE_SECRET: "test-secret-that-is-long-enough-to-pass-min",
    });
    expect(env.SEED_DEMO).toBe(false);
  });

  it("provisions a demo user with one unblinded experiment and a verdict", async () => {
    const inserted = await runSeed(db, silent);
    expect(inserted).toBe(true);

    const users = await db.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [DEMO_EMAIL]);
    expect(users).toHaveLength(1);

    const exps = await db.query<{ status: string }>(
      `SELECT status FROM experiments WHERE user_id = $1`,
      [users[0].id]
    );
    expect(exps).toHaveLength(1);
    expect(exps[0].status).toBe("unblinded");

    const verdicts = await db.query(
      `SELECT verdict_text FROM verdicts v
         JOIN experiments e ON e.id = v.experiment_id
        WHERE e.user_id = $1`,
      [users[0].id]
    );
    expect(verdicts).toHaveLength(1);

    const allocations = await db.query(
      `SELECT a.id FROM allocations a
         JOIN experiments e ON e.id = a.experiment_id
        WHERE e.user_id = $1`,
      [users[0].id]
    );
    expect(allocations.length).toBeGreaterThan(0);
  });

  it("is idempotent: a second run creates no duplicates", async () => {
    const inserted = await runSeed(db, silent);
    expect(inserted).toBe(false);

    const exps = await db.query(`SELECT id FROM experiments`);
    expect(exps).toHaveLength(1);
  });
});
