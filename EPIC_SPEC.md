# EPIC SPEC — EPIC 1: Foundation, auth, and staging scaffold

## Quality differentiator (this app must win on it)

**Trust: you can believe the answer.** The verdict is one the user did not
generate and could not bias, and when the data cannot decide, the app says so
plainly instead of manufacturing confidence.

What this demands of THIS epic: the foundation must make the "secret held
server-side" architecture real from day one. The database and API skeleton must
be built so that experiment allocation data (which day was active vs. blank) can
only ever live server-side and can never be serialized into a client response by
accident. This epic ships no experiment features, but it must lay the schema and
the response-shaping discipline that later epics depend on to keep the blind. In
copy, the trust differentiator means honest, plain wording everywhere: no
overclaiming, no filler, no manufactured confidence. Establish that voice now.

---

## 1. Scope

### In scope
- A monorepo with a backend service and a frontend web app.
- PostgreSQL database with a forward-only migration runner and the product's
  core schema (users, sessions, magic tokens, experiments, allocations,
  check-ins, verdicts). This epic **creates the schema**; it builds **no
  experiment logic or endpoints** beyond what the demo seed inserts directly.
- Passwordless magic-link authentication end to end, using the central mailer,
  with server-side session issuance.
- Mobile-first application shell (390px baseline) with a public landing /
  first-run screen and a minimal authenticated home.
- Security baseline: server-side authorization on every data route, input
  validation at the boundary, rate limiting on auth and mutation endpoints,
  secrets via env only, no PII in logs.
- Error tracking (Sentry/GlitchTip DSN) and analytics (Umami) wired into both
  backend and frontend.
- `Dockerfile`, `docker-compose.staging.yml`, and a passing health check.
- A `SEED_DEMO` path that idempotently provisions a demo account containing one
  fully completed experiment (static seed rows, not computed).
- A `README.md` skeleton written for strangers.

### Out of scope (do not build — later epics or non-goals)
- **Any experiment feature**: the designer, pre-registration, allocation
  generation, prep walkthrough, check-in loop, dashboard, break-blind,
  unblinding, verdict engine, formulary UI, export. These are EPICs 2–6. Note
  the schema tables exist after this epic, but **no endpoints or business logic
  that read/write them** are built here except the demo seed's direct inserts.
- **Any statistics / verdict computation.** The demo verdict is hand-authored
  static data, not computed. No permutation test, no binomial test, nothing.
