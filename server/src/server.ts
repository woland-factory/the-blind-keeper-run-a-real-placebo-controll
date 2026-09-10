import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import { buildApp } from "./app.js";
import { createDb, resolveDriver } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { loadEnv } from "./env.js";
import { runSeed } from "./seed.js";
import { createMailer } from "./mailer.js";
import { DEMO_EMAIL } from "./seed.js";
import { issueMagicToken } from "./auth.js";

function staticDir(): string {
  if (process.env.STATIC_DIR) return process.env.STATIC_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "web", "dist");
}

async function main(): Promise<void> {
  const env = loadEnv();
  const driver = resolveDriver({ driver: process.env.DB_DRIVER, databaseUrl: env.DATABASE_URL });
  const db = await createDb({ driver, databaseUrl: env.DATABASE_URL });

  await runMigrations(db);

  const mailer = createMailer(env, console as never);
  const app = await buildApp({ db, env, mailer });

  if (env.SEED_DEMO) {
    await runSeed(db, { info: (m) => app.log.info(m) });
    // Surface the demo sign-in link so a staging reviewer can enter the demo
    // account without a real mailbox. Behind SEED_DEMO only.
    const demoUser = await db.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [DEMO_EMAIL]);
    if (demoUser[0]) {
      const raw = await issueMagicToken(db, demoUser[0].id);
      app.log.info(
        `Demo sign-in link: ${env.APP_BASE_URL}/api/auth/verify?token=${encodeURIComponent(raw)}`
      );
    }
  }

  // Serve the built SPA. Existing files (assets) are served directly; every
  // other path falls back to index.html via the not-found handler.
  const dir = staticDir();
  if (existsSync(dir)) {
    await app.register(fastifyStatic, { root: dir, wildcard: false });
    app.spaIndexPath = path.join(dir, "index.html");
  } else {
    app.log.warn(`static dir not found at ${dir}; serving API only`);
  }

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
