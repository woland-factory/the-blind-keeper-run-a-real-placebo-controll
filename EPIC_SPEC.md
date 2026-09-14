# EPIC SPEC — Blinding prep walkthrough and confirm-ready

## Quality differentiator (this app must win on it)

**Trust: you can believe the answer.** The verdict is one the user did not
generate and could not bias, and when the data cannot decide, the app says so
plainly instead of manufacturing confidence.

What this demands of THIS epic: prep is the one moment the user has to touch the
secret, because they physically fill the packets. The design must (1) let the
user fill correctly while (2) never printing a code next to its condition and
never showing which day a code belongs to, and (3) be honest about what the
blind can and cannot protect. A printable sheet the user leaves on the counter
must not give the game away. The walkthrough earns trust by keeping the schedule
sealed through prep, not by claiming a solo blind is tamper-proof.

Read the honest threat model in section 2.1 before writing a line: it settles
every "does this leak?" question in this epic.

---

## 1. Scope

### In scope
- **The prep walkthrough** (`/experiments/:id/prep`, replacing EPIC 2's reserved
  placeholder): a one-step-at-a-time guide that turns the sealed allocation into
  a set of sealed, coded packets, in a randomized interleaved fill order, ending
  in a shuffle step.
- **A blind-safe prep read endpoint** (`GET /api/experiments/:id/prep`) that
  returns the codes, their neutral batch token, and the fill count per code, so
  the client can render the walkthrough and the sheet. It never returns the
  words `active`/`placebo`/`condition`, never returns `block_index`, and never
  returns any block date. The code-to-day schedule stays sealed.
- **A printable prep sheet**: a print-friendly view listing each code, its
  neutral batch token, and its capsule count. The printed artifact omits which
  batch holds the supplement, so the sheet alone never reveals the allocation.
- **Confirm-ready** (`POST /api/experiments/:id/confirm-prep`): transitions the
  experiment from `prepped` to `running`, sets `start_date`, `planned_end_date`,
  and every allocation's `block_start_date` / `block_end_date`. Idempotent.
- **A confirmation state** after confirm-ready that tells the user the run has
  started, without building the running dashboard.
- **A minimal status-aware tweak to the locked summary** (`/experiments/:id`) so
  a `running` experiment does not re-offer "Prepare your capsules" as if unstarted.

### Out of scope (do not build — later epics or non-goals)
- **The running dashboard, today's code, streak, days remaining, break-blind**
  (EPIC 4). After confirm-ready the app shows a short confirmation state, not a
  dashboard. Do not build `GET /experiments/:id/today` here.
- **Daily check-ins** (EPIC 4). No check-in rows are written in this epic.
- **Verdict / unblinding** (EPIC 5). No allocation condition is ever revealed.
- **Formulary / export** (EPIC 6).
- **Editing a pre-registered design** (Non-Goal). Confirm-ready sets calendar
  dates and status only; the frozen design columns stay frozen (EPIC 2's DB
  trigger already allows exactly `status`, `start_date`, `planned_end_date`).
- **Low-prep paired-jars mode** (Non-Goal). One prep procedure only: the
  two-batch coded-packet method below. No alternate low-effort path.
- **Mail-order capsule kits** (Non-Goal). Atoms stay on the user's side.
- **Barcode / QR scanning** (Non-Goal). Codes are short, handwritten labels; no
  scanning, no camera.
- **Washout as calendar gaps.** Blocks are contiguous on the calendar (see 2.5).
  The washout note stays advisory, exactly as EPIC 2 and the demo seed model it.
- **Spare / extra capsules.** Fill count per code equals `block_length_days`
  (one capsule per day of the block). No spares math.

---

## 2. Technical design