- **Notifications / email reminders.** (EPIC 4.)
- **The guided first-run walkthrough** (QUALITY BAR §4 "walk the first
  success"). It is explicitly EPIC 7's scope, and there is no core action to
  walk in this epic. The landing screen must satisfy first-run *clarity* (state
  what the app does, offer one primary action) but must NOT build a multi-step
  guided tour. Do not build it here; do not flag its absence as a defect here.
- LLM features of any kind.

---

## 2. Technical design

### 2.1 Stack (authoritative — build exactly this)

- **Language/runtime:** Node.js 20 LTS, TypeScript (strict).
- **Repo layout:** npm workspaces monorepo.
  ```
  /package.json            # workspaces: ["server", "web"]
  /server                  # Fastify API + serves built web assets
  /web                     # React + Vite SPA
  /docker-compose.staging.yml
  /Dockerfile              # multi-stage: build web, build server, run
  /.env.example
  /.gitignore
  /README.md
  ```
- **Backend:** Fastify 4 + TypeScript. Plugins/libs:
  `@fastify/cookie` (signed cookies), `@fastify/rate-limit`, `@fastify/static`
  (serve the built SPA), `zod` (boundary validation), `drizzle-orm` +
  `postgres` (pg driver), `@sentry/node`.
- **Frontend:** React 18 + Vite + TypeScript, `react-router-dom`,
  `@sentry/react`. No component/UI framework dependency required; hand-written
  mobile-first CSS is fine. Keep the dependency surface small.
- **Database:** PostgreSQL 16.
- **Tests:** Vitest (backend unit/integration via `fastify.inject`), Playwright
  (frontend e2e incl. 390px viewport and full magic-link flow).

The single app container serves the API under `/api/*` and serves the built SPA
for all other routes (SPA fallback to `index.html`). This keeps the compose file
to two services (`app`, `db`) with one health check.

### 2.2 Configuration and secrets

All configuration via environment. Provide `.env.example` with placeholders only;
`.env` is gitignored and never committed. Validate env at startup with zod and
**fail fast with a clear message** if a required var is missing in production.

| Var | Required | Purpose |
|---|---|---|
| `NODE_ENV` | yes | `development` / `production` |
| `PORT` | no (default 8080) | HTTP port |
| `DATABASE_URL` | yes | Postgres connection string |
| `APP_BASE_URL` | yes | Public base URL, used to build magic links |
| `SESSION_COOKIE_SECRET` | yes | Signs the session cookie (min 32 chars) |
| `MAIL_TRANSPORT` | no (default `central` in prod, `console` in dev) | `central` \| `console` |
| `INTERNAL_SERVICE_KEY` | yes when `MAIL_TRANSPORT=central` | `X-Internal-Key` for central mailer |
| `MAILER_URL` | no (default `http://central-mailer-prod-api:8000`) | Central mailer base |
| `SENTRY_DSN` | no | Backend error tracking; disabled if unset |
| `SEED_DEMO` | no (default `false`) | When `true`, run the demo seed at startup |
| `RATE_LIMIT_MAX` | no (default 100) | Global requests/min/IP |
| `VITE_SENTRY_DSN` | no | Frontend error tracking (build-time) |
| `VITE_UMAMI_WEBSITE_ID` | no | Umami analytics website id (build-time) |
| `VITE_UMAMI_URL` | no | Umami script endpoint (build-time) |

No secret value appears in any tracked file. `.env.example` contains only
placeholders (e.g. `SESSION_COOKIE_SECRET=change-me-min-32-chars`).

### 2.3 Data model (initial forward-only migration `0001_init.sql`)

Migrations are plain SQL files in `server/migrations/`, applied in filename order
by a small runner at startup, tracked in a `schema_migrations(version text pk,
applied_at timestamptz)` table. Application is idempotent (already-applied
versions are skipped). Forward-only: never edit an applied migration; add a new
one.

Create the product's core schema now (the DB is this epic's responsibility).
Later epics add endpoints/logic and, where needed, new forward-only migrations.
**This epic writes no code that reads or mutates the experiment tables except the
demo seed.**

- `users` — `id uuid pk default gen_random_uuid()`, `email citext unique not
  null`, `created_at timestamptz not null default now()`. (Enable the `citext`
  extension for case-insensitive email.)
- `magic_tokens` — `id uuid pk`, `user_id uuid not null references users(id) on
  delete cascade`, `token_hash text not null` (SHA-256 of the raw token; the raw
  token is never stored), `expires_at timestamptz not null`, `consumed_at
  timestamptz`, `created_at timestamptz not null default now()`. Index on
  `token_hash`.
- `sessions` — `id uuid pk`, `user_id uuid not null references users(id) on
  delete cascade`, `expires_at timestamptz not null`, `created_at timestamptz
  not null default now()`. The signed cookie carries the session id.
