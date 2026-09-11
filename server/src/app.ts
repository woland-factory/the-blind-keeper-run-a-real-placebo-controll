import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import * as Sentry from "@sentry/node";
import type { Db } from "./db/index.js";
import type { Env } from "./env.js";
import { createMailer, type Mailer } from "./mailer.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerMeRoutes } from "./routes/me.js";
import { registerExperimentRoutes } from "./routes/experiments.js";
import { errorEnvelope } from "./http.js";
import type { User } from "./auth.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    env: Env;
    mailer: Mailer;
    spaIndexPath?: string;
  }
  interface FastifyRequest {
    user?: User;
  }
}

export interface BuildAppOptions {
  db: Db;
  env: Env;
  mailer?: Mailer;
  /** Test-only: capture logger output to assert no PII is written. */
  logStream?: NodeJS.WritableStream;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { db, env } = opts;

  const redact = {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body.email",
      "res.headers['set-cookie']",
    ],
    remove: true,
  };

  // Log the route path only. Query strings can carry the raw magic-link token,
  // which must never reach the logs.
  const serializers = {
    req(req: { method: string; url: string; ip?: string }) {
      return { method: req.method, url: req.url.split("?")[0], remoteAddress: req.ip };
    },
  };

  const app = Fastify({
    trustProxy: true,
    logger: opts.logStream
      ? { level: "info", redact, serializers, stream: opts.logStream }
      : {
          level: env.NODE_ENV === "test" ? "silent" : "info",
          // Never let PII reach the logs.
          redact,
          serializers,
        },
  });

  if (env.SENTRY_DSN) {
    Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV });
  }

  const mailer = opts.mailer ?? createMailer(env, app.log);
  app.decorate("db", db);
  app.decorate("env", env);
  app.decorate("mailer", mailer);

  await app.register(cookie, { secret: env.SESSION_COOKIE_SECRET });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: "1 minute",
  });

  app.setErrorHandler((err, request, reply) => {
    const statusCode = err.statusCode ?? 500;
    if (statusCode === 429) {
      return reply
        .code(429)
        .send(errorEnvelope("rate_limited", "Too many requests. Wait a minute and try again."));
    }
    // Boundary validation failures surface as a plain 400, never a stack.
    if (statusCode >= 500) {
      request.log.error({ err }, "request failed");
      if (env.SENTRY_DSN) Sentry.captureException(err);
      if (env.isProd) {
        return reply
          .code(500)
          .send(errorEnvelope("internal", "The request failed on our side. Try again in a moment."));
      }
    }
    const code = statusCode >= 500 ? "internal" : "bad_request";
    return reply.code(statusCode).send(errorEnvelope(code, err.message || "The request could not be completed."));
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    if (request.url.startsWith("/api")) {
      return reply.code(404).send(errorEnvelope("not_found", "That endpoint does not exist."));
    }
    // SPA fallback: serve index.html for client-side routes when static assets
    // are mounted (production). In API-only contexts (tests) return 404.
    if (app.spaIndexPath) {
      return reply.type("text/html").sendFile("index.html");
    }
    return reply.code(404).send(errorEnvelope("not_found", "Not found."));
  });

  app.get("/api/healthz", { config: { rateLimit: false } }, async (_req, reply) => {
    const ok = await db.healthcheck();
    if (ok) return { status: "ok" };
    return reply.code(503).send({ status: "degraded" });
  });

  await app.register(registerAuthRoutes);
  await app.register(registerMeRoutes);
  await app.register(registerExperimentRoutes);

  return app;
}
