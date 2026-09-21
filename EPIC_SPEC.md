# EPIC SPEC — Polish pass: first-run, designed states, mobile, copy, README

This is a UX, performance, and quality pass over the whole delivered product.
Tighten what exists. Add no features. The delivered loop already ships: design
and pre-register a blinded run, prep numbered capsules, run a daily check-in with
a placebo guess, reveal a deterministic verdict, and keep every finished run in a
personal formulary you can export. This EPIC brings that loop cleanly up to the
QUALITY BAR and the trust differentiator, and proves it with tests. Most criteria
below are already met in shipped code; each one still carries a provable check so
"met" is verified, not assumed. Exactly one behavior gap needs a code change (the
guided first-run, section 3.1). The rest is verification, small tightening, and
added test coverage.

## Quality differentiator (this app must win on it)

**Trust: you can believe the answer.** The verdict is one the user did not
generate and could not bias, and when the data cannot decide, the app says so
plainly instead of manufacturing confidence.

What polish owes the differentiator:

1. **The guided first run leads to a real sealed run, never a demo shortcut that
   fakes the experience.** The path walks a new user all the way to a started,
   blinded run. That run, weeks later, produces an honest verdict. Onboarding
   that stops at "locked" has not walked the user to the thing that earns trust.
2. **The seeded demo shows a genuine "cannot decide" verdict, not a staged win.**
   The staging demo run is a near-null result computed by the real engine. A
   first-time visitor must reach that honest verdict fast, because seeing the app
   admit "your data cannot tell them apart" is the differentiator in one screen.
3. **Copy never overclaims.** Every visible word stays plain and honest. No
   marketing inflation, no manufactured confidence, no dashes-asides or banned
   LLM vocabulary. The verdict tags stay factual (`Matched the blank`, `Too
   little data`), never softened into a false positive.
4. **Polish must not touch the blinding invariant.** No change here may cause a
   sealed run's allocation to reach the client, reorder the reveal, or alter
   verdict math. The trust invariant proven by `allocation-never-serialized.test`
   stays green, untouched.

---

## 1. Scope

### In scope (tighten what exists)

- **Guided first run (one code change).** Extend the existing Design walkthrough
  so the guided path carries a brand-new user through pre-registering AND
  prepping, and marks itself done only at the first genuine success (the first
  started run), not at lock. Keep it 2 to 4 short imperative steps anchored to
  real controls, skippable at any step, shown only until first success and never
  again (section 3.1).
- **Designed states audit** across every screen: empty, loading, and error are
  designed surfaces; loading holds the layout; errors speak in the product's
  voice with a next step. Verify each screen; fix any gap (section 3.2).
- **Mobile and accessibility audit** at 390px across every screen: no horizontal
  scroll, ~44px touch targets, readable without zoom, keyboard reaches
  everything, inputs labeled, visible focus, sufficient contrast. Verify and add
  the missing e2e coverage for the run-loop screens (section 3.3).
- **Performance invariants** on hot paths: first meaningful render holds the
  layout within ~1s, every interaction acknowledges within 100ms, no unindexed
  query on a hot path, the formulary list stays capped. Verify and assert; do not
  re-architect (section 3.4).
- **Seeded demo path** on staging: with `SEED_DEMO`, a first-time visitor reaches
  a real completed verdict within a minute without hand-crafting data. Verify the
  seed, the staging compose env, and the documented reviewer path (section 3.5).
- **Mechanical copy sweep** over every user-visible string: no em-dashes or
  en-dashes, none of the banned LLM vocabulary, no negative empty-state phrasing
  (section 3.6).
- **README for strangers**: understand, run (verified against the compose files),
  contribute. Verify accuracy and completeness (section 3.7).

### Out of scope (Non-Goals — do not build)

