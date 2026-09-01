# SPEC.md — Cadence

A single-user AI day planner. Built for one person. No sharing, no teams, no accounts.

This document is the complete specification. Claude Code should implement everything here — schema, backend, AI layer, and frontend — without asking the user to write code. The user will push the finished repo to GitHub and deploy it on Vercel.

---

## 0. How to use this document

Work in the phase order given in section 12. Each phase has acceptance criteria; do not start the next phase until the current one runs locally and passes them.

Where this spec gives an exact prompt, schema, or formula, use it verbatim rather than improvising. Where it gives a principle, apply judgment.

When something in this spec turns out to be wrong or impossible, say so and propose an alternative rather than silently working around it.

---

## 1. What the app is

The user types everything on their mind, in whatever form it comes out. The app turns that into a realistic time-blocked day, tells them honestly what will not fit, and learns over time how badly they underestimate their own work.

It replaces three things the user currently juggles: a task list, a calendar, and the gap between them where planning actually happens.

### The seven principles

These are load-bearing. Every design decision traces back to one of them.

1. **The database is the only source of truth.** No external task manager, no spreadsheets. Previous versions of this system failed because state lived in three places.
2. **The app is allowed to say no.** When work exceeds available hours, the surplus is returned in an explicit overflow list with a reason and a recommended action. The app never silently compresses blocks to make everything appear to fit.
3. **Every block carries a one-line reason.** "Overdue; protect focus time." This is what makes the output read as judgment rather than as a list. Never render a block without one.
4. **An estimate is a hypothesis, not a fact.** Actual durations are logged, per-category ratios accumulate, and future estimates are multiplied by the user's demonstrated bias — stated visibly on the affected block.
5. **Nothing writes to the user's calendar without confirmation.** Plans are drafts until explicitly committed.
6. **Trigger-based, never time-anchored.** No assumptions about "morning routine." Every mode can run at any hour, more than once a day.
7. **Buckets are dynamic.** Read from the database at runtime. Never hardcode a project name anywhere in a prompt, a type, or a seed.

### Non-goals

Do not build, and do not suggest building: multi-user support, sharing or collaboration, push notifications, drag-to-adjust scheduling, a native mobile app, pomodoro or focus timers, integrations beyond Google Calendar, or any analytics or telemetry.

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js (App Router), TypeScript, strict mode | Server Actions for mutations; Route Handlers for the capture webhook and cron |
| Styling | Tailwind CSS + shadcn/ui | See section 9 for the design system |
| Database | Postgres on Neon | Serverless driver, works on Vercel edge/node runtime |
| ORM | Drizzle + drizzle-kit migrations | Schema in `db/schema.ts`, migrations committed |
| AI | provider interface (`lib/ai/provider.ts`) with Gemini + Anthropic adapters, server-side only | Section 6; active provider Gemini via `@google/genai` |
| Validation | Zod | Both for AI structured output and for all form/action input |
| Dates | `date-fns` + `date-fns-tz` | Single timezone: `Asia/Kolkata`. Store UTC, render IST |
| Charts | Recharts | Review screen only |
| Deploy | Vercel | PWA manifest so it installs to the home screen |

The model API key must never reach the browser. All model calls happen in server actions or route handlers.

### Repo structure

```
/app
  /(app)/today/page.tsx
  /(app)/inbox/page.tsx
  /(app)/week/page.tsx
  /(app)/review/page.tsx
  /(app)/settings/page.tsx
  /login/page.tsx
  /api/capture/route.ts        # for the iOS Shortcut
  /api/calendar/callback/route.ts
  layout.tsx
/components
  /ribbon                      # the day ribbon — the signature component
  /chat                        # the persistent assistant rail
  /ui                          # shadcn primitives
/lib
  /ai
    client.ts                  # Anthropic client + a runStructured() helper
    schemas.ts                 # all Zod output schemas
    prompts/                   # one file per mode, prompts as exported consts
    modes/                     # compose.ts, capture.ts, rebalance.ts, week.ts, debrief.ts
  /calibration.ts
  /pressure.ts
  /calendar.ts                 # Google Calendar OAuth + sync
  /auth.ts
  /time.ts                     # IST helpers, work-window math
/db
  schema.ts
  index.ts
  seed.ts
/drizzle                       # generated migrations
```

