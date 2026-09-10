import { createHash, randomBytes } from "node:crypto";
import type { Db } from "./db/index.js";

export const SESSION_COOKIE = "bk_session";
export const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface User {
  id: string;
  email: string;
}

/** Upsert a user by email and return it. */
export async function upsertUser(db: Db, email: string): Promise<User> {
  const normalized = normalizeEmail(email);
  const rows = await db.query<User>(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id, email::text AS email`,
    [normalized]
  );
  return rows[0];
}

/** Create a magic token for a user and return the raw token (never stored). */
export async function issueMagicToken(db: Db, userId: string, now = Date.now()): Promise<string> {
  const raw = generateRawToken();
  const expiresAt = new Date(now + TOKEN_TTL_MS).toISOString();
  await db.query(
    `INSERT INTO magic_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hashToken(raw), expiresAt]
  );
  return raw;
}

/**
 * Consume a raw token: it must exist by hash, be unexpired, and unconsumed.
 * On success returns the user and marks the token consumed atomically.
 */
export async function consumeMagicToken(db: Db, raw: string): Promise<User | null> {
  const hash = hashToken(raw);
  const rows = await db.query<{ user_id: string }>(
    `UPDATE magic_tokens
        SET consumed_at = now()
      WHERE token_hash = $1
        AND consumed_at IS NULL
        AND expires_at > now()
      RETURNING user_id`,
    [hash]
  );
  if (rows.length === 0) return null;
  const users = await db.query<User>(
    `SELECT id, email::text AS email FROM users WHERE id = $1`,
    [rows[0].user_id]
  );
  return users[0] ?? null;
}

export async function createSession(db: Db, userId: string, now = Date.now()): Promise<string> {
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
  const rows = await db.query<{ id: string }>(
    `INSERT INTO sessions (user_id, expires_at) VALUES ($1, $2) RETURNING id`,
    [userId, expiresAt]
  );
  return rows[0].id;
}

export async function resolveSession(db: Db, sessionId: string): Promise<User | null> {
  const rows = await db.query<User>(
    `SELECT u.id, u.email::text AS email
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [sessionId]
  );
  return rows[0] ?? null;
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}
