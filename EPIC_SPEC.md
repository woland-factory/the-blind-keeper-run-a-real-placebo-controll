# EPIC SPEC — Unblinding verdict (the signature moment)

## Quality differentiator (this app must win on it)

**Trust: you can believe the answer.** The verdict is one the user did not
generate and could not bias, and when the data cannot decide, the app says so
plainly instead of manufacturing confidence.

This epic IS the differentiator's moment of truth. Three rules follow from it:

1. **The verdict is deterministic arithmetic, never generation.** A pure,
   unit-tested engine (exact permutation test, exact binomial test) computes it
   once from the stored data. No LLM, no network call, no randomness anywhere
   in the path. The same data always yields the same verdict.
2. **A null is read honestly.** When the data cannot separate supplement from
   blank, the verdict says exactly that, names what size of effect the run
   could have seen, and never lets "no signal" read as "proven nothing."
3. **The reveal is earned, gated, and singular.** The schedule and verdict
   unseal only when the run is complete and the user asks; a voided run never
   gets one; the result is computed once, stored, and served unchanged forever
   after. Nothing about the answer can be re-rolled.

The two-part reveal (what the data says, and whether the user could feel it)
is the interaction users repeat to friends. Section 2.5's templates carry it;
implement them verbatim.

---

## 1. Scope

### In scope
- **Migration `0004`**: extend the existing `verdicts` table with the guess
  counts, days-logged count, p-value floor, and the part-two text column the
  screen needs (section 2.2).
- **The verdict engine** (`server/src/verdict.ts`, new, pure): exact
  permutation test on block means oriented by `metric_direction`, exact
  binomial test of guess accuracy versus chance (unsure days excluded and
  counted), adherence, blind-integrity flag, honest power note reusing
  `power.ts`, and the deterministic two-part verdict text (section 2.4–2.5).
- **`POST /api/experiments/:id/unblind`**: allowed only when the run is
  complete; flips `status` to `unblinded`, computes the verdict once, stores
  it, and serves it. A second call serves the stored result (section 2.6).
- **`GET /api/experiments/:id/verdict`**: the stored verdict for an
  `unblinded` experiment, including the now-unsealed schedule table.
- **The verdict screen** (`/experiments/:id/verdict`, new page): the two-part
  reveal, adherence, the blind-integrity reading, the power caveat, and the
  unsealed schedule, legible at 390px with designed loading/error states
  (section 2.9).
- **Wiring the moment**: the run page's `complete` phase becomes the
  `Reveal the verdict` action; its `unblinded` phase and the locked summary's
  `unblinded` status link to the verdict screen (section 2.9).
- **An engine-computed demo verdict**: `seed.ts` stops hand-authoring verdict
  numbers and computes them with the real engine over its seeded check-ins,
  so the staging demo's verdict is a true output of the product (2.8).
- **A dev-only run-completion route** (console mail transport only, never
  production) so the e2e suite can reach a completed run without waiting 42
  days (section 2.7).

### Out of scope (do not build — later epics or non-goals)
- **LLM-written narrative verdicts** (Non-Goal). The verdict text is a fixed
  deterministic template. No LLM call, no BYOK surface, nothing "optional".
- **Bayesian model selection** (Non-Goal). One permutation test, one binomial
  test. No model comparison, no priors, no effect-size shrinkage.
- **Sharing/publishing** (Non-Goal). No share link, no image export, no
  copy-to-clipboard card.
- **The formulary and export** (EPIC 6). No list of past verdicts, no export
  file. The verdict screen links back to the experiment summary only.
- **Measured-noise carry-forward** (EPIC 6). The power note uses the same
  assumed within-person noise as the design screen (`DEFAULT_WITHIN_SD`).
- **A per-day guess-overlay visualization.** The payload carries the guess
  counts and the per-block schedule table; a day-by-day chart of guesses over
  the schedule is a later polish idea, not this epic.
- **Recomputing or editing a verdict.** No recompute endpoint, no admin
  override. Determinism plus compute-once is the contract.
- **Changing EPIC 2's power preview.** The preview endpoint and Design screen
  are untouched (see the requested-task note on `yes_no` units in the run
  summary; do not fix it here).

---

## 2. Technical design

Build on EPIC 1–4 exactly as it stands. Reuse: the `Db` interface
(`server/src/db/index.ts`), zod at the boundary, `errorEnvelope` and
`requireAuth` (`server/src/http.ts`), `ExperimentError`, the owner-scoped
`WHERE id = $1 AND user_id = $2` pattern and the "miss returns null → route
answers 404" convention (`server/src/experiments.ts`), `idSchema` and
`mutationLimit` (`server/src/routes/experiments.ts`), `combinations`,
`pValueFloor`, and `minimumDetectableEffect` (`server/src/power.ts`),
`METRIC_UNITS` and `DEFAULT_WITHIN_SD` (`server/src/metrics.ts`), the
frontend `api.ts` client, and `Page` / `LoadingCard` / `ErrorState` with the
existing mobile-first CSS. Introduce no new dependencies.

### 2.1 The reveal rule at unblinding (read first, binding)