---

## 3. Data model

All timestamps `timestamptz`, stored UTC. All durations in **minutes**, integer. All ids `uuid` with `gen_random_uuid()` default.

### `buckets`
Projects or life areas. The user creates and retires these freely.

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| name | text unique | e.g. lowercase slug style, user's choice |
| color | text | hex |
| active | boolean default true | retired buckets keep their history |
| priority_hint | text nullable | free text passed to the planner, e.g. "weekday priority" |
| weekly_target_min | integer nullable | intended hours per week, in minutes. Intent only — nothing schedules against it |
| outcome | text nullable | **the guiding star**: what "done" looks like, one sentence |
| outcome_target_date | date nullable | when the outcome is meant to be true by |
| status | enum | `active` | `achieved` | `abandoned` — set by hand, never inferred |
| breakdown_transcript | jsonb nullable | the breakdown dialogue that produced the outcome and targets |
| created_at | timestamptz | |

A bucket with no `outcome` is just a label and behaves exactly as it did before
the goal layer existed. The outcome is what lets the app answer "do my days add
up to what I am trying to achieve" — it is not a project, and there is
deliberately no place to put dependencies, sub-projects or a percent-complete
field.

### `tasks`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| title | text | |
| notes | text nullable | |
| bucket_id | uuid fk nullable | |
| category | enum | `deep` \| `shallow` \| `calls` \| `admin` \| `errand` \| `personal` |
| estimate_min | integer nullable | the user's or the model's raw estimate, uncalibrated |
| due_at | timestamptz nullable | |
| priority | enum | `low` \| `normal` \| `high` |
| status | enum | `inbox` \| `active` \| `done` \| `dropped` |
| parent_id | uuid fk nullable | self-reference for subtasks, one level only |
| defer_count | integer default 0 | incremented whenever a task is carried past its planned day |
| source | enum | `dump` \| `manual` \| `voice` \| `carryover` |
| created_at, completed_at | timestamptz | |

`inbox` means captured but not yet confirmed by the user. Only `active` tasks are eligible for planning.

`weekly_target_id` is optional and must stay that way. A task with no target
behaves exactly as it always has. If assigning a target were ever a
precondition for planning a task, capture would stop happening — which costs
more than the goal layer is worth.

`must_do_today` differs from `priority`: priority *ranks*, this *constrains*.
Compose runs a deterministic fit check before calling the model and refuses to
plan at all if the must-do set cannot fit, naming the tasks and the shortfall,
rather than quietly deferring one.

### `commitments`
Things that cannot move. Meetings, classes, appointments.

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| title | text | |
| start_at, end_at | timestamptz | |
| recurrence | text nullable | RRULE string, keep support minimal: daily/weekly-by-day |
| source | enum | `manual` \| `gcal` |
| gcal_event_id | text nullable | |

### `weekly_targets`
One week's slice of a bucket's outcome — the layer between "what I am trying to
achieve" and "what I did today". Deliberately thin.

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| bucket_id | uuid fk | cascade on delete |
| week_start | date | the IST Monday of the week this belongs to |
| description | text | what the target is, in a line |
| target_hours | numeric nullable | optional — a target can be a deliverable rather than an amount of time |
| status | enum | `planned` | `hit` | `missed` | `partial` | `dropped` |
| review_note | text nullable | one line written at review time about how it went |
| created_at | timestamptz | |

No dependencies, no nesting, no stored percent-complete: progress is derived
from the tasks that link to a target, so it cannot drift from the actual work.

### `habits`
Recurring things the user wants placed but that aren't tasks — gym, reading, a weekly call.

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| name | text | |
| cadence | text | e.g. `3x/week`, `daily`, `mon,wed,fri` |
| duration_min | integer | |
| preferred_window | text nullable | e.g. `06:00-08:00` or `evening` |
| bucket_id | uuid fk nullable | |
| active | boolean | |

