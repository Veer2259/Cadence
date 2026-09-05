# CONTEXT.md — where this project stands

Orientation for someone (or some session) picking this up cold. `SPEC.md` is the
design document and is authoritative for *what the app is*. This file covers
*where it actually is*, what was decided along the way, and why.

Last updated: 2026-09-02.

---

## What this is

Cadence — a single-user AI day planner. One person, one passphrase, no accounts.
Next.js 16 (App Router, Turbopack) on Vercel, Postgres on Neon, Gemini for the
model calls. Everything is IST (`Asia/Kolkata`): stored UTC, rendered IST,
converted in exactly one place (`lib/time.ts`).

The core loop: capture tasks → compose a time-blocked day → work it, logging as
you go → debrief → calibration and focus scores improve the next plan.

---

## Current state

**Phases 1–7 complete (see SPEC §12).**

Working end to end: auth, inbox and capture, compose, the day ribbon with drag
and per-block logging, rebalance, debrief with calibration, the deadline
pressure week view, review charts, the assistant rail with routing, the goal
layer, breakdown and weekly kickoff, learned focus hours, and the PWA manifest.

**Cut, not deferred:** Google Calendar sync, `.ics` export and `/api/capture`.
See SPEC §7 for why — sync puts state in two places, which is what killed the
predecessor system. Their env vars are gone from `.env.example`.

**Not built, deliberately:** the adaptive weekly-reflection *analysis*. The
capture for it is in place; only the analysis is missing, and it is waiting on
weeks of real data rather than on code.

Quality gates, all passing: `npx tsc --noEmit`, `npm run lint`, `npm test`
(116 tests), `npm run build`.

---

## Deployment

`DEPLOY.md` is the checklist. The three things that actually bite:

1. **The build does not run migrations.** Run `npm run db:migrate` against the
   production `DATABASE_URL` or every screen 500s with `relation ... does not
   exist`. There are 11 migrations (`0000`–`0010`).
2. **Fluid compute must be ON** in Vercel. Without it `maxDuration` caps at 60s
   and a slow compose — they have taken ~2.5 minutes under load — is killed.
3. **`SESSION_SECRET` needs ≥16 characters**, enforced at runtime in
   `lib/session.ts`, so a short one fails as a mystery 500 rather than a build
   error.

`maxDuration = 300` lives on **page segments** (`/today`, `/rebalance`,
`/inbox`, `/goals`) and on the `(app)` layout — Server Actions inherit the
timeout from the page they are invoked from, not from the file they live in, and
the chat rail sits in that layout so it can fire compose from anywhere.

Nothing is deployed yet at time of writing; the app runs locally against the
real Neon database, and migrations `0000`–`0010` are applied there.

---

## Decisions, and why

These were all made deliberately. Please do not silently reverse them.

### The app carries three categories, not six, and no task priority

`calls`, `errand` and `personal` were choices paid for at task entry — on every
task, every day — and they bought nothing the planner used. They split the
calibration history into thinner slices without changing where anything went.
Categories are now `deep | shallow | admin`.

`tasks.priority` is gone for the same reason. Importance is carried by `due_at`,
`must_do_today`, `defer_count` and the day's bucket emphasis, all of which are
either facts or a single deliberate act — where priority was a third field to
set on every capture and a fourth signal for the planner to weigh against them.

Also removed in that pass: subtasks (`tasks.parent_id` — hierarchy lives in
goal → weekly target → task now), `buckets.priority_hint` (superseded by daily
bucket emphasis), `buckets.weekly_target_min` (`weekly_targets.target_hours`
covers it per week and properly), and bucket-scope calibration, which was
written on every debrief and read by nothing.

All of it was one deletion pass with a fresh baseline migration; there is no
migration history before `0000` because every earlier row was discarded.

### Sharp hours were removed and replaced by learned focus hours

Declaring "when I think clearly" is a guess, and the guess actively broke
scheduling. Declared sharp hours of 09:00–12:30 against work windows of
11:00–13:00 and 17:00–23:59 left only **90 usable minutes** for **180 minutes**
of deep work, so compose deferred a task while **235 minutes of the day sat
free**. The payload was correct; the model was obeying "deep work belongs inside
the sharp hours" as if it were a hard constraint.

`day_profile.sharp_hours` is dropped (migration `0010`). `focus_scores` holds
one row per hour, recomputed at debrief from deep-category blocks: how close
actual came to estimate (only **overrun** is punished — finishing early says
nothing bad about a slot) multiplied by `1 − skipRate` (so an always-skipped
hour scores 0 regardless). Three samples minimum, mirroring calibration.

**The cold start is honest and must stay that way.** No history means *no*
focus hours, `focusHoursKnown: false`, and an instruction not to assume mornings
or any other default. A morning fallback is precisely the guess being removed.
Nothing was migrated from the old declared values — that would have imported the
bias.

### Drag does not cascade

Moving or resizing a block leaves every other block where it is. Conflicts are
reported in a non-blocking panel and the move is always kept. A visible conflict
beats a silent cascade, and it matches how the rest of the app behaves:
`validatePlan` flags, it never rewrites.

### Committed plans are edited in place

A manual drag or an assistant edit on a committed plan mutates its block rows
directly — no new draft, no supersede, no model call. This is a deliberate
departure from "committed is immutable; rebalance supersedes". The user chose
lightweight direct manipulation over a commit cycle for every nudge. Calibration
is unaffected because it reads `actual_min` at debrief.

### Every task that leaves a plan leaves a trace

