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
and per-block logging, debrief with calibration, the deadline
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

`maxDuration = 300` lives on **page segments** (`/today`,
`/inbox`, `/goals`) and on the `(app)` layout — Server Actions inherit the
timeout from the page they are invoked from, not from the file they live in, and
the chat rail sits in that layout so it can fire compose from anywhere.

Nothing is deployed yet at time of writing; the app runs locally against the
real Neon database, and migrations `0000`–`0010` are applied there.

---

## Decisions, and why

These were all made deliberately. Please do not silently reverse them.

### Overflow is actionable, and the assistant is how

An overflow row says "there was no room today" and recommends an action. That
recommendation was rendered as a dark pill at a 38px tap target and was a `<p>`
— it looked exactly like a button and did nothing at all. It is a real button
now, and tapping it opens the assistant with the instruction already written.

`schedule_task` is what carries it out: it puts an existing task on a chosen
day's plan, moving the block if one is already there, and clears the matching
overflow row — a task is a block OR an overflow row, never both.

The action word (MOVE / DROP / …) is styled as a label rather than a pill,
because it describes what the planner recommends and cannot be tapped.

`get_plan` now returns overflow WITH task titles. Without them the assistant
could see that something had overflowed but not what, so it could not act on it.

### The assistant is the app; the two chat windows are one

There used to be two sheets — a capture sheet on the tab bar's + and a chat
sheet on the "Ask Cadence" handle — which meant deciding, before typing, which
kind of thing you were about to say. That is friction paid on every entry.

They are now one conversation with 27 tools covering the whole app. The + opens
it already in brain-dump mode; the handle opens it normally. A "Brain dump"
toggle in the composer marks a message explicitly, and the assistant also
recognises an unmarked dump on its own — verified on the WEAKEST configured
model, which routed "ok brain's full — chase the vendor quote, renew the car
insurance…" to capture rather than acting on it.

The toggle exists as well as the judgement because the two failure directions
are not symmetric: an instruction misread as a dump costs a rejected card, while
a dump misread as instructions starts editing the day.

Capture still never writes. It proposes into a review card inside the chat, with
keep/discard per task, and only what survives is saved (SPEC 6.2). Committing,
discarding and closing the day all return confirmation cards too — closing
because it is final.

The rail runs on its own `chat` model role so its model can be tuned without
touching compose. It is `claude-haiku-4-5`: it was briefly on claude-opus-5, on
the reasoning that routing ~28 tools and telling a dump from an instruction is
the hardest judgement in the app — which it is, but this fires on EVERY message
and the cost per query did not justify it.

The evidence says a small model copes: every routing case was verified on
gemini-3.5-flash-lite, the weakest model configured anywhere here, including an
unmarked brain dump correctly recognised as a dump. Pin it back with
`ANTHROPIC_CHAT_MODEL=claude-opus-5` if quality slips.

Two things stay outside: the day profile and the timetable PDF import. The
prompt tells the assistant to send you to Settings rather than improvise.

### Rebalance was cut; the assistant rail replans instead

There is no rebalance button, screen or mode. It was a second way to do what the
chat rail and drag-to-move already did, and it carried real machinery to do it:
its own model call and prompt, its own validation pass, `plans.parent_plan_id`,
preserved-block copying, and a carry-forward rule for the parent's overflow so
the handover did not lose work.

A committed day is edited IN PLACE — that was already the rule for drag and for
assistant edits. Rebalance was the one path that instead built a new plan and
superseded the old one, which is where all that machinery came from.

The rail now does the job: `get_plan` reads the day, then `adjust_block` moves,
resizes or drops one block at a time. `get_plan` is the new capability that made
this possible — before it, the assistant could adjust a block by title but could
not see what was on the day, which is precisely why replanning needed a mode of
its own. Its loop was widened from 5 tool steps to 9, and from 6 outbound calls
to 11, because a replan is several adjustments plus the reply.

What rebalance protected is now in the rail's prompt: a `done` or `partial`
block is a record and is never moved, nothing is placed before the current time,
moving beats dropping, and a drop still returns a confirmation card.

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
departure from "committed is immutable; a new plan supersedes". The user chose
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
the rebalance handover ignored its parent's overflow, and `validatePlan` never checked
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
- **The Today page audits plan accounting against each plan's own
  `input_snapshot`**, so it can only catch what that snapshot recorded.
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