### `plans`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| date | date | IST calendar date |
| status | enum | `draft` \| `committed` \| `superseded` |
| generated_at | timestamptz | |
| model | text | which model produced it |
| input_snapshot | jsonb | the exact payload sent to the model |
| output_snapshot | jsonb | the model's validated result (blocks, overflow, calibrationNote) |
| parent_plan_id | uuid nullable | set when this plan came from a rebalance |
| debriefed_at | timestamptz nullable | set once the day is closed out; blocks a second debrief |
| debrief_summary | text nullable | the two-line descriptive summary written at debrief |

`input_snapshot` matters: when a plan comes out wrong, the user needs to see what the model was actually given. Do not skip it.

At most one `committed` plan per date (enforced by a partial unique index). A rebalance `draft` (with `parent_plan_id` set) is allowed to coexist with its committed parent; "one `draft` per date" is enforced in code. Committing a plan sets every other live plan for that date to `superseded`.

### `blocks`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| plan_id | uuid fk | |
| task_id | uuid fk nullable | null for `fixed`, `habit`, `break` |
| habit_id | uuid fk nullable | |
| start_at, end_at | timestamptz | |
| kind | enum | `task` \| `fixed` \| `habit` \| `break` |
| title | text | denormalised so a plan renders without joins |
| category | enum | same set as tasks |
| reason | text | **required for every block.** One line, ≤ 90 chars |
| estimate_min | integer | calibrated estimate used when scheduling |
| raw_estimate_min | integer | pre-calibration, for the review screen |
| status | enum | `planned` \| `done` \| `partial` \| `skipped` |
| actual_min | integer nullable | filled at debrief |

### `overflow`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| plan_id | uuid fk | |
| task_id | uuid fk | |
| reason | text | why it didn't fit |
| action | enum | `defer` \| `shrink` \| `delegate` \| `drop` |
| suggestion | text | concrete, e.g. "move to Thursday morning — 3 free hours" |

### `time_log`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| date | date | |
| start_at, end_at | timestamptz | |
| duration_min | integer | |
| bucket_id | uuid fk nullable | |
| task_id | uuid fk nullable | |
| category | enum | |
| planned | boolean | false for unplanned work logged after the fact |
| note | text nullable | |

### `calibration`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| scope | enum | `category` \| `bucket` |
| key | text | the category name or bucket id |
| ratio | numeric(4,2) | actual ÷ estimate, exponentially weighted |
| sample_n | integer | |
| updated_at | timestamptz | |

Unique on `(scope, key)`.

### `day_profile`
Singleton row. Enforce with a `CHECK (id = 1)` integer primary key.

| Column | Type | Notes |
|---|---|---|
| id | integer pk = 1 | |
| work_windows | jsonb | per weekday: `{ mon: [["09:00","19:00"]], ... }` — array allows split days |
| sharp_hours | jsonb | per weekday, same shape; when the user thinks clearly |
| daily_cap_min | integer | hard ceiling on scheduled work, classes included |
| protected_blocks | jsonb | recurring non-negotiables: meals, family, sleep |
| min_block_min | integer default 30 | |
| max_block_min | integer default 150 | |
| break_min | integer default 15 | inserted between consecutive deep blocks |
| timezone | text default 'Asia/Kolkata' | |

### `chat_messages`
For the assistant rail. `id, role, content, tool_calls jsonb, created_at`. Keep the last 200; prune older on write.

---

## 4. Calibration

This is the feature that makes the app compound. Implement it exactly.

**Recording.** At debrief, for every **task** block (`kind = 'task'`) with `status IN ('done','partial')` and a non-null `actual_min`, compute `sample = actual_min / raw_estimate_min`. Discard samples where `raw_estimate_min < 15` (noise) or where `sample > 5` (the block was clearly abandoned or misused). Break, habit, and fixed blocks carry no user estimate and are not sampled.