- **Any new feature.** In particular, and explicitly:
  - No in-progress / active-runs list or dashboard on Home. Home stays the
    formulary of finished runs plus the empty state. (A returning user with a run
    in progress and no finished runs still sees the empty state. That continuity
    gap is a pre-existing product gap, recorded as a requested task below, not
    fixed here.)
  - No one-tap anonymous "demo login" button that auto-signs a visitor into the
    shared demo account. That is a new surface (and a new auth path). The staging
    reviewer reaches the demo through the existing console-link convention
    (section 3.5). Recorded as a requested task.
  - No settings screen, no reminder toggle UI, no new API endpoints, no new
    database columns, and no migration.
  - No LLM anywhere. Nothing in this EPIC generates text.
- **Visual gold-plating beyond the bar.** No redesign, no new animation system,
  no theming controls, no icon set, no font change. Meeting the written bar is in
  scope; exceeding it is drift.
- **Verdict math, the run loop, the unblind path, the blinding invariant, and
  every API contract.** All shipped in EPIC 1 to 6 and stay byte-for-byte
  unchanged. Polish is UX, copy, states, and tests, not behavior.

### Recorded as requested_tasks (not built here)

- In-progress-run continuity on Home (a way back to a running experiment without
  a URL). New feature; needs its own EPIC.
- A cold one-tap demo path that shows the seeded verdict without the reviewer
  reading a console link. New surface; needs its own decision.

---

## 2. Technical design

Build on the shipped app exactly as it stands. Reuse the existing components
(`Page`, `LoadingCard`, `ErrorState` in `web/src/components/ui.tsx`), the CSS
variables and mobile-first rules in `web/src/styles.css`, the existing e2e
helpers (`signIn`, `lockDesign`, `startRun`, `expectNoHorizontalScroll` in
`web/e2e/helpers.ts`), and the Vitest route harness in `server/test/helpers.ts`.
Introduce no new dependencies.

The audit surface is the full set of screens and their routes:

| Screen (route) | File | States present today |
| --- | --- | --- |
| Landing (`/`, anon) | `web/src/pages/Landing.tsx` | form + inline error |
| Root gate (`/`) | `web/src/App.tsx` | loading skeleton, error with retry |
| Home / formulary (`/`, authed) | `web/src/pages/Home.tsx` | loading, error, empty, list |
| Design (`/design`) | `web/src/pages/Design.tsx` | loading, error, walk, form |
| Locked summary (`/experiments/:id`) | `web/src/pages/ExperimentLocked.tsx` | loading, error, per-status |
| Prep (`/experiments/:id/prep`) | `web/src/pages/Prep.tsx` | loading, error, step wizard, started |
| Run (`/experiments/:id/run`) | `web/src/pages/Run.tsx` | loading, error, per-phase, reveal |
| Verdict (`/experiments/:id/verdict`) | `web/src/pages/Verdict.tsx` | loading, error, verdict |
| Check email (`/auth/check-email`) | `web/src/pages/CheckEmail.tsx` | static |
| Expired (`/auth/expired`) | `web/src/pages/Expired.tsx` | static error with next step |

### 2.1 The only code change: guided first-run completion (section 3.1)

**Problem.** `Design.tsx` shows a 3-step walkthrough (`bk_walk_done` in
`localStorage`) and calls `finishWalk()` inside `onLock`, so the guided path ends
the instant the user locks, before they prep. Planner criterion 1 requires the
guided path to walk through pre-registering AND prepping, ending only at first
success. First success for this product is a started, sealed run, not a locked
design.

**Change (minimal).**

- **New tiny shared module `web/src/walk.ts`** so Design and Prep agree on the
  flag with no duplicated string literal:

  ```ts
  export const WALK_DONE_KEY = "bk_walk_done";
  export function isWalkDone(): boolean {
    return localStorage.getItem(WALK_DONE_KEY) === "1";
  }
  export function markWalkDone(): void {
    localStorage.setItem(WALK_DONE_KEY, "1");
  }
  ```