- `experiments` — per the plan's data-model sketch: `id uuid pk`, `user_id uuid
  not null references users(id)`, `substance_name text`, `metric_name text`,
  `metric_type text`, `metric_direction text`, `block_length_days int`,
  `num_blocks int`, `num_active_blocks int`, `washout_note text`, `status text
  not null` (`designing|prepped|running|unblinded|voided`), `pre_registered_at
  timestamptz`, `start_date date`, `planned_end_date date`, `created_at
  timestamptz not null default now()`. Index on `user_id`.
- `allocations` (**SECRET — server-side only, never serialized to a client
  before unblinding**) — `id uuid pk`, `experiment_id uuid not null references
  experiments(id) on delete cascade`, `block_index int`, `code text`,
  `condition text` (`active|placebo`), `block_start_date date`, `block_end_date
  date`.
- `check_ins` — `id uuid pk`, `experiment_id uuid not null references
  experiments(id) on delete cascade`, `check_date date not null`, `metric_value
  numeric`, `note text`, `placebo_guess text` (`placebo|active|unsure`),
  `submitted_at timestamptz not null default now()`, unique
  `(experiment_id, check_date)`.
- `verdicts` — `id uuid pk`, `experiment_id uuid not null unique references
  experiments(id) on delete cascade`, `effect_estimate numeric`, `effect_units
  text`, `permutation_p_value numeric`, `guess_accuracy numeric`,
  `guess_p_value_vs_chance numeric`, `adherence_pct numeric`,
  `blind_integrity_flag boolean`, `power_note text`, `verdict_text text`,
  `computed_at timestamptz not null default now()`.

Document, as a code comment in the model layer, the invariant: **the `allocations`
table must never be included in any API response.** Later epics rely on this.

### 2.4 API contracts

All API routes are under `/api`. Non-auth data routes require a valid session;
an unauthenticated request is rejected **server-side** with `401` (never rely on
the client hiding a control). Standard error envelope for every 4xx/5xx:

```json
{ "error": { "code": "string_slug", "message": "human, product-voice sentence" } }
```

In production the error handler never leaks stack traces or internal messages;
it maps unknown errors to a generic `{ "error": { "code": "internal", "message":
"The request failed on our side. Try again in a moment." } }` with 500 and
reports to Sentry. (Keep it short, plain, and honest.)

- `GET /api/healthz` → `200 { "status": "ok" }` only when a `SELECT 1` against
  the DB succeeds; otherwise `503 { "status": "degraded" }`. No auth. Used by the
  compose health check.
- `POST /api/auth/magic-link` — body `{ "email": string }`, validated with zod
  (trimmed, RFC-ish email, max 254 chars). Always responds `200 { "ok": true }`
  regardless of whether the email maps to an existing user (**no account
  enumeration**). Side effect: upsert the user, create a `magic_tokens` row
  (raw token = 32 bytes base64url, store only its SHA-256 hash, `expires_at =
  now()+15min`), and send the link `${APP_BASE_URL}/auth/verify?token=RAW` via
  the mailer. Rate-limited (see 2.5). Never log the email or the raw token.
- `GET /api/auth/verify?token=...` — validate token: must exist by hash, not be
  expired, not be consumed. On success: mark consumed, create a `sessions` row,
  set a signed httpOnly, `SameSite=Lax`, `Secure` (in prod) session cookie, and
  `302` redirect to `/` (the authenticated home). On failure: redirect to
  `/auth/expired` (a designed error screen). Rate-limited.
- `POST /api/auth/logout` — clears the session cookie, deletes the session row,
  `200 { "ok": true }`. Requires auth. Rate-limited as a mutation.
- `GET /api/me` — requires auth; returns `{ "email": string }` for the signed-in
  user (used by the shell to render the greeting and prove the session works).
  Returns `401` when unauthenticated.

No experiment endpoints are built in this epic.

### 2.5 Security baseline (binding)

- **Authorization:** a `requireAuth` Fastify pre-handler resolves the session
  cookie → session row → user, and rejects with `401` when absent/expired.
  Applied to `GET /api/me` and `POST /api/auth/logout`, and documented as the
  mandatory guard for all future data routes. A test proves an unauthenticated
  request to a data route is rejected server-side.
- **Boundary validation:** every request body/query parsed with a zod schema at
  the route boundary; on failure return `400` with the standard error envelope
  and a plain message (never a stack trace, never the raw zod dump to the user).
- **Rate limiting:** `@fastify/rate-limit` global default (`RATE_LIMIT_MAX`/min
  per IP). Stricter bucket on `POST /api/auth/magic-link` and
  `GET /api/auth/verify` (e.g. 5/min per IP) and on all mutation routes
  (`POST /api/auth/logout`). Over-limit returns `429` with the standard error
  envelope. A test proves the auth limiter trips.
- **Secrets via env only:** verified by 2.2; `.gitignore` excludes `.env`.
- **No PII in logs:** configure the Fastify logger to redact `req.body.email`,
  `req.headers.authorization`, `req.headers.cookie`, and never log email
  addresses or raw tokens anywhere. Log users by `user_id` only. A test/grep
  step confirms no email or token is logged on the auth path.
- **Session cookie:** signed with `SESSION_COOKIE_SECRET`, httpOnly,
  `SameSite=Lax`, `Secure` in production, sensible `Max-Age` matching
  `sessions.expires_at`.

### 2.6 Mailer integration

Single mailer client. `MAIL_TRANSPORT=central` → `POST ${MAILER_URL}/send` with
header `X-Internal-Key: ${INTERNAL_SERVICE_KEY}` and body
`{ to, subject, html_content, from_name }`. The email contains one clear button
/link to the verify URL and plain fallback text. `MAIL_TRANSPORT=console` (dev
and test default) → do not send; log **only the verify path with the raw token**
(no email address) at info level so Playwright can complete the flow. This keeps
the flow end-to-end testable without leaking PII.

Email copy (sweep-clean, provide verbatim):
- Subject: `Your blind-keeper sign-in link`
- Body heading: `Sign in to blind-keeper`
- Button: `Sign in`
- Fallback line: `This link works once and expires in 15 minutes.`
- from_name: `blind-keeper`

### 2.7 Frontend shell (mobile-first, 390px baseline)

Routes:
- `/` — **Landing / first-run** when unauthenticated; **authenticated home**
  when a session exists (decided by `GET /api/me`).
- `/auth/check-email` — confirmation after requesting a link.
- `/auth/expired` — designed error screen for an invalid/expired link.

**Landing (unauthenticated).** Must render real content (server-fast, no blank
page) at 390px within ~1s. States in one glance what the app does and offers
exactly one primary action.
- Heading (verbatim): `Run a real placebo test on yourself.`
- Subhead (verbatim): `Pick a supplement. Stay blind for a few weeks. Get an
  honest verdict you could not fake.`
- Primary action: an email field + one button `Send my sign-in link`. On submit,
  call `POST /api/auth/magic-link`, then route to `/auth/check-email`. Button
  shows a pressed/loading state within 100ms; disable double-submit.
- No second competing CTA. Secondary text stays visibly subordinate.

**Authenticated home (the shell).** Proves auth works and hosts the app for
later epics. At 390px:
- Header with the product name and a `Sign out` control (calls
  `POST /api/auth/logout`, returns to landing).
- A **designed empty state** (not a blank region) that names what comes next and
  offers one primary action. Verbatim:
  - Heading: `Start your first blind test`
  - Body: `You choose a supplement and a daily score. We keep the schedule
    secret so you stay blind. At the end you get a verdict.`
  - Primary button: `Design a test` → routes to `/design`.
- `/design` in this epic is a **reserved placeholder route** that renders a
  designed "not built yet" state honestly, so the shell is navigable without
  building EPIC 2. Verbatim: heading `The designer opens soon`, body `This is
  where you will set up your first test.`, plus a `Back` link. (Do NOT build any
  designer functionality. This placeholder exists only so the primary action is
  not a dead button.)

**Designed states everywhere (QUALITY BAR §3).** Each screen that fetches
(`/api/me`) holds layout steady with a skeleton/spinner in place (no white
flash), and renders a product-voice error state with a retry on failure. The
`/auth/expired` screen is a first-class designed error, not a redirect to blank.
Verbatim for `/auth/expired`: heading `That link expired`, body `Sign-in links
work once and last 15 minutes. Request a new one.`, primary button `Send a new
link` → back to the landing form.

**Analytics + error tracking (frontend).** Initialize Umami (via
`VITE_UMAMI_WEBSITE_ID` / `VITE_UMAMI_URL`) and Sentry (`VITE_SENTRY_DSN`) only
when their env vars are present; both are no-ops when unset (local dev must not
crash without them).

**Accessibility & mobile (QUALITY BAR §2, §6):** semantic headings/landmarks,
every input labeled, visible focus states, ~44px touch targets, sufficient
contrast, no horizontal scroll at 390px, keyboard reaches every control.

### 2.8 SEED_DEMO

When `SEED_DEMO=true`, after migrations, run an **idempotent** seed:
- A fixed demo user (email e.g. `demo@blind-keeper.app`), created only if absent
  (look up by email; do not duplicate on re-run).
- One `experiment` for that user with `status='unblinded'`, a full set of
  `allocations`, a realistic run of `check_ins`, and one `verdict` row — all
  hand-authored static data representing a completed run. Re-running the seed
  makes no duplicate rows (guard on the demo user + a stable experiment key).
- No statistics are computed; the verdict numbers are static demo values.
- Off by default (`SEED_DEMO` unset/false → seed never runs).
- Provide a way to sign in as the demo account on staging without a real
  mailbox: when `SEED_DEMO=true`, the console transport (or a documented staging
  step) exposes the demo user's magic link so a reviewer can enter the account.
  Keep this behind `SEED_DEMO`; never enable it in a normal production boot.

Demo verdict copy (sweep-clean, static, verbatim `verdict_text`):
`Your sleep scores could not tell magnesium from a blank. You guessed the blank
days about as often as a coin flip.` (`power_note` verbatim: `This run was small,
so it can miss a weak effect. Read a null as "not enough signal," not "proven
nothing."`)