**Updating.** Exponentially weighted, `alpha = 0.3`:

```
new_ratio = (alpha * sample) + ((1 - alpha) * old_ratio)
```

Seed `ratio = 1.0, sample_n = 0` on first sight of a scope key. Increment `sample_n` on every update.

Maintain both `category` and `bucket` scopes. Category is the primary signal; bucket is shown in the review screen but not applied to estimates.

**Applying.** When composing a plan:

```
if sample_n >= 3:
    calibrated = round(raw_estimate * clamp(ratio, 0.6, 2.5))
else:
    calibrated = raw_estimate
```

When `ratio >= 1.25` or `<= 0.8` and it materially changed a block, the model must say so in that block's `reason` — for example, "1h estimated, 1h25 scheduled: you run ~40% over on writing." This is the app's most persuasive moment. Do not hide it.

---

## 5. Deadline pressure

Powers the week screen. Compute server-side, deterministically — no model call needed for the arithmetic, only for the commentary.

1. Take all `active` tasks with `due_at` within the next 14 days. Compute `hours_needed` from the calibrated estimate, including subtasks.
2. Build the free-hours timeline from now to the furthest due date: for each day, the work windows from `day_profile`, minus fixed commitments, minus protected blocks, minus already-committed blocks from existing plans, minus a **15% friction buffer**.
3. Allocate free hours to deadlines **earliest-due-first**, consuming the pool as you go. This is the step that's easy to get wrong: without it, three tasks due Thursday each independently "have" the same 6 free hours, and the whole view lies.
4. Classify each deadline from `ratio = hours_available / hours_needed`:

| Ratio | Status |
|---|---|
| ≥ 1.5 | `safe` |
| ≥ 1.0 | `tight` |
| ≥ 0.6 | `at_risk` |
| < 0.6 | `impossible` |

Then send the computed table to the model for a short `weekNote` — two or three sentences naming the binding constraint and the single most useful move. The model comments on the numbers; it does not produce them.

---

## 6. AI layer

### Provider

The model provider is behind an interface (`lib/ai/provider.ts`) exposing a single
`runStructured({ role, system, messages, schema })`. Two adapters implement it —
Gemini and Anthropic — selected at runtime by the `LLM_PROVIDER` env var
(`gemini` | `anthropic`). The active provider is **Gemini**.

The API key never reaches the browser: all model calls happen in server actions
or route handlers.

### Models

Model IDs live in one file (`lib/ai/models.ts`) as named constants, keyed by
provider and by role (`compose` | `capture`), each overridable by an env var
(`GEMINI_COMPOSE_MODEL`, etc.) to ride out an outage without a code change.

| Role | Gemini (active) | Anthropic (alternate) |
|---|---|---|
| compose, rebalance, week commentary, chat rail | `gemini-3.7-flash` | `claude-sonnet-5` |
| capture parsing, classification, debrief summary | `gemini-3.5-flash-lite` | `claude-haiku-4-5-20251001` |

Gemini IDs verified against https://ai.google.dev/gemini-api/docs/models (Aug 2026);
Anthropic reference: https://docs.claude.com/en/docs/about-claude/models.

### Structured output

Every mode returns validated JSON. The schema is derived from the mode's Zod
schema and passed to the provider:

