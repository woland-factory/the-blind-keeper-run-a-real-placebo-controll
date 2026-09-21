# EPIC SPEC — Personal formulary, measured-noise carry-forward, and export

## Quality differentiator (this app must win on it)

**Trust: you can believe the answer.** The verdict is one the user did not
generate and could not bias, and when the data cannot decide, the app says so
plainly instead of manufacturing confidence.

What this EPIC's work owes the differentiator:

1. **The formulary is a ledger, not a highlight reel.** It lists every finished
   run the same way: the wins, the nulls, and the voided runs where the user
   cracked and peeked. A voided run stays visible and stays marked voided. The
   honest record is the point.
2. **The card repeats the engine, it never re-judges.** Every number and every
   tag on a formulary card is derived from the stored verdict (the same
   deterministic engine output the verdict screen shows). No card recomputes, re
   -rounds against a different rule, or invents a softer label. The list and the
   verdict screen agree to the digit.
3. **Carry-forward sharpens honesty, it never inflates it.** When a new design
   reuses a metric the user has already measured, the power statement swaps the
   assumed day-to-day noise for the user's own measured noise, and says which one
   it used. Measuring their real noise makes a future null MORE honest (correctly
   underpowered), never a manufactured "now it works."
4. **Isolation is a trust rule, not just a security rule.** Every formulary and
   export byte is the requesting user's own. No other user's runs, verdicts, or
   noise can reach the response, proven by test. A sealed (still-running) run's
   schedule never appears in an export.

---

## 1. Scope

### In scope

- **`GET /api/formulary`** (new): the requesting user's finished runs
  (`unblinded` and `voided`) as cards, newest first, capped, each card carrying
  substance, metric, effect, guess calibration, adherence, and void status. Every
  verdict number on a card is derived from the stored `verdicts` row (section
  2.3).
- **`GET /api/formulary/export`** (new): a downloadable JSON file of the
  requesting user's finished runs in full (design fields, the stored verdict, the
  now-unsealed schedule, and the daily check-ins). Never includes a sealed run
  (section 2.4).
- **Measured-noise carry-forward in the power preview** (edit): the design
  screen's power statement uses the user's measured within-person noise for a
  metric they have already completed, falls back to the stated assumption when
  there is no history, and names which one it used (section 2.5).
- **The formulary screen** (edit `Home.tsx`): the returning user's home lists the
  formulary cards with an export action and a design action; a brand-new user
  sees the designed empty state that points to their first experiment (section
  2.6). The empty-state heading `Start your first blind test` is preserved
  verbatim.
- **The design screen's noise line** (edit `Design.tsx`): send the metric name in
  the preview request and show one line naming measured vs assumed noise (section
  2.6).

### Out of scope (do not build — later epics or non-goals)

- **Public N=1 commons / registry** (Non-Goal). No publishing, no shared list, no
  discoverable runs.
- **Cross-user aggregation** (Non-Goal). No pooling of noise, effects, or counts
  across users. Every query in this EPIC is scoped to one user id.
- **Social sharing** (Non-Goal). No share link, no share image, no
  copy-to-clipboard card, no export-to-social.
- **A guided first-run walkthrough** (EPIC 7). The formulary empty state is a
  designed state with one clear action; the multi-step guided path is the polish
  EPIC's job, not this one.
- **An "active runs" dashboard.** The formulary is finished runs only
  (`unblinded` + `voided`), exactly as the acceptance criteria state. Listing
  in-progress (`prepped`/`running`) experiments on the home screen is a
  pre-existing gap and stays out of scope (see the requested-task note).
- **New verdict math, recompute, or editing.** The card and export read the
  stored verdict unchanged. Nothing here recomputes or mutates a verdict.
- **Changing the verdict screen, the run loop, or the unblind path.** Those
  shipped in EPIC 4/5 and are untouched.
- **CSV export.** The acceptance criterion allows "JSON and/or CSV"; this EPIC
  ships one portable format (JSON), which is lossless for the nested
  run/verdict/schedule/check-in shape. No CSV.
- **A database migration.** The formulary, export, and measured noise are all
  reads over the existing tables. Add no migration (forward-only means no empty
  or speculative migration file).
- **Enriching the demo seed** (extra completed runs, a voided demo run). The seed
  stays exactly as EPIC 5 left it (one unblinded run); `seed.test.ts` asserts
  exactly one experiment and must keep passing. See the requested-task note.

