import type { FastifyBaseLogger } from "fastify";
import type { Env } from "./env.js";

// One mailer client with two transports. "central" posts to the shared mailer;
// "console" logs only the verify path with the raw token (never the email) so
// the flow stays testable end to end without leaking PII.

export interface Mailer {
  sendMagicLink(email: string, verifyUrl: string): Promise<void>;
  /** Console transport only: the most recent link issued for an email. */
  lastLinkFor(email: string): string | undefined;
}

const SUBJECT = "Your blind-keeper sign-in link";
const HEADING = "Sign in to blind-keeper";
const BUTTON = "Sign in";
const FALLBACK = "This link works once and expires in 15 minutes.";
const FROM_NAME = "blind-keeper";

function renderHtml(verifyUrl: string): string {
  return [
    `<h1>${HEADING}</h1>`,
    `<p><a href="${verifyUrl}" style="display:inline-block;padding:12px 20px;background:#1b3a5b;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">${BUTTON}</a></p>`,
    `<p>${FALLBACK}</p>`,
    `<p>${verifyUrl}</p>`,
  ].join("");
}

export function createMailer(env: Env, log: FastifyBaseLogger): Mailer {
  const lastLinks = new Map<string, string>();

  return {
    lastLinkFor(email: string) {
      return lastLinks.get(email.toLowerCase());
    },
    async sendMagicLink(email: string, verifyUrl: string): Promise<void> {
      if (env.mailTransport === "console") {
        lastLinks.set(email.toLowerCase(), verifyUrl);
        // Log only the route, never the email address and never the raw token.
        // The link itself is retrievable via the console-only dev endpoint.
        log.info({ verifyPath: new URL(verifyUrl).pathname }, "magic link issued (console transport)");
        return;
      }

      const res = await fetch(`${env.MAILER_URL}/send`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Internal-Key": env.INTERNAL_SERVICE_KEY ?? "",
        },
        body: JSON.stringify({
          to: email,
          subject: SUBJECT,
          html_content: renderHtml(verifyUrl),
          from_name: FROM_NAME,
        }),
      });
      if (!res.ok) {
        // Log the failure by status only, never the recipient.
        log.error({ status: res.status }, "mailer send failed");
        throw new Error("mailer_failed");
      }
    },
  };
}
