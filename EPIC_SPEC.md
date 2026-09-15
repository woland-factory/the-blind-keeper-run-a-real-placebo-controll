# EPIC SPEC — Daily check-in loop, dashboard, reminders, and break-blind

## Quality differentiator (this app must win on it)

**Trust: you can believe the answer.** The verdict is one the user did not
generate and could not bias, and when the data cannot decide, the app says so
plainly instead of manufacturing confidence.

What this demands of THIS epic: the running phase is where trust is either kept
or quietly lost, one day at a time. Two rules protect it. First, the blind must
hold: the daily dashboard reveals **only today's code**, never a condition, never
another block's code, never a block date, so the sealed code-to-day schedule the
user pre-registered cannot leak while the run accumulates. Second, when the user
gives up, the app must be honest about it: break-blind reveals the schedule but
**voids the run permanently** and records that fact, so a peeked run can never
later masquerade as clean evidence. The one-tap placebo guess captured here is
the raw material for the signature verdict in EPIC 5 (can the user actually feel
the difference), so it must be stored faithfully, one per day. Speed and a
sub-minute check-in serve trust: a check-in that is a chore gets skipped, and
missing days weaken the answer.

Read section 2.1 before writing a line: it settles every "does this leak?"
question in this epic.

---

## 1. Scope

### In scope
- **The running dashboard** (`/experiments/:id/run`, a new page): today's code to
  open, the streak of sealed days, days remaining, the inline daily check-in, and
  a subordinate break-blind control. Renders at 390px with designed
  empty/loading/error states.
- **A blind-safe "today" read endpoint** (`GET /api/experiments/:id/today`) that
  returns today's code and whether today's check-in is done, plus the non-secret
  progress numbers (day number, sealed-day streak, days remaining). It never
  returns a `condition`, any code other than today's, any `block_index`, or any
  block date.
- **The daily check-in** (`POST /api/experiments/:id/checkins`): one entry per
  day, metric value validated by the experiment's metric type, an optional note,
  and a one-tap placebo guess (`placebo` | `active` | `unsure`). The check date is
  the server's `CURRENT_DATE`, never client-supplied.
- **One debounced daily email reminder** via the central mailer: at most one
  email per user per day, sent only to users with a running experiment whose
  check-in for today is still open. A database guard makes the send idempotent so
  it can never storm.
- **Break-blind** (`POST /api/experiments/:id/break-blind`): reveals the schedule,
  sets `status = 'voided'`, records `broke_blind_at` permanently, and cannot be
  undone.
- **A minimal status-aware tweak to the locked summary** (`/experiments/:id`) so a
  `running` experiment offers a way into the dashboard and a `voided` experiment
  reads as voided.

### Out of scope (do not build — later epics or non-goals)
- **The verdict / unblinding** (EPIC 5). No verdict is computed or shown here.
  `POST /experiments/:id/unblind`, `GET /experiments/:id/verdict`, the permutation
  test, and the two-part reveal all belong to EPIC 5. The dashboard's `complete`
  state points forward to it without building it.
- **The formulary and export** (EPIC 6). No list of past runs, no export.
- **Push notifications** (Non-Goal). Email reminders only. No web-push, no service
  worker, no native notifications.
- **Editing past days** (Non-Goal). The check date is always the server's today.
  A day with a check-in is final. No endpoint edits, deletes, or backfills a
  prior day. There is no "edit yesterday".
- **Gamified rewards beyond the sealed-day streak** (Non-Goal). The one sealed-day
  count is the only progress reward. No badges, points, levels, confetti, or
  streak-freeze mechanics.
- **A reminder on/off setting or a settings screen.** The Settings screen in the
  product plan is not part of this epic. The reminder is on for any running
  experiment. Do not build a per-user toggle here.
- **Editing the frozen design.** Break-blind changes only `status` and
  `broke_blind_at`; the frozen design columns stay frozen (EPIC 2's DB trigger
  already permits `status` and rejects the rest).

---

## 2. Technical design

Build on the EPIC 1 + EPIC 2 + EPIC 3 foundation exactly as it stands. Reuse: the
`Db` interface (`server/src/db/index.ts`), the zod-at-the-boundary pattern,
`errorEnvelope` and `requireAuth` (`server/src/http.ts`), the `ExperimentError`
class and the owner-scoped query pattern (`server/src/experiments.ts`), the
`mutationLimit` bucket and `idSchema` already wired in
`server/src/routes/experiments.ts`, the `Mailer` interface
(`server/src/mailer.ts`), the frontend `api.ts` client, and the mobile-first CSS
with `Page` / `LoadingCard` / `ErrorState` / `Stepper` / `Segmented`. Introduce
no new dependencies.

One forward-only migration IS required (`0003`, section 2.2): it adds the
`broke_blind_at` column, the reminder debounce table, and one index. Everything
else this epic reads (`experiments.status`, `start_date`, `planned_end_date`,
`allocations.*`, `check_ins.*`) already exists from `0001_init.sql`.