---

## 2. Technical design

Build on EPIC 1–5 exactly as it stands. Reuse: the `Db` interface
(`server/src/db/index.js`), zod at the boundary, `errorEnvelope` and
`requireAuth` (`server/src/http.js`), the owner-scoped `WHERE ... user_id = $1`
pattern and the "miss returns null → route answers 404" convention
(`server/src/experiments.ts`), `minimumDetectableEffect` and the `combinations`
family (`server/src/power.js`), `METRIC_UNITS` / `DEFAULT_WITHIN_SD`
(`server/src/metrics.js`), the frontend `api.ts` client, and `Page` /
`LoadingCard` / `ErrorState` with the existing mobile-first CSS. Introduce no new
dependencies. No LLM anywhere: nothing in this EPIC generates text.

### 2.1 Read model, isolation, and the sealed-run rule (read first, binding)

1. **Every query is owner-scoped.** The formulary list, the export, and the
   measured-noise lookup all filter `WHERE ... user_id = $1` using
   `request.user!.id`. No path accepts a user id, email, or experiment id from
   the client that would widen the scope. Cross-user reachability is a defect,
   proven absent by test.
2. **Only finished runs are ever serialized here.** The formulary and the export
   return experiments with `status IN ('unblinded', 'voided')` only. A
   `prepped` or `running` experiment (its schedule still sealed) must never appear
   in a formulary card or an export, because both surfaces reveal the allocation
   (condition + block dates). This EPIC adds no new intentional reveal: it reuses
   the two that EPIC 4/5 already gated (break-blind voids; unblind completes).
   Extend `allocation-never-serialized.test` to assert a sealed run never appears
   in `GET /formulary` or `GET /formulary/export`.
3. **The card never re-judges.** `significant` and `guesses_beat_chance` on a
   card are derived from the stored p-values with the SAME rule the verdict view
   uses (`p !== null && p <= 0.05`). No card applies a different threshold,
   rounds a stored number again, or produces a label the verdict screen would
   contradict.
4. **Measured noise is per-user and read-only.** It is computed from the
   requesting user's own completed (`unblinded`) runs of the same metric. Voided
   runs never feed it (their blind was broken, their data is compromised). It
   changes only the power preview; it never rewrites a stored verdict or a past
   power note.

### 2.2 New / changed files