- **`Design.tsx`:**
  - Import `WALK_DONE_KEY`/`isWalkDone`/`markWalkDone` from `./walk.js`; delete
    the local `WALK_DONE_KEY` const and inline `localStorage` calls.
  - Read the flag with `isWalkDone()` on mount (unchanged behavior).
  - **Remove the `finishWalk()` call inside `onLock`.** Locking no longer ends
    the walk. Keep the `Skip` button calling `finishWalk()` (which calls
    `markWalkDone()`), so it stays skippable.
  - Reword the checklist to name the whole first journey through starting the
    run, four short imperative steps (verbatim copy in section 3.8). The
    tick-state logic stays: step 1 ticks when a substance is named, step 2 when
    the acknowledgement is checked. Steps 3 and 4 stay unticked on Design (they
    complete on later screens); rendering them as upcoming is correct.
- **`Prep.tsx`:**
  - Import `markWalkDone` from `../walk.js`.
  - Call `markWalkDone()` when the run has started: in `onStart` right after
    `confirmPrep(id)` succeeds (before or with `setStarted(true)`), AND in the
    `load.prep.status === "running"` branch on mount (a run that already started,
    for example on another device, is a success too). This is the first-success
    signal.
- No server change. No new route. No schema change. `confirm-prep` already
  exists and is unchanged.

**Result.** A brand-new user sees the guided checklist on Design, it survives
locking, and it is cleared the moment their first run starts. It never appears
again for that browser. Skip clears it immediately at any step.

### 2.2 Everything else is verify-and-tighten (no behavior change unless a check fails)

Sections 3.2 to 3.7 are audits. For each, run the concrete check. If the check
passes as-is (most will), the work is the test that proves it. If a check fails,
the fix is the smallest edit that makes it pass, within the bar, touching only
the named file. If a fix appears to require a Non-Goal, stop and report `blocked`
with the precise conflict (do not build around it).

The README accuracy edit (section 3.7) and any copy fixes from the sweep (section
3.6) are the expected small tightening edits. No other behavior changes are
anticipated.

---

## 3. Ordered task list (with concrete, provable acceptance criteria)

### 3.1 Guided first-run tightening

Implement section 2.1.

- *AC1:* A brand-new user (fresh sign-in, empty `localStorage`) who opens
  `/design` sees the guided checklist with four short imperative steps anchored
  to the real controls (section 3.8). Step 1 ticks once a substance is named;
  step 2 ticks once the acknowledgement is checked.
- *AC2:* The checklist is skippable: pressing `Skip` hides it immediately and it
  does not return on reload.
- *AC3:* The checklist survives locking (it is still the guided path after the
  design is sealed) and is cleared only after the user starts their first run.
  After starting a run, reopening `/design` shows no checklist.
- *AC4:* A returning user who has already started any run never sees the
  checklist. The `Skip` path and the started-run path both persist that.
- *AC5:* Existing `design.spec.ts` and `prep.spec.ts` still pass unmodified
  (the change adds no primary action to Design and does not alter the prep
  wizard).

### 3.2 Designed states on every screen

Audit each screen in the table (section 2). Each must have a designed empty (where
applicable), loading, and error state. Loading holds the layout with a skeleton or
in-place placeholder, never a white flash. Errors state what to do next in the
product's voice.

- *AC1:* Root gate and every data-backed screen (Home, Design, Locked, Prep, Run,
  Verdict) renders `LoadingCard` (skeleton) while its fetch is in flight, not a
  blank page.
- *AC2:* Each of those screens renders `ErrorState` (or an equivalent designed
  error) with a retry or a clear next step on fetch failure. No raw error text,
  no stack trace, no dead end.
- *AC3:* Home renders its designed empty state for a user with zero finished runs:
  heading `Start your first blind test` (VERBATIM; the sign-in e2e helper and
  landing flow assert it), a short positive body, and one primary action
  `Design a test`.
- *AC4:* The Expired screen states what happened and offers `Send a new link`;
  the Check-email screen states what to do next. Both stay designed cards, not
  blank routes.

### 3.3 Mobile and accessibility at 390px on every screen

