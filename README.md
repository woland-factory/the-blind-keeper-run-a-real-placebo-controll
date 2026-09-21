# blind-keeper

Run a real placebo-controlled test on a supplement, on yourself.

You pick a supplement and one daily score. The app designs a blinded on/off
schedule and keeps it secret so you stay genuinely blind for a few weeks. Each
day you log your score and guess whether that day was the blank. At the end it
gives you a verdict you did not generate and could not bias: whether the
supplement beat the blank, and whether you could actually feel the difference.

This repository has the whole loop. Open `/design` to pick a supplement and a
daily score and see live statistical power as you set the length, then lock the
plan into a sealed, pre-registered summary. Prepare your numbered capsules from a
blind-safe sheet, start the run, and log a short daily check-in with a guess of
whether that day was the blank. On unblinding day the app computes a deterministic
verdict: whether the supplement beat the blank, and whether you could actually
feel the difference. Every finished run lands in a personal formulary you can
export as JSON, and when you design a new run for a metric you have measured
before, the power estimate uses your own day-to-day noise.

## Run it locally

You need Node.js 20 or newer.

```bash
git clone <this-repo-url> blind-keeper
cd blind-keeper
npm install
npm run build
DB_DRIVER=pglite SESSION_COOKIE_SECRET=a-random-string-at-least-32-chars SEED_DEMO=true npm start
```

Open http://localhost:8080.

`DB_DRIVER=pglite` runs an in-process database that needs nothing to install and
resets when you stop the server. `SEED_DEMO=true` loads one completed demo
experiment so the app has real content to show.

Sign-in is passwordless. In local mode the app prints links instead of sending
email, so request a link on the landing page, then read it back:

```bash
curl "http://localhost:8080/api/dev/last-magic-link?email=you@example.com"
```

Open that link to sign in.

## Configuration

Copy `.env.example` to `.env` and edit the values. The important ones:

- `DATABASE_URL` for a real PostgreSQL 16 database (or set `DB_DRIVER=pglite`
  for the in-process option above).
- `SESSION_COOKIE_SECRET`, a random string of at least 32 characters.
- `APP_BASE_URL`, the public URL the app is served from.

`.env` is never committed. `.env.example` holds placeholders only.

## Run with PostgreSQL

For a persistent database, point `DATABASE_URL` at any PostgreSQL 16 instance and
start the app without the `DB_DRIVER` override:

```bash
DATABASE_URL=postgres://user:password@localhost:5432/blindkeeper \
SESSION_COOKIE_SECRET=a-random-string-at-least-32-chars \
npm start
```

The app applies its migrations on startup, so a fresh, empty database is all it
needs.

`docker-compose.staging.yml` is the deployment manifest: the app plus PostgreSQL
16 behind a reverse proxy. It is meant for a hosted environment rather than a
laptop, since the web service is reached through the proxy and does not publish a
port directly.

On staging the app seeds one demo account (`SEED_DEMO=1`) and prints sign-in
links to its own logs (`MAIL_TRANSPORT=console`). To see a real finished verdict
in under a minute:

1. On the landing page, request a sign-in link for `demo@blind-keeper.app`.
2. Read the link from the app logs (`docker logs` on the web container).
3. Open it. You land on the demo formulary with one finished run.
4. Tap the run to read its verdict: a genuine near-null result the engine
   computed over the seeded data.

## How it is built

- `server/` is a Fastify API in TypeScript. It owns the database, the
  forward-only SQL migrations in `server/migrations/`, passwordless auth, and it
  serves the built web app.
- `web/` is a React single-page app built with Vite, mobile-first from a 390px
  baseline.

The blinding schedule lives in the `allocations` table and is never sent to the
browser before unblinding. That rule is the product's whole point, so the code
keeps it server-side by design.

## Tests

Backend tests (Vitest) run against an in-process database:

```bash
npm test
```

End-to-end tests (Playwright) drive the real sign-in flow at a 390px viewport.
They run inside the official Playwright container so the browser build matches
the pinned version:

```bash
./scripts/e2e.sh
```

Both use an in-process database and clean up after themselves, so no external
service is required.

## License

MIT. See [LICENSE](LICENSE).