**Server**
- `server/src/formulary.ts` (new) — `listFormulary` and `buildExport`: the two
  owner-scoped read models (sections 2.3, 2.4). Pure of HTTP; takes `Db`,
  `userId` (and the user's email for the export envelope).
- `server/src/routes/formulary.ts` (new) — `registerFormularyRoutes`: the two
  GET routes, `requireAuth`, global limiter, `errorEnvelope` on failure.
- `server/src/app.ts` (edit) — register `registerFormularyRoutes` alongside the
  existing route registrations.
- `server/src/power.ts` (edit) — add the pure `pooledWithinSd` helper and the
  `MIN_NOISE_DF` constant (section 2.5). Leave the existing functions untouched.
- `server/src/experiments.ts` (edit) — add `measuredWithinSd` (a Db read) and
  thread an optional measured SD through `previewDesign`; extend `previewSchema`
  with an optional `metric_name`; add `noise_source` to `PreviewResult` (section
  2.5). Leave every other function untouched.
- `server/src/routes/experiments.ts` (edit, minimal) — in the existing
  `/api/experiments/preview` handler, look up the measured SD when a metric name
  is present and pass it to `previewDesign`.

**Web**
- `web/src/pages/Home.tsx` (edit) — fetch and render the formulary; keep the
  empty state and its `Start your first blind test` heading verbatim (section
  2.6).
- `web/src/pages/Design.tsx` (edit) — send `metric_name` in the preview request;
  render the noise-source line (section 2.6).
- `web/src/api.ts` (edit) — `getFormulary` + `FormularyCard`/`FormularyView`
  types; add `metric_name` to `PreviewInput` and `noise_source` to `Preview`; the
  export is a plain same-origin link, so no client function is required (a
  `FORMULARY_EXPORT_PATH` constant is fine).
- `web/src/styles.css` (edit) — formulary card and list styles, mobile-first at
  390px, using the existing CSS variables only. Reuse `.card`, `.badge`,
  `.empty-state`, `.btn` families.

**Tests** — see section 4.

### 2.3 `GET /api/formulary` — the card list

`listFormulary(db, userId)` returns the user's finished runs newest first,
capped at `FORMULARY_LIMIT = 100` (a hot read; the cap keeps it bounded — a real
user has a handful of lifetime runs, and the query is covered by the existing
`experiments_user_id_idx`). No new index.

Query (single statement, left join so voided runs with no verdict still appear):

```sql
SELECT e.id, e.status, e.substance_name, e.metric_name, e.metric_type,
       e.block_length_days, e.num_blocks,
       e.planned_end_date::text AS planned_end_date,
       e.broke_blind_at::text   AS broke_blind_at,
       v.effect_estimate, v.effect_units, v.permutation_p_value,
       v.guess_p_value_vs_chance, v.guess_days_correct, v.guess_days_scored,
       v.adherence_pct
  FROM experiments e
  LEFT JOIN verdicts v ON v.experiment_id = e.id
 WHERE e.user_id = $1
   AND e.status IN ('unblinded', 'voided')
 ORDER BY COALESCE(v.computed_at, e.broke_blind_at, e.created_at) DESC
 LIMIT $2
```

Numeric columns come back from the driver as strings; coerce with `Number(...)`
(mirror the `num()` helper pattern in `experiments.ts`, which returns `null` for
`null`). The route sends `{ "cards": FormularyCard[] }`. Each card:

```json
{
  "id": "uuid",
  "status": "unblinded",
  "substance_name": "Magnesium glycinate",
  "metric_name": "Sleep quality",
  "metric_type": "rating_0_10",
  "run_length_days": 42,
  "ended_on": "2026-08-11",
  "verdict": {
    "effect_estimate": 0.2,
    "effect_units": "points",
    "permutation_p_value": 0.42,
    "significant": false,
    "guess_days_correct": 16,
    "guess_days_scored": 30,
    "guesses_beat_chance": false,
    "adherence_pct": 100
  }
}
```

Rules:
- `run_length_days` = `block_length_days * num_blocks`.
- `ended_on` = `planned_end_date` for an `unblinded` run; the date part of
  `broke_blind_at` for a `voided` run. Serve as `"YYYY-MM-DD"`.
- `verdict` is `null` for a `voided` run (no verdict row). It is also `null`
  defensively if an `unblinded` run somehow has no verdict row (should not
  happen; the card then renders as insufficient-data rather than crashing).
- `significant` = `permutation_p_value !== null && permutation_p_value <= 0.05`.
  `guesses_beat_chance` = `guess_p_value_vs_chance !== null &&
  guess_p_value_vs_chance <= 0.05`. Identical to `rowToVerdictNumbers`.
- Fields the card does not use (raw guess p-value, etc.) are omitted to keep the
  payload lean; the full detail is on the verdict screen and in the export.

### 2.4 `GET /api/formulary/export` — the portable file

`buildExport(db, userId, email)` returns the user's finished runs in full. The
route sets:
- `Content-Type: application/json; charset=utf-8`
- `Content-Disposition: attachment; filename="blind-keeper-export.json"`
- Body = the object below (send with `reply.header(...)` then `reply.send(obj)`).

Cap the run count at `EXPORT_LIMIT = 1000` newest-first (a safety bound so the
endpoint cannot grow without limit; a real user never reaches it). Check-ins per
run are naturally bounded by the run length.

```json
{
  "schema_version": 1,
  "exported_for": "you@example.com",
  "runs": [
    {
      "id": "uuid",
      "status": "unblinded",
      "substance_name": "Magnesium glycinate",
      "metric_name": "Sleep quality",
      "metric_type": "rating_0_10",
      "metric_direction": "higher_better",
      "block_length_days": 7,
      "num_blocks": 6,
      "num_active_blocks": 3,
      "run_length_days": 42,
      "washout_note": "…",
      "pre_registered_at": "2026-07-01T…Z",
      "start_date": "2026-07-01",
      "planned_end_date": "2026-08-11",
      "broke_blind_at": null,
      "verdict": {
        "effect_estimate": 0.2, "effect_units": "points",
        "permutation_p_value": 0.42, "p_value_floor": 0.05,
        "guess_accuracy": 0.533, "guess_p_value_vs_chance": 0.43,
        "guess_days_scored": 30, "guess_days_correct": 16,
        "guess_days_unsure": 12, "days_logged": 42, "adherence_pct": 100,
        "blind_integrity_flag": false, "power_note": "…",
        "verdict_text": "…", "guess_text": "…", "computed_at": "2026-08-11T…Z"
      },
      "schedule": [
        { "code": "MQ7", "condition": "placebo", "contents": "Blank",
          "block_start_date": "2026-07-01", "block_end_date": "2026-07-07" }
      ],
      "check_ins": [
        { "check_date": "2026-07-01", "metric_value": 6.4, "note": null,
          "placebo_guess": "placebo" }
      ]
    }
  ]
}
```

Rules:
- `runs` includes ONLY `unblinded` and `voided` experiments for `user_id = $1`,
  newest first (same ordering as the list). A `prepped`/`running` run and its
  allocation NEVER appear (section 2.1 rule 2), proven by test.
- `verdict` is the full stored verdict for an `unblinded` run, `null` for a
  `voided` run.
- `schedule` reuses the break-blind reveal mapping (`active` → substance name,
  `placebo` → `Blank`, in `block_index` order); it is safe here because both
  exported statuses have already had their blind revealed.
- `check_ins` carries the user's own daily rows (date, value, note, guess) so the
  file is a real personal evidence base, not just a summary. Coerce
  `metric_value` to a number.
- `exported_for` is the requesting user's own email (their own data; this is not
  a log, so the no-PII-in-logs rule is not in play). Do not include any other
  identifier.