EPIC 4 established the trust invariant: while an experiment is sealed, no
code-to-condition mapping, no code-to-day schedule, and no condition label
ever leaves the server. This epic adds the second and final intentional
reveal (after break-blind) and must not widen anything else:

1. **The verdict path serves allocation data ONLY for `status = 'unblinded'`.**
   `GET /verdict` returns 422 for every other status. `POST /unblind` flips
   the status first, under a guard, and only then serves the reveal. There is
   no state in which a sealed experiment's schedule or conditions can cross
   the wire through these routes.
2. **The status flip is the gate, and it is one-way.** `running` (past its
   last day) → `unblinded` via a guarded single-row update. `voided` never
   becomes `unblinded`; `unblinded` never becomes anything else. Break-blind
   already refuses `unblinded` runs, so the two reveals cannot both fire.
3. **`GET /today`, `GET /prep`, `GET /:id`, and the check-in response are
   untouched.** Extend `allocation-never-serialized.test` to name the verdict
   routes as the second intentional exception and to prove they refuse a
   sealed run.
4. **The engine is pure and offline.** `server/src/verdict.ts` imports no
   HTTP client, reads no env, calls no external service. A test stubs global
   `fetch` to throw and runs the whole unblind path to prove no network call
   happens (this is how "no LLM anywhere in the verdict path" is made
   provable, alongside the no-new-dependencies rule).

### 2.2 Migration `0004_verdict.sql` (new, forward-only)

The `verdicts` table exists since `0001` with the core columns
(`effect_estimate`, `effect_units`, `permutation_p_value`, `guess_accuracy`,
`guess_p_value_vs_chance`, `adherence_pct`, `blind_integrity_flag`,
`power_note`, `verdict_text`, `computed_at`, and `UNIQUE (experiment_id)`).
Add what the two-part screen needs. Never edit an applied migration; this is
a new file after `0003`.

```sql
-- 0004_verdict.sql: the verdict screen shows counts, not just rates, and the
-- reveal has two text parts. Store them at compute time so the stored verdict
-- is the whole answer. Forward-only.

ALTER TABLE verdicts ADD COLUMN guess_text        text;
ALTER TABLE verdicts ADD COLUMN guess_days_scored  int;
ALTER TABLE verdicts ADD COLUMN guess_days_correct int;
ALTER TABLE verdicts ADD COLUMN guess_days_unsure  int;
ALTER TABLE verdicts ADD COLUMN days_logged        int;
ALTER TABLE verdicts ADD COLUMN p_value_floor      numeric;
```

No index is needed: every verdict read is by `experiment_id`, which is
`UNIQUE` already. `experiments.status` writes stay within the columns the
`0002` immutability trigger permits.

### 2.3 New / changed files

**Server**
- `server/migrations/0004_verdict.sql` (new) — section 2.2.
- `server/src/verdict.ts` (new) — the pure engine: `permutationTest`,
  `binomialTestVsChance`, `computeVerdict`, and the text/format helpers of
  2.5. No I/O, no imports beyond `power.ts` and `metrics.ts`.
- `server/src/experiments.ts` (edit) — add `unblindExperiment`,
  `getVerdictView`, and a shared `ensureVerdict` helper (2.6). Leave every
  existing function untouched.
- `server/src/routes/experiments.ts` (edit) — add the two verdict routes and
  the dev completion route (2.6, 2.7), reusing `idSchema`, `requireAuth`, and
  `mutationLimit` for the mutation.
- `server/src/seed.ts` (edit) — compute the demo verdict with the engine
  (2.8).

**Web**
- `web/src/pages/Verdict.tsx` (new) — the verdict screen (2.9).
- `web/src/pages/Run.tsx` (edit) — the `complete` phase becomes the reveal
  action; the `unblinded` phase links to the verdict (2.9).
- `web/src/pages/ExperimentLocked.tsx` (edit, minimal) — an `unblinded`
  branch with a `See the verdict` action (2.9).
- `web/src/App.tsx` (edit) — route `/experiments/:id/verdict` → `Verdict`.
- `web/src/api.ts` (edit) — `unblind`, `getVerdict`, and the `VerdictView`
  types.
- `web/src/styles.css` (edit) — verdict-screen styles (the two reveal cards,
  the stat rows, the schedule table reuse), mobile-first at 390px, existing
  CSS variables only.

**Tests** — see section 4.

### 2.4 The verdict engine (`server/src/verdict.ts`) — exact definitions

All functions are pure and deterministic. `Math.random` and any RNG are
forbidden; the permutation test enumerates exactly.

**Inputs to `computeVerdict`** (plain values, no Db): the experiment's
`substance_name`, `metric_name`, `metric_type`, `metric_direction`,
`block_length_days`, `num_blocks`, `num_active_blocks`, `run_length_days`,
the allocations (`condition`, `block_start_date`, `block_end_date` per
block), and the check-ins (`check_date`, `metric_value`, `placebo_guess`).

**Windowing.** Only check-ins with `check_date` inside
`[start_date, planned_end_date]` count anywhere below (a stray row outside
the window, possible after the dev completion shift of 2.7, is ignored).

**Adherence.**
- `days_logged` = number of in-window check-ins (one per day by the DB
  constraint).