### 2.1 The blinding rule during the run (read first, binding)

The whole product rests on the sealed schedule not leaking while data
accumulates. During the running phase the enemy is the user's own curiosity, so
every read surface this epic adds is held to these rules:

1. **`GET /today` reveals only today's code.** It returns the single code for the
   block whose date range contains `CURRENT_DATE`, and nothing that links a code
   to a condition or a day. It NEVER returns any other block's code, any
   `condition`, any `block_index`, or any block date. Prove it with a test that
   greps the serialized body (section 4).
2. **No condition word ever leaves `GET /today`, in any status.** For a
   `prepped`, `complete`, `voided`, or `unblinded` experiment, `today_code` is
   `null` and the payload still carries no condition. The reveal is exclusively
   the break-blind response (rule 4). This makes `/today` provably blind-safe in
   every state.
3. **The stored placebo guess is user data, not the allocation.** The check-in
   stores the user's guess (`placebo` | `active` | `unsure`). `GET /today` reports
   only `check_in_done` (a boolean); it does NOT echo the stored guess or metric
   value back. So the grep-for-`placebo` test on `/today` stays clean, and the
   guess is never used to hint at the truth.
4. **Break-blind is the one intentional reveal.** `POST /break-blind` returns the
   full schedule (each block's code, condition, and dates) because revealing it is
   the point of the action. That response, together with the already-`unblinded`
   verdict path in EPIC 5, is the only place allocation data crosses to the
   client. It is gated on the action that also voids the run.

The trust invariant this epic protects is therefore: **while an experiment is
sealed (`prepped`/`running`), no code-to-condition, no code-to-day schedule, and
no condition label ever leaves the server; the daily dashboard exposes only
today's code.** Guard it with the tests in section 4.

### 2.2 Migration `0003_run_loop.sql` (new, forward-only)

Never edit an applied migration; this is a new file after `0002`.

```sql
-- 0003_run_loop.sql: the running loop needs a permanent void marker, a reminder
-- debounce guard, and an index for the status-filtered sweeps. Forward-only.

-- Permanent record that the user broke the blind. Not in the frozen-column set,
-- so the immutability trigger allows writing it. NULL until break-blind.
ALTER TABLE experiments ADD COLUMN broke_blind_at timestamptz;

-- One reminder per user per calendar day. The UNIQUE constraint is the debounce:
-- a second insert for the same (user, day) is a no-op, so reminders never storm
-- no matter how often the sweep runs.
CREATE TABLE reminder_sends (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  send_date date NOT NULL,
  sent_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, send_date)
);

-- The dashboard and the reminder sweep both filter experiments by status.
CREATE INDEX experiments_status_idx ON experiments (status);
```

`broke_blind_at` is not in the frozen-column list in
`0002_experiment_immutability.sql`, so writing it does not trip the trigger
(confirm this holds by test, section 4). `check_ins` already has
`UNIQUE (experiment_id, check_date)` and `allocations` already has
`allocations_experiment_id_idx`, so no further index is needed for the check-in
insert or the today-block lookup.

### 2.3 New / changed files

**Server**
- `server/src/experiments.ts` (edit) — add `getToday`, `submitCheckIn`,
  `breakBlind`, the `checkInSchema`, and a `validateMetricValue` helper. Reuse
  `ExperimentError`, the owner-scoped `WHERE id = $1 AND user_id = $2` pattern,
  and the "miss returns null → route answers 404" convention. Leave the EPIC 2/3
  functions untouched.
- `server/src/reminders.ts` (new) — `sendDailyReminders(db, mailer, appBaseUrl, log)`.
- `server/src/mailer.ts` (edit) — add `sendDailyReminder(email, appUrl)` to the
  `Mailer` interface and both transports, plus a console-only
  `reminderCountFor(email)` for test introspection (mirrors `lastLinkFor`).
- `server/src/routes/experiments.ts` (edit) — add the three routes in 2.6, reusing
  `idSchema`, `requireAuth`, and `mutationLimit` for the two mutations.
- `server/src/env.ts` (edit) — add `REMINDERS_ENABLED` (boolish; default on only
  in production) and `REMINDER_SWEEP_INTERVAL_MINUTES` (coerced int, default 60).
- `server/src/server.ts` (edit) — when `REMINDERS_ENABLED`, start one
  `setInterval` that calls `sendDailyReminders` and `.unref()` it so it never
  holds the process open. Tests never start this timer.

**Web**
- `web/src/pages/Run.tsx` (new) — the running dashboard and inline check-in and
  break-blind, per 2.7.
- `web/src/pages/ExperimentLocked.tsx` (edit, minimal) — status-aware forward
  affordance per 2.8.
- `web/src/App.tsx` (edit) — add the route `/experiments/:id/run` → `Run`.
- `web/src/api.ts` (edit) — add `getToday`, `submitCheckIn`, `breakBlind` and
  their response types.
- `web/src/styles.css` (edit) — styles for the dashboard (today's code, the
  streak/days row, the check-in form, the placebo-guess segmented control, the
  subordinate break-blind control and its confirm step, and the reveal table),
  mobile-first at 390px, reusing existing CSS variables.

**Tests** — see section 4.

### 2.4 The "today" read model (`getToday`) — blind-safe in every status

Owner-scoped. Load the experiment (`WHERE id = $1 AND user_id = $2`); a miss
returns `null` so the route answers `404` without leaking existence. Compute a
single `phase` and the non-secret numbers off `CURRENT_DATE` and the stored
dates, in ONE query so the anchor date is consistent:

- `phase`:
  - `prepped` when `status = 'prepped'` (not started).
  - `running` when `status = 'running'` and `CURRENT_DATE` is within
    `[start_date, planned_end_date]`.
  - `complete` when `status = 'running'` and `CURRENT_DATE > planned_end_date`
    (every block is logged; unblinding is the next step, EPIC 5).
  - `voided` when `status = 'voided'`.
  - `unblinded` when `status = 'unblinded'`.
- `today_code`: the code of the allocation whose
  `block_start_date <= CURRENT_DATE <= block_end_date`. Non-null ONLY in phase
  `running`; `null` in every other phase. Fetch with a single scoped query:
  `SELECT code FROM allocations WHERE experiment_id = $1 AND CURRENT_DATE BETWEEN
  block_start_date AND block_end_date`. Select `code` only, never `condition` or
  `block_index`.
- `check_in_done`: `EXISTS (SELECT 1 FROM check_ins WHERE experiment_id = $1 AND
  check_date = CURRENT_DATE)`. A boolean only.
- `day_number`: `CURRENT_DATE - start_date + 1` in phase `running`, else `null`.
- `sealed_day_streak`: `LEAST(CURRENT_DATE - start_date + 1, run_length_days)` in
  phase `running`; `run_length_days` in phase `complete`; `0` otherwise. (Sealed =
  blind intact. Only break-blind ends the streak; a missed check-in does not,
  because the seal is unbroken.)
- `days_remaining`: `GREATEST(planned_end_date - CURRENT_DATE, 0)` when running,
  else `0`.
- `run_length_days`: `block_length_days * num_blocks` (matches EPIC 2/3).

`getToday` return shape (server-internal type; the route sends exactly this):
```json
{
  "id": "uuid",
  "status": "running",
  "phase": "running",
  "metric_name": "Afternoon focus",
  "metric_type": "rating_0_10",
  "metric_direction": "higher_better",
  "run_length_days": 30,
  "day_number": 3,
  "sealed_day_streak": 3,
  "days_remaining": 27,
  "today_code": "MQ7",
  "check_in_done": false
}
```
Forbidden in this payload, asserted in tests: the string `condition`; any
`block_index`; any block date field; any code other than `today_code`; the words
`active`/`placebo` (the guess is not echoed here). `metric_type` values are the
enum ids, which do not contain those words.

### 2.5 The check-in (`submitCheckIn`) and metric validation

`checkInSchema` (strict, at the boundary):
```
metric_value:  z.number()
note:          z.string().trim().max(500).optional().default("")
placebo_guess: z.enum(["placebo", "active", "unsure"])
```
`.strict()` rejects any extra field, including a client-supplied `check_date`:
the date is always the server's `CURRENT_DATE`.

`validateMetricValue(metricType, value)` throws
`ExperimentError(422, "invalid_input", <plain message>)` on a bad value, by type:
- `rating_0_10`: integer 0 to 10. Message: `Use a score from 0 to 10.`
- `minutes`: number 0 to 1440. Message: `Use a number of minutes from 0 to 1440.`
- `count`: integer 0 to 10000. Message: `Use a whole number from 0 to 10000.`
- `yes_no`: exactly 0 or 1. Message: `Choose yes or no.`

`submitCheckIn(db, userId, id, input)` behavior, owner-scoped:
1. Load the experiment (`WHERE id = $1 AND user_id = $2`); a miss returns `null`
   (route → `404`).
2. Guard state. If `status !== 'running'`, or `CURRENT_DATE` is not within
   `[start_date, planned_end_date]` (no block today, i.e. phase `complete`),
   throw `ExperimentError(422, "invalid_state", <message>)`:
   - `voided`/`unblinded`: `This run has already finished.`
   - `prepped`/other: `This run has not started.`
   - running-but-past-end (`complete`): `This run is finished. Nothing to log today.`
3. `validateMetricValue(metric_type, metric_value)`.
4. Insert exactly one row with `check_date = CURRENT_DATE`:
   `INSERT INTO check_ins (experiment_id, check_date, metric_value, note,
   placebo_guess) VALUES ($1, CURRENT_DATE, $2, $3, $4)`. Store an empty note as
   `NULL`.
5. On the `UNIQUE (experiment_id, check_date)` violation, throw
   `ExperimentError(409, "already_checked_in", "You already checked in today.")`.
   Do not update the existing row (no editing).
6. On success, return the refreshed `getToday` payload (so the client updates
   without a second round trip). The payload is blind-safe per 2.4.

The `metric_value` is stored in the existing `numeric` column. Do not add a
column.

### 2.6 API contracts

All three routes under `/api`, all require a valid session via `requireAuth`
(server-side `401` when absent). Owner-only via the `user_id`-scoped query; a miss
returns `404` (`not_found`) so existence never leaks across users. Standard
`errorEnvelope` for every 4xx/5xx. `:id` validated as a uuid via the existing
`idSchema`; a non-uuid param returns `404`.

**`GET /api/experiments/:id/today`** — read; global limiter only. Returns the 2.4
shape for an owned experiment in any status. `404` when not owned or not found.

**`POST /api/experiments/:id/checkins`** — mutation; reuse `mutationLimit`. Body
validated by `checkInSchema`; a parse failure is `400`
(`errorEnvelope("invalid_input", "Check your entry and try again.")`). Returns
`201` with the refreshed `getToday` payload on success. `422` on a state guard
failure (2.5 step 2), `422` on a bad metric value (2.5 step 3), `409` on a second
check-in for the same day, `404` when not owned/found, `401` when unauthenticated.

**`POST /api/experiments/:id/break-blind`** — mutation; reuse `mutationLimit`. No
request body (empty or `{}`; ignore any body). Behavior:
- Load the owned experiment; `404` if not owned/found.
- If `status === 'running'`: void it. In one guarded update set
  `status = 'voided', broke_blind_at = now() WHERE id = $1 AND status = 'running'`
  (the `status = 'running'` guard makes a retry a no-op). Then respond `200` with
  the reveal (below). The update touches only `status` and `broke_blind_at`, so
  the immutability trigger never fires.
- If `status === 'voided'`: **idempotent**. Respond `200` with the same reveal
  (the schedule is already unsealed; re-showing it is harmless and matches
  "cannot be undone"). Do not move `broke_blind_at`.
- If `status === 'unblinded'`: respond `422`
  (`invalid_state`, `This run has already finished.`). A completed, honestly
  unblinded run is not voided.
- If `status === 'prepped'`/other: respond `422`
  (`invalid_state`, `This run has not started.`).

Break-blind reveal response (the one intentional allocation reveal, rule 4):
```json
{
  "id": "uuid",
  "status": "voided",
  "broke_blind_at": "2026-09-15T10:22:00.000Z",
  "substance_name": "Theanine",
  "blocks": [
    { "code": "MQ7", "contents": "Theanine", "block_start_date": "2026-09-15", "block_end_date": "2026-09-19" },
    { "code": "ZK2", "contents": "Blank",    "block_start_date": "2026-09-20", "block_end_date": "2026-09-24" }
  ]
}
```
`contents` maps the stored condition to display text: `active` → `substance_name`,
`placebo` → `Blank`. Return blocks in `block_index` order (the true schedule; the
run is over, so order no longer needs hiding). Dates cast to text (`::text`) so
they serialize as `YYYY-MM-DD`, matching `getExperimentSummary`.

No route that edits the frozen design is added here.

### 2.7 Frontend — the running dashboard (`/experiments/:id/run`, 390px)

New page `Run.tsx`. On mount, fetch `GET /api/experiments/:id/today`. Hold the
layout with `LoadingCard` while loading; render a product-voice `ErrorState` with
retry on failure (QUALITY BAR §3). Branch on `phase`:

- **`running`** — the core dashboard:
  - **Today's code**, the hero: `Open packet {today_code}` in a large, high-
    contrast card. This is the day's instruction.
  - **A compact progress row**: `{sealed_day_streak} sealed days` and
    `{days_remaining} days left`. Subordinate to the code.
  - **The inline check-in** (this is the screen's primary action). If
    `check_in_done` is false, render the form:
    - The metric input, chosen by `metric_type`:
      - `rating_0_10`: the existing `Stepper` (0 to 10).
      - `yes_no`: a `Segmented` Yes/No mapping to 1/0.
      - `minutes` / `count`: a labeled numeric `<input inputMode="numeric">` with
        `min`/`max` matching 2.5, a real `<label>` tied by `id`.
    - The placebo guess: a `Segmented` with three options,
      `Blank` → `placebo`, `Supplement` → `active`, `Not sure` → `unsure`. No
      default selection; the user must pick before submit is enabled (the guess is
      load-bearing for EPIC 5, so do not silently default it).
    - An optional note: a `<textarea>` labelled `Note (optional)`.
    - One primary button `Save check-in`.
    If `check_in_done` is true, render the done state instead of the form
    (heading `Checked in for today`, body `Come back tomorrow for the next packet.`).
  - **Break-blind**, visibly subordinate (a ghost/quiet control, not competing
    with Save): `Break the blind`. Tapping it does NOT fire immediately; it opens
    an inline confirm step (friction is the point): the warning line plus
    `Reveal and void` (destructive) and `Keep it sealed` (cancel). Only
    `Reveal and void` calls the endpoint.
- **`complete`** — heading `Your run is complete`, body
  `You logged every block. The verdict is the next step.` A `Back to summary`
  link. No check-in, no code, no break-blind. (EPIC 5 fills the verdict.)
- **`voided`** — heading `Your run is voided`, body
  `You broke the blind, so this run cannot count as evidence.` A `Back to summary`
  link. (The full schedule reveal is shown once, right after the break-blind
  action; a later visit does not re-reveal it, and does not need to.)
- **`prepped`** — heading `Start your run first`, body
  `Prepare your capsules, then start the run.` A link to `/experiments/:id/prep`.
- **`unblinded`** — a `Back to summary` link only (EPIC 5 owns this screen).

**After a successful check-in.** The `POST` returns the refreshed today payload;
update state from it so the form is replaced by the done state with no extra
fetch. Feedback within 100ms: `Save check-in` shows a pressed/`aria-busy`
loading label (`Saving…`) immediately and disables to prevent double-submit; on
`409` show the done state (already checked in); on other errors show an inline
`ErrorState`-style message and re-enable.

**After break-blind.** `Reveal and void` shows an immediate pressed/`aria-busy`
state, then on success renders the reveal: heading `Your run is voided`, body
`Here is the schedule you were following.`, and a table
`Packet | What it was | Days` built from the response `blocks` (`contents` and the
date range). A `Back to summary` link. This is the only screen in the epic that
shows a condition; it appears only after the user has voided the run.

**Accessibility & mobile (QUALITY BAR §2, §6):** real headings and landmarks; the
today card and progress numbers announced sensibly; every control is a real,
keyboard-reachable button/input with a visible focus ring and ~44px target; every
input has a real label; no horizontal scroll at 390px; reuse existing CSS
variables for contrast. The check-in region uses `aria-live="polite"` for the
submit result.

### 2.8 Locked summary tweak (`/experiments/:id`)

Minimal, status-aware change to `ExperimentLocked.tsx`. Keep the existing
`prepped` behavior (the `Prepare your capsules` button) and the existing
`running` line `Run in progress. Come back each day for the packet to open.`
verbatim (EPIC 3's e2e asserts that line and the absence of the prep button, so do
not remove them). Add, only in the `running` case, a primary action `Open today`
that navigates to `/experiments/:id/run`. In the `voided` case, replace the prep
button with a plain line `This run is voided.`. Do not build any dashboard,
today's-code, streak, or check-in UI in this file; the dashboard lives in
`Run.tsx`. The sealed-summary card is unchanged.

### 2.9 Reminders (`server/src/reminders.ts` + scheduler)

`sendDailyReminders(db, mailer, appBaseUrl, log): Promise<{ sent: number }>`:
1. Find the users who owe a check-in today, one row per user:
```sql
SELECT DISTINCT e.user_id, u.email
  FROM experiments e
  JOIN users u ON u.id = e.user_id
 WHERE e.status = 'running'
   AND CURRENT_DATE BETWEEN e.start_date AND e.planned_end_date
   AND NOT EXISTS (
     SELECT 1 FROM check_ins c
      WHERE c.experiment_id = e.id AND c.check_date = CURRENT_DATE
   )
```
2. For each candidate, claim the day atomically:
   `INSERT INTO reminder_sends (user_id, send_date) VALUES ($1, CURRENT_DATE)
   ON CONFLICT (user_id, send_date) DO NOTHING RETURNING id`. Send the email ONLY
   when a row is returned (the claim succeeded). A conflict means today's reminder
   already went out, so skip. This is the debounce: at most one email per user per
   day regardless of how many running experiments they have or how often the sweep
   runs.
3. Send exactly one email per claimed user via `mailer.sendDailyReminder(email,
   appBaseUrl)`. If a send throws, log by status only (never the email) and
   continue; a failed send may retry on the next sweep only if its
   `reminder_sends` row was not written, so write the row first and treat a send
   failure as "skip until tomorrow" (do not delete the row) to guarantee
   no-storm. Count successful sends.
4. Return `{ sent }`.

The email (console transport logs the route only, never the recipient):
- Subject: `Your blind-keeper check-in`
- Heading: `Time for today's check-in`
- Body: `Open today's packet, take it, and log your score.`
- Button: `Open blind-keeper` linking to `appBaseUrl`.

**Scheduler** (in `server.ts`, not in `buildApp`, so tests never spawn a timer):
```
if (env.REMINDERS_ENABLED) {
  const everyMs = env.REMINDER_SWEEP_INTERVAL_MINUTES * 60_000;
  const timer = setInterval(() => {
    sendDailyReminders(db, mailer, env.APP_BASE_URL, app.log)
      .catch((err) => app.log.error({ err }, "reminder sweep failed"));
  }, everyMs);
  timer.unref();
}
```
Correctness does not depend on the cadence: the `reminder_sends` unique guard
bounds it to one per user per day. The sweep is a background job on a small,
`status`-indexed query, not a user hot path.

### 2.10 Copy (verbatim, swept clean — no em-dashes, no banned vocabulary, positive phrasing)

Dashboard, `running`:
- Today's code card: `Open packet {code}`
- Progress: `{n} sealed days` / `{n} days left`
- Check-in heading: `Today's check-in`
- Guess prompt: `Your guess: was today the blank or the supplement?`
- Guess options: `Blank` / `Supplement` / `Not sure`
- Note label: `Note (optional)`
- Note placeholder: `Anything worth remembering about today.`
- Save button: `Save check-in` (loading label: `Saving…`)
- Done heading: `Checked in for today`
- Done body: `Come back tomorrow for the next packet.`
- Break-blind control: `Break the blind`
- Break-blind confirm line: `Breaking the blind reveals the schedule and voids this run. You cannot undo it.`
- Break-blind confirm action: `Reveal and void`
- Break-blind cancel: `Keep it sealed`

Reveal (after break-blind):
- Heading: `Your run is voided`
- Body: `Here is the schedule you were following.`
- Table headers: `Packet` / `What it was` / `Days`
- Back link: `Back to summary`

Dashboard, other phases:
- `complete` heading: `Your run is complete`
- `complete` body: `You logged every block. The verdict is the next step.`
- `voided` heading: `Your run is voided`
- `voided` body: `You broke the blind, so this run cannot count as evidence.`
- `prepped` heading: `Start your run first`
- `prepped` body: `Prepare your capsules, then start the run.`
- Back link (all): `Back to summary`

Locked summary (2.8):
- Running action: `Open today`
- Voided line: `This run is voided.`

Reminder email (2.9):
- Subject: `Your blind-keeper check-in`
- Heading: `Time for today's check-in`
- Body: `Open today's packet, take it, and log your score.`
- Button: `Open blind-keeper`

Server / inline state messages:
- Second check-in same day (`409`): `You already checked in today.`
- Bad metric value (`422`, by type, per 2.5): `Use a score from 0 to 10.` /
  `Use a number of minutes from 0 to 1440.` / `Use a whole number from 0 to 10000.` /
  `Choose yes or no.`
- Check-in on a finished run (`422`): `This run has already finished.`
- Check-in before start (`422`): `This run has not started.`
- Check-in on a finished-but-open run (`422`, phase complete):
  `This run is finished. Nothing to log today.`
- Break-blind on a finished run (`422`): `This run has already finished.`
- Break-blind before start (`422`): `This run has not started.`
- Malformed check-in body (`400`): `Check your entry and try again.`

Load / error states reuse EPIC 1's `LoadingCard` and `ErrorState`; error copy
unchanged for consistency: `We could not load this page.` / body
`Check your connection and try again.` / action `Try again`.

Run the mechanical copy sweep (section 4) over every string above and every
string added in components before finishing.

---

## 3. Ordered task list (with acceptance criteria)

1. **Migration `0003`.** Add `broke_blind_at`, `reminder_sends`, and
   `experiments_status_idx` per 2.2.
   - *AC:* migrations apply cleanly on a fresh database; `migrations.test` passes;
     the immutability trigger still rejects a frozen-column update after the new
     column exists.

2. **"Today" read model + route.** Add `getToday` to `experiments.ts`; add
   `GET /api/experiments/:id/today`.
   - *AC:* for a running experiment within its date range, the route returns
     `phase: "running"`, a non-null `today_code` equal to the code of the block
     containing `CURRENT_DATE`, `check_in_done`, and correct `day_number`,
     `sealed_day_streak`, and `days_remaining`. The payload contains no
     `condition`, no `block_index`, no block date, and no code other than
     `today_code`.
   - *AC:* for `prepped`, `voided`, and `unblinded` experiments the route returns
     `200` with `today_code: null` and the matching `phase`, and still carries no
     condition word.
   - *AC:* unauthenticated → `401`; another user's id → `404`; a non-uuid id →
     `404`.

3. **Check-in logic + route.** Add `checkInSchema`, `validateMetricValue`, and
   `submitCheckIn` to `experiments.ts`; add `POST /api/experiments/:id/checkins`
   using `mutationLimit`.
   - *AC:* a valid check-in on a running experiment returns `201`, writes exactly
     one `check_ins` row with `check_date = CURRENT_DATE`, and the refreshed
     payload has `check_in_done: true`. The stored `placebo_guess` matches the
     input.
   - *AC:* a second check-in the same day returns `409` `already_checked_in` and
     does not modify the first row (no editing).
   - *AC:* a bad metric value per type returns `422` `invalid_input` with the
     plain message; a client-supplied `check_date` is rejected by `.strict()`; a
     malformed body returns `400`.
   - *AC:* a check-in on a `prepped`, `complete`, `voided`, or `unblinded`
     experiment returns `422` `invalid_state` with the matching message and writes
     no row.
   - *AC:* the response body carries no `condition`, no `block_index`, no block
     date, and no code other than `today_code`; unauthenticated → `401`; another
     user → `404`.

4. **Break-blind logic + route.** Add `breakBlind` to `experiments.ts`; add
   `POST /api/experiments/:id/break-blind` using `mutationLimit`.
   - *AC:* from `running`, the route returns `200`, sets `status = 'voided'` and a
     non-null `broke_blind_at`, and the reveal body lists every block with its
     `code`, `contents` (`substance_name` or `Blank`), and dates, in
     `block_index` order.
   - *AC:* a second break-blind returns `200` with the same reveal and does not
     move `broke_blind_at`; break-blind on `unblinded` returns `422`; on `prepped`
     returns `422`; unauthenticated → `401`; another user → `404`.
   - *AC:* the void update touches only `status` and `broke_blind_at`, so the
     `0002` immutability trigger does not fire (a frozen-column update on the same
     row still raises afterward).

5. **Reminders.** Add `sendDailyReminders` (`reminders.ts`), extend the `Mailer`
   interface and both transports with `sendDailyReminder` (+ console
   `reminderCountFor`), add the env vars, and start the `.unref()`'d sweep in
   `server.ts`.
   - *AC:* one sweep sends exactly one email to each user with a running
     experiment and an open check-in today, and none to a user who already checked
     in today.
   - *AC:* a second sweep the same day sends zero emails (the `reminder_sends`
     unique guard debounces), and a user with two running experiments still
     receives at most one email per day.

6. **API client.** Add `getToday`, `submitCheckIn`, `breakBlind` and their types
   to `api.ts`.
   - *AC:* each calls the correct path with `credentials: "same-origin"` and
     surfaces `ApiRequestError` on non-OK responses, matching the existing client.

7. **Dashboard page + check-in UI + break-blind UI.** Build `Run.tsx` per 2.7 and
   route it in `App.tsx`.
   - *AC:* at 390px, phase `running` shows today's code, the sealed-days streak,
     days left, and the inline check-in with the metric control for the
     experiment's type, a three-way guess, and an optional note; `Save check-in`
     gives feedback within 100ms, cannot double-submit, and on success shows
     `Checked in for today` with no page reload; no horizontal scroll; keyboard
     reaches every control with visible focus.
   - *AC:* designed loading and error states are present; phases `complete`,
     `voided`, and `prepped` render their designed states, not a broken dashboard.
   - *AC:* the break-blind control is visibly subordinate and requires the inline
     confirm; `Reveal and void` shows the schedule reveal and the voided state; no
     condition word appears anywhere in the `running` phase before the reveal.

8. **Locked-summary tweak.** Make `ExperimentLocked.tsx` status-aware per 2.8.
   - *AC:* a `running` experiment keeps the `Run in progress.` line and adds an
     `Open today` action into the dashboard; a `voided` experiment shows
     `This run is voided.`; the `prepped` prep button is unchanged; EPIC 3's
     `prep.spec` still passes.

9. **Tests + mechanical copy sweep.** All backend + e2e tests in section 4; run
   the copy sweep over every user-visible string touched.
   - *AC:* all listed tests pass; the sweep finds no `—` / `–`, no banned
     vocabulary, and no negative empty-state phrasing in any shipped string.

---

## 4. Test plan (which test proves each acceptance criterion)

Automated, run in the foreground to completion before writing `result.json`.

**Backend (Vitest, `fastify.inject` + PGlite, following `server/test/helpers.ts`;
lock and confirm a real experiment through the routes, as `prep.test` does).** A
shared helper in each test file locks via `POST /api/experiments` and starts the
run via `POST /api/experiments/:id/confirm-prep`, so `start_date = CURRENT_DATE`
and today falls in block 0.

- `today.test` (new):
  - After confirm, `GET .../today` returns `phase: "running"`, a `today_code` that
    equals block 0's stored code (`CURRENT_DATE = start_date`), `check_in_done:
    false`, `day_number: 1`, `sealed_day_streak: 1`, and
    `days_remaining = L*N - 1`. The serialized body contains none of `condition`,
    `block_index`, `block_start_date`, `block_end_date`, and contains no
    allocation code except `today_code` (assert against the stored codes). →
    *AC task 2.*
  - Force `status='voided'` (direct `UPDATE`, allowed by the trigger); `GET
    .../today` returns `phase: "voided"`, `today_code: null`, no condition word.
    Repeat for `prepped` (a freshly locked, unconfirmed experiment). → *AC task 2.*
  - Auth: unauth → `401`; other user → `404`; non-uuid → `404`. → *AC task 2.*
- `checkins.test` (new):
  - A valid `rating_0_10` check-in → `201`, one row with `check_date =
    CURRENT_DATE` (compare to a DB `SELECT CURRENT_DATE`), stored `placebo_guess`
    equals the input, refreshed payload `check_in_done: true`. → *AC task 3.*
  - A second check-in same day → `409` `already_checked_in`; the first row's
    `metric_value`/`placebo_guess` are unchanged (re-select and compare). →
    *AC task 3.*
  - Bad values per type: `rating_0_10` = 11 → `422`; `minutes` = -1 → `422`;
    `count` = 1.5 → `422`; `yes_no` = 2 → `422`, each with its plain message. A
    body with an extra `check_date` field → `400` (`.strict()`); a non-numeric
    `metric_value` → `400`. → *AC task 3.*
  - State guard: check-in on a `voided` experiment → `422` `invalid_state`, no
    row written; on a `prepped` experiment → `422`. → *AC task 3.*
  - Blind-safety: the `201` body contains no `condition`, no `block_index`, no
    block date, and no code except `today_code`. Auth: unauth → `401`, other user
    → `404`. → *AC task 3.*
- `break-blind.test` (new):
  - From `running` → `200`; DB shows `status='voided'` and a non-null
    `broke_blind_at`; the reveal `blocks` equal the stored allocations (codes,
    `contents` mapping `active`→substance / `placebo`→`Blank`, dates) in
    `block_index` order. → *AC task 4.*
  - Idempotency: a second break-blind → `200`, same reveal, `broke_blind_at`
    unchanged (re-select and compare). → *AC task 4.*
  - State guards: force `status='unblinded'` → break-blind returns `422`; a
    `prepped` experiment → `422`. Auth: unauth → `401`; other user → `404`. →
    *AC task 4.*
  - Immutability coexistence: after break-blind voids the row, a direct `UPDATE`
    of a frozen column (for example `metric_name`) still raises, proving the void
    did not weaken the seal. → *AC tasks 1, 4.*
- `reminders.test` (new): build the app with a spy/counting mailer (extend the
  console transport's `reminderCountFor`, or pass a stub mailer). Lock+confirm a
  running experiment for user A, lock+confirm for user B, and give user B a
  check-in for today. Call `sendDailyReminders` directly:
  - First call: user A gets exactly one email, user B gets zero (already checked
    in). → *AC task 5.*
  - Second call same day: zero emails sent (unique guard). A user with two running
    experiments still gets at most one email in a sweep. → *AC task 5.*
- `allocation-never-serialized.test` (extend): after locking, confirming, and
  running a real experiment, assert `GET .../today` and the check-in `201`
  response carry no allocation code beyond `today_code`, and no `condition`,
  `placebo`, `block_index`, or block date. Document in a comment that `GET .../prep`
  (EPIC 3) and `POST .../break-blind` (this epic) are the intentional exceptions,
  and assert that break-blind's reveal appears only after the run is voided. →
  *the trust invariant on the running design.*
- `immutability.test` / `migrations.test` (existing): unchanged, still pass with
  the new migration and writes in play. → *DB seal + migration baseline.*

**Frontend / e2e (Playwright, 390px project; sign in via the console transport and
reach a running experiment through the real flow).** Add a `startRun(page)` helper
to `web/e2e/helpers.ts` that calls `lockDesign`, walks the prep walkthrough to
`Start the run`, and returns the id.

- `run.spec` (new): from a running experiment, open `/experiments/:id/run`;
  assert today's code card (`Open packet {code}`), the sealed-days and days-left
  numbers, and the check-in form are visible; assert no `active`/`placebo`
  condition word and no date-shaped string appears on the page; set the rating,
  pick a guess, press `Save check-in`, and assert the `Checked in for today` state
  appears without a reload; no horizontal scroll at 390px throughout. Then reload
  and confirm the done state persists (server `check_in_done`). → *AC tasks 7, 8.*
- `break-blind.spec` (new, or a case inside `run.spec`): from a running
  experiment, open the dashboard, tap `Break the blind`, confirm the inline
  warning, tap `Reveal and void`, and assert the reveal shows the schedule table
  and the `Your run is voided` state; returning to `/experiments/:id` shows
  `This run is voided.`. → *AC tasks 7, 8.*

**Non-automated verification (record in `result.json` summary):**
- Mechanical copy sweep over every user-visible string added or edited
  (`Run.tsx`, `ExperimentLocked.tsx`, the reminder email in `mailer.ts`/
  `reminders.ts`, any new `api.ts` messages, and the copy in 2.10): search for
  `—`, `–`, the banned vocabulary, and negative empty-state phrasing. Fix every
  hit. → *copy quality.*

---

## 5. Definition of done

All acceptance criteria in §3 are met and all §4 tests pass. A user with a running
experiment can open the dashboard at 390px, see only today's code, their sealed-day
streak, and days left, complete a sub-minute check-in (metric value, optional note,
one-tap placebo guess) with feedback within 100ms and exactly one entry per day,
and receive at most one daily email reminder that never storms. Breaking the blind
reveals the schedule, sets `status = 'voided'`, records `broke_blind_at`
permanently, and cannot be undone. Throughout the sealed run, no dashboard field,
no check-in response, and no reminder leaks a condition, another block's code, a
`block_index`, or a block date; the only allocation reveal is the break-blind
response, gated behind voiding the run. Nothing from the Non-Goals (§1
out-of-scope) is built: no verdict/unblinding, no formulary or export, no push
notifications, no editing of past days, no gamified rewards beyond the sealed-day
streak, and no reminder settings screen. The copy sweep is clean.
`EPIC_SPEC.md` (this file) is the only artifact this task leaves; the implementer
executes it.
