import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createDb, type Db } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { loadEnv, type Env } from "../src/env.js";

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  env: Env;
}

export async function buildTestApp(overrides: NodeJS.ProcessEnv = {}): Promise<TestApp> {
  const env = loadEnv({
    NODE_ENV: "test",
    DB_DRIVER: "pglite",
    MAIL_TRANSPORT: "console",
    APP_BASE_URL: "http://127.0.0.1:8080",
    SESSION_COOKIE_SECRET: "test-secret-that-is-long-enough-to-pass-min",
    ...overrides,
  });
  const db = await createDb({ driver: "pglite" });
  await runMigrations(db);
  const app = await buildApp({ db, env });
  await app.ready();
  return { app, db, env };
}

/** Pull the session cookie header value from a set-cookie list. */
export function extractSessionCookie(setCookie: string | string[] | undefined): string | undefined {
  if (!setCookie) return undefined;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  const found = list.find((c) => c.startsWith("bk_session="));
  return found?.split(";")[0];
}

/**
 * Sign a fresh user in through the real magic-link flow (console transport) and
 * return the session cookie for authenticated requests.
 */
export async function signIn(app: FastifyInstance, email: string): Promise<string> {
  await app.inject({ method: "POST", url: "/api/auth/magic-link", payload: { email } });
  const link = (
    await app.inject({
      method: "GET",
      url: `/api/dev/last-magic-link?email=${encodeURIComponent(email)}`,
    })
  ).json().link as string;
  const token = new URL(link).searchParams.get("token")!;
  const verify = await app.inject({
    method: "GET",
    url: `/api/auth/verify?token=${encodeURIComponent(token)}`,
  });
  return extractSessionCookie(verify.headers["set-cookie"])!;
}
