import type { Db } from "./db/index.js";
import type { Mailer } from "./mailer.js";

// The daily reminder sweep. At most one email per user per calendar day, enforced
// by the reminder_sends UNIQUE (user_id, send_date) guard, so it can never storm
// no matter how often the sweep runs or how many running experiments a user has.

interface ReminderLog {
  error(obj: unknown, msg?: string): void;
}

/**
 * Send today's check-in reminder to every user with a running experiment whose
 * check-in is still open. Claims each user's day atomically, then sends only on a
 * successful claim. A send failure leaves the claimed row in place, so a failed
 * user is skipped until tomorrow instead of retried into a storm.
 */
export async function sendDailyReminders(
  db: Db,
  mailer: Mailer,
  appBaseUrl: string,
  log: ReminderLog
): Promise<{ sent: number }> {
  const candidates = await db.query<{ user_id: string; email: string }>(
    `SELECT DISTINCT e.user_id, u.email
       FROM experiments e
       JOIN users u ON u.id = e.user_id
      WHERE e.status = 'running'
        AND CURRENT_DATE BETWEEN e.start_date AND e.planned_end_date
        AND NOT EXISTS (
          SELECT 1 FROM check_ins c
           WHERE c.experiment_id = e.id AND c.check_date = CURRENT_DATE
        )`
  );

  let sent = 0;
  for (const candidate of candidates) {
    // Claim the day. A conflict means today's reminder already went out; skip.
    const claimed = await db.query<{ id: string }>(
      `INSERT INTO reminder_sends (user_id, send_date)
       VALUES ($1, CURRENT_DATE)
       ON CONFLICT (user_id, send_date) DO NOTHING
       RETURNING id`,
      [candidate.user_id]
    );
    if (claimed.length === 0) continue;

    try {
      await mailer.sendDailyReminder(candidate.email, appBaseUrl);
      sent++;
    } catch (err) {
      // Log by status only, never the recipient. The claimed row stays, so this
      // user is skipped until tomorrow rather than retried into a storm.
      log.error({ err }, "reminder send failed");
    }
  }

  return { sent };
}