Build on the EPIC 1 + EPIC 2 foundation exactly as it stands. Reuse: the `Db`
interface (`server/src/db/index.ts`), the zod-at-the-boundary pattern,
`errorEnvelope` and `requireAuth` (`server/src/http.ts`), the
`ExperimentError` class and owner-scoped query pattern
(`server/src/experiments.ts`), the mutation rate-limit bucket already wired in
`server/src/routes/experiments.ts`, the frontend `api.ts` client, and the
mobile-first CSS with `Page` / `LoadingCard` / `ErrorState`. Introduce no new
dependencies. **No new SQL migration is required**: every column this epic
writes (`experiments.status`, `experiments.start_date`,
`experiments.planned_end_date`, `allocations.block_start_date`,
`allocations.block_end_date`) already exists from `0001_init.sql`, and the
`0002` immutability trigger already permits the three experiment columns.

### 2.1 The threat model and the blinding rule (read first, binding)

A solo self-experiment cannot be information-theoretically blind at prep time:
the same person makes the capsules and fills the packets, so at the moment of
filling they can, if they try, know which code holds the supplement. The plan
states this plainly ("the enemy is the user's own future impatience, not a
determined adversary") and the answer is **friction plus honesty plus memory
decay**, not a false claim of a tamper-proof blind.

So "no step reveals which code is active" is satisfied concretely as follows,
and the implementer must hold every prep surface to these five rules:

1. **No condition words next to a code, ever.** No screen, no API field, and no
   printed line pairs a code with `active`, `placebo`, `blank as a condition`,
   or the substance name. Codes are filled by a **neutral batch token**
   (`Batch 1` / `Batch 2`) only.
2. **The batch-to-contents link is stated once, mentions no code, and is never
   printed.** Exactly one walkthrough step tells the user what goes in each
   batch (for example, "Batch 1 gets your {substance} capsules"). That step
   names no packet code. It is on-screen only and is omitted from the printable
   sheet.
3. **The fill order is randomized and interleaved, not the schedule order.** The
   walkthrough and the sheet present codes in an order that alternates the two
   batches and is uncorrelated with `block_index`. `block_index` is never sent
   to the client. This is what keeps the code-to-day schedule sealed.
4. **The map is shown once and never re-displayed.** After confirm-ready the app
   does not re-show the code-to-batch mapping anywhere in this epic. Memory decay
   plus the shuffle step is the blind.
5. **Which batch is the supplement is randomized per experiment.** `Batch 1` is
   the supplement in roughly half of experiments, so a user's cross-experiment
   prior is useless. Derive it deterministically from the already-shuffled
   allocation (see 2.3), so no schema change and no read-time randomness is
   needed.

The prep payload does necessarily let a determined inspector of *their own*
account derive code-to-condition (it carries code→batch and, once, batch→
contents). That is inherent to prep and is accepted. The invariant this epic
protects is narrower and provable: **no code-to-day schedule and no condition
label ever leaves the server**, and **the printable sheet is blind-safe on its
own**. Guard both with tests (section 4).

### 2.2 New / changed files

**Server**
- `server/src/experiments.ts` (edit) — add the prep read model (`getPrep`) and
  the confirm-ready logic (`confirmPrep`), plus the deterministic batch-labeling
  and interleave-ordering helpers. Keep the allocation-generating code from
  EPIC 2 untouched.
- `server/src/routes/experiments.ts` (edit) — add the two routes in 2.4. Reuse
  the existing `mutationLimit` config for the confirm mutation.

**Web**
- `web/src/pages/PrepPlaceholder.tsx` (delete or replace) — becomes the real
  prep walkthrough. Rename to `web/src/pages/Prep.tsx` and export `Prep`; update
  the import in `App.tsx`. (If the implementer prefers to keep the filename, that
  is fine as long as the route renders the real walkthrough.)
- `web/src/pages/ExperimentLocked.tsx` (edit, minimal) — make the forward
  affordance status-aware (see 2.7).
- `web/src/App.tsx` (edit) — point `/experiments/:id/prep` at the real page.
- `web/src/api.ts` (edit) — add `getPrep(id)` and `confirmPrep(id)` plus their
  response types.
- `web/src/styles.css` (edit) — styles for the step walkthrough, the batch
  callout, the prep sheet table, and a `@media print` block that shows only the
  sheet.

**Tests** — see section 4.

### 2.3 Prep read model (`getPrep`) — deterministic, blind-safe

Owner-scoped. Load the experiment (`WHERE id = $1 AND user_id = $2`); a miss
returns `null` so the route can answer `404` without leaking existence. Load its
allocations (`block_index`, `code`, `condition`) server-side only.

Derive, purely, with no randomness at read time (so the display is stable across
reloads and idempotent):

- **Batch labeling.** Let `c0` be the `condition` of the allocation with
  `block_index = 0`. Assign `Batch 1` to every code whose condition equals `c0`,
  and `Batch 2` to the rest. Because the condition vector was CSPRNG-shuffled at
  lock, `c0` is `active` about half the time, satisfying rule 5. Never send the
  condition; send only the batch token.
- **Batch contents (for the one on-screen link step).** `Batch 1` contents is
  the substance name when `c0 === "active"`, otherwise the blank; `Batch 2` is
  the other. Expose contents as a separate small object the client uses only for
  the single link step, and which the printable view omits.
- **Interleaved fill order.** Split codes into the two batch lists, sort each
  list by its `code` string (stable, uncorrelated with `block_index`), then
  interleave: `batch1[0], batch2[0], batch1[1], batch2[1], …`. This is the fill
  order for the walkthrough and the sheet. `block_index` is never included.
- **Fill count.** Every code's count is `block_length_days` (one capsule per day
  of a block; all blocks share the same length).