- **Gemini** — `responseMimeType: "application/json"` + `responseSchema` (the Zod
  JSON Schema, sanitised to Gemini's dialect).
- **Anthropic** — a single forced tool whose `input_schema` is the Zod JSON Schema.

The result is parsed with the same Zod schema. On a validation failure, retry
once with the validation error appended as a user message. On a second failure,
throw a typed `StructuredOutputError` the UI renders as "The planner returned
something I couldn't read — try again." Never render unvalidated model output.

`runStructured` signature:

```ts
runStructured<T>({ role, system, messages, schema, schemaName? }): Promise<T>
```

### Rate limits and transient errors

Separately from the Zod-validation retry above, the provider layer retries the
transport call on HTTP **429** (free-tier RPM) and transient **5xx** with
exponential backoff + jitter (429 gets the longer base delay). The Gemini free
tier is ~5 requests/minute on the compose model.

### 6.1 Compose — the core mode

**Input payload** (also stored as `input_snapshot`):

```jsonc
{
  "date": "2026-09-01",
  "now": "2026-09-01T04:30:00Z",
  "timezone": "Asia/Kolkata",
  "workWindows": [["09:00","13:00"],["14:00","20:00"]],
  "sharpHours": [["09:00","12:30"]],
  "dailyCapMin": 600,
  "minBlockMin": 30, "maxBlockMin": 150, "breakMin": 15,
  "protectedBlocks": [{"label":"lunch","start":"13:00","end":"14:00"}],
  "commitments": [{"title":"...","start":"10:00","end":"11:00"}],
  "habitsDue": [{"name":"gym","durationMin":60,"preferredWindow":"06:00-08:00"}],
  "tasks": [{
    "id":"...","title":"...","bucket":"...","category":"deep",
    "rawEstimateMin":90,"calibratedEstimateMin":126,
    "dueAt":"2026-09-03T12:00:00Z","priority":"high","deferCount":2
  }],
  "calibration": [{"category":"deep","ratio":1.4,"sampleN":11}]
}
```

**System prompt — use verbatim:**

```
You are a calm, realistic day planner. You plan one person's day. You are not a
cheerleader and not a productivity coach; you are the part of them that can count.

You will be given a working window, the hours in which they think most clearly,
fixed commitments, protected blocks, habits due today, and a list of tasks with
both a raw estimate and a calibrated estimate. Produce a time-blocked plan.

Rules, in priority order:

1. Never schedule outside the working windows. Never schedule over a fixed
   commitment or a protected block. These are absolute.
2. Use the calibrated estimate, not the raw one, when deciding what fits. The
   calibrated number already accounts for this person's demonstrated tendency to
   under- or over-estimate.
3. Place work in the category-appropriate hours. Cognitively heavy work
   (category "deep") belongs inside the sharp hours. Calls, admin and errands
   belong outside them. Never fragment a deep block below 45 minutes.
4. Cluster same-category tasks adjacently to reduce context switching.
5. Insert a break between two consecutive deep blocks.
6. Respect the daily cap. Time inside fixed commitments counts toward it.
7. Weigh deadline pressure, priority, and deferCount together. A task deferred
   three or more times is either genuinely important and being avoided, or it is
   not real — schedule it early in the day or say plainly in the overflow reason
   that it should be dropped.
8. Do not overfill. If the work exceeds the hours, put the surplus in `overflow`
   with an honest reason and a concrete recommended action. Never compress
   estimates to make everything appear to fit. A plan that is quietly impossible
   is worse than no plan.

Every block must have a `reason`: one line, at most 90 characters, in plain
language, explaining why that task is in that slot. Write reasons a person would
actually find useful — "Due tomorrow; needs your sharp hours" is useful,
"Scheduled for productivity" is not. Where a calibrated estimate differs from
the raw estimate by more than 20%, say so in the reason for that block.

Set `calibrationNote` to one sentence about how this person's history shaped
today's plan, or null if there is not enough history to say anything honest.

Be conservative. It is better to plan a day the person finishes than a day that
looks ambitious and breaks by noon.
```

**Output schema** (`lib/ai/schemas.ts`):

```ts
const block = z.object({
  taskId: z.string().nullable(),
  title: z.string(),
  start: z.string(),          // "HH:mm" IST
  end: z.string(),
  kind: z.enum(["task","fixed","habit","break"]),
  category: z.enum(["deep","shallow","calls","admin","errand","personal"]),
  estimateMin: z.number().int(),
  reason: z.string().max(90),
});

const overflowItem = z.object({
  taskId: z.string(),
  reason: z.string(),
  action: z.enum(["defer","shrink","delegate","drop"]),
  suggestion: z.string(),
});

export const planSchema = z.object({
  blocks: z.array(block),
  overflow: z.array(overflowItem),
  calibrationNote: z.string().nullable(),
});
```

**Post-validation checks — run these in code, not in the prompt.** Models drift on arithmetic. After parsing, verify: no block overlaps another; no block falls outside a work window; no block collides with a commitment or protected block; total scheduled minutes ≤ `dailyCapMin`; every referenced `taskId` exists and was in the input. On failure, retry once with the specific violations listed. On a second failure, surface the plan to the user with the violations flagged rather than discarding it.

### 6.2 Capture

Input: raw text. Output: an array of parsed tasks plus optional clarifying questions.

The prompt should: split the dump into discrete concrete tasks, merge obvious duplicates against the existing active task list (pass the titles in), infer bucket from the existing bucket list only (never invent a bucket — return `null` and let the user assign), infer category, infer a due date from natural language relative to today, and give a first-pass estimate.

Coaching depth differs by input shape. A concrete task ("call the mill about sampling") gets captured with no questions. A goal ("get the Raahat pilot moving") gets one to three probing questions before anything is written — what does done look like, by when, what is the first physical action. Return questions in `clarifications`; do not write to the database until the user answers or explicitly skips.

Everything lands with `status = 'inbox'`. The user confirms from the inbox screen.

```ts
export const captureSchema = z.object({
  tasks: z.array(z.object({
    title: z.string(),
    notes: z.string().nullable(),
    bucketName: z.string().nullable(),
    category: z.enum(["deep","shallow","calls","admin","errand","personal"]),
    estimateMin: z.number().int().nullable(),
    dueAt: z.string().nullable(),     // ISO
    priority: z.enum(["low","normal","high"]),
    possibleDuplicateOf: z.string().nullable(),
  })),
  clarifications: z.array(z.string()),
});
```

### 6.3 Rebalance

Runs mid-day. Input: the committed plan with each block's current status, the current time, a free-text account of what happened, and an energy level (`sharp` / `ok` / `fried`).

Rules: never move or delete a block already marked `done` or `partial` — carry them into the new plan unchanged. Only the remaining hours are replannable. Tier the unfinished work into must / should / could and be explicit about which tier gets dropped. When energy is `fried`, do not schedule any `deep` block; say so in `calibrationNote`. Use shorter blocks than compose — cap at 90 minutes.

Output: the same `planSchema`. Write a new `plans` row with `parent_plan_id` set and supersede the old one on commit.

### 6.4 Debrief

Mostly not a model call. The UI presents the day's blocks pre-filled with their planned durations; the user taps done, adjusts a number, or marks skipped. Anything left untouched at submit defaults to `status='done', actual_min=estimate_min`.

**This must take under sixty seconds.** It is the habit the whole system depends on, and it is the one most likely to be abandoned. Optimise the interaction ruthlessly: one screen, large tap targets, no scrolling on a normal day, a single submit.

On submit: write `time_log` rows, update `calibration`, mark unfinished tasks for carry-over with `defer_count + 1`, then one cheap Haiku call for a two-line descriptive summary. Descriptive only — no advice, no encouragement, no moralising. "Six hours logged. Deep work ran 35 minutes over across two blocks. The E-Cell call didn't happen."

### 6.5 Week

Deterministic pressure table from section 5, then a model call for `weekNote` and per-deadline one-liners. Also produces the weekly review numbers: hours per bucket, accuracy trend, defer leaderboard. Strictly descriptive.

### 6.6 Chat rail

A persistent conversation pane on every screen, with tools:

`create_task`, `update_task`, `list_tasks`, `trigger_compose`, `trigger_rebalance`, `query_time_log`, `get_pressure`.

Everything the user could do by clicking, they can do by typing. Writes that create or modify tasks execute directly; anything that commits a plan or writes to the calendar returns a confirmation card the user must accept. History persists in `chat_messages`; load the last 30 into context.

---

## 7. Google Calendar

OAuth 2.0, offline access, refresh token stored encrypted in a `settings` table.

**Read:** pull events from the user's primary calendar for the planning horizon into `commitments` with `source='gcal'`. Sync on demand and via a Vercel cron every 30 minutes.

**Write:** on plan commit, write blocks to a **separate dedicated calendar** named "Cadence" that the app creates on first connect. Never write to the primary calendar — the user must be able to toggle the whole layer off in one click. Store `gcal_event_id` on each block. On supersede, delete the old events.

Keep `.ics` export of a single day as a fallback for when OAuth is not connected.

---

## 8. Auth

One user. A single passphrase in `APP_PASSPHRASE`, compared with a timing-safe comparison, setting an httpOnly signed cookie valid for 30 days. Middleware protects everything except `/login` and `/api/capture`.

`/api/capture` authenticates with a separate bearer token in `CAPTURE_TOKEN`, so an iOS Shortcut can POST dictated text without a session.

Do not add OAuth providers, user tables, or role logic.

---

## 9. Design

### Direction

This is an instrument, not a productivity product. The reference point is a flight strip or a hospital chart: dense, legible at a glance, numeric, unemotional. It should feel like something that tells the truth. Avoid the warm-cream-and-serif look, avoid dark-mode-with-a-neon-accent, avoid gradients entirely.

Restraint everywhere except the ribbon.

### Tokens

```
--paper:     #F7F7F4   page background
--surface:   #FFFFFF   cards, blocks
--ink:       #16191C   primary text
--ink-muted: #6B7178   secondary text, reasons
--rule:      #D8D8D0   hairlines, 1px, used liberally
--sharp:     #DDE5EA   the sharp-hours band on the ribbon
--signal:    #8C1D18   overflow, impossible, over-cap warnings
--caution:   #A67C00   at_risk, tight
--settled:   #2F5D50   done, safe
```

Type: **IBM Plex Sans** for UI, **IBM Plex Mono** for every time, duration and number (tabular figures are the point — columns of times must align), **Newsreader** for exactly two things: block reason lines and the overflow section heading. That contrast — mono for the machine's arithmetic, a book face for its judgment — is the typographic idea. Do not use Newsreader anywhere else.

No border radius above 4px. No shadows. Separation comes from hairlines and whitespace.

### The signature component: the day ribbon

A continuous vertical band representing the working window, where **block height is strictly proportional to duration**. A 30-minute block is visibly a third of a 90-minute block. This is the whole point: the user must be able to see that their day is full.

- The sharp-hours range is shaded `--sharp` behind the blocks.
- A 1px `--ink` hairline marks the current time, with the time in mono in the left gutter. It moves.
- Time gutter on the left, mono, hour marks only.
- Fixed commitments render with a hatched fill so they're visually distinct from plannable work.
- Each block: title in Plex Sans, duration in mono, reason in Newsreader at a smaller size in `--ink-muted`.
- Below the ribbon, if overflow exists: a hairline rule, then the heading **"This doesn't fit today"** in Newsreader, then each item with its reason and recommended action.

Do not let the ribbon collapse to a plain list on mobile. Narrow the gutter, drop the reason lines to a tap-to-expand, but keep proportionality.

### Copy

Sentence case throughout. Active voice. Buttons name what happens: "Commit plan," not "Submit." Empty states direct rather than apologise: an empty inbox says "Nothing waiting. Type a brain dump to get started," not "No tasks found."

Accessibility floor: responsive to 380px, visible keyboard focus, `prefers-reduced-motion` respected, colour never the sole carrier of meaning — pair every status colour with a label or icon.

---

## 10. Screens

**Today** — the ribbon, the overflow drawer, and per-block controls (done / took longer / skipped). A "Plan my day" button when no plan exists, "Rebalance" when one does and the current time is inside the window. Shows `calibrationNote` above the ribbon.

**Inbox** — unconfirmed captures at the top with one-tap confirm, then the full active task list, filterable by bucket and sortable by due date. A brain-dump textarea pinned at the top. Inline edit of estimate, bucket, category, due date.

**Week** — seven columns, each deadline rendered as a bar showing hours needed against hours available, coloured by status and labelled. The `weekNote` above.

**Review** — accuracy ratio over time trending toward 1.0 (the single most motivating chart in the app), hours per bucket for the last 7 and 30 days, per-category calibration ratios with sample counts, and the defer leaderboard: tasks pushed most often.

**Settings** — day profile editor (work windows, sharp hours, cap, protected blocks), bucket CRUD, habit CRUD, Google Calendar connect/disconnect, capture token display.

**Chat rail** — collapsible right panel on desktop, bottom sheet on mobile. Present on every screen.

---

## 11. Environment

```
DATABASE_URL=
LLM_PROVIDER=            # "gemini" (active) | "anthropic"
GEMINI_API_KEY=         # when LLM_PROVIDER=gemini
ANTHROPIC_API_KEY=      # when LLM_PROVIDER=anthropic
# optional per-role model pins: GEMINI_COMPOSE_MODEL, GEMINI_CAPTURE_MODEL,
#   ANTHROPIC_COMPOSE_MODEL, ANTHROPIC_CAPTURE_MODEL
APP_PASSPHRASE=
SESSION_SECRET=
CAPTURE_TOKEN=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
ENCRYPTION_KEY=          # for the stored refresh token
```

Include `.env.example` with every key and a one-line comment. Include a `README.md` covering: Neon setup, running migrations, Google Cloud console steps for the OAuth client, Vercel env var configuration, and the redirect URI that must be registered for both local and production.

---

## 12. Build phases

Each phase must run locally and pass its criteria before the next begins.

**Phase 1 — Foundation, no AI.**
Schema, migrations, seed script, auth, task and bucket CRUD, day profile editor, inbox screen.
*Done when:* the user can add and edit tasks and buckets by hand, set their work windows and sharp hours, and log in and out. No model calls exist yet.

**Phase 2 — Compose and the ribbon.**
The compose mode, plan and block persistence, the Today screen, the post-validation checks, plan commit.
*Done when:* a brain of active tasks produces a valid plan with reasons on every block, overflow renders when the day is overfull, and the ribbon is proportional with a live now-marker.

**Phase 3 — Debrief and calibration.**
The debrief screen, time log writes, the calibration update, carry-over with defer counting.
*Done when:* logging actuals changes the estimates in the next day's plan, and the change is visible in a block's reason line.

> Phase 3 is where this class of app usually dies and where all the compounding value is. Do not skip ahead to the week view. If the user is still logging actuals three weeks after this phase ships, the rest is worth building.

**Phase 4 — Rebalance and chat rail.**
Rebalance mode with completed-block preservation, the persistent assistant with its tools, capture mode.
*Done when:* a mid-day replan preserves everything already done, and every action available by clicking is also available by typing.

**Phase 5 — Week and review.**
The pressure algorithm with earliest-due-first allocation, the week screen, the review charts.
*Done when:* the pressure view does not double-count free hours across competing deadlines.

**Phase 6 — Calendar, PWA, capture endpoint.**
Google Calendar two-way sync, `.ics` export, PWA manifest and icons, `/api/capture` for the iOS Shortcut.
*Done when:* the app installs to the home screen and dictated text creates inbox tasks.

---

## 13. Notes for the implementer

Write the seed script to create three or four generically-named buckets, a realistic day profile, and about fifteen tasks spread across categories and due dates, so Phase 2 can be tested without hand-entry. Never seed a real project name — buckets are the user's to define.

Every model call should log its latency and token usage to the console in development. Compose takes roughly ten to fifteen seconds; the UI must show a real progress state, not a spinner with no text.

Handle the empty case everywhere. No tasks, no plan, no calibration history, no calendar connected — each has a defined empty state in this spec or needs one written.

The timezone is the most likely source of silent bugs. Store UTC, convert once at the render boundary, and write a small set of unit tests for the work-window math across a DST-free zone before building on top of it.