Audit at the 390px baseline. The CSS already sets `--tap: 44px`, `overflow-x:
hidden`, focus-visible outlines, and labeled inputs. Verify per screen and add the
missing e2e coverage.

- *AC1:* No horizontal scroll at 390px on Landing, Home (empty and list), Design,
  Locked summary, Prep, Run (running dashboard), and Verdict. (Landing, Design,
  and Home are already covered; add coverage for Locked, Prep, Run, Verdict.)
- *AC2:* Every interactive control is at least ~44px tall/wide (buttons, steppers,
  segmented options, chips, card links). Verify against the shared `.btn`,
  `.stepper-btn`, `.segmented-btn`, and `.formulary-card` rules.
- *AC3:* Every input has an associated label reachable by `getByLabel`: the run
  check-in metric field, the guess segmented control, and the note textarea on
  the Run screen are labeled; the Design metric and substance inputs are labeled.
- *AC4:* Keyboard reaches every action and every card link, with a visible focus
  ring, on at least one authed run-loop screen proven by e2e (extend the
  accessibility smoke beyond Landing to the Run check-in).
- *AC5:* Color contrast and focus states use the existing CSS variables; no new
  low-contrast color is introduced. (Static check; no code change expected.)

### 3.4 Performance invariants on hot paths

Verify and assert. No re-architecting.

- *AC1:* The formulary list read is capped: `listFormulary` uses
  `LIMIT FORMULARY_LIMIT` (`= 100`) and the export uses `LIMIT EXPORT_LIMIT`
  (`= 1000`). Assert the constants and that the query carries the limit
  (`formulary.ts`).
- *AC2:* No hot-path query is unindexed: the formulary list, the export, the
  measured-noise lookup, and the daily `today` read all filter by `user_id` or
  `experiment_id`, covered by `experiments_user_id_idx`,
  `allocations_experiment_id_idx`, and the `check_ins (experiment_id, check_date)`
  unique index. Confirm no polish edit introduces a new unindexed scan.
- *AC3:* Every mutation control gives feedback within 100ms as perceived: primary
  buttons carry an `:active` pressed state and set `aria-busy` with a
  "Saving…/Locking…/Starting…/Revealing…" label while the request is in flight.
  Verify the check-in, lock, start-run, unblind, and break-blind buttons all do.
- *AC4:* Loading holds the layout (skeletons in place), so first meaningful render
  shows structure, not a white screen (this is the same skeleton coverage as
  3.2 AC1, asserted from the perceived-speed angle).

### 3.5 Seeded demo path (staging)

Verify the SEED_DEMO first-run path end to end at the infrastructure level.

- *AC1:* `runSeed` provisions exactly one demo account (`demo@blind-keeper.app`)
  holding one `unblinded` experiment with a full set of allocations, a realistic
  run of daily check-ins, and one stored verdict that equals the real engine
  output over that data. (Covered by `seed.test.ts`; keep it green. Do not add
  extra demo runs; the test asserts exactly one experiment.)
- *AC2:* The seeded verdict is a genuine near-null result (the demo shows the app
  admitting the data cannot decide), so a visitor sees the differentiator, not a
  staged win. (Property of the seed data; verify the stored `verdict_text`
  reflects a non-significant effect.)
- *AC3:* `docker-compose.staging.yml` sets `SEED_DEMO: "1"` and
  `MAIL_TRANSPORT: console`, so the seed runs on boot and the demo sign-in link
  prints to the app logs. (Static check against the compose file; already true,
  keep it.)
- *AC4:* The README documents the staging reviewer path to the demo verdict in
  one place: request a sign-in link for `demo@blind-keeper.app`, read it from the
  app logs (console transport), open it, and land on the demo formulary with a
  finished verdict one tap away. A reviewer following it reaches the verdict
  within a minute without hand-crafting data. (Section 3.7.)

### 3.6 Mechanical copy sweep

Search every user-visible string in the shipped surfaces (`web/src/**`,
server-rendered strings and email templates in `server/src/**`, and `README.md`)
for the three tell classes and fix every hit:

