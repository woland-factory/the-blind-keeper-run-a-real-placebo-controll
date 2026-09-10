import type { FastifyReply, FastifyRequest } from "fastify";
import { resolveSession, SESSION_COOKIE } from "./auth.js";

export interface ErrorEnvelope {
  error: { code: string; message: string };
}

export function errorEnvelope(code: string, message: string): ErrorEnvelope {
  return { error: { code, message } };
}

/**
 * Whether the current request arrived over a secure channel. On staging TLS
 * terminates upstream, so the Secure cookie flag derives from the forwarded
 * protocol or the configured base URL scheme, never from NODE_ENV.
 */
export function isSecureRequest(request: FastifyRequest): boolean {
  const forwarded = request.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (proto) return proto.split(",")[0].trim() === "https";
  return request.server.env.APP_BASE_URL.startsWith("https://");
}

/**
 * Server-side authorization guard. Resolves the signed session cookie to a
 * user or rejects with 401. Every data route must use this. Hiding a control
 * on the client is not access control.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) {
    await reply.code(401).send(errorEnvelope("unauthorized", "Sign in to continue."));
    return;
  }
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) {
    await reply.code(401).send(errorEnvelope("unauthorized", "Sign in to continue."));
    return;
  }
  const user = await resolveSession(request.server.db, unsigned.value);
  if (!user) {
    await reply.code(401).send(errorEnvelope("unauthorized", "Sign in to continue."));
    return;
  }
  request.user = user;
}