- `adherence_pct` = `round1(100 * days_logged / run_length_days)`.

**Block means and the effect.**
- A block's mean = mean of `metric_value` over its in-window check-ins with
  `block_start_date <= check_date <= block_end_date`. A block with zero
  check-ins is EXCLUDED from the effect test (it has no mean).
- If the included blocks contain zero `active` blocks or zero `placebo`
  blocks, the effect cannot be computed: `effect_estimate`,
  `permutation_p_value`, and `p_value_floor` are `null` and the verdict text
  takes the insufficient-data branch (2.5). Guess scoring and adherence still
  compute.
- Otherwise `raw_effect` = mean(active block means) − mean(blank block
  means), in the metric's raw units.
- **`yes_no` conversion**: for `metric_type = 'yes_no'`, multiply the effect
  (and the power note's MDE) by 100 and report in `percentage points`
  (`METRIC_UNITS.yes_no`). Every other type reports raw with its
  `METRIC_UNITS` label.
- `effect_estimate` stored = `round1` of the (converted) signed effect,
  sign convention active minus blank.

**The permutation test (`permutationTest`).**
- Test statistic, oriented so that positive means "the supplement helped":
  `oriented(labeling)` = (mean of blocks labeled active − mean of blocks
  labeled blank), negated when `metric_direction = 'lower_better'`.
- Enumerate ALL `C(m, a)` labelings of the `m` included blocks with `a`
  active labels, where `a` is the number of included blocks that are truly
  active (use an iterative index-combination generator; `C(12, 6) = 924` is
  the worst case, so brute force is fine).
- One-sided p-value = (number of labelings with
  `oriented(labeling) >= oriented(observed)`) / `C(m, a)`. Ties count; the
  identity labeling always counts, so `p >= 1 / C(m, a)` — the floor the
  design screen promised. Six balanced blocks give `C(6,3) = 20` and a floor
  of exactly `0.05`.
- `p_value_floor` stored = `1 / C(m, a)` for the INCLUDED blocks (equals
  `pValueFloor(num_blocks, num_active_blocks)` when every block has data).
- `significant` (derived, not stored) = `permutation_p_value <= 0.05`.

**The guess test (`binomialTestVsChance`).**
- For each in-window check-in, find its block by date. Days with
  `placebo_guess = 'unsure'` are excluded and counted as
  `guess_days_unsure`. The rest are scored: correct when the guess equals
  the block's condition (`'active'` ↔ active, `'placebo'` ↔ placebo).
- `guess_days_scored` = scored days, `guess_days_correct` = correct days,
  `guess_accuracy` = correct / scored (null when scored = 0).
- One-sided exact binomial versus chance 0.5:
  `guess_p_value_vs_chance` = `sum(C(n, i) for i = k..n) / 2^n` with
  `n = guess_days_scored`, `k = guess_days_correct` (null when n = 0). Use
  `combinations` from `power.ts`; for n beyond safe-integer territory this
  never occurs (n <= 12 * 14 = 168 days; compute the sum in floating point
  via the ratio form `C(n,i)/2^n` accumulated iteratively to avoid overflow —
  spec: implement the term iteratively, `term(i+1) = term(i) * (n-i)/(i+1)`,
  starting from `term(0) = 0.5^n` computed as `Math.pow(0.5, n)`).
- `guesses_beat_chance` (derived) = `guess_p_value_vs_chance !== null && <= 0.05`.
- `blind_integrity_flag` stored = `guesses_beat_chance`.

**The power note.** Reuse `minimumDetectableEffect` with
`DEFAULT_WITHIN_SD[metric_type]` (the same stated assumption the design
screen used; measured noise is EPIC 6) over the DESIGNED blocks
(`num_active_blocks`, `num_blocks - num_active_blocks`,
`block_length_days`), `yes_no` converted per above, `round1`. Compose the
`power_note` text of 2.5 with that MDE and
`pValueFloor(num_blocks, num_active_blocks)`.

**Output.** `computeVerdict` returns every stored column of the `verdicts`
table (2.2 plus the originals) as one object. `verdict_text` and
`guess_text` come from the templates in 2.5. `computed_at` is left to the
DB default.

### 2.5 Verdict text and formatting (verbatim, deterministic, swept clean)

Formatting helpers (unit-tested, exported from `verdict.ts`):
- `round1(n)`: one decimal, as elsewhere in the codebase.
- `luckPhrase(p)`: `p >= 0.001` → `about {pct} of the time` where `pct` is
  `p * 100` rounded to a whole percent when `>= 1` (`0.05` → `5%`, `0.25` →
  `25%`) and to one decimal when `< 1` (`0.0036` → `0.4%`); `p < 0.001` →
  `fewer than 1 time in 1000`.
- Direction word: for the effect sentence, `higher` when the signed effect is
  positive, `lower` when negative; use the absolute `round1` value with it.

**`verdict_text` (part one, the effect):**
- Effect computed and `permutation_p_value <= 0.05`:
  `{substance_name} moved your {metric_name}. Supplement days ran about {X} {units} {higher|lower} than blank days. Luck alone does that {luckPhrase(p)}.`
- Effect computed, not significant, `|effect| rounds to 0.0`:
  `Your {metric_name} could not tell {substance_name} from a blank. Supplement and blank days ran about even.`
- Effect computed, not significant, otherwise:
  `Your {metric_name} could not tell {substance_name} from a blank. Supplement days ran about {X} {units} {higher|lower}, well within luck.`
- Effect not computable (insufficient data):
  `Too few days were logged to test {substance_name} against a blank. Log more days next run.`

**`guess_text` (part two, could you feel it):**
- `guess_days_scored = 0`:
  `You marked every day unsure, so this run cannot score your guesses.`
- `guesses_beat_chance`:
  `You felt it. You guessed right on {C} of {S} days. A coin gets about half.`
- Otherwise:
  `Your guesses matched a coin flip: right on {C} of {S} days.`

**`power_note`:**
`A run this size can reliably notice a change of about {mde} {units} or larger, given a typical amount of day-to-day noise. With {num_blocks} blocks, the strongest possible evidence is p = {floor}. Read a quiet result as "not enough signal," never as "proven nothing."`
(`floor` printed as the plain decimal of
`pValueFloor(num_blocks, num_active_blocks)`, e.g. `0.05`.)

These strings are the stored, immutable verdict. They must pass the
mechanical copy sweep exactly as written (no em-dashes, no banned
vocabulary; the honest negations above are verdict statements, not
empty-state filler, and stay as written). The screen-only strings live in
2.10.

### 2.6 Unblinding and serving (`experiments.ts` + routes)

**`ensureVerdict(db, experimentId)`** (internal): if a `verdicts` row exists
for the experiment, return it. Otherwise load allocations and in-window
check-ins, call `computeVerdict`, `INSERT ... ON CONFLICT (experiment_id) DO
NOTHING`, and re-select. The `UNIQUE (experiment_id)` constraint makes
compute-once race-safe, and determinism makes a lost race harmless: both
writers computed identical numbers. Also heals the crash window between a
status flip and the verdict insert.

**`unblindExperiment(db, userId, id)`**, owner-scoped:
1. Load the experiment (`WHERE id = $1 AND user_id = $2`); a miss returns
   `null` (route → 404).
2. If `status = 'unblinded'`: return `getVerdictView` (idempotent; serves the
   stored result, `computed_at` untouched).
3. If `status = 'voided'`: throw
   `ExperimentError(422, "invalid_state", "You broke the blind, so this run has no verdict.")`.
4. If `status = 'prepped'` (or any other non-running):
   `ExperimentError(422, "invalid_state", "This run has not started.")`.
5. If `status = 'running'`: flip first, guarded and complete-gated in one
   statement:
   `UPDATE experiments SET status = 'unblinded' WHERE id = $1 AND status = 'running' AND CURRENT_DATE > planned_end_date`.
   - 0 rows and a re-read shows `unblinded`: another request won the race;
     fall through to serve the stored verdict.
   - 0 rows otherwise (still inside the calendar window):
     `ExperimentError(422, "invalid_state", "Your run is still going. Finish every block first.")`.
   - 1 row: `ensureVerdict`, then return `getVerdictView`.
   The update touches only `status`, which the `0002` trigger permits.

**`getVerdictView(db, userId, id)`**, owner-scoped: a miss returns `null`
(route → 404). When `status != 'unblinded'`, throw
`ExperimentError(422, "invalid_state", ...)` with:
- `voided` → `You broke the blind, so this run has no verdict.`
- `running` past its window → `Your run is complete. Reveal the verdict first.`
- anything else → `Finish the run, then reveal the verdict.`
When `unblinded`: `ensureVerdict`, then return exactly this shape (the route
sends it verbatim; dates cast `::text` as elsewhere):

```json
{
  "id": "uuid",
  "status": "unblinded",
  "substance_name": "Theanine",
  "metric_name": "Afternoon focus",
  "metric_type": "rating_0_10",
  "metric_direction": "higher_better",
  "num_blocks": 6,
  "block_length_days": 7,
  "run_length_days": 42,
  "verdict": {
    "effect_estimate": 0.2,
    "effect_units": "points",
    "permutation_p_value": 0.42,
    "p_value_floor": 0.05,
    "significant": false,
    "guess_days_scored": 30,
    "guess_days_correct": 16,
    "guess_days_unsure": 12,
    "guess_accuracy": 0.533,
    "guess_p_value_vs_chance": 0.43,
    "guesses_beat_chance": false,
    "days_logged": 42,
    "adherence_pct": 100,
    "blind_integrity_flag": false,
    "power_note": "…",
    "verdict_text": "…",
    "guess_text": "…",
    "computed_at": "2026-09-15T10:22:00.000Z"
  },
  "blocks": [
    { "code": "MQ7", "contents": "Theanine", "block_start_date": "2026-08-04", "block_end_date": "2026-08-10" }
  ]
}
```

`blocks` reuses the break-blind reveal mapping (`active` →
`substance_name`, `placebo` → `Blank`, `block_index` order) — the run is
unblinded, and showing the schedule is what lets the user check the verdict
against their own memory, which is the trust bar in action. `significant` and
`guesses_beat_chance` are derived from the stored p-values at serialization.
Numeric columns come back from the driver as strings for `numeric` types:
coerce with `Number(...)` in the view builder so the JSON carries numbers
(match how existing code handles `metric_value` if it does; verify at
implementation).

**Routes** (in `routes/experiments.ts`; `:id` via `idSchema`, misses and
non-uuids → 404, standard `errorEnvelope` everywhere, 401 without a
session):

- **`POST /api/experiments/:id/unblind`** — `requireAuth` + `mutationLimit`.
  No request body (ignore any). 200 with the verdict view on success (first
  call and every later call); 422 per the state matrix above; 404 when not
  owned/found.
- **`GET /api/experiments/:id/verdict`** — `requireAuth`, global limiter.
  200 with the verdict view when `unblinded`; 422 per the matrix; 404 when
  not owned/found.

### 2.7 Dev-only completion route (test scaffolding, never production)

The e2e suite must exercise the real signature moment (complete run → reveal
→ verdict) without a 42-day wait. Mirror the `last-magic-link` precedent, but
gated STRICTLY on the console mail transport (never the
`E2E_EXPOSE_MAGIC_LINK` escape, so it cannot exist on staging or
production):

```
if (app.env.mailTransport === "console") {
  app.post("/api/experiments/:id/complete-run", { preHandler: requireAuth }, ...)
}
```

Register it under `/api/experiments/:id/complete-run` inside the same
console-only guard style, owner-scoped like every other experiment route
(404 on a miss). Behavior, only for a `running` experiment (422
`invalid_state`, `This run has not started.` otherwise):
1. Shift the whole calendar back by `run_length_days`:
   `UPDATE experiments SET start_date = start_date - run_length,
   planned_end_date = planned_end_date - run_length WHERE id = $1` and the
   same `- run_length` shift on both date columns of its `allocations`.
   (`start_date`/`planned_end_date` are outside the frozen-column set, and
   `allocations` has no trigger, so this is legal.)
2. Backfill one check-in for every shifted run day that lacks one, valued by
   the day's true condition so the demo verdict has real signal:
   `metric_value` = 8 on active days and 3 on blank days for
   `rating_0_10` / `minutes` / `count` (swapped when
   `metric_direction = 'lower_better'`), and 1 / 0 (swapped likewise) for
   `yes_no`; `placebo_guess` = the day's true condition; `note` = NULL.
3. Respond `200 { "ok": true }`.

This route exists for tests and local development only. It is not part of
the product surface, gets no UI, and the gate condition is itself asserted
by test (section 4).

### 2.8 Seed: the demo verdict comes from the engine

`seed.ts` currently inserts hand-authored verdict numbers. Now that the
engine exists, hand-authored numbers on the staging demo would be exactly
the manufactured confidence this product exists to kill. Change the seed's
verdict insert to: build the engine input from the seed's own BLOCKS and
generated check-ins, call `computeVerdict`, and insert the engine's output
(all columns, including the new 2.2 ones). Keep the seeded experiment,
allocations, and check-ins exactly as they are; the near-null data already
tells the right demo story, and the engine will now say so in its own words.
Delete the hardcoded `VERDICT_TEXT`/`POWER_NOTE` constants and the static
numbers. The seed stays idempotent (the existing skip guard is untouched).

### 2.9 Frontend — the reveal and the verdict screen (390px)

**`Run.tsx`, phase `complete`** (replaces the current pass-through card;
grep the e2e specs first and keep any asserted `running`-phase strings
untouched — the `complete` body text is not asserted anywhere today):
- Heading `Your run is complete`, body
  `Every block is logged. The schedule stays sealed until you reveal the verdict.`
- One primary button `Reveal the verdict`. On press: `aria-busy` pressed
  state with label `Revealing…` within 100ms, disabled against
  double-submit; call `POST /unblind`; on success navigate to
  `/experiments/:id/verdict`; on failure show an inline error line
  (`Check your connection and try again.`) and re-enable. A 422 with the
  voided message navigates back to the summary.
- A subordinate `Back to summary` link stays.

**`Run.tsx`, phase `unblinded`** (replaces the bare back-link card): heading
`Your verdict is ready`, primary link `See the verdict` to
`/experiments/:id/verdict`, ghost `Back to summary`.

**`ExperimentLocked.tsx`** (minimal, status-aware): add an `unblinded`
branch before the final else: line `This run is finished.` plus a primary
button `See the verdict` navigating to `/experiments/:id/verdict`. The
`running`, `voided`, and default (`prepped`) branches are byte-for-byte
untouched (EPIC 3/4 e2e asserts them).

**`Verdict.tsx`** (new page). On mount fetch `GET /verdict`. `LoadingCard`
while loading; designed `ErrorState` with retry on failure. On a 422
`invalid_state`, redirect to `/experiments/:id` (the summary's status
affordances take over). On success render, top to bottom:

1. Header: h1 `Your verdict`, subhead
   `{substance_name}. {run_length_days} days, sealed until now.`
2. **Part one card** (hero): h2 `What the data says`, body =
   `verdict_text`. Small stat row underneath: `Effect {signed effect} {units}`
   and `p = {p}` (p to 3 decimals; `p < 0.001` when smaller; the row is
   omitted entirely on the insufficient-data branch).
3. **Part two card** (the repeatable moment): h2 `Could you feel it?`, body =
   `guess_text`. When `guess_days_unsure > 0`, a quiet line:
   `{U} unsure days sit out of the guess score.`
4. **The blind line**: when `blind_integrity_flag` and `significant`:
   `You also guessed the days better than chance. Some of the gap may be expectation rather than the capsule. Weigh the result with that in mind.`
   When `blind_integrity_flag` and not `significant`:
   `You guessed the days better than chance, so the blind may have leaked. Treat this run's numbers with extra doubt.`
   When the flag is false and `guess_days_scored > 0`:
   `The blind held: your guesses stayed near chance.`
   (No line when `guess_days_scored = 0`.)
5. **Adherence line**: `You logged {days_logged} of {run_length_days} days.`
6. **Power card**: h2 `How much this run could see`, body = `power_note`.
7. **Schedule table**: h2 `The schedule, unsealed`, the existing
   `sheet-table reveal-table` markup with headers `Packet` / `What it was` /
   `Days`, one row per block (`code`, `contents`,
   `{block_start_date} to {block_end_date}`), in the served order.
8. Ghost link `Back to summary` to `/experiments/:id`.

The two reveal cards carry the visual weight (larger type on `verdict_text`
and `guess_text` via a couple of new CSS classes); everything below is
subordinate. No animations, no confetti — the honesty IS the moment.

**Accessibility & mobile (QUALITY BAR §2, §6):** real heading order
(h1 → h2s), the schedule as a real `<table>`, every link/button
keyboard-reachable with visible focus and ~44px targets, no horizontal
scroll at 390px, existing CSS variables for contrast. `aria-busy` on the
reveal button while pending.

### 2.10 Screen-only copy (verbatim; the stored verdict strings live in 2.5)

Run page, `complete`:
- Heading: `Your run is complete`
- Body: `Every block is logged. The schedule stays sealed until you reveal the verdict.`
- Primary: `Reveal the verdict` (pending label: `Revealing…`)
- Inline error: `Check your connection and try again.`
- Ghost link: `Back to summary`

Run page, `unblinded`:
- Heading: `Your verdict is ready`
- Primary: `See the verdict`
- Ghost link: `Back to summary`

Locked summary, `unblinded`:
- Line: `This run is finished.`
- Primary: `See the verdict`

Verdict screen:
- h1: `Your verdict`
- Subhead: `{substance_name}. {run_length_days} days, sealed until now.`
- Card headings: `What the data says` / `Could you feel it?` /
  `How much this run could see` / `The schedule, unsealed`
- Stat row: `Effect {X} {units}` / `p = {p}`
- Unsure line: `{U} unsure days sit out of the guess score.`
- Blind lines: as written in 2.9 item 4.
- Adherence: `You logged {n} of {m} days.`
- Table headers: `Packet` / `What it was` / `Days`
- Back link: `Back to summary`

Server messages (all via `errorEnvelope`):
- Unblind mid-run (`422`): `Your run is still going. Finish every block first.`
- Unblind/verdict on voided (`422`): `You broke the blind, so this run has no verdict.`
- Unblind before start (`422`): `This run has not started.`
- Verdict on a complete-but-sealed run (`422`): `Your run is complete. Reveal the verdict first.`
- Verdict on any other sealed state (`422`): `Finish the run, then reveal the verdict.`

Loading/error states reuse `LoadingCard` and `ErrorState` with the standard
copy (`We could not load this page.` / `Check your connection and try
again.` / `Try again`). Run the mechanical copy sweep (section 4) over every
string above and every string in 2.5 before finishing.

---

## 3. Ordered task list (with acceptance criteria)

1. **Migration `0004`.** Add the six verdict columns per 2.2.
   - *AC:* migrations apply cleanly on a fresh database; `migrations.test`
     passes; existing verdict inserts (seed) still work once updated.

2. **Verdict engine.** Build `server/src/verdict.ts` per 2.4–2.5: exact
   permutation test, exact binomial test, adherence, blind-integrity flag,
   power note, verbatim text templates, formatting helpers.
   - *AC:* `permutationTest` reproduces the hand-computed vectors in section
     4 exactly, including the six-block floor case where the best possible
     outcome yields p = 0.05 and never less.
   - *AC:* `binomialTestVsChance` matches exact values (section 4) and
     returns null-safe output for zero scored days.
   - *AC:* `computeVerdict` handles: full data; blocks with missing days;
     one condition entirely unlogged (insufficient-data branch, null effect
     fields, honest text); all-unsure guesses; `yes_no` percentage-point
     conversion; `lower_better` orientation. All deterministic: same input,
     same output, no RNG.
   - *AC:* every produced string matches 2.5 verbatim and passes the copy
     sweep.

3. **Unblind + verdict read, server.** Add `ensureVerdict`,
   `unblindExperiment`, `getVerdictView` and the two routes per 2.6.
   - *AC:* on a `running` experiment past `planned_end_date`, `POST /unblind`
     returns 200, sets `status = 'unblinded'`, and stores exactly one
     `verdicts` row; a second POST returns 200 with the same stored result
     and an unchanged `computed_at`.
   - *AC:* `POST /unblind` mid-run → 422; on `prepped` → 422; on `voided` →
     422; unauthenticated → 401; another user's id and non-uuid ids → 404.
     `GET /verdict` mirrors the matrix and serves the stored view only when
     `unblinded`.
   - *AC:* the verdict view carries the schedule (`blocks`) and every field
     of 2.6's shape with numeric types as numbers.
   - *AC:* no network call occurs anywhere in the unblind path (fetch-stub
     test, section 4), and no new dependency was added.

4. **Dev completion route.** Add the console-transport-only
   `POST /api/experiments/:id/complete-run` per 2.7.
   - *AC:* with the console transport, a running experiment's dates shift
     back one full run length and every run day gains a condition-valued
     check-in with a true-condition guess; the run then reads `phase:
     "complete"` on `GET /today`. With the central transport the route does
     not exist (404).

5. **Seed uses the engine.** Rework the seed's verdict insert per 2.8.
   - *AC:* with `SEED_DEMO=true`, the stored demo verdict equals
     `computeVerdict` run over the seeded allocations and check-ins
     (recompute in the test and compare field by field); the hardcoded
     verdict constants are gone; the seed remains idempotent.

6. **API client.** Add `unblind`, `getVerdict`, and `VerdictView` types to
   `api.ts`.
   - *AC:* both call the correct paths with `credentials: "same-origin"` and
     surface `ApiRequestError` on non-OK, matching the existing client.

7. **Verdict screen + wiring.** Build `Verdict.tsx`, route it, and rework
   the `complete`/`unblinded` phases in `Run.tsx` and the `unblinded` branch
   in `ExperimentLocked.tsx` per 2.9.
   - *AC:* at 390px the verdict screen shows, in order: the two-part reveal
     (both cards), the unsure line when applicable, the blind line, the
     adherence line, the power card, and the unsealed schedule table; no
     horizontal scroll; keyboard reaches everything with visible focus.
   - *AC:* the run page's `complete` phase shows `Reveal the verdict`, gives
     feedback within 100ms, cannot double-submit, and lands on the verdict
     screen; the `unblinded` phase and the locked summary link to it.
   - *AC:* designed loading and error states are present on the verdict
     screen; a sealed run's 422 redirects to the summary instead of showing
     a broken page.
   - *AC:* EPIC 3/4 e2e specs (`prep.spec`, `run.spec`, `break-blind`
     coverage) still pass unmodified except where a spec asserted the old
     `complete`-phase body (none do today; verify by grep before editing).

8. **Tests + mechanical copy sweep.** Everything in section 4; sweep every
   string in 2.5 and 2.10.
   - *AC:* all listed tests pass in the foreground; the sweep finds no `—` /
     `–`, no banned vocabulary, and no negative empty-state phrasing in any
     shipped string.

---

## 4. Test plan (which test proves each acceptance criterion)

Automated, run in the foreground to completion before writing `result.json`.

**Engine unit tests (Vitest, pure — no app, no DB): `verdict-engine.test.ts` (new).**
- Permutation, floor case: 6 blocks, 3 active, active means `[8, 8, 8]`,
  blank `[2, 2, 2]`, `higher_better` → effect `6`, p exactly `1/20 = 0.05`.
  Assert no smaller p is possible: every one of the 20 labelings' p values
  is `>= 0.05`. → *AC task 2, planner criterion 2.*
- Permutation, hand-computed mixed case: block means `[5, 6, 7]` active,
  `[4, 5, 6]` blank, `higher_better` → effect `1`, p = `5/20 = 0.25`
  (labelings with active-sum >= 18: exactly 5 of 20). Same data with
  `lower_better` → oriented effect `-1`, p = `19/20 = 0.95`. → *AC task 2.*
- Permutation, no signal: all six block means equal → p = `1.0`. → *AC 2.*
- Binomial: `P(X >= 3 | n=6)` = `42/64 = 0.65625` exact;
  `P(X >= 17 | n=21)` ≈ `0.0036` (assert within 1e-4); `P(X >= 0 | n=0)` →
  null branch. → *AC task 2, planner criterion 2.*
- `computeVerdict` end to end on synthetic inputs: adherence rounding;
  a block with zero check-ins is excluded and `p_value_floor` reflects the
  included blocks; one condition unlogged → null effect fields + the
  insufficient-data `verdict_text`; all-unsure → `guess_days_scored = 0`,
  null accuracy/p, flag false, the all-unsure `guess_text`; `yes_no` effect
  and MDE reported ×100 in `percentage points`; `lower_better` flips the
  `higher|lower` word; text output byte-equal to the 2.5 templates for one
  case per branch. → *AC task 2.*
- `luckPhrase` cases: `0.05` → `about 5% of the time`, `0.0036` →
  `about 0.4% of the time`, `0.0004` → `fewer than 1 time in 1000`. → *AC 2.*

**Route tests (Vitest, `fastify.inject` + PGlite per `helpers.ts`; drive the
real flow — lock via `POST /api/experiments`, start via `confirm-prep`, log
check-ins via `POST /checkins`, then shift dates directly in the DB
(`start_date`/`planned_end_date` and allocation dates are not frozen) to
make the run complete): `unblind.test.ts` (new).**
- Happy path: complete run with a full set of check-ins → `POST /unblind`
  200; DB shows `status = 'unblinded'` and exactly one `verdicts` row; the
  response carries the 2.6 shape with numbers as numbers and `blocks`
  matching the stored allocations in order. → *AC task 3, planner criterion 1.*
- Compute-once: a second `POST /unblind` → 200, identical verdict,
  `computed_at` unchanged, still one row. `GET /verdict` returns the same
  stored view. → *AC task 3, planner criterion 1.*
- Gating matrix: mid-run unblind → 422 `invalid_state`; `prepped` → 422;
  `voided` → 422 with the no-verdict message and NO verdicts row written;
  `GET /verdict` on each sealed state → 422 with the 2.10 message; unauth →
  401; other user → 404; non-uuid → 404. → *AC task 3.*
- No-network proof: stub `globalThis.fetch` to throw, run the full
  lock → confirm → shift → unblind → get-verdict path, assert it succeeds
  (nothing in the verdict path touches the network). → *AC task 3, planner
  criterion 5.*
- Immutability coexistence: after unblinding, a direct UPDATE of a frozen
  column still raises (the `0002` trigger outlived the status flip). →
  *DB seal.*
- `dev-complete-run` behavior: with the console transport (the test
  default), `POST /complete-run` on a running experiment → dates shifted,
  every run day has a check-in, `GET /today` reads `phase: "complete"`, and
  the subsequent unblind yields a significant effect with all guesses
  correct (the 2.7 values guarantee it). Then
  `buildTestApp({ MAIL_TRANSPORT: "central" })` (valid in test env; the
  `INTERNAL_SERVICE_KEY` requirement is production-only) and assert the
  route answers 404 there, proving the console-only gate. → *AC task 4.*
- `allocation-never-serialized.test` (extend): assert `GET /today`, `GET
  /:id`, and the check-in response on a COMPLETE (but sealed) run still
  carry no condition, no non-today code, no block date; document and assert
  that `POST /unblind` / `GET /verdict` reveal only after
  `status = 'unblinded'`. → *the trust invariant, rule 2.1.*
- `seed.test` (extend): with `SEED_DEMO=true`, read the demo verdict row,
  recompute with `computeVerdict` over the seeded data, and compare every
  stored field; assert the demo `GET /verdict` (signed in as the demo user
  via the console flow, or via direct view call) serves it. → *AC task 5.*
- `migrations.test` (existing): passes with `0004` in place. → *AC task 1.*

**Frontend / e2e (Playwright, 390px project): `verdict.spec.ts` (new).**
- The signature moment, end to end: `startRun(page)` (existing helper), then
  `page.request.post` to `/api/experiments/:id/complete-run` (console
  transport is on in e2e), reload `/experiments/:id/run` → assert the
  `Your run is complete` card and `Reveal the verdict`; click it → land on
  `/experiments/:id/verdict`; assert h1 `Your verdict`, both card headings
  (`What the data says`, `Could you feel it?`), the `You felt it.` opening
  (the 2.7 backfill guarantees that branch), the adherence line, the power
  card, and the schedule table with a `Blank` row; no horizontal scroll
  anywhere on the page. → *AC task 7, planner criteria 3 and 4.*
- Persistence and wiring: reload the verdict URL directly → same content
  (stored verdict, no recompute UI); go to `/experiments/:id` → assert
  `This run is finished.` and `See the verdict` navigates back to the
  verdict. → *AC task 7.*
- Sealed-run guard: on a freshly started (running) experiment, navigate
  straight to `/experiments/:id/verdict` → assert redirect to the summary,
  not an error dump. → *AC task 7.*

**Non-automated verification (record in `result.json` summary):**
- Mechanical copy sweep over every string added or edited (`verdict.ts`
  templates, `Verdict.tsx`, `Run.tsx`, `ExperimentLocked.tsx`, `api.ts`
  messages): search for `—`, `–`, the banned vocabulary, and negative
  empty-state phrasing. Fix every hit. → *copy quality.*

---

## 5. Definition of done

All acceptance criteria in §3 are met and all §4 tests pass. A user whose
run has passed its last day opens the run page, presses `Reveal the
verdict`, and lands on a 390px-legible two-part reveal: what the data says
about the supplement (effect estimate in the metric's own units with an
exact permutation p-value) and whether they could feel it (guess accuracy
against an exact binomial chance baseline, unsure days counted and set
aside), plus adherence, the blind-integrity reading, an honest power caveat
that reads a null as underpowered and never as proven-no-effect, and the
unsealed schedule. The verdict is computed exactly once by a pure,
deterministic, LLM-free, network-free engine, stored, and served unchanged
on every later visit; a voided run can never obtain one, and sealed runs
still leak nothing. The staging demo's verdict is now a true engine output
over its seeded data. Nothing from the Non-Goals is built: no LLM narrative,
no Bayesian comparison, no sharing, no formulary, no per-day overlay chart,
no recompute path. The copy sweep is clean. `EPIC_SPEC.md` (this file) is
the only artifact this task leaves; the implementer executes it.