- The characters `—` (em-dash) and `–` (en-dash), and `" - "` used as a sentence
  break.
- The banned LLM vocabulary: `seamlessly`, `effortlessly`, `unlock`, `elevate`,
  `empower`, `leverage`, `robust`, `dive in`, `in today's fast-paced world`,
  `we've got you covered`, and their kin.
- Negative empty-state phrasing: `You don't have`, `No … yet`, `Nothing … here`,
  `Unable to`, `Something went wrong`.

- *AC1:* The sweep finds zero hits in any shipped user-visible string, including
  the four new walkthrough step strings from section 3.8 and any README edit.
- *AC2:* The honest verdict tags stay factual and unchanged: `Matched the blank`
  and `Too little data` are result statements, not empty-state filler, and are
  not reworded. The blind-integrity and verdict copy on the Verdict screen is not
  softened.
- *AC3:* Code comments and non-UI strings are exempt and are not touched for the
  sweep.

(As of this spec, a sweep of `web/src` and `server/src` shows no hits; the shipped
copy is already clean. The load-bearing check is that it stays clean after the
walkthrough rewording.)

### 3.7 README for strangers

Verify `README.md` is accurate, complete, and free of factory internals.

- *AC1:* Understand: two or three plain sentences on what the app is and why it
  exists, matching the shipped loop (design, prep, daily check-in with a placebo
  guess, deterministic verdict, personal formulary with export). No stale claim
  that any shipped step "arrives in a later release".
- *AC2:* Run: the exact local commands are correct and verified against the actual
  files (`npm install`, `npm run build`, then `npm start` with `DB_DRIVER=pglite`,
  `SESSION_COOKIE_SECRET`, and `SEED_DEMO=true`; the passwordless sign-in link is
  retrieved via `GET /api/dev/last-magic-link`). The PostgreSQL path and the
  `docker-compose.staging.yml` note match the compose file (the web service uses
  `expose`, reached through a proxy, so it is a hosted manifest, not a laptop
  `docker compose up`; the README says so honestly).
- *AC3:* Contribute: where the code lives (`server/`, `web/`, migrations in
  `server/migrations/`) and how to run the tests (`npm test`, `./scripts/e2e.sh`)
  are correct.
- *AC4:* The staging demo reviewer path (section 3.5 AC4) is documented.
- *AC5:* No factory internals anywhere (no agent names, task types, internal
  service paths, or pipeline jargon).

### 3.8 Walkthrough copy (verbatim; sweep before finishing)

The Design checklist steps (replace the current three; keep `aria-label="Getting
started"`):

1. `Pick a template or name what you are testing.`
2. `Confirm this is a supplement, not a prescription drug.`
3. `Lock your design to seal it.`
4. `Prepare your capsules and start your run.`

Skip button label (unchanged): `Skip`.

Preserved verbatim elsewhere (do NOT reword):
- Home empty-state heading: `Start your first blind test`
- Home empty-state primary: `Design a test`

Run the section 3.6 sweep over these strings and any README edit before finishing.

---

## 4. Test plan (which automated test proves each criterion)

All tests run in the foreground to completion before `result.json` is written.
Server tests: `npm test`. End-to-end: `./scripts/e2e.sh` (Playwright, 390px
project, console transport).

**Guided first-run — `web/e2e/first-run.spec.ts` (new) → 3.1.**
- Fresh sign-in, open `/design`: assert the four step strings from section 3.8 are
  visible and the `Skip` button is present. (AC1)
- Press `Skip`, reload `/design`: the checklist is gone. (AC2)
- Fresh browser context: `startRun(page)` (locks and starts a run through the real
  flow), then open `/design`: the checklist is gone, proving it survived lock and
  cleared at first run start. (AC3, AC4)
- `design.spec.ts` and `prep.spec.ts` run unchanged and pass. (AC5)

