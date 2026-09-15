import type { FastifyBaseLogger } from "fastify";
import type { Env } from "./env.js";

// One mailer client with two transports. "central" posts to the shared mailer;
// "console" logs only the verify path with the raw token (never the email) so
// the flow stays testable end to end without leaking PII.

export interface Mailer {
  sendMagicLink(email: string, verifyUrl: string): Promise<void>;
  /** One daily check-in reminder linking back to the app. */
  sendDailyReminder(email: string, appUrl: string): Promise<void>;
  /** Console transport only: the most recent link issued for an email. */
  lastLinkFor(email: string): string | undefined;
  /** Console transport only: how many reminders an email has received. */
  reminderCountFor(email: string): number;
}

const SUBJECT = "Your blind-keeper sign-in link";
const HEADING = "Sign in to blind-keeper";
const BUTTON = "Sign in";
const FALLBACK = "This link works once and expires in 15 minutes.";
const FROM_NAME = "blind-keeper";

const REMINDER_SUBJECT = "Your blind-keeper check-in";
const REMINDER_HEADING = "Time for today's check-in";
const REMINDER_BODY = "Open today's packet, take it, and log your score.";
const REMINDER_BUTTON = "Open blind-keeper";

function renderHtml(verifyUrl: string): string {
  return [
    `<h1>${HEADING}</h1>`,
    `<p><a href="${verifyUrl}" style="display:inline-block;padding:12px 20px;background:#1b3a5b;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">${BUTTON}</a></p>`,
    `<p>${FALLBACK}</p>`,
    `<p>${verifyUrl}</p>`,
  ].join("");
}

function renderReminderHtml(appUrl: string): string {
  return [
    `<h1>${REMINDER_HEADING}</h1>`,
    `<p>${REMINDER_BODY}</p>`,
    `<p><a href="${appUrl}" style="display:inline-block;padding:12px 20px;background:#1b3a5b;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">${REMINDER_BUTTON}</a></p>`,
  ].join("");
}

export function createMailer(env: Env, log: FastifyBaseLogger): Mailer {
  const lastLinks = new Map<string, string>();
  const reminderCounts = new Map<string, number>();

  return {
    lastLinkFor(email: string) {
      return lastLinks.get(email.toLowerCase());
    },
    reminderCountFor(email: string) {
      return reminderCounts.get(email.toLowerCase()) ?? 0;
    },
    async sendDailyReminder(email: string, appUrl: string): Promise<void> {
      if (env.mailTransport === "console") {
        const key = email.toLowerCase();
        reminderCounts.set(key, (reminderCounts.get(key) ?? 0) + 1);
        // Log only that a reminder went out, never the recipient.
        log.info("daily reminder issued (console transport)");
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
          subject: REMINDER_SUBJECT,
          html_content: renderReminderHtml(appUrl),
          from_name: FROM_NAME,
        }),
      });
      if (!res.ok) {
        // Log the failure by status only, never the recipient.
        log.error({ status: res.status }, "reminder send failed");
        throw new Error("mailer_failed");
      }
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
