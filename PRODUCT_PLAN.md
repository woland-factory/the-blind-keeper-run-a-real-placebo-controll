# PRODUCT PLAN — The blind-keeper

## Core value (one sentence)

Turn "I wonder if this supplement does anything" into a genuinely blinded,
pre-registered N-of-1 experiment, and hand back a statistical verdict the user
could not have produced or biased themselves.

## North star

A year in, the user opens a personal formulary of verdicts earned on their own
body: magnesium helped their sleep with a large effect, theanine was
indistinguishable from a blank, ashwagandha voided the day they cracked and
peeked. They know a number about themselves nobody has ever had, how well they
can actually feel what a pill does, and it sits near chance. So they shop for
supplements as a calibrated skeptic: keep what survived a blind test, drop what
didn't. The feeling is quiet confidence. They finally have honest answers about
their own body that no chat window or spreadsheet could give them, and every
new experiment is sharper because the last one measured their day-to-day noise.

## Quality differentiator (the one dimension we win on)

**Trust: you can believe the answer.** Every other way to do this job either
cannot blind (Bearable's correlations, StudyMe's unblinded protocols, a
spreadsheet, a chatbot that prints the schedule and ruins it) or leaves the
rigor to the user (Gwern's manual method). The blind-keeper commits to one
thing above all: the verdict is one you did not generate and could not bias,
and when the data cannot decide, the app says so plainly instead of
manufacturing confidence. We beat everyone on honesty of the answer. Speed,
polish, and simplicity serve that; they are not the wedge.

## Signature moment

Unblinding day. The app overlays weeks of daily "was today placebo?" guesses on
the true schedule and delivers a two-part reveal no other product can:
the effect estimate, and whether the user beat chance at feeling it. When the
supplement does nothing: "Your focus scores cannot tell theanine from a blank.
And you guessed the blank days no better than a coin." When it works: "You felt
it. You guessed right 17 days out of 21." The second clause is the part the
user repeats to a friend: the app measured whether they can trust their own
body sense.

---

## MVP user stories

1. As a curious supplement user, I choose a substance and lock a single success
   metric before any data exists, so I cannot move the goalposts later.
2. As a user, I see an honest up-front power statement (what size of effect this
   run can and cannot detect) before I commit, so a null result later is
   informative rather than a surprise.
3. As a user, I follow a step-by-step prep walkthrough to make identical active
   and blank capsules and package them under app-issued codes, so which capsule
   is which is no longer something I can see.
4. As a user, the app holds the schedule secret and shows me only today's code
   each day, so I stay genuinely blind for the whole run.
5. As a user, I complete a sub-minute daily check-in: my metric, an optional
   note, and a one-tap "was today placebo?" guess.
6. As a user, I get one daily reminder so I keep my streak of sealed days.
7. As a user who cannot wait, I can break the blind, which instantly reveals the
   schedule but voids the run and records the void permanently.
8. As a user, on unblinding day I get a deterministic verdict: effect estimate,
   guess-accuracy-versus-chance, adherence, a blind-integrity flag, and a plain
   reading honest about the run's power.
9. As a returning user, each completed run becomes a card in my personal
   formulary, which I can export.
10. As a returning user, when I design a new run for a metric I have measured
    before, the power statement uses my own measured noise, so the new run is
    designed smarter than the first.

---

## Data model sketch

- **User** — id, email, auth (passwordless magic-link; no stored password),
  created_at.
- **Experiment** — id, user_id, substance_name, metric_name,
  metric_type (`rating_0_10` | `minutes` | `count` | `yes_no`),
  metric_direction (`higher_better` | `lower_better`), block_length_days,
  num_blocks, num_active_blocks, washout_note, status
  (`designing` | `prepped` | `running` | `unblinded` | `voided`),
  pre_registered_at (lock timestamp), start_date, planned_end_date, created_at.
  Everything above is immutable once `pre_registered_at` is set.
- **Allocation** (SECRET, never sent to client before unblinding) — one row per
  block: experiment_id, block_index, code, condition (`active` | `placebo`),
  block_start_date, block_end_date. Stored server-side only.
- **CheckIn** — id, experiment_id, check_date (one per day), metric_value,
  optional note, placebo_guess (`placebo` | `active` | `unsure`), submitted_at.
  Editable only on its own day.
- **Verdict** (created at unblinding) — experiment_id, effect_estimate (+units),
  permutation_p_value, guess_accuracy, guess_p_value_vs_chance, adherence_pct,
  blind_integrity_flag, power_note, verdict_text (deterministic template),
  computed_at.
- **Formulary card** — a view over unblinded/voided experiments plus their
  verdict. No new table required.
- **MetricNoise** — derived per (user_id, metric_name): measured within-person
  standard deviation from past completed runs, used to power future designs.

## Screen / endpoint inventory

Screens (mobile-first, 390px baseline):
1. Landing / first-run — what it is, one CTA to start.
2. Design experiment — substance, metric, block length, block count; live power
   statement; safety acknowledgement; lock-and-pre-register.
3. Prep walkthrough — make capsules, fill by code, shuffle, confirm ready.
4. Running dashboard — today's code, streak of sealed days, days remaining,
   break-blind control.
5. Daily check-in — metric input, optional note, one-tap placebo guess.
6. Verdict — the signature-moment reveal.
7. Formulary — list of verdict cards, export.
8. Settings — account, reminder on/off.

Endpoints (all authorized server-side per user; input validated at the
boundary; mutations rate-limited):
- `POST /auth/magic-link`, `GET /auth/verify`
- `POST /experiments` — validates and locks pre-registration; generates and
  stores the secret allocation server-side.
- `GET /experiments/:id` — non-secret state only; never returns allocation.
- `GET /experiments/:id/prep` — codes and per-code fill instructions.
- `POST /experiments/:id/confirm-prep` — status → running, sets start_date.
- `GET /experiments/:id/today` — today's code and whether today's check-in is done.
- `POST /experiments/:id/checkins` — one per day; validated; idempotent per date.
- `POST /experiments/:id/break-blind` — reveals schedule, sets status `voided`.
- `POST /experiments/:id/unblind` — allowed only when the run is complete;
  computes and stores the verdict.
- `GET /experiments/:id/verdict`
- `GET /formulary`, `GET /formulary/export`
- `GET /power-preview` — power statement for a candidate design (uses
  MetricNoise when available).

---

## The blinding mechanism (the crux — specified, not hand-waved)

Naive "numbered capsules" fails: the user fills the capsules, so any scheme
where the app announces which numbers hold the active substance unblinds
itself. The reference procedure, adapted from the Imperial College
self-blinding microdose study (N=191, home self-blinding proven feasible), is:

1. **Make active and blank capsules physically identical** — same opaque shell,
   same fill weight, active contains the supplement, blank contains inert filler
   only. Prepared as two separate batches.
2. **Fill by code.** The app issues one neutral code per block (for example
   `MQ7`, `ZK2`) and walks the user one packet at a time: "Packet MQ7: seven
   capsules from your active batch." "Packet ZK2: seven from your blank batch."
   The user fills and seals each identical, opaque packet, marked only with its
   code. The app dictates a randomized, interleaved fill order.
3. **Destroy the trace.** All packets are now identical except for their codes.
   The user drops them in a bag and shuffles. With many random codes filled in a
   scrambled order, the code-to-content map decays from memory within days.
4. **The app holds two secrets server-side**: the code-to-condition allocation
   and the code-to-day schedule. Each morning it reveals only today's code. To
   unblind themselves the user would have to have recorded the entire fill map,
   which the design discourages and never re-displays.

Threat model, stated honestly: the enemy is the user's own future impatience,
not a determined adversary. Nothing makes a solo self-experiment tamper-proof;
a user can open a capsule and taste it. The design answer is friction plus
honesty: a "break the blind" button that unblinds instantly, voids the run, and
records the void in the permanent formulary. Gwern's paired-jar method has the
same property. This is disclosed, not hidden.

## The verdict engine (deterministic, no LLM)

- **Effect.** Test statistic is the difference in the metric's block means
  between active and blank blocks, oriented by `metric_direction`. A permutation
  test permutes the active/blank labels across the actual blocks to build the
  null distribution and read a p-value. Report the effect estimate in the
  metric's own units alongside the p-value.
- **Guess accuracy.** Each day's placebo guess is scored against that day's true
  block condition; report accuracy and a binomial p-value versus chance (0.5;
  "unsure" days excluded and reported as excluded).
- **Blind integrity.** If guess accuracy beats chance significantly, flag that
  the blind may have leaked and temper the effect reading accordingly.
- **Power, up front and at the end.** The design screen states the minimum
  detectable effect from assumed (or, when available, measured) within-person
  noise, and names the hard limit: with few blocks the permutation test's
  smallest possible p-value is bounded (six blocks, three active, gives a floor
  of 0.05). The verdict repeats this so a null is read as "underpowered to
  detect small effects," never as "proven no effect."

---

## EPIC list (build order)

### EPIC 1 — Foundation, auth, and staging scaffold
**Scope.** App skeleton (backend + frontend), passwordless magic-link auth,
database, mobile-first shell, landing / first-run screen, security baseline
(server-side authorization on every route, boundary validation, rate limiting
on auth and mutations, secrets via env only, no PII in logs), error/analytics
wiring (Sentry DSN, Umami), Dockerfile, `docker-compose.staging.yml`, a
`SEED_DEMO` path that provisions a demo account, and a README skeleton for
strangers.
**Acceptance criteria.**
- `docker compose -f docker-compose.staging.yml up` builds and serves the app
  with a passing health check; secrets read from env, none committed.
- Landing screen renders real content (not a blank page) within ~1s at 390px
  width, states in one glance what the app does, and offers one primary action.
- Magic-link sign-in works end to end via the central mailer; an unauthenticated
  request to any data route is rejected server-side.
- With `SEED_DEMO=true` the app boots a demo account containing at least one
  fully completed experiment (later EPICs enrich its verdict); the seed is
  idempotent and off by default.
- Auth and mutation endpoints are rate-limited; malformed input is rejected at
  the boundary with a designed error state, never a stack trace.
- README states in plain language what the app is and the exact verified
  commands to run it; no factory internals.
**Non-goals.** Real experiment features, any statistics, notifications.

### EPIC 2 — Protocol designer + immutable pre-registration + power statement
**Scope.** The design screen: pick substance, one success metric (type +
direction), block length, and block count; a small starter set of substance
templates (a handful, prefilled washout and metric suggestions) so the screen is
concrete; a live power statement; a safety gate (supplements and behavior only,
a blocklist of common prescription drugs, a clear not-medical-advice line, an
acknowledgement checkbox); and a lock action that pre-registers the design
immutably and generates the secret allocation server-side.
**Acceptance criteria.**
- A user can design and pre-register a valid experiment; balanced active/blank
  blocks and a minimum block count are enforced, and day-level randomization is
  impossible to select.
- After locking, the metric, direction, block structure, and run length cannot
  be edited by any client request; the server rejects mutation attempts.
- The design screen shows a power statement that names the minimum detectable
  effect and the p-value floor implied by the chosen block count, before the
  user commits.
- Entering a substance on the prescription blocklist blocks pre-registration
  with a plain explanation; the not-medical-advice framing is visible on the
  screen.
- The generated allocation (code-to-condition and code-to-day) is stored
  server-side and is never included in any pre-unblinding API response
  (verified by test).
- At least four substance templates are available with sensible prefilled
  washout and metric defaults.
**Non-goals.** Editable pre-registration, conversational/LLM design, large
template libraries.

### EPIC 3 — Blinding prep walkthrough + confirm-ready
**Scope.** The step-by-step prep walkthrough implementing the reference
procedure above: identical-capsule instructions, per-code fill steps in a
randomized interleaved order, the shuffle step, a printable prep sheet, and a
confirm-ready action that starts the run and sets the schedule dates.
**Acceptance criteria.**
- The walkthrough presents one short imperative step at a time and issues the
  app-generated codes with per-code fill instructions; no step ever reveals
  which code is active or which day a code belongs to.
- A printable prep sheet lists the codes and fill counts without leaking the
  allocation.
- Confirm-ready transitions the experiment to `running`, sets `start_date` and
  per-block dates, and is idempotent.
- A usability check demonstrates a first-time user can complete prep from the
  walkthrough alone (recorded in the EPIC's test notes or a short artifact).
- Every visible string passes the copy sweep (no em-dashes, no banned
  vocabulary, positive phrasing).
**Non-goals.** Low-prep paired-jars mode, mail-order capsule kits, barcode/QR
scanning.

### EPIC 4 — Daily check-in loop, dashboard, reminders, break-blind
**Scope.** The running dashboard (today's code, streak of sealed days, days
remaining, break-blind control), the sub-minute daily check-in (metric input,
optional note, one-tap placebo guess), one debounced daily email reminder via
the central mailer, and the break-blind action that reveals and voids.
**Acceptance criteria.**
- `GET /experiments/:id/today` returns today's code and check-in status; the
  dashboard renders it at 390px with designed empty/loading/error states.
- A check-in submits in under a minute of interaction, accepts exactly one entry
  per day, validates the metric value, and gives feedback within 100ms
  (optimistic update or pressed state).
- The daily reminder sends at most once per day per user and never storms.
- Break-blind reveals the schedule, sets status `voided`, records the void
  permanently, and cannot be undone.
- The placebo guess is captured per day and stored for the verdict.
**Non-goals.** Push notifications, editing past days, gamified rewards beyond
the sealed-day streak.

### EPIC 5 — Unblinding verdict (the signature moment)
**Scope.** The deterministic verdict engine (permutation test on block means,
guess-accuracy binomial versus chance, adherence, blind-integrity flag, honest
power note) and the verdict screen delivering the two-part reveal.
**Acceptance criteria.**
- `POST /experiments/:id/unblind` is allowed only when the run is complete,
  computes the verdict once, stores it, and thereafter serves the stored result.
- The permutation test and binomial test are unit-tested against known inputs,
  including the six-block p-value floor case.
- The verdict screen shows, in plain language, the effect estimate with units,
  the guess-accuracy-versus-chance result, adherence, the blind-integrity flag,
  and a power caveat that reads a null as "underpowered," never as "proven no
  effect."
- The two-part reveal (effect and can-you-feel-it) is present and legible at
  390px.
- No LLM is called anywhere in the verdict path.
**Non-goals.** LLM-written narrative verdicts, Bayesian model selection beyond a
simple comparison, sharing/publishing.

### EPIC 6 — Personal formulary + measured-noise carry-forward + export
**Scope.** The formulary list of verdict cards (including voided runs), export
to a portable file, and using a metric's measured within-person noise from past
completed runs to power future designs.
**Acceptance criteria.**
- The formulary lists every completed and voided run as a card (substance,
  metric, effect, guess calibration, adherence, void status) at 390px, with a
  designed empty state that points a new user to their first experiment.
- Export produces a portable file (JSON and/or CSV) of the user's own runs and
  verdicts; no other user's data is reachable.
- Designing a new experiment for a metric the user has completed before uses
  their measured noise in the power statement; with no history it falls back to
  a stated assumption and says which it used.
- Formulary and export routes are authorized per user server-side (verified by
  test).
**Non-goals.** Public N=1 commons registry, cross-user aggregation, social
sharing.

### EPIC 7 — Polish pass (no new features)
**Scope.** A UX, performance, and quality pass over the whole delivered product
against the QUALITY BAR and the trust differentiator. Tighten what exists; add
nothing.
**Acceptance criteria.**
- A guided first-run path walks a brand-new user through pre-registering and
  prepping their first experiment: 2 to 4 short imperative steps anchored to the
  real controls, skippable at any step, shown only until first success and never
  again.
- Every screen has designed empty, loading, and error states; loading holds the
  layout steady; errors speak in the product's voice with a next step.
- Every screen is fully usable at 390px: no horizontal scroll, ~44px touch
  targets, readable without zoom; keyboard reaches everything; inputs labeled;
  visible focus states; sufficient contrast.
- First meaningful render is within ~1s and every interaction acknowledges
  within 100ms on hot paths; no unindexed query on a hot path; the formulary
  list is capped or paginated.
- On staging with `SEED_DEMO`, a first-time visitor reaches a real completed
  verdict (the signature moment) within a minute without hand-crafting data.
- A mechanical copy sweep over every user-visible string passes: no "—" or "–",
  none of the banned LLM vocabulary, no negative empty-state phrasing.
- README is complete and accurate for a stranger: understand, run (verified
  against the compose files), contribute.
**Non-goals.** Any new feature; visual gold-plating beyond the bar.

---

## Non-Goals / Out of scope (the fence)

- **The N=1 commons / public registry.** No publishing runs, no cross-user
  pooling, no leaderboards. This is the compounding second act, not the MVP.
- **Physical fulfillment.** No mail-order capsule kits, no supplement inventory
  or sales. Atoms stay on the user's side. This is what killed the 2015
  precursor.
- **Passive correlation tracking.** No "log everything and find correlations."
  That is already free and is the opposite of a controlled test.
- **Prescription-drug protocols.** Supplements and harmless behavior tweaks
  only. The designer refuses prescription drugs and never positions itself for
  them.
- **LLM-generated verdicts.** The verdict must be deterministic. An optional
  bring-your-own-key narrative layer is deferred; it must never replace or
  soften the computed result.
- **Low-prep paired-jars mode.** Deferred; a solo paired-jars mode blinds weakly
  and would undercut the trust differentiator if shipped half-done.
- **Native mobile apps and push notifications.** The MVP is a mobile-first web
  app with email reminders.
- **Day-level randomization.** Scientifically wrong for slow-acting substances;
  the app randomizes blocks only.