### 2.9 Docker & staging

- **`Dockerfile`** multi-stage: (1) build `web` (Vite → static assets), (2) build
  `server` (tsc/esbuild), (3) runtime image (Node 20 slim) that runs migrations
  then starts the server, which serves the API and the built web assets.
- **`docker-compose.staging.yml`**: services `db` (postgres:16 with a named
  volume) and `app` (built from the Dockerfile). All secrets come from env, none
  hardcoded. `app` depends on `db` being healthy. Compose defines a health check
  on `app` hitting `GET /api/healthz`; the stack is "up and healthy" only when
  that passes. On boot, `app` runs migrations and, if `SEED_DEMO=true`, the seed.

### 2.10 README skeleton (for strangers)

Plain-language `README.md`: what the app is (2–3 sentences, honest, no factory
internals), how to run it (exact, verified commands: clone, copy `.env.example`
to `.env`, `docker compose -f docker-compose.staging.yml up`), and how to
contribute (where `server/` and `web/` live, how to run the tests). No mention of
the App Factory, agents, task types, or internal paths. Verify every command
against the actual compose/Docker files before claiming it works. Sweep all
prose for banned vocabulary and em-dashes.

---

## 3. Ordered task list (with acceptance criteria)

1. **Monorepo & tooling scaffold.** npm workspaces, TypeScript strict configs
   for `server` and `web`, `.gitignore` (excludes `.env`, `node_modules`,
   build output), `.env.example` with placeholders per 2.2.
   - *AC:* `npm install` at root installs both workspaces; `.env` is gitignored;
     `.env.example` has every var from 2.2 with placeholder (non-secret) values.

