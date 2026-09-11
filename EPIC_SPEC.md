# EPIC SPEC — Protocol designer, immutable pre-registration, and power statement

## Quality differentiator (this app must win on it)

**Trust: you can believe the answer.** The verdict is one the user did not
generate and could not bias, and when the data cannot decide, the app says so
plainly instead of manufacturing confidence.

What this demands of THIS epic: this is the epic where trust is *built*, not just
protected. Three things must be true and provable:

1. **The design is sealed before any data exists.** Once the user locks, the
   metric, its direction, the block structure, and the run length can never
   change. The server refuses every mutation attempt, enforced at the database,
   not just by a missing button. A goalpost you can move is not a goalpost.
2. **The secret is generated server-side and never leaks.** The allocation
   (which code is active vs. blank, and in which block/day-order) is created on
   lock, stored server-side, and never appears in any pre-unblinding response.
   The `allocations` invariant already documented in `server/src/db/index.ts`
   becomes load-bearing here for the first time.
3. **The power statement is honest up front.** Before the user commits, the
   screen names the smallest effect this run can detect and the p-value floor
   the chosen block count implies. A weak design is disclosed, not hidden, so a
   null result later reads as "underpowered," never as a surprise.

In copy, trust means plain, honest wording: no overclaiming, no manufactured
confidence, no filler. Reuse the voice EPIC 1 established.

---

## 1. Scope