- Numeric columns coerced to numbers; dates cast `::text` as elsewhere.

Implementation note: gather the runs, then their allocations and check-ins,
scoped by the run ids you already fetched for this user (or a single query with
ordered client-side grouping). Keep it simple; the volume is one user's finished
runs.

### 2.5 Measured-noise carry-forward (the power preview)

**Pure helper (`power.ts`).** Add:

```ts
export const MIN_NOISE_DF = 4;

/**
 * Pooled within-block standard deviation across completed blocks: the user's
 * measured day-to-day noise for a metric. `blocks` is one array of daily metric
 * values per block that has data. Blocks with fewer than two values carry no
 * within-block deviation and are skipped. Returns null when the pooled residual
 * degrees of freedom fall below MIN_NOISE_DF or the spread is zero, so a flimsy
 * or degenerate history falls back to the stated assumption.
 */
export function pooledWithinSd(blocks: number[][]): number | null {
  let ss = 0;
  let df = 0;
  for (const values of blocks) {
    if (values.length < 2) continue;
    const m = values.reduce((s, v) => s + v, 0) / values.length;
    for (const v of values) ss += (v - m) ** 2;
    df += values.length - 1;
  }
  if (df < MIN_NOISE_DF || ss <= 0) return null;
  return Math.sqrt(ss / df);
}
```