2. **DB migration runner + `0001_init.sql`.** Runner applies pending SQL
   migrations in order, tracked in `schema_migrations`, idempotently. Schema per
   2.3 (incl. `citext`, `pgcrypto`/`gen_random_uuid`).
   - *AC:* running the runner twice applies once and is a no-op the second time;
     all tables from 2.3 exist; re-run does not error.

3. **Backend skeleton.** Fastify app, zod-validated env loader (fail-fast in
   prod), logger with PII redaction (2.5), global error handler with the
   standard envelope and no stack leakage in prod, Sentry init (no-op if DSN
   unset), `GET /api/healthz`, `@fastify/static` serving the built SPA with
   history fallback.
   - *AC:* `GET /api/healthz` returns 200 with DB up and 503 with DB down;
     unknown-route errors return the standard envelope, not a stack trace, in
     production mode.

4. **Magic-link auth.** Mailer client (central + console transports),
   `POST /api/auth/magic-link`, `GET /api/auth/verify`, session issuance +
   signed cookie, `requireAuth`, `GET /api/me`, `POST /api/auth/logout`.
   - *AC:* full flow works end to end using the console transport in a test;
     tokens are single-use and expire; `GET /api/me` is 401 without a session and
     200 with one; requesting a link for any email returns 200 (no enumeration).

5. **Rate limiting & validation.** Global limiter + strict auth/mutation
   buckets; zod schemas at every boundary.
   - *AC:* exceeding the auth limiter returns 429 with the standard envelope;
     malformed `POST /api/auth/magic-link` body returns 400 with a plain message,
     never a stack trace.

6. **Frontend shell.** Vite React app per 2.7: landing/first-run, check-email,
   expired, authenticated home + placeholder `/design`, designed
   empty/loading/error states, Umami + Sentry (no-op when env absent),
   mobile-first CSS at 390px, accessibility basics.
   - *AC:* landing renders real content at 390px within ~1s with one primary
     action; sign-out works; loading holds layout; error states are designed and
     in product voice; no horizontal scroll at 390px; keyboard reaches every
     control.

7. **SEED_DEMO.** Idempotent demo seed per 2.8, off by default.
   - *AC:* with `SEED_DEMO=true` a demo user with one `unblinded` experiment and
     a static `verdict` exists; re-running creates no duplicates; with `SEED_DEMO`
     unset the seed does not run.

