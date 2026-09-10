import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDb, type Db } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { loadEnv } from "../src/env.js";
import type { FastifyInstance } from "fastify";

describe("no PII in logs", () => {
  let db: Db;
  let app: FastifyInstance;
  const chunks: string[] = [];

  beforeAll(async () => {
    db = await createDb({ driver: "pglite" });
    await runMigrations(db);
    const env = loadEnv({
      NODE_ENV: "test",
      DB_DRIVER: "pglite",
      MAIL_TRANSPORT: "console",
      APP_BASE_URL: "http://127.0.0.1:8080",
      SESSION_COOKIE_SECRET: "test-secret-that-is-long-enough-to-pass-min",
    });
    const stream = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    app = await buildApp({ db, env, logStream: stream });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it("never logs the email address or the raw token on the auth path", async () => {
    const email = "sensitive-user@example.com";
    await app.inject({ method: "POST", url: "/api/auth/magic-link", payload: { email } });

    const link = (
      await app.inject({ method: "GET", url: `/api/dev/last-magic-link?email=${encodeURIComponent(email)}` })
    ).json().link as string;
    const token = new URL(link).searchParams.get("token")!;

    await app.inject({ method: "GET", url: `/api/auth/verify?token=${encodeURIComponent(token)}` });

    const logged = chunks.join("");
    expect(logged.length).toBeGreaterThan(0); // logging actually happened
    expect(logged).not.toContain(email);
    expect(logged).not.toContain(token);
  });
});