This estimates the same quantity `DEFAULT_WITHIN_SD` assumes (day-to-day spread
of the metric around its block mean, on the metric's raw stored scale), so it
drops into `minimumDetectableEffect` unchanged. Do not rescale `yes_no` here: the
raw 0/1 pooled SD is the same scale as `DEFAULT_WITHIN_SD.yes_no = 0.5`, matching
the assumed path exactly. (The preview's existing `yes_no` unit labeling is
unchanged and out of scope, consistent with EPIC 5's note.)

**Db read (`experiments.ts`).** Add:

```ts
export async function measuredWithinSd(
  db: Db, userId: string, metricType: string, metricName: string
): Promise<number | null>
```

- Query the user's completed history for this exact metric:

```sql
SELECT a.experiment_id, a.block_index, c.metric_value
  FROM experiments e
  JOIN allocations a ON a.experiment_id = e.id
  JOIN check_ins   c ON c.experiment_id = e.id
                    AND c.check_date BETWEEN a.block_start_date AND a.block_end_date
 WHERE e.user_id = $1
   AND e.status = 'unblinded'
   AND e.metric_type = $2
   AND lower(btrim(e.metric_name)) = lower(btrim($3))
```

- Group rows into blocks keyed by `${experiment_id}:${block_index}`, coerce
  `metric_value` to numbers, and call `pooledWithinSd`. Return its result
  (`number | null`). Matching on `metric_type` AND the case-insensitive, trimmed
  `metric_name` is what makes it "the same metric I measured before"; voided runs
  are excluded by the `status = 'unblinded'` filter. Scoped to `user_id`, so no
  cross-user noise. The query is covered by `experiments_user_id_idx`; it runs
  only when a metric name is present (see the route) and returns a handful of
  rows.

**`previewSchema` + `previewDesign` (`experiments.ts`).**
- Extend `previewSchema` with `metric_name: z.string().trim().max(60).optional()`
  (keep `.strict()`; still optional so existing callers are unaffected).
- Change `previewDesign(input, measuredWithinSd?: number | null)`:
  - When `measuredWithinSd` is a finite number, use it and set
    `noise_source = "measured"`.
  - Otherwise use `assumedWithinSd(input.metric_type, input.template_id)` (the
    existing template-or-default logic) and set `noise_source = "assumed"`.
  - Everything else (MDE, floor, safety, run length) is computed exactly as
    today; only the SD input and the new field change.
- Add `noise_source: "measured" | "assumed"` to `PreviewResult`.

**Route (`routes/experiments.ts`).** In the existing `/api/experiments/preview`
handler, after a successful parse:

```ts
const measured = parsed.data.metric_name
  ? await measuredWithinSd(app.db, request.user!.id, parsed.data.metric_type, parsed.data.metric_name)
  : null;
return reply.send(previewDesign(parsed.data, measured));
```

No change to status codes, validation, or the "writes nothing" guarantee.

### 2.6 Frontend — the formulary home and the noise line (390px)

**`Home.tsx`** (the authed root, rendered by `RootGate`). On mount, fetch
`GET /api/formulary`.
- **Loading:** `LoadingCard` inside `Page` (holds the layout; no white flash).
- **Error:** `ErrorState` with `We could not load your formulary.` /
  `Check your connection and try again.` / `Try again` retrying the fetch.
- **Empty (zero cards):** the existing empty-state card, unchanged:
  heading `Start your first blind test` (VERBATIM — the e2e sign-in helper and
  landing flow assert it), the existing body, and the `Design a test` primary
  button to `/design`. Do not reword this state.
- **Non-empty:** keep the `app-bar` header (brand + sign out) and the greeting.
  Then:
  - h1 `Your formulary`.
  - A row with one primary action `Design a test` (to `/design`) and one
    subordinate action `Export` — an anchor `<a class="btn btn-ghost"
    href="/api/formulary/export">Export</a>` (a real same-origin link: the
    browser sends the session cookie, the attachment downloads, the SPA does not
    navigate; keyboard-reachable with visible focus, ~44px target).
  - The list of cards, newest first. Each card is a single keyboard-reachable
    control (a `<button>` or `<Link>`) with an accessible name, navigating to:
    `/experiments/:id/verdict` for an `unblinded` run, `/experiments/:id` for a
    `voided` run.

**Card contents** (all derived from the payload; no recompute):
- Title: `substance_name`. Subtitle: `metric_name`.
- **Voided card:** a `Voided` badge and the line
  `You broke the blind, so this run has no verdict.` (reused verbatim from the
  server voided message; a factual verdict statement, not empty-state filler). No
  effect/guess/adherence stats.
- **Unblinded card:** two short tags plus a stat line.
  - Effect tag, from `verdict`:
    - `verdict === null` or `effect_estimate === null` → `Too little data`
    - `significant === true` → `Beat the blank`
    - otherwise → `Matched the blank`
  - Guess tag, from `verdict`:
    - `guess_days_scored === 0` → `All unsure`
    - `guesses_beat_chance === true` → `You felt it`
    - otherwise → `Near a coin flip`
  - Stat line (omit any part whose value is null):
    - When an effect exists: `{signed effect} {units}, {p}` where `signed` is
      `+n`/`n` and `p` is `p = 0.abc` (three decimals) or `p < 0.001` for smaller
      values (reuse the `signed`/`formatStatP` helpers' behavior from
      `Verdict.tsx`; duplicating the two tiny helpers is acceptable, or lift them
      into `components/ui.tsx`).
    - Guess calibration: `Guessed {guess_days_correct} of {guess_days_scored}
      days` (omit when `guess_days_scored === 0`).
    - `Adherence {adherence_pct}%` (omit when `adherence_pct === null`).
  - A small `Finished {ended_on}` line (fine-print).
- Voided card fine-print: `Voided {ended_on}`.

**Accessibility & mobile (QUALITY BAR §2, §6, §7):** real heading order (h1 →
card titles as h2 or a semantic list), each card a keyboard-reachable control
with a visible focus ring and ~44px height, cards stack vertically with no
horizontal scroll at 390px, one obvious primary action (`Design a test`) with the
export visibly subordinate, existing CSS variables for contrast.

**`Design.tsx`** (measured-noise line):
- Add `metricName` to the debounced preview effect's dependency array and send
  `metric_name: metricName.trim() || undefined` in the `previewDesign` request.
- In the power card, below the existing power statement, render one line from
  `preview.noise_source`:
  - `"measured"` →
    `This is tuned to the day-to-day noise measured in your past runs of this metric.`
  - `"assumed"` →
    `This uses a typical day-to-day noise. Finish a run of this metric to tune it to you.`
- No other change to the design screen. The MDE number already updates from the
  preview; this line only names the source.

### 2.7 Screen-only and file copy (verbatim; sweep before finishing)

Home, empty (UNCHANGED — do not reword):
- Heading: `Start your first blind test`
- Primary: `Design a test`

Home, formulary:
- h1: `Your formulary`
- Primary: `Design a test`
- Subordinate: `Export`
- Effect tags: `Beat the blank` / `Matched the blank` / `Too little data`
- Guess tags: `You felt it` / `Near a coin flip` / `All unsure`
- Voided badge: `Voided`
- Voided line: `You broke the blind, so this run has no verdict.`
- Stat line parts: `Guessed {c} of {s} days` / `Adherence {n}%`
- Fine-print: `Finished {date}` / `Voided {date}`
- Loading/error: `We could not load your formulary.` /
  `Check your connection and try again.` / `Try again`

Design, noise line:
- Measured: `This is tuned to the day-to-day noise measured in your past runs of this metric.`
- Assumed: `This uses a typical day-to-day noise. Finish a run of this metric to tune it to you.`

Export file:
- Filename: `blind-keeper-export.json`

Run the mechanical copy sweep over every string above and every new string in
the code: search for `—` and `–`, the banned vocabulary (`seamlessly`,
`effortlessly`, `unlock`, `elevate`, `empower`, `leverage`, `robust`, `dive in`,
and kin), and negative empty-state phrasing (`You don't have`, `No … yet`,
`Nothing … here`, `Unable to`, `Something went wrong`). The honest verdict tags
above (`Matched the blank`, `Too little data`) are factual result statements, not
empty-state filler, and stay as written.

### 2.8 README (QUALITY BAR §9)

`README.md` currently says "Daily check-ins and the verdict engine arrive in
later releases," which is now false (EPIC 4/5 shipped, and this EPIC completes
the loop). Update the "what this repository has" paragraph to describe the whole
delivered product in plain language: design a blinded run, prep capsules, log a
daily check-in with a placebo guess, get a deterministic verdict on unblinding
day, and keep every finished run in a personal formulary you can export. Keep the
run/build/test commands (verified against the compose files) and the no-factory
-internals rule. This is a small accuracy edit, not a rewrite.

---

## 3. Ordered task list (with acceptance criteria)

1. **Measured-noise engine + power wiring.** Add `pooledWithinSd` and
   `MIN_NOISE_DF` to `power.ts`; add `measuredWithinSd` to `experiments.ts`;
   extend `previewSchema` with `metric_name`; thread the measured SD through
   `previewDesign` and add `noise_source`; wire the preview route to look it up
   (sections 2.5).
   - *AC:* `pooledWithinSd` returns the pooled within-block SD for known vectors,
     skips blocks with fewer than two values, and returns `null` when
     `df < MIN_NOISE_DF` or the spread is zero (unit test).
   - *AC:* with no completed history for a metric, the preview returns
     `noise_source: "assumed"` and the same MDE as today (the existing preview
     test's `mde` value is unchanged).
   - *AC:* after the same user completes an `unblinded` run of a metric, a
     preview with that `metric_name` returns `noise_source: "measured"` and an
     MDE computed from the measured SD; another user's history does not change
     this user's preview; a metric with only `voided` history stays `"assumed"`.

2. **Formulary list, server.** Add `listFormulary` and the `GET /api/formulary`
   route (sections 2.3, 2.2).
   - *AC:* returns the user's `unblinded` and `voided` runs as cards, newest
     first, each with substance, metric, `ended_on`, and (for unblinded) the
     verdict subset with `significant`/`guesses_beat_chance` derived exactly as
     `rowToVerdictNumbers` does; a voided card has `verdict: null`.
   - *AC:* `prepped`/`running` runs never appear; the list is capped at
     `FORMULARY_LIMIT`.
   - *AC:* unauthenticated → 401; another user's runs are never in the response.

3. **Export, server.** Add `buildExport` and the `GET /api/formulary/export`
   route with the attachment headers (sections 2.4, 2.2).
   - *AC:* returns valid JSON with `Content-Disposition: attachment;
     filename="blind-keeper-export.json"`; `runs` carries the user's finished
     runs with the stored verdict (unblinded) or `null` (voided), the unsealed
     `schedule`, and the daily `check_ins`.
   - *AC:* a `prepped`/`running` run and its allocation never appear in the
     export.
   - *AC:* unauthenticated → 401; only the requesting user's data is reachable
     (another user's ids, runs, and check-ins never appear).

4. **Register routes.** Register `registerFormularyRoutes` in `app.ts`.
   - *AC:* both routes are reachable under `/api/formulary` and
     `/api/formulary/export`; the app boots and existing route tests still pass.

5. **API client.** Add `getFormulary` + `FormularyCard`/`FormularyView` types,
   `metric_name` on `PreviewInput`, `noise_source` on `Preview`, and the export
   path constant to `api.ts`.
   - *AC:* `getFormulary` calls `/api/formulary` with `credentials:
     "same-origin"` and surfaces `ApiRequestError` on non-OK, matching the
     existing client.

6. **Formulary home.** Rework `Home.tsx` to fetch and render the formulary with
   loading/error/empty/non-empty states and the export link; keep the empty-state
   heading verbatim (section 2.6).
   - *AC:* at 390px, a user with finished runs sees `Your formulary`, one card per
     finished run with the correct tags/stats, a `Design a test` primary action,
     and an `Export` link to `/api/formulary/export`; no horizontal scroll;
     keyboard reaches every card and action with visible focus.
   - *AC:* a brand-new user (no finished runs) sees the `Start your first blind
     test` empty state with the `Design a test` action; the existing sign-in and
     landing e2e still pass unmodified.
   - *AC:* tapping an unblinded card lands on its verdict; tapping a voided card
     lands on its summary (which reads `This run is voided.`).

7. **Design noise line.** Send `metric_name` in the preview request and render
   the measured/assumed line in `Design.tsx` (section 2.6).
   - *AC:* after completing a run of a metric, opening `/design` and entering that
     metric name shows the measured line; with no such history the assumed line
     shows. No other design-screen behavior changes.

8. **README + copy sweep.** Update the README paragraph (section 2.8) and run the
   mechanical copy sweep over every new/edited string.
   - *AC:* the README accurately describes the shipped loop including the
     formulary and export; the sweep finds no `—`/`–`, no banned vocabulary, and
     no negative empty-state phrasing in any shipped string.

---

## 4. Test plan (which test proves each acceptance criterion)

Automated, run in the foreground to completion before writing `result.json`.

**Unit (Vitest, pure): `power.test.ts` (extend).**
- `pooledWithinSd`: for blocks `[[6,8],[2,4]]` the pooled SD is
  `sqrt((2+2)/2) = sqrt(2) ≈ 1.4142` (assert within 1e-6); a block of length < 2
  is skipped; `df` below `MIN_NOISE_DF` → `null`; all-equal values (`ss = 0`) →
  `null`. → *AC task 1.*

**Route (Vitest, `fastify.inject` + PGlite per `helpers.ts`): `formulary.test.ts`
(new).** Drive the real flow: `signIn`, lock via `POST /api/experiments`, start
via `confirm-prep`, and reach a completed run via `POST
/api/experiments/:id/complete-run` (console transport is on in tests) then `POST
/unblind`; produce a voided run via `POST /break-blind`; leave a third run
`running`.
- List happy path: `GET /formulary` returns the unblinded and voided runs newest
  first; the unblinded card carries the verdict subset with `significant` and
  `guesses_beat_chance` matching the stored `GET /verdict` values to the digit;
  the voided card has `verdict: null` and `status: "voided"`; the running run is
  absent. → *AC task 2, planner criterion 1.*
- Export happy path: `GET /formulary/export` returns 200 with the attachment
  `Content-Disposition`; the parsed body's `runs` contains the unblinded run with
  its full stored verdict, an unsealed `schedule` (a `Blank` row present), and its
  `check_ins`; the voided run with `verdict: null`; the running run and any
  allocation of it are absent. → *AC task 3, planner criterion 2.*
- Isolation: sign in a second user with their own finished run; `GET /formulary`
  and `GET /formulary/export` as each user return only that user's ids; neither
  contains the other's substance name, run ids, or check-ins. → *AC tasks 2 & 3,
  planner criterion 4.*
- Auth: unauthenticated `GET /formulary` and `GET /formulary/export` → 401. →
  *AC tasks 2 & 3, planner criterion 4.*
- `allocation-never-serialized.test` (extend): a sealed (`running`) run appears in
  neither `GET /formulary` nor `GET /formulary/export`, and no condition/block
  date for it crosses the wire. → *the trust invariant, section 2.1 rule 2.*

**Route (Vitest): `preview.test.ts` (extend).**
- Existing assumed case still returns `mde: 1.4` and now also
  `noise_source: "assumed"`. → *AC task 1.*
- Measured case: as one user, complete an `unblinded` run of metric
  `"Afternoon focus"` (`rating_0_10`) with check-ins, then `POST /preview` with
  `metric_name: "Afternoon focus"` → `noise_source: "measured"` and an `mde`
  equal to `previewDesign` fed the `measuredWithinSd`/`pooledWithinSd` value
  (recompute in the test and compare). → *AC task 1, planner criterion 3.*
- Voided-only history for a metric → `noise_source: "assumed"`; a second user's
  completed history does not flip user A's preview to `"measured"`. → *AC task 1,
  planner criteria 3 & 4.*

**Frontend / e2e (Playwright, 390px project): `formulary.spec.ts` (new).**
- Empty state: a fresh user at `/` sees `Start your first blind test` and
  `Design a test` (guards the preserved heading). → *AC task 6.*
- Finished run appears: `startRun(page)`, then `page.request.post(
  /api/experiments/:id/complete-run)` and `page.request.post(
  /api/experiments/:id/unblind)`; go to `/` → assert `Your formulary`, a card
  with the substance name, and that clicking it lands on
  `/experiments/:id/verdict`; assert the `Export` link points at
  `/api/formulary/export`; no horizontal scroll. → *AC task 6, planner criteria 1
  & 2.*
- Voided run appears: `startRun`, break the blind via the UI (or
  `page.request.post(/break-blind)`), go to `/` → a `Voided` card whose click
  lands on `/experiments/:id` reading `This run is voided.` → *AC task 6, planner
  criterion 1.*
- Measured-noise line: after completing and unblinding a run for metric
  `Afternoon focus`, open `/design`, fill the metric with `Afternoon focus`, and
  assert the measured line appears; on a fresh design (different metric) the
  assumed line appears. → *AC task 7, planner criterion 3.*

**Non-automated verification (record in `result.json` summary):**
- Mechanical copy sweep over every string added or edited (`Home.tsx`,
  `Design.tsx`, `formulary.ts`, `api.ts`, `README.md`): search for `—`, `–`, the
  banned vocabulary, and negative empty-state phrasing. Fix every hit. → *copy
  quality.*

---

## 5. Definition of done

All acceptance criteria in §3 are met and all §4 tests pass in the foreground. A
returning user opens the app and sees a personal formulary: one card per finished
run, newest first, each showing the substance, the metric, whether it beat the
blank, whether they could feel it, and their adherence, with voided runs present
and marked voided. Tapping a card opens its full verdict (unblinded) or its
summary (voided). One tap on `Export` downloads a portable JSON file of the
user's own finished runs, verdicts, unsealed schedules, and daily check-ins, and
no other user's data is reachable from either route (proven by test). When the
user designs a new run for a metric they have already completed, the power
statement uses their own measured day-to-day noise and says so; with no history
it uses the stated assumption and says that instead. Every formulary number is
the stored engine output, unchanged; nothing recomputes or re-judges. Sealed,
in-progress runs never appear in the formulary or the export. Nothing from the
Non-Goals is built: no public commons, no cross-user aggregation, no sharing, no
new verdict math, no migration, no CSV, no demo-seed changes. The README is
accurate for the shipped loop, and the copy sweep is clean. `EPIC_SPEC.md` (this
file) is the only artifact this task leaves; the implementer executes it.