8. **Docker & staging compose.** `Dockerfile` + `docker-compose.staging.yml` per
   2.9; migrations (and optional seed) run on boot; health check wired.
   - *AC:* `docker compose -f docker-compose.staging.yml up` builds and serves
     the app; the `app` service reaches healthy via `GET /api/healthz`; no secret
     is committed (all via env).

9. **README skeleton.** Per 2.10.
   - *AC:* a stranger can understand, run (commands verified against the compose
     files), and contribute; no factory internals; passes the copy sweep.

10. **Tests + mechanical copy sweep.** Vitest integration + Playwright e2e (2.11
    below); run the copy sweep over every user-visible string.
    - *AC:* all listed tests pass; the copy sweep finds no `—`/`–`, no banned
      vocabulary, no negative empty-state phrasing in any shipped or seed string.

---

## 4. Test plan (which test proves each acceptance criterion)

Automated, run in the foreground to completion before writing `result.json`.

**Backend (Vitest, `fastify.inject` against a test Postgres):**
- `healthz.test`: 200 when DB reachable; 503 when the DB check fails. → *compose
  health check criterion (backend half).*
- `auth-flow.test`: `POST /api/auth/magic-link` returns 200 for known and unknown
  emails (no enumeration); console transport surfaces exactly one token;
  `GET /api/auth/verify` with that token sets a session and redirects;
  `GET /api/me` returns the email with the session cookie and **401 without it**;
  a second use of the same token fails; an expired token fails. → *magic-link end
  to end + unauthenticated data route rejected server-side.*
- `rate-limit.test`: the auth limiter returns 429 after the configured burst. →
  *auth/mutation rate-limited.*
- `validation.test`: malformed magic-link body → 400 with the standard envelope
  and no stack trace; production error handler maps an unexpected throw to the
  generic envelope. → *malformed input rejected at boundary, no stack trace.*
- `no-pii-logs.test`: capture logger output across the auth path and assert no
  email address and no raw token appears. → *no PII in logs.*
- `migrations.test`: apply twice → idempotent; all tables present. → *DB
  baseline.*
- `seed.test`: with `SEED_DEMO=true` the demo user + one `unblinded` experiment +
  a `verdict` exist; running the seed twice yields no duplicates; without the
  flag the seed is a no-op. → *SEED_DEMO idempotent, off by default, completed
  experiment present.*
- `allocation-never-serialized.test`: assert no API response body in this epic
  includes allocation rows (guards the trust invariant for later epics).

**Frontend / e2e (Playwright, 390px viewport project):**
- `landing.spec`: at 390px the landing shows the heading (real content) quickly,
  has exactly one primary action, and no horizontal scroll. → *landing criterion.*
- `magic-link-e2e.spec`: submit email → check-email screen → read the token from
  the console transport → visit verify link → land authenticated → `Sign out`
  returns to landing. → *magic-link works end to end through the UI.*
- `designed-states.spec`: expired-link screen renders the designed error (product
  voice, a next step); the authenticated home renders the designed empty state,
  not a blank region; loading holds layout. → *designed states.*
- `a11y-smoke.spec`: inputs labeled, visible focus, keyboard reaches the primary
  action. → *accessibility basics.*

**Non-automated verification (record in `result.json` summary):**
- `docker compose -f docker-compose.staging.yml up` builds and the `app` service
  reaches healthy; confirm no secret is committed (grep tracked files). → *compose
  criterion (integration half).*
- Mechanical copy sweep over every user-visible string (components, seed copy,
  email copy, README): search for `—`, `–`, the banned vocabulary, and negative
  empty-state phrasing (`You don't have`, `No … yet`, `Nothing … here`, `Unable
  to`, `Something went wrong`). Fix every hit. → *copy quality.*

---

## 5. Definition of done

All acceptance criteria in §3 are met and all §4 tests pass; the staging compose
stack builds and reports healthy; no secret is committed; the copy sweep is
clean; the README's run commands are verified against the actual compose/Docker
files. Nothing from the Non-Goals (§1 out-of-scope) is built. `EPIC_SPEC.md`
(this file) is the only artifact this task leaves; the implementer executes it.