`getPrep` return shape (server-internal type; the route sends exactly this):
```json
{
  "id": "uuid",
  "status": "prepped",
  "substance_name": "Theanine",
  "block_length_days": 5,
  "num_blocks": 6,
  "capsules_per_code": 5,
  "batches": [
    { "label": "Batch 1", "contents": "Theanine" },
    { "label": "Batch 2", "contents": "Blank" }
  ],
  "packets": [
    { "code": "MQ7", "batch": "Batch 1", "count": 5 },
    { "code": "ZK2", "batch": "Batch 2", "count": 5 },
    { "code": "TX9", "batch": "Batch 1", "count": 5 }
  ]
}
```
Forbidden in this payload (assert in tests): the strings `active`, `placebo`,
`condition`; any `block_index`; any `block_start_date` / `block_end_date` / date
field. `contents` uses the substance name and the neutral word `Blank`, never a
condition word.

### 2.4 API contracts

Both routes under `/api`, both require a valid session via `requireAuth`
(server-side `401` when absent). Owner-only via the `user_id`-scoped query; a
miss returns `404` (`not_found`) so existence never leaks across users. Standard
`errorEnvelope` for every 4xx/5xx. `:id` validated as a uuid; a non-uuid param
returns `404` (matching EPIC 2's `GET /api/experiments/:id`).

**`GET /api/experiments/:id/prep`** — global rate limiter only (a read). Returns
the 2.3 shape for an owned experiment. Allowed for any status the experiment can
be in after lock (`prepped` and `running`); the codes exist from lock onward, so
this does not gate on status. `404` when not owned or not found.

**`POST /api/experiments/:id/confirm-prep`** — mutation; reuse the dedicated
`mutationLimit` bucket. No request body (empty or `{}`; ignore any body). Behavior:
- Load the owned experiment; `404` if not owned/found.
- If `status === 'prepped'`: start the run (below), respond `200` with the
  non-secret running summary (same shape EPIC 2's `GET /api/experiments/:id`
  returns: includes `status: "running"`, `start_date`, `planned_end_date`).
- If `status === 'running'`: **idempotent success**. Respond `200` with the
  current running summary. Do not recompute or move any date.
- Any other status (`unblinded`, `voided`, or the pre-lock `designing` that
  cannot occur here): respond `422` (`invalid_state`) with the plain message in
  2.8. No rows change.

Starting the run, in this order so a mid-way crash cannot leave a `running`
experiment with unset block dates:
1. Read the anchor date once from the database: `SELECT CURRENT_DATE AS today`.
   Use one value for every derived date. (`CURRENT_DATE` is a timezone-free
   `date`, which matches the `date` columns and keeps tests deterministic.)
2. For each allocation of this experiment, set
   `block_start_date = today + block_index * block_length_days` and
   `block_end_date  = block_start_date + block_length_days - 1`
   (compute with SQL `date` arithmetic or in JS from the same anchor; blocks are
   contiguous, no gaps).
3. Flip the experiment last, guarded by the current status so a retry is a no-op:
   `UPDATE experiments SET status = 'running', start_date = $today,
   planned_end_date = $today + (block_length_days * num_blocks - 1)
   WHERE id = $id AND status = 'prepped'`.
   This update touches only the three columns the `0002` trigger permits, so it
   never trips immutability.

`start_date` therefore equals block 0's `block_start_date`, and
`planned_end_date` equals the last block's `block_end_date`
(`start_date + run_length_days - 1`, where
`run_length_days = block_length_days * num_blocks`, matching EPIC 2's
`run_length_days`). No allocation data appears in the confirm-ready response.

There is still **no** route that edits the frozen design, and none is added here.

### 2.5 Schedule model

Blocks are contiguous. Block `i` (in `block_index` order, the sealed schedule)
runs `[start_date + i*L, start_date + i*L + L - 1]` where `L = block_length_days`.
The washout note is advice the user follows around blocks; it does not add
calendar days. This matches EPIC 2's `run_length_days = L * num_blocks` and the
demo seed, so EPIC 5's per-block means line up with the pre-registered length.

### 2.6 Frontend — the prep walkthrough (`/experiments/:id/prep`, 390px)

Replace the placeholder with a real one-step-at-a-time walkthrough. On mount,
fetch `GET /api/experiments/:id/prep`. Hold the layout with `LoadingCard` while
loading; render a product-voice `ErrorState` with retry on failure
(QUALITY BAR §3). If the fetched `status === 'running'`, show the
already-started state (2.8) instead of the walkthrough, so the flow is not
re-entered as if unstarted.

**One step at a time.** Keep a step index in component state. Each step is ONE
short imperative sentence anchored to a real action, with `Back` / `Next` and a
`Step {n} of {total}` indicator. The steps, in order:
1. Make identical capsules (two batches, same look and fill weight).
2. The single batch-to-contents link step (names no code): put the substance
   capsules in Batch 1, the blank capsules in Batch 2. (Wording follows the
   derived `batches[].contents`; when `Batch 1` contents is the blank, the
   sentence still reads naturally, for example "Batch 1 gets your blank
   capsules.")
3. …one step per packet, in `packets` (interleaved) order: fill `{count}`
   capsules from `{batch}` into a packet, seal it, and write `{code}` on it.
4. Shuffle: drop every sealed packet into a bag and shuffle it well.
5. Confirm-ready: a single primary action `Start the run`.

The per-packet steps must show only the code and the neutral batch token, never
the contents and never a day. The batch callout from step 2 must not persist on
screen once the user moves past it (it is the one-time link).

**Feedback within 100ms.** `Next` / `Back` update the visible step instantly
from local state (no network). `Start the run` shows a pressed/`aria-busy`
loading state immediately and disables itself to prevent double-submit; on
success it advances to the confirmation state (2.8). On failure it shows the
inline error and re-enables.

**Printable prep sheet.** A secondary, visibly subordinate action `Print prep
sheet`. It reveals a print-only sheet (a `@media print` block, or a dedicated
print view) listing, in the same interleaved order, a table of
`Packet | Batch | Capsules`. The sheet MUST NOT contain the batch contents, the
substance name against a batch, any condition word, or any date. Everything else
on the page is hidden in print. Include the honest one-line note from 2.8 on the
sheet.

**Accessibility & mobile (QUALITY BAR §2, §6):** the step region uses real
headings and is announced (`aria-live="polite"` on the step container);
`Back` / `Next` / `Print` / `Start the run` are real buttons, keyboard-reachable
with visible focus and ~44px targets; no horizontal scroll at 390px; reuse
existing CSS variables for contrast.

### 2.7 Locked summary tweak (`/experiments/:id`)

Minimal, status-aware change only. When `status === 'prepped'`, keep the current
"Prepare your capsules" primary action routing to `/experiments/:id/prep`. When
`status === 'running'`, do not offer prep as if unstarted: replace that action
with a short "Run in progress" line (copy in 2.8). Do not build any dashboard,
today's-code, or progress UI here. The sealed-summary card is unchanged.

### 2.8 Copy (verbatim, swept clean — no em-dashes, no banned vocabulary, positive phrasing)

Prep walkthrough:
- Heading: `Prepare your capsules`
- Step counter: `Step {n} of {total}`
- Step 1: `Make {substance} capsules and blank capsules that look the same.`
- Step 2 (contents link, substance in Batch 1):
  `Put your {substance} capsules in Batch 1 and your blank capsules in Batch 2.`
- Step 2 (contents link, blank in Batch 1):
  `Put your blank capsules in Batch 1 and your {substance} capsules in Batch 2.`
- Per-packet step:
  `Put {count} capsules from {batch} into a packet, seal it, and write {code} on it.`
- Shuffle step: `Drop every sealed packet into a bag and shuffle it well.`
- Confirm step lead-in: `You are ready. Starting the run sets your schedule and keeps it sealed.`
- Primary action: `Start the run` (loading label: `Starting…`)
- Nav: `Back` / `Next`
- Secondary action: `Print prep sheet`

Prep sheet (printable):
- Title: `Prep sheet`
- Instruction: `Fill each packet with the listed count, seal it, and write its code on it.`
- Table headers: `Packet` / `Batch` / `Capsules`
- Blind note: `This sheet hides which batch is which, so you stay blind.`

Confirmation state (after confirm-ready):
- Heading: `Your run starts today`
- Body: `Come back each day for the packet to open. We hold the schedule so you stay blind.`
- Back link: `Back to summary`

Already-running state (prep opened after the run started):
- Heading: `Your run is already going`
- Body: `Come back each day for the packet to open.`
- Back link: `Back to summary`

Locked summary, running line (2.7):
- Line: `Run in progress. Come back each day for the packet to open.`

Validation / state messages (server + inline):
- Confirm-ready on a finished run (`unblinded`/`voided`): `This run has already finished.`
- Confirm-ready on an unexpected state fallback: `This run cannot start from here.`

Load / error states reuse EPIC 1's `LoadingCard` and `ErrorState`; error copy
(unchanged from EPIC 1/2 for consistency):
`We could not load this page.` / body `Check your connection and try again.` /
action `Try again`.

Run the mechanical copy sweep (section 4) over every string above and every
string added in components before finishing.

---

## 3. Ordered task list (with acceptance criteria)

1. **Prep read model + route.** Add `getPrep` and the batch-label / interleave
   helpers to `experiments.ts`; add `GET /api/experiments/:id/prep`.
   - *AC:* for a locked experiment, the route returns exactly `num_blocks`
     packets, each with a `code`, a `batch` of `Batch 1` or `Batch 2`, and a
     `count = block_length_days`; codes are unique; the two batches split the
     codes evenly (`num_blocks/2` each). The payload contains no `active`,
     `placebo`, `condition`, `block_index`, or any date field. The packet order
     is not the `block_index` order.
   - *AC:* which batch is the substance is derived from the block-0 condition and
     is stable across repeated calls; the same experiment always returns the same
     batch mapping and the same order.
   - *AC:* an unauthenticated request returns `401`; another user's id returns
     `404`; a non-uuid id returns `404`.

2. **Confirm-ready logic + route.** Add `confirmPrep` to `experiments.ts`; add
   `POST /api/experiments/:id/confirm-prep` using the mutation rate-limit bucket.
   - *AC:* from `prepped`, the route returns `200` with `status = 'running'`,
     `start_date = CURRENT_DATE`, and `planned_end_date = start_date +
     block_length_days * num_blocks - 1`; every allocation now has contiguous
     `block_start_date` / `block_end_date`, block 0 starting on `start_date`.
   - *AC:* the call is idempotent: a second call returns `200` with the same
     running summary and does not change any date.
   - *AC:* the response body contains no code, `condition`, `active`, `placebo`,
     `allocation`, or block date.
   - *AC:* confirm-ready on an `unblinded` or `voided` experiment returns `422`
     with a plain message and changes no rows; unauthenticated returns `401`;
     another user's id returns `404`.
   - *AC:* the confirm-ready update touches only `status`, `start_date`,
     `planned_end_date` on `experiments`, so the `0002` immutability trigger does
     not fire (proven by the update succeeding on a pre-registered row).

3. **API client.** Add `getPrep` and `confirmPrep` (and their types) to
   `api.ts`.
   - *AC:* both call the correct paths with `credentials: "same-origin"` and
     surface `ApiRequestError` on non-OK responses, matching the existing client.

4. **Prep walkthrough page.** Replace the placeholder per 2.6.
   - *AC:* at 390px, the page fetches prep, presents one imperative step at a
     time with `Back` / `Next` and a step counter, shows one on-screen batch-to-
     contents link step, then a per-packet step for every code showing only the
     code and its neutral batch token, then a shuffle step, then `Start the run`;
     no per-packet step shows a condition word or a day; no horizontal scroll;
     keyboard reaches every control with visible focus.
   - *AC:* designed loading and error states are present; opening prep when the
     experiment is already `running` shows the already-running state, not the
     walkthrough.

5. **Printable prep sheet.** Add the print view and `@media print` styles.
   - *AC:* the printed sheet lists every code with its batch token and capsule
     count and the blind note, and contains no batch contents, no substance-to-
     batch pairing, no condition word, and no date.

6. **Confirm-ready in the UI + locked-summary tweak.** Wire `Start the run` to
   `confirmPrep`, show the confirmation state, and make the locked summary
   status-aware per 2.7.
   - *AC:* pressing `Start the run` gives feedback within 100ms, cannot double-
     submit, and on success shows `Your run starts today`; returning to
     `/experiments/:id` shows the running line, not a second prep invitation.

7. **Tests + mechanical copy sweep.** All backend + e2e tests in section 4; run
   the copy sweep over every user-visible string touched.
   - *AC:* all listed tests pass; the sweep finds no `—` / `–`, no banned
     vocabulary, and no negative empty-state phrasing in any shipped string.
   - *AC:* the prep e2e completes the entire walkthrough using only on-screen
     guidance and reaches the running state; the implementer records a 3 to 5
     sentence usability note (in `result.json` `summary`, or a short
     `PREP_USABILITY.md`) confirming a first-time user can finish prep from the
     walkthrough alone.

---

## 4. Test plan (which test proves each acceptance criterion)

Automated, run in the foreground to completion before writing `result.json`.

**Backend (Vitest, `fastify.inject` + PGlite, following `server/test/helpers.ts`;
lock a real experiment via `POST /api/experiments` as the existing
`allocation-never-serialized.test` does):**

- `prep.test` (new):
  - `GET /api/experiments/:id/prep` returns `num_blocks` packets with unique
    codes, each `batch` in {`Batch 1`, `Batch 2`}, each `count =
    block_length_days`; the two batches are balanced. Cross-check against the DB:
    the returned codes equal the stored allocation codes, and the returned order
    differs from `block_index` order. The payload string contains none of
    `active`, `placebo`, `condition`, `block_index`, `block_start_date`,
    `block_end_date`. Repeated calls return an identical body (stable derivation).
    → *AC task 1.*
  - Auth: unauth → `401`; another user's id → `404`; non-uuid id → `404`. →
    *AC task 1.*
  - `POST /api/experiments/:id/confirm-prep` from `prepped` → `200`,
    `status='running'`, `start_date = CURRENT_DATE` (compare to a DB
    `SELECT CURRENT_DATE`), `planned_end_date = start_date + L*num_blocks - 1`;
    all allocations have contiguous block dates with block 0 on `start_date`.
    Body carries no code / condition / date. → *AC task 2.*
  - Idempotency: a second confirm-ready → `200`, same summary, allocation dates
    unchanged (re-select and compare). → *AC task 2.*
  - State guard: confirm-ready on a `voided` experiment (force the status via a
    direct `UPDATE … SET status='voided'`, allowed by the trigger) → `422`, no
    row changes; unauth → `401`; other user → `404`. → *AC task 2.*
  - Immutability coexistence: after confirm-ready flips a pre-registered row to
    `running`, a direct `UPDATE` of a frozen column (for example `metric_name`)
    still raises, proving confirm-ready did not weaken the seal. → *AC task 2.*
- `allocation-never-serialized.test` (extend): after locking and confirming a
  real experiment, assert `GET /api/experiments/:id` and the confirm-ready
  response still contain none of the generated codes, `placebo`, `active`,
  `allocation`, `condition`, or block dates. Document in a comment that
  `GET …/prep` is the one intentional exception that carries codes, and assert
  there that it still carries no condition word, no `block_index`, and no date.
  → *the trust invariant on the running design.*
- `immutability.test` (existing): unchanged, still passes with the new writes in
  play. → *DB seal baseline.*
- `migrations.test` (existing): unchanged (no new migration). → *DB baseline.*

**Frontend / e2e (Playwright, 390px project; sign in via the console transport,
lock a design through the real `/design` flow as `design.spec` does):**

- `prep.spec` (new): from a freshly locked experiment, open
  `/experiments/:id/prep`; step through the walkthrough using only `Next`
  (one step at a time, step counter visible); confirm a per-packet step shows a
  code and a batch token and never the text `active`, `placebo`, or a date;
  reach and press `Start the run`; land on `Your run starts today`; returning to
  `/experiments/:id` shows the running line, not a second prep button. No
  horizontal scroll at 390px throughout. This run is the recorded usability
  check. → *AC tasks 4, 6, 7.*
- `prep-safety.spec` (new, or a case inside `prep.spec`): open the print view /
  toggle the sheet and assert its content lists codes, batch tokens, and counts
  but does not contain the substance name paired with a batch, the words
  `active` / `placebo`, or any date. → *AC task 5, the blind-safe-sheet guard.*

**Non-automated verification (record in `result.json` summary):**
- Mechanical copy sweep over every user-visible string added or edited
  (`Prep.tsx`/`PrepPlaceholder.tsx`, `ExperimentLocked.tsx`, any new `ui.tsx`
  strings, and the copy in 2.8): search for `—`, `–`, the banned vocabulary, and
  negative empty-state phrasing. Fix every hit. → *copy quality.*
- The 3 to 5 sentence prep usability note (AC task 7).

---

## 5. Definition of done

All acceptance criteria in §3 are met and all §4 tests pass. A user who has
locked a design can open the prep walkthrough, follow one short imperative step
at a time through making two identical batches, filling every coded packet from a
neutral batch token in a randomized interleaved order, and shuffling, then press
`Start the run`. No walkthrough step, no prep API field, and no printed line
pairs a code with its condition or its day; the printable sheet is blind-safe on
its own. Confirm-ready transitions the experiment to `running`, sets
`start_date`, `planned_end_date`, and every block's dates, and is idempotent; it
touches only the columns the immutability trigger permits, and the design stays
sealed. Nothing from the Non-Goals (§1 out-of-scope) is built: no dashboard, no
check-ins, no paired-jars mode, no scanning, no calendar washout gaps. The copy
sweep is clean and the usability check is recorded. `EPIC_SPEC.md` (this file) is
the only artifact this task leaves; the implementer executes it.