**Designed states — `web/e2e/designed-states.spec.ts` (extend) → 3.2.**
- Keep the existing expired-link, loading-skeleton, and empty-home cases.
- Add: delay `GET /api/formulary` and assert Home shows the skeleton, not a blank
  page. (AC1)
- Add: fail `GET /api/formulary` (route abort) and assert Home shows the
  `We could not load your formulary.` designed error with a `Try again` action.
  (AC2)

**Mobile and a11y — `web/e2e/mobile-390.spec.ts` (new) + `a11y-smoke.spec.ts`
(extend) → 3.3.**
- New: for the run-loop screens, drive `startRun`, then visit the Locked summary,
  Prep, Run, and (after `complete-run` + `unblind` via `page.request`) the Verdict
  screen, asserting `expectNoHorizontalScroll` on each at 390px. (AC1)
- Extend `a11y-smoke`: on the running dashboard, assert the metric input, the
  guess control, and the note field are reachable by label/role, the primary
  `Save check-in` button is keyboard-focusable, and focus is visible. (AC3, AC4)

**Performance invariants — `server/test/formulary.test.ts` (extend) +
`server/test/migrations.test.ts` (verify) → 3.4.**
- Assert `FORMULARY_LIMIT === 100` and `EXPORT_LIMIT === 1000` and that the list
  query is bounded (a straightforward unit assertion on the exported constants).
  (AC1)
- Confirm (existing `migrations.test.ts`) that `experiments_user_id_idx`,
  `allocations_experiment_id_idx`, and the `check_ins` unique index exist; add an
  assertion if not already covered. (AC2)
- AC3/AC4 are UI-perceived and covered by the pressed-state/`aria-busy` presence
  already asserted in `design.spec.ts` (Locking) and by the skeleton tests above;
  add a light assertion of `aria-busy` on the check-in `Save` button in the a11y
  spec if convenient.

**Seed and staging — `server/test/seed.test.ts` (keep) → 3.5.**
- The existing three cases prove one demo user, one unblinded experiment, one
  engine-equal verdict, and idempotency. Keep them green. (AC1, AC2)
- AC3 is a static check of `docker-compose.staging.yml` (recorded in the run
  summary, not a unit test). AC4 is verified by reading the README.

**Copy sweep — mechanical, recorded in the run summary → 3.6.**
- Grep `web/src`, `server/src`, and `README.md` for `—`, `–`, the banned
  vocabulary, and the negative empty-state phrases. Zero hits in shipped strings.
  Fix any hit in the same run. (AC1, AC2, AC3)

**README — manual verification recorded in the run summary → 3.7.**
- Read `README.md` against `package.json` scripts, `.env.example`, the local
  start command, `server/src/routes/auth.ts` (the dev link endpoint), and
  `docker-compose.staging.yml`. Every command and claim matches. No factory
  internals. (AC1 to AC5)

---

## 5. Definition of done

All acceptance criteria in section 3 are met and every test in section 4 passes
in the foreground. A brand-new user is led, in four short steps, from naming what
they are testing to a started, sealed run, and that guidance never reappears once
their first run begins or once they skip it. Every screen holds its layout while
loading, states an empty screen as an invitation, and states an error in the
product's voice with a next step. Every screen is usable at 390px with no
horizontal scroll, tappable targets, labeled inputs, visible focus, and full
keyboard reach. The formulary read stays capped and no hot path runs an unindexed
query. On staging the seeded demo shows a real, honest near-null verdict a
reviewer reaches within a minute. Every shipped string is plain and honest, with
no dashes, no banned vocabulary, and no negative empty-state phrasing. The README
lets a stranger understand, run, and contribute, verified against the compose and
package files. Nothing new was built: no active-runs dashboard, no demo login, no
settings screen, no endpoints, no migration, no LLM, and no visual gold-plating.
The blinding invariant and every API contract are untouched, and
`allocation-never-serialized.test` stays green. `EPIC_SPEC.md` (this file) is the
only artifact this task leaves; the implementer executes it.
