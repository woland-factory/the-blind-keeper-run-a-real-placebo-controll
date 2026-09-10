import { z } from "zod";

// Configuration comes only from the environment. Required vars fail fast with a
// clear message in production so a misconfigured deploy never boots half-broken.

const boolish = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().optional(),
  DB_DRIVER: z.enum(["postgres", "pglite"]).optional(),
  APP_BASE_URL: z.string().url().default("http://localhost:8080"),
  SESSION_COOKIE_SECRET: z.string().min(32).default("dev-only-insecure-secret-change-me-please"),
  MAIL_TRANSPORT: z.enum(["central", "console"]).optional(),
  INTERNAL_SERVICE_KEY: z.string().optional(),
  MAILER_URL: z.string().default("http://central-mailer-prod-api:8000"),
  SENTRY_DSN: z.string().optional(),
  SEED_DEMO: boolish,
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  E2E_EXPOSE_MAGIC_LINK: boolish,
});

export type Env = z.infer<typeof schema> & {
  mailTransport: "central" | "console";
  isProd: boolean;
};

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${details}`);
  }
  const env = parsed.data;
  const isProd = env.NODE_ENV === "production";

  // Default transport: console in dev/test, central in production.
  const mailTransport = env.MAIL_TRANSPORT ?? (isProd ? "central" : "console");

  if (isProd) {
    if (!env.DATABASE_URL && env.DB_DRIVER !== "pglite") {
      throw new Error("DATABASE_URL is required in production");
    }
    if (env.SESSION_COOKIE_SECRET === "dev-only-insecure-secret-change-me-please") {
      throw new Error("SESSION_COOKIE_SECRET must be set in production");
    }
    if (mailTransport === "central" && !env.INTERNAL_SERVICE_KEY) {
      throw new Error("INTERNAL_SERVICE_KEY is required when MAIL_TRANSPORT=central");
    }
  }

  return { ...env, mailTransport, isProd };
}
