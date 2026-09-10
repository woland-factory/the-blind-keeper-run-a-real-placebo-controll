// Database access layer.
//
// TRUST INVARIANT (load-bearing for every later epic): the `allocations` table
// holds the secret code-to-condition and code-to-day map that keeps the user
// blind. It must NEVER be included in any API response before unblinding. Route
// handlers select explicit columns from other tables; no handler selects from
// `allocations` into a client-facing payload. Guard this with a test.
//
// Two drivers sit behind one small interface. Production and staging use
// postgres-js against real PostgreSQL. Tests and e2e use an in-process PGlite
// instance so the suite provisions its own clean database with no external
// service. Only the selected driver is imported.

export interface Db {
  /** Run a parameterized query ($1, $2, ...) and return the rows. */
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Run one or more statements with no parameters (used for migration files). */
  exec(sql: string): Promise<void>;
  /** True when a trivial SELECT succeeds. */
  healthcheck(): Promise<boolean>;
  close(): Promise<void>;
}

export type DbDriver = "postgres" | "pglite";

export function resolveDriver(opts: { driver?: string; databaseUrl?: string }): DbDriver {
  if (opts.driver === "pglite") return "pglite";
  if (opts.driver === "postgres") return "postgres";
  if (!opts.databaseUrl || opts.databaseUrl.startsWith("pglite")) return "pglite";
  return "postgres";
}

export async function createDb(opts: { driver: DbDriver; databaseUrl?: string }): Promise<Db> {
  if (opts.driver === "pglite") {
    return createPgliteDb();
  }
  if (!opts.databaseUrl) {
    throw new Error("DATABASE_URL is required for the postgres driver");
  }
  return createPostgresDb(opts.databaseUrl);
}

async function createPostgresDb(databaseUrl: string): Promise<Db> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(databaseUrl, { max: 10, onnotice: () => {} });
  return {
    async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
      const rows = await sql.unsafe(text, params as never[]);
      return rows as unknown as T[];
    },
    async exec(script: string): Promise<void> {
      // Simple-query protocol (no params) runs multi-statement scripts.
      await sql.unsafe(script);
    },
    async healthcheck(): Promise<boolean> {
      try {
        await sql`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    },
    async close(): Promise<void> {
      await sql.end({ timeout: 5 });
    },
  };
}

async function createPgliteDb(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { citext } = await import("@electric-sql/pglite/contrib/citext");
  const pg = new PGlite({ extensions: { citext } });
  await pg.waitReady;
  return {
    async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
      const res = await pg.query<T>(text, params);
      return res.rows;
    },
    async exec(script: string): Promise<void> {
      await pg.exec(script);
    },
    async healthcheck(): Promise<boolean> {
      try {
        await pg.query("SELECT 1");
        return true;
      } catch {
        return false;
      }
    },
    async close(): Promise<void> {
      await pg.close();
    },
  };
}