### In scope
- **The design screen** (`/design`, replacing EPIC 1's placeholder): pick a
  substance, one success metric (name + type + direction), a block length, and a
  block count.
- **A small starter set of substance templates** (ship five; at least four
  required) with prefilled metric, washout note, and design defaults, so the
  screen is concrete on first open.
- **A live power statement** that names the minimum detectable effect and the
  p-value floor for the current block choice, updated as the user changes the
  design, shown before the user commits.
- **A safety gate**: an always-visible "supplements and behavior only, not
  medical advice" line, a server-side prescription-drug blocklist that refuses
  pre-registration with a plain explanation, and a required acknowledgement
  checkbox.
- **A lock action** that pre-registers the design immutably (server enforces
  immutability at the DB) and generates the secret allocation server-side.
- A minimal **locked-summary view** (`/experiments/:id`) that confirms the design
  is sealed and shows the pre-registered summary. The forward step (capsule prep)
  is a reserved placeholder, exactly as EPIC 1 handled `/design`.

### Out of scope (do not build — later epics or non-goals)
- **Editable pre-registration** (Non-Goal). No draft persistence, no PATCH/PUT of
  a design, no "unlock." The design lives in client state until lock; only lock
  writes it.
- **Conversational / LLM design** (Non-Goal). No LLM anywhere in this epic.
- **Large template libraries** (Non-Goal). Five templates, curated by hand.
- **The prep walkthrough and confirm-ready** (EPIC 3). This epic creates the
  allocation and fixes the block *ordering* (the relative code-to-day schedule),
  but does NOT set absolute calendar dates, does NOT build fill instructions, and
  does NOT transition to `running`. The prep route is a reserved placeholder only.
- **Check-ins, dashboard, reminders, break-blind** (EPIC 4).
- **Verdict computation / unblinding** (EPIC 5). The power math here is a
  design-time estimate; the exact permutation test lives in EPIC 5.
- **Formulary, export, measured-noise carry-forward** (EPIC 6). The power
  statement uses a stated assumed spread only; using the user's *measured* noise
  is explicitly EPIC 6.
- **Day-level randomization** (Non-Goal). The block is the only randomization
  unit; there is no per-day option anywhere.

---

## 2. Technical design

Build on the EPIC 1 foundation exactly as it stands. Reuse: the `Db` interface
(`server/src/db/index.ts`), the zod-at-the-boundary pattern, `errorEnvelope`
(`server/src/http.ts`), `requireAuth`, the forward-only SQL migration runner
(`server/src/db/migrate.ts`), the frontend `api.ts` client, and the mobile-first
CSS and `Page`/`LoadingCard`/`ErrorState` components. Do not introduce new
dependencies.

### 2.1 New / changed files

**Server**
- `server/migrations/0002_experiment_immutability.sql` (new) — DB trigger that
  freezes immutable columns once `pre_registered_at` is set (see 2.6).
- `server/src/metrics.ts` (new) — the metric-type and direction enums, the
  display units per metric type, and the default assumed within-person spread per
  metric type. Single source of truth reused by power, routes, and (later) the
  verdict engine.
- `server/src/power.ts` (new) — pure functions: `combinations`, `pValueFloor`,
  `minimumDetectableEffect`. No I/O, no randomness. Unit-tested (see 4).
- `server/src/safety/blocklist.ts` (new) — the prescription-drug blocklist and a
  pure `blocklistMatch(substanceName)` check.
- `server/src/templates.ts` (new) — the five substance templates.
- `server/src/experiments.ts` (new) — the create-and-lock logic: validate, derive
  the balanced block count, generate unique per-block codes and the shuffled
  condition assignment with a CSPRNG, insert the experiment and its allocations in
  one transaction-like sequence.
- `server/src/routes/experiments.ts` (new) — the four routes in 2.4.
- `server/src/app.ts` (edit) — register the experiments routes.
- `server/src/env.ts` (edit) — add `MUTATION_RATE_LIMIT_MAX` (default 20).
- `.env.example` (edit) — add the new var with a placeholder.

**Web**
- `web/src/pages/Design.tsx` (rewrite) — the real designer.
- `web/src/pages/ExperimentLocked.tsx` (new) — the `/experiments/:id`
  locked-summary confirmation.
- `web/src/pages/PrepPlaceholder.tsx` (new) — reserved `/experiments/:id/prep`
  placeholder (honest "opens next" state, no dead button).
- `web/src/App.tsx` (edit) — add `/experiments/:id` and `/experiments/:id/prep`.
- `web/src/api.ts` (edit) — add `getTemplates`, `previewDesign`,
  `createExperiment`, `getExperiment`.
- `web/src/components/ui.tsx` (edit, minimal) — small reused controls if helpful
  (`Stepper`, `Segmented`); keep it small, no framework.
- `web/src/styles.css` (edit) — styles for the new controls at 390px.

**Tests** — see section 4.

### 2.2 Metric model (`metrics.ts`)

```
metric_type      ∈ { "rating_0_10", "minutes", "count", "yes_no" }
metric_direction ∈ { "higher_better", "lower_better" }
```

Display units by metric type (reused for the power statement now and the verdict
later): `rating_0_10 → "points"`, `minutes → "minutes"`, `count → "counts"`,
`yes_no → "percentage points"`.

Default assumed within-person day-to-day spread (standard deviation, metric
units) when no template is chosen. This is a *stated assumption* only; EPIC 6
replaces it with the user's measured noise.

| metric_type | default within-SD |
|---|---|
| `rating_0_10` | 1.5 |
| `minutes` | 15 |
| `count` | 2 |
| `yes_no` | 0.5 |

### 2.3 Power math (`power.ts`) — deterministic, documented, testable

The block is the unit of randomization. Balanced design: `num_active_blocks =
num_blocks / 2`, `num_blank_blocks = num_blocks / 2`.

**P-value floor** — the smallest p-value the permutation test can ever produce
for this block count. The permutation test permutes active/blank labels across
blocks; the number of distinct labelings is `C(num_blocks, num_active_blocks)`,
and the single most-extreme labeling gives a one-sided p-value of
`1 / C(num_blocks, num_active_blocks)`.

```
pValueFloor(numBlocks, numActive) = 1 / combinations(numBlocks, numActive)
```

Worked, exact values the unit test must assert:

| num_blocks | num_active | C(n,k) | p_value_floor |
|---|---|---|---|
| 6 | 3 | 20 | 0.05 |
| 8 | 4 | 70 | 0.0142857… |
| 10 | 5 | 252 | 0.0039683… |
| 12 | 6 | 924 | 0.0010823… |

The 6-block floor of exactly 0.05 is why the minimum block count is 6: fewer
blocks cannot reach significance for any effect. State that fact honestly in the
power statement when relevant.

**Minimum detectable effect (MDE)** — a normal-approximation estimate, in metric
units, of the smallest true effect this design could detect with ~80% power at a
one-sided α = 0.05. This is an up-front estimate; the exact test is EPIC 5's job,
so label it as an estimate.

```
seBlockMean = assumedWithinSd / sqrt(blockLengthDays)
seDiff      = seBlockMean * sqrt(1/numActive + 1/numBlank)
mde         = Z * seDiff,   Z = 2.4865   (z_{0.05,one-sided}=1.6449 + z_{0.80}=0.8416)
```

Worked example the unit test must assert (within a tolerance): theanine template
(`assumedWithinSd = 1.5`, `blockLengthDays = 5`, `numActive = numBlank = 3`) →
`seBlockMean = 0.6708`, `seDiff = 0.5477`, `mde ≈ 1.36` → rounds to about **1.4
points**. Round the displayed MDE to one decimal place.

`combinations(n, k)` must be exact integer arithmetic (no floating-point
factorials that overflow); compute multiplicatively.

### 2.4 API contracts

All routes under `/api`, all require a valid session via `requireAuth` (reject
`401` server-side when absent). Standard `errorEnvelope` for every 4xx/5xx. No
allocation data appears in any response body.

**`GET /api/experiments/templates`** — returns the starter templates. Global rate
limiter only. Response:
```json
{ "templates": [
  { "id": "theanine", "substance_name": "Theanine", "metric_name": "Afternoon focus",
    "metric_type": "rating_0_10", "metric_direction": "higher_better",
    "block_length_days": 5, "num_blocks": 6,
    "washout_note": "Skip 1 day between blocks." }
] }
```
No secret fields; `assumed_within_sd` is a server-internal power input and need
not be returned (the power statement comes from the preview endpoint).

**`POST /api/experiments/preview`** — a read-only computation of the power
statement and safety check for a *candidate* design. No side effects, no rows
written. Global rate limiter only. Body (zod-validated; invalid → `400`
envelope):
```json
{ "substance_name": "Theanine", "metric_type": "rating_0_10",
  "block_length_days": 5, "num_blocks": 6, "template_id": "theanine" }
```
Response:
```json
{ "num_active_blocks": 3, "num_blank_blocks": 3,
  "run_length_days": 30,
  "p_value_floor": 0.05,
  "mde": 1.4, "mde_units": "points",
  "can_reach_significance": true,
  "safety": { "blocked": false, "matched_term": null } }
```
`can_reach_significance` is `p_value_floor <= 0.05`. `mde_units` from 2.2.
`assumed_within_sd` for the computation is the template's value when `template_id`
matches a known template, else the metric-type default from 2.2. The client only
calls this on discrete control changes (debounced ~250ms), so it stays well under
the global limit.

**`POST /api/experiments`** — validate, lock, pre-register, and generate the
secret allocation. Mutation: rate-limited with a dedicated bucket
(`MUTATION_RATE_LIMIT_MAX`/min per IP). Body (zod):
```json
{ "substance_name": "Theanine", "metric_name": "Afternoon focus",
  "metric_type": "rating_0_10", "metric_direction": "higher_better",
  "block_length_days": 5, "num_blocks": 6,
  "washout_note": "Skip 1 day between blocks.",
  "acknowledged": true }
```
Validation (all failures → the standard envelope, plain message, no stack):
- `substance_name`: trimmed, 1–80 chars. Rejected `422` if it matches the
  blocklist (see 2.5).
- `metric_name`: trimmed, 1–60 chars.
- `metric_type` ∈ enum; `metric_direction` ∈ enum (`400` on a bad value).
- `block_length_days`: integer, **3–14** (the 3-day floor is a deliberate guard
  that also makes day-level randomization unselectable).
- `num_blocks`: integer, **even**, **6–12** (`422` with a plain message when odd
  or below 6).
- `num_active_blocks` is **not accepted from the client**; the server derives
  `num_blocks / 2`. This is how "balanced blocks" is enforced: an imbalanced run
  is not expressible.
- `acknowledged`: must be exactly `true`, else `422`.

On success the server, in one sequence:
1. Inserts the `experiments` row with `status = 'prepped'`, `pre_registered_at =
   now()`, `num_active_blocks = num_blocks / 2`, and `start_date` /
   `planned_end_date` **left NULL** (absolute dates are set at confirm-ready in
   EPIC 3).
2. Builds the condition vector: `num_active` `"active"` + `num_blank` `"placebo"`,
   shuffled with a CSPRNG (Fisher–Yates using `crypto.randomInt`, never
   `Math.random`).
3. Generates one unique neutral code per block (3 characters from an
   unambiguous alphabet, e.g. `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, via
   `crypto.randomInt`), unique within the experiment.
4. Inserts one `allocations` row per block: `block_index` (0…n-1, the fixed
   relative schedule / code-to-day order), `code`, `condition`, with
   `block_start_date` / `block_end_date` **NULL** until EPIC 3.

Response `201`, **allocation-free**:
```json
{ "id": "uuid", "status": "prepped", "pre_registered_at": "…",
  "substance_name": "Theanine", "metric_name": "Afternoon focus",
  "metric_type": "rating_0_10", "metric_direction": "higher_better",
  "block_length_days": 5, "num_blocks": 6, "num_active_blocks": 3,
  "run_length_days": 30, "washout_note": "Skip 1 day between blocks." }
```

**`GET /api/experiments/:id`** — the non-secret summary for the locked view.
Owner-only: `WHERE id = $1 AND user_id = $2`; a miss returns `404`
(`not_found`) so existence is never leaked across users. Returns the same
non-secret fields as the create response plus `start_date`, `planned_end_date`,
`created_at`. **Never** selects from or returns `allocations`.

No other experiment endpoints exist in this epic. In particular there is **no**
route that updates an experiment (that is how "no editable pre-registration" is
kept); a `PATCH`/`PUT`/`DELETE` to `/api/experiments/:id` falls through to the
`404` API handler.

### 2.5 Safety gate (`safety/blocklist.ts`)

A curated, server-side list of common prescription and controlled drug names
(brand and generic). This is a safety heuristic, not a medical database; the
acknowledgement checkbox and the always-visible not-medical-advice line carry the
rest. Ship a reasonable starter set (roughly 25–40 terms) covering at least:
common statins (atorvastatin, simvastatin, rosuvastatin, lipitor, crestor),
SSRIs/SNRIs (sertraline, fluoxetine, escitalopram, venlafaxine, zoloft, prozac,
lexapro), benzodiazepines (alprazolam, diazepam, clonazepam, xanax, valium),
stimulants (adderall, amphetamine, methylphenidate, ritalin, vyvanse), opioids
(oxycodone, hydrocodone, tramadol, codeine), anticoagulants (warfarin, coumadin,
apixaban, eliquis), metformin, insulin, levothyroxine (synthroid), prednisone,
lisinopril, gabapentin, and sildenafil (viagra).

`blocklistMatch(substanceName)`: normalize (trim, lowercase, collapse internal
whitespace), then match a blocklist term as a **whole word** within the input
(word-boundary match, not a bare substring, so "vitamin" never trips on a term
that happens to be a substring). Return the matched term or `null`.

Behavior: `POST /api/experiments/preview` reports `safety.blocked` +
`matched_term` so the UI can warn live; `POST /api/experiments` re-checks
server-side (authoritative) and returns `422` with a plain message when matched.
The blocklist lives only server-side; the client relies on the preview/lock
responses (no duplicated list in the bundle).

### 2.6 Immutability enforcement (`0002_experiment_immutability.sql`)

Belt-and-suspenders for AC #2 and the differentiator. A `BEFORE UPDATE` trigger
on `experiments` raises an exception when `OLD.pre_registered_at IS NOT NULL` and
any frozen column changes (`IS DISTINCT FROM`). Frozen columns: `id`, `user_id`,
`substance_name`, `metric_name`, `metric_type`, `metric_direction`,
`block_length_days`, `num_blocks`, `num_active_blocks`, `washout_note`,
`pre_registered_at`, `created_at`. Columns that later epics still need to change
after lock — and which the trigger must therefore ALLOW: `status`, `start_date`,
`planned_end_date`.

This is forward-only and safe with the existing demo seed (the seed only
INSERTs). Use `plpgsql`; the migration runner applies it via `db.exec`. The
trigger is the primary mechanism the AC #2 test asserts against; the absence of
any update route is the secondary defense.

### 2.7 Frontend — the design screen (`/design`, mobile-first, 390px)

Replace the placeholder. One screen, top to bottom, one obvious primary action.
Fetches templates on mount; holds layout steady with a skeleton while loading and
renders a product-voice `ErrorState` with retry on failure (QUALITY BAR §3).

Sections:
1. **Heading + not-medical-advice line** (always visible, never dismissible).
2. **Substance.** A text input plus template chips. Selecting a chip prefills the
   substance, metric name/type/direction, block length, block count, and washout
   note. The user can edit any field afterward.
3. **Metric.** A name input, a type control (the four types), and a direction
   control (higher-better / lower-better as a two-option segmented control).
4. **Block length** stepper (3–14) and **block count** selector (6 / 8 / 10 / 12,
   even only — there is no control that yields an odd or day-level design).
5. **Live power statement.** Calls `POST /api/experiments/preview` debounced
   (~250ms) on control changes. The control values update instantly (their own
   state, <100ms); the power area holds its layout and shows a subtle updating
   affordance while the value settles (QUALITY BAR §1). Renders the MDE + units,
   the p-value floor, and, when `can_reach_significance` is false, the honest
   "cannot reach significance" note. Also surfaces `safety.blocked` live.
6. **Safety acknowledgement** checkbox. Lock stays disabled until it is checked
   and the substance is not blocklisted.
7. **Primary action:** `Lock and pre-register`. Pressed/loading state within
   100ms; disable double-submit. On success, navigate to `/experiments/:id`.

On a blocklisted substance the Lock button is disabled and a plain block
explanation appears near the substance field.

**`/experiments/:id` (locked summary).** Fetches `GET /api/experiments/:id`,
holds layout while loading, product-voice error with retry. Shows a "Locked"
badge, the sealed summary (substance, metric + direction, block structure, run
length), the honest sealed-design line, and a single forward affordance
`Prepare your capsules` → `/experiments/:id/prep`.

**`/experiments/:id/prep` (reserved placeholder).** A designed "opens next" state
(mirrors EPIC 1's `/design` placeholder), NOT a dead button and NOT any prep
functionality. Do not build EPIC 3 here.

**Accessibility & mobile (QUALITY BAR §2, §6):** every input labeled; the
type/direction/block controls are real, keyboard-reachable controls with visible
focus; ~44px touch targets; no horizontal scroll at 390px; sufficient contrast
(reuse existing CSS variables).

### 2.8 Copy (verbatim, swept clean — no em-dashes, no banned vocabulary, positive phrasing)

Design screen:
- Heading: `Design your blind test`
- Not-medical-advice line: `Supplements and behavior only, not prescription drugs. This is not medical advice.`
- Template group label: `Start from a template`
- Substance label: `What are you testing?` (placeholder: `Theanine`)
- Metric name label: `What will you measure each day?` (placeholder: `Afternoon focus`)
- Metric type label: `Kind of score` (options: `Rating 0 to 10`, `Minutes`, `Count`, `Yes or no`)
- Direction label: `Which way is better?` (options: `Higher is better`, `Lower is better`)
- Block length label: `Days per block`
- Block count label: `Number of blocks`
- Run length line: `This runs about {n} days.`
- Power statement: `With {num_blocks} blocks you can spot a change of about {mde} {units}. The best p-value this design can reach is {floor}.`
- Underpowered note (when it cannot reach significance): `This design cannot reach a clear result. Add blocks so the test can decide.`
- Honesty line: `A short run can miss a small effect. Setting this before you start is what keeps the answer honest.`
- Acknowledgement checkbox: `I understand this tests a supplement or a behavior change, not a prescription drug, and is not medical advice.`
- Lock button: `Lock and pre-register`
- Blocklist message: `{name} looks like a prescription drug. This app is for supplements and behavior changes. Choose something else.`

Validation messages (server + inline):
- Odd/low block count: `Use an even number of blocks, at least 6, so active and blank match.`
- Block length: `Use 3 to 14 days per block.`
- Missing acknowledgement: `Check the box to confirm this is a supplement or behavior, not a prescription drug.`

Locked summary:
- Badge: `Locked`
- Heading: `Your design is sealed`
- Body: `You cannot change the metric or the schedule now. That is what makes the verdict honest.`
- Forward button: `Prepare your capsules`

Prep placeholder:
- Heading: `Capsule prep opens next`
- Body: `This is where you will fill and seal your numbered packets.`
- Back link: `Back`

Load/error states reuse EPIC 1's `LoadingCard` and `ErrorState`; error copy:
`We could not load this page.` / body `Check your connection and try again.` /
action `Try again`.

Run the mechanical copy sweep over every string above and every string added in
components before finishing (see 4).

---

## 3. Ordered task list (with acceptance criteria)

1. **Metric + power modules.** `metrics.ts` (enums, units, default SDs) and
   `power.ts` (`combinations`, `pValueFloor`, `minimumDetectableEffect`).
   - *AC:* unit tests assert the exact floor table (6/8/10/12 blocks) and the
     theanine MDE worked example within tolerance; `combinations` uses exact
     integer math.

2. **Templates + blocklist.** `templates.ts` (five templates) and
   `safety/blocklist.ts` (`blocklistMatch`, whole-word).
   - *AC:* templates test confirms ≥4 templates each with a valid metric type,
     direction, block length in 3–14, even block count ≥6, and a washout note;
     blocklist test confirms a known drug matches and a plausible supplement
     ("theanine", "vitamin d") does not.

3. **Immutability migration `0002`.** The `BEFORE UPDATE` trigger per 2.6.
   - *AC:* after lock, a direct `UPDATE` of any frozen column raises; an `UPDATE`
     of `status` / `start_date` / `planned_end_date` succeeds; clearing
     `pre_registered_at` raises. Migration runner still idempotent (re-run is a
     no-op), and `migrations.test` passes with 0002 present.

4. **Create-and-lock logic + routes.** `experiments.ts` (validation, balanced
   derivation, CSPRNG code + condition generation, inserts) and
   `routes/experiments.ts` (the four routes in 2.4); register in `app.ts`; add
   `MUTATION_RATE_LIMIT_MAX` to `env.ts` and `.env.example`.
   - *AC:* a valid `POST /api/experiments` returns `201` with `status='prepped'`,
     `pre_registered_at` set, `num_active_blocks = num_blocks/2`; the DB then
     holds exactly `num_blocks` allocation rows, balanced active/blank, with
     unique codes; the response body contains no code, condition, or the words
     `active`/`placebo`/`allocation`.
   - *AC:* odd `num_blocks`, `num_blocks < 6`, `block_length_days` outside 3–14,
     a client-supplied `num_active_blocks` that would imbalance the run,
     `acknowledged` not `true`, and a blocklisted substance are each rejected with
     the standard envelope and no experiment/allocation rows written.
   - *AC:* an unauthenticated request to any of the four routes returns `401`;
     `GET /api/experiments/:id` for another user's id returns `404`; a
     `PATCH`/`PUT` to `/api/experiments/:id` returns `404` (no mutation route).

5. **Power/safety preview endpoint.** `POST /api/experiments/preview`.
   - *AC:* returns `p_value_floor`, `mde`, `mde_units`, `can_reach_significance`,
     `run_length_days`, and `safety.blocked` for a candidate design; a
     blocklisted candidate reports `blocked: true` with the matched term; no rows
     are written.

6. **Design screen.** Rewrite `Design.tsx` per 2.7; add `getTemplates`,
   `previewDesign`, `createExperiment`, `getExperiment` to `api.ts`.
   - *AC:* at 390px the screen shows the not-medical-advice line, template chips
     that prefill the form, the metric/block controls, a live power statement
     naming an MDE and a p-value floor, and a lock disabled until acknowledgement;
     no horizontal scroll; keyboard reaches every control.

7. **Locked summary + prep placeholder.** `ExperimentLocked.tsx`,
   `PrepPlaceholder.tsx`, routes in `App.tsx`.
   - *AC:* after lock the app lands on `/experiments/:id` showing the `Locked`
     badge and sealed summary; the forward button routes to the reserved prep
     placeholder (not a dead button); refreshing `/experiments/:id` re-fetches and
     renders.

8. **Tests + mechanical copy sweep.** All backend + e2e tests in section 4; run
   the copy sweep over every user-visible string touched (components, template
   copy, validation messages, seed copy unchanged).
   - *AC:* all listed tests pass; the sweep finds no `—`/`–`, no banned
     vocabulary, no negative empty-state phrasing in any shipped string.

---

## 4. Test plan (which test proves each acceptance criterion)

Automated, run in the foreground to completion before writing `result.json`.

**Backend (Vitest, `fastify.inject` + PGlite, following `server/test/helpers.ts`):**
- `power.test` (pure unit): exact `combinations`; `pValueFloor` for 6/8/10/12
  blocks equals the table in 2.3 (6 blocks → exactly 0.05); theanine MDE ≈ 1.36
  within tolerance; MDE strictly decreases as `num_blocks` or `block_length_days`
  rises. → *power math; AC #3 numbers.*
- `templates.test`: `GET /api/experiments/templates` returns ≥4 valid templates;
  no secret fields. → *AC #6.*
- `blocklist.test` (pure unit): a known drug matches; "theanine" and "vitamin d"
  do not; matching is whole-word and case-insensitive. → *AC #4 (matching half).*
- `experiments-create.test`: valid lock → `201`, `status='prepped'`,
  `pre_registered_at` set, `num_active_blocks = num_blocks/2`; DB holds
  `num_blocks` balanced allocation rows with unique codes; response body is
  allocation-free. Odd/low block count, bad block length, imbalance attempt,
  missing acknowledgement, and a blocklisted substance each rejected with the
  envelope and **no** rows written. Unauth → `401`. → *AC #1, #2 (creation half),
  #4 (lock half).*
- `immutability.test`: with 0002 applied, `UPDATE` of a frozen column on a locked
  experiment raises; `UPDATE` of `status`/`start_date`/`planned_end_date`
  succeeds; clearing `pre_registered_at` raises; a `PATCH` to
  `/api/experiments/:id` returns `404`. → *AC #2.*
- `preview.test`: preview returns the power fields and `safety.blocked` for
  candidate designs, including the underpowered case and a blocklisted candidate;
  no rows written. → *AC #3, #4.*
- `allocation-never-serialized.test` (extend the existing test): after creating a
  real experiment via `POST /api/experiments`, assert that `POST` response and
  `GET /api/experiments/:id` contain none of the generated codes, neither
  `active`/`placebo`, nor `allocation`; another user's `GET` returns `404`. →
  *AC #5 (the trust invariant, now on a real design).*
- `migrations.test` (existing): still idempotent with 0002. → *DB baseline.*

**Frontend / e2e (Playwright, 390px project; sign in via the console transport as
EPIC 1 does):**
- `design.spec`: open `/design`; a template chip prefills the form; the power
  statement shows an MDE and a p-value floor; Lock is disabled until the
  acknowledgement is checked; locking lands on `/experiments/:id` with the
  `Locked` badge; no horizontal scroll at 390px. → *AC #1, #3, visual half of #2.*
- `design-safety.spec`: typing a blocklisted substance disables Lock and shows the
  plain block explanation; the not-medical-advice line is visible throughout. →
  *AC #4.*

**Non-automated verification (record in `result.json` summary):**
- Mechanical copy sweep over every user-visible string added or edited
  (`Design.tsx`, `ExperimentLocked.tsx`, `PrepPlaceholder.tsx`, template copy,
  validation messages, any new `ui.tsx` strings): search for `—`, `–`, the banned
  vocabulary, and negative empty-state phrasing. Fix every hit. → *copy quality.*

---

## 5. Definition of done

All acceptance criteria in §3 are met and all §4 tests pass. A user can design and
lock a balanced, minimum-6-block experiment; day-level and imbalanced designs are
unselectable and server-rejected; the power statement names the MDE and the
p-value floor before commit; a blocklisted substance is refused with a plain
explanation and the not-medical-advice line is always visible; the allocation is
generated server-side on lock and never appears in any response (proven by test);
and the locked design cannot be mutated by any client request (proven by the DB
trigger test). Nothing from the Non-Goals (§1 out-of-scope) is built. The copy
sweep is clean. `EPIC_SPEC.md` (this file) is the only artifact this task leaves;
the implementer executes it.
