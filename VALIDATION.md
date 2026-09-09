# VALIDATION — The blind-keeper

## Verdict: VIABLE

This idea passes the hardest test in the rubric on structural grounds, not on
polish. A chatbot can design a self-experiment; it cannot keep the assignment
secret from its own user for three weeks, fire a check-in on day 14, or hold a
pre-registered metric immutable against later goalpost-moving. Those three
holds are the product, and no free incumbent ships them together: StudyMe does
protocols without blinding, Bearable does correlations with a printed warning
that correlations aren't causation, and Gwern's manual protocol is the recipe
everyone admires and almost nobody cooks. The evidence shows real people
asking for exactly this bridge.

It also passes the durability test. A completed run mints a verdict card in a
personal formulary; runs accumulate a measured noise profile that makes each
future experiment better-powered; the placebo-guess history becomes a
calibration record of self-trust. All three are things a user keeps, and none
can live in a chat window or a spreadsheet.

It is agent-buildable. The core loop is deterministic software: block
randomization, forms, scheduled reminders, a permutation test. No runtime LLM
is required for the first moment of value, so the BYOK question is passed
trivially; an optional LLM layer can degrade to the deterministic path.

The audience is small. The factory's purpose statement makes that acceptable:
this is deep value for few, judged as value, not as a business. The 2015
precursor's death is explained by its physical-fulfillment model, which this
idea deliberately avoids.

## Core value proposition

Turn "I wonder if this supplement does anything" into a genuinely blinded,
pre-registered N-of-1 experiment, then deliver a statistical verdict the user
could not have produced or biased themselves. Signature moment: unblinding
day, when the app reveals both the effect estimate and whether the user's
daily "was today placebo?" guesses beat chance.

## Minimal feature set

1. **Protocol designer with pre-registration.** Substance, one success
   metric locked before day one, randomized on/off BLOCKS sized to the
   substance's washout period (day-level randomization is scientifically
   wrong for slow-acting substances and must not ship), run length, and an
   honest up-front power statement.
2. **Capsule-prep walkthrough that actually blinds.** The proven mechanism
   is the Imperial-study shape: many meaningless codes on identical
   containers plus a physical shuffle, so the user's knowledge is destroyed
   while the app's mapping survives. A printable prep sheet and a low-prep
   paired-jars fallback mode.
3. **The held secret.** Assignment stored where the user cannot casually see
   it (server-side is the clean choice), with a "break the blind" button
   that unblinds instantly but voids the run and records the void.
4. **Daily check-in.** The pre-registered metric, one or two ratings, and
   the one-tap placebo guess. PWA notification or email reminder; this is
   the adherence backbone, not a nice-to-have.
5. **Unblinding verdict.** Permutation test or simple Bayesian comparison,
   guess-accuracy-vs-chance, adherence and blind-integrity report, plain
   language, honest about power.
6. **Personal formulary.** Verdict cards accumulate; exportable.

Out of the minimum: the N=1 commons registry, protocol template libraries
beyond a starter handful, LLM features, native apps, social anything.

## Main risks

1. **The blinding handshake is the crux, and it is a design problem, not a
   coding problem.** Naive "numbered capsules" fails: the user fills the
   capsules, so any scheme where the app announces which numbers get the
   active substance unblinds itself. The workable procedure (code-labeled
   identical containers, then a shuffle that erases positional and code
   memory) is proven at N=191 by the Imperial self-blinding study, but the
   plan must specify it step by step and test that a first-timer can execute
   it. If the prep walkthrough is hand-waved, the product's central promise
   is theater.
2. **Statistical honesty under low power.** Ten on-days versus ten off-days
   detects only large effects. The verdict engine must say so before day one
   (power warning from assumed or measured variance) and express uncertainty
   plainly at the end, or the honesty engine becomes a false-confidence
   engine, which is worse than not existing.
3. **Adherence before payoff.** Three to six weeks of daily check-ins with
   the reward at the end. The daily guess is the engagement mechanic carrying
   this and it is unproven. Mitigations: sub-minute check-ins, reminders,
   visible streak of sealed days.
4. **Setup wall.** An hour of kitchen work and a purchase of empty capsules
   before day one. Motivated users demonstrably do this; casual users will
   bounce. The paired-jars low-prep mode is the mitigation, and the demo
   (SEED_DEMO) must show the verdict experience without requiring three weeks
   of real data.
5. **Safety boundary.** Must refuse prescription-drug protocols and carry
   clear not-medical-advice framing. Supplements and behavior tweaks only.
   This is scope discipline and wording, cheap to do, expensive to get wrong.
6. **Most verdicts will be nulls.** That is the product's integrity and a
   churn risk. The framing must make a null verdict feel like the purchase
   it is: permission to stop buying a useless pill.

## What would make me reject it

- If the plan ships day-level randomization or a prep procedure that does not
  survive the "the user filled the capsules themselves" objection: the core
  claim would be false.
- If the verdict were LLM-generated narrative instead of a deterministic
  test: the one thing the product must do well would be vibes.
- If it drifted toward passive correlation tracking or physical fulfillment
  of capsule kits: the first is already free (Bearable), the second killed
  the 2015 precursor.
- If pre-registration were quietly editable after day one: the product's
  epistemics collapse and it becomes another tracker.

None of these are inherent to the idea; all are planning discipline. Proceed.
