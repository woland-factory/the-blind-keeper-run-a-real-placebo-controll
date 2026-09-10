import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  consumeMagicToken,
  createSession,
  deleteSession,
  issueMagicToken,
  normalizeEmail,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  upsertUser,
} from "../auth.js";
import { errorEnvelope, isSecureRequest, requireAuth } from "../http.js";

const emailSchema = z.object({
  email: z.string().trim().min(3).max(254).email(),
});

const verifyQuerySchema = z.object({
  token: z.string().min(1).max(512),
});

// Stricter limiter for the auth surface: brute-forcing links or spamming email.
function authLimit(instance: FastifyInstance) {
  return {
    rateLimit: {
      max: instance.env.AUTH_RATE_LIMIT_MAX,
      timeWindow: "1 minute",
    },
  };
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/auth/magic-link",
    { config: authLimit(app) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = emailSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(errorEnvelope("invalid_input", "Enter a valid email address."));
      }
      const email = normalizeEmail(parsed.data.email);

      // Always succeed the same way whether or not the account exists. No
      // account enumeration.
      const user = await upsertUser(app.db, email);
      const raw = await issueMagicToken(app.db, user.id);
      const verifyUrl = `${app.env.APP_BASE_URL}/api/auth/verify?token=${encodeURIComponent(raw)}`;
      try {
        await app.mailer.sendMagicLink(email, verifyUrl);
      } catch {
        // Do not leak send failures to a caller probing for accounts.
        request.log.warn({ userId: user.id }, "magic link send failed");
      }
      return reply.send({ ok: true });
    }
  );

  app.get(
    "/api/auth/verify",
    { config: authLimit(app) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = verifyQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.redirect("/auth/expired");
      }
      const user = await consumeMagicToken(app.db, parsed.data.token);
      if (!user) {
        return reply.redirect("/auth/expired");
      }
      const sessionId = await createSession(app.db, user.id);
      reply.setCookie(SESSION_COOKIE, sessionId, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: isSecureRequest(request),
        signed: true,
        maxAge: Math.floor(SESSION_TTL_MS / 1000),
      });
      return reply.redirect("/");
    }
  );

  app.post(
    "/api/auth/logout",
    { preHandler: requireAuth, config: authLimit(app) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const raw = request.cookies[SESSION_COOKIE];
      if (raw) {
        const unsigned = request.unsignCookie(raw);
        if (unsigned.valid && unsigned.value) {
          await deleteSession(app.db, unsigned.value);
        }
      }
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return reply.send({ ok: true });
    }
  );

  // Console transport only: lets the e2e suite and a staging reviewer retrieve
  // the last issued link without a real mailbox. Never registered under the
  // central transport, so it cannot leak links in production email flows.
  if (app.env.mailTransport === "console" || app.env.E2E_EXPOSE_MAGIC_LINK) {
    app.get(
      "/api/dev/last-magic-link",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const q = z.object({ email: z.string().email() }).safeParse(request.query);
        if (!q.success) {
          return reply.code(400).send(errorEnvelope("invalid_input", "Provide an email."));
        }
        const link = app.mailer.lastLinkFor(normalizeEmail(q.data.email));
        if (!link) {
          return reply.code(404).send(errorEnvelope("not_found", "No link for that email."));
        }
        return reply.send({ link });
      }
    );
  }
}