A task once vanished with no block, no overflow row and nothing in the UI. With
twenty tasks in flight that is invisible, and trust in the plan is the entire
product.

`lib/plan-invariant.ts` states the rule: a task in a plan's input is either a
block or an overflow row with a reason, never neither. `saveDraftPlan` asserts
it **inside its transaction**, so a plan that would lose a task is rolled back
rather than saved. Three loss paths were closed: `dropPlanBlock` wrote nothing,
rebalance ignored the parent's overflow, and `validatePlan` never checked
coverage at all.

If you add a new path that removes a block, it must write an overflow row.

### Other standing decisions

- **`must_do_today` constrains; `priority` ranks.** Compose runs a
  deterministic fit check *before* spending a model call and refuses to plan at
  all if the must-do set cannot fit, naming the tasks and the exact shortfall.
- **Model ids are verified, never guessed.** `instrumentation.ts` checks every
  configured id against Gemini ListModels at boot. This exists because an
  invented `gemini-3.7-pro` shipped and 404'd inside breakdown.
- **Breakdown and weekly kickoff never write.** They propose into a review list
  the person confirms or edits.
- **Goal progress is descriptive, never prescriptive.** Report the gap with real
  numbers; never tell the person to try harder.
- **The task → weekly target link is optional and must stay optional.** If
  assigning a target ever became a precondition for planning a task, capture
  would stop happening.
- **Status controls are not hover-based.** They live on blocks tall enough to
  hold them, with a click-pinned menu for slivers. Hover does not exist on
  touch, and the app is used on a phone.

---

## Known limitations

- **Anthropic is now the active provider.** `LLM_PROVIDER=anthropic`, because
  the Gemini free tier caps at ~20 requests/DAY on the Flash models, which is
  too tight to plan a day with. The Gemini adapter is unchanged and still
  selectable by flipping that one env var.
- **The Anthropic model ids have NOT been checked against a live key.** There
  was no `ANTHROPIC_API_KEY` available when they were written. The boot check
  now covers both providers (`GET /v1/models` for Anthropic), so the `[models]`
  line on the first deploy is what confirms them. Read it. Defaults are
  compose=`claude-sonnet-5`, capture=`claude-haiku-4-5`, reason=`claude-sonnet-5`.
  The capture id previously carried a `-20251001` date suffix, which is not a
  valid model string and would have 404'd on first use.
- **Anthropic rate limits are RPM / TPM / TPD**, not requests-per-day. A 429
  carries `retry-after`. `dailyQuotaResetHint()` deliberately does NOT claim a
  Pacific-midnight reset on that provider — that clock is Gemini's.
- **529 `overloaded_error` is Anthropic-specific** and was previously classified
  as non-retryable, so it was thrown rather than backed off. Now treated as
  transient.
- **Gemini free tier is ~20 requests/day** on 3.6/3.7 Flash, 500/day on 3.5
  Flash Lite — relevant only if you switch back. A clean compose is 1 call, 3 at
  worst (hard-capped). The app surfaces daily-quota exhaustion distinctly from
  per-minute rate limiting.
- **Focus scores have no real data yet.** There are no debriefed days with deep
  blocks, so the scoring is proven by unit tests and the cold-start path, not by
  live scores. First real numbers appear after a few debriefs.
- **The rebalance overflow carry-forward is unit-tested, not live-tested** —
  exercising it end to end costs a model call.
- **The Today page audits plan accounting against each plan's own
  `input_snapshot`**, so it can only catch what that snapshot recorded. The
  rebalance carry-forward is what closes the remaining gap.
- **Anyone with the URL and the passphrase is in.** One user, one secret, by
  design (SPEC §8).

---

## Where the important logic lives

Pure, unit-tested modules — start here, they encode the rules:

| File | What it decides |
|---|---|
| `lib/time.ts` | all IST conversion and interval maths |
| `lib/plan-geometry.ts` | the five positional checks on a day's blocks |
| `lib/plan-invariant.ts` | every task leaves a trace |
| `lib/must-do.ts` | whether the must-do set genuinely fits |
| `lib/focus.ts` | learned focus scoring, and the cold start |
| `lib/goal-pressure.ts` | how far behind a weekly target is |
| `lib/pressure-alloc.ts` | earliest-due-first, no double-counting |
| `lib/calibration.ts` | the EWMA estimate correction |
| `lib/habits.ts` | cadence parsing and weekday distribution |

Server-side orchestration: `lib/plan.ts` (persistence and the invariant),
`lib/debrief.ts` (the one transaction that closes a day), `lib/ai/modes/*` (one
file per mode), `lib/ai/validate.ts` (the checks that actually hold — the prompt
is advisory, this is not).

---

## What's next

Nothing is in progress. Reasonable next steps, roughly in order of value:

1. **Deploy and use it.** Everything below depends on real data, and the
   adaptive layer depends on weeks of it.
2. **Set a bucket outcome and run breakdown.** It has never been exercised
   against a real goal with real capacity evidence.
3. **The adaptive weekly reflection.** The capture is in place
   (`time_log.planned_start_at`, `raw_estimate_min`, `energy_level`, `kind`;
   `blocks.logged_at`); only the analysis is missing. Deliberately deferred
   until there is history to analyse.
4. **Render the emphasis-honesty line** on Week or Review. The module and its
   tests are in (`lib/emphasis-honesty.ts`); the query and the panel are not.
5. **Visual design.** Being taken to Claude Design separately; structural work
   here has avoided cosmetic changes on purpose.
