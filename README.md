# Cadence

A single-user AI day planner. Full specification in [SPEC.md](./SPEC.md).

Stack: Next.js 16 (App Router, TypeScript strict) · Tailwind CSS v4 · Postgres on
Neon · Drizzle ORM + drizzle-kit · Zod · date-fns · Gemini (`@google/genai`) with
an Anthropic adapter behind the same interface.

---

## Build status

| Phase | Scope | State |
|---|---|---|
| **1 — Foundation** | Schema, migrations, seed, auth, task/bucket CRUD, day-profile editor, inbox | **done** |
| **2 — Compose & ribbon** | Provider interface, compose mode, post-validation, plan/block persistence, Today ribbon, commit | **done** |
| 3 — Debrief & calibration | Actuals logging, calibration, carry-over | not started |
| 4 — Rebalance & chat rail | Mid-day replan, assistant, capture | not started |
| 5 — Week & review | Deadline pressure, charts | not started |
| 6 — Calendar, PWA, capture endpoint | Google Calendar sync, iOS shortcut | not started |

Phase 2 needs `LLM_PROVIDER` + `GEMINI_API_KEY` (see `.env.example`). The Google
Calendar and capture variables are still placeholders until Phase 6.

### Model notes

- Provider is chosen by `LLM_PROVIDER` (`gemini` active). Model IDs are in
  [`lib/ai/models.ts`](lib/ai/models.ts); each can be pinned via an env var
  (`GEMINI_COMPOSE_MODEL`, …) to ride out an outage.
- Default compose model is `gemini-3.7-flash`. If it returns HTTP 503
  ("high demand"), pin `GEMINI_COMPOSE_MODEL=gemini-3.6-flash` until it recovers.
- `node --conditions=react-server --import tsx scripts/try-compose.ts` dry-runs a
  compose against the real DB + model without writing anything.

---

## Local setup

### 1. Prerequisites

- Node.js 20+ (developed on 24)
- A Neon Postgres database (or any Postgres 15+ with the `pgcrypto`/`gen_random_uuid` function available — Neon has it built in)

### 2. Environment

Copy the template and fill it in:

```bash
cp .env.example .env.local
```

Phase 1 needs three values:

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Neon connection string. Use the **pooled** one (host contains `-pooler`). Keep `?sslmode=require`. |
| `APP_PASSPHRASE` | The single phrase that unlocks the app. Choose anything memorable. |
| `SESSION_SECRET` | Random string used to sign the login cookie. Generate one with: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |

`.env.local` is gitignored and must never be committed.

### 3. Install

```bash
npm install
```

### 4. Create the database tables

Migrations are committed in [`drizzle/`](./drizzle). Apply them to the database in
`DATABASE_URL`:

```bash
npm run db:migrate
```

Verify it worked:

```bash
npx tsx scripts/check-db.ts
```

Expected: 11 tables (`buckets`, `tasks`, `commitments`, `habits`, `plans`,
`blocks`, `overflow`, `time_log`, `calibration`, `day_profile`, `chat_messages`),
10 enum types, and the partial unique index on `plans`.

### 5. Seed sample data (optional)

Fills empty tables with four generically-named buckets, a realistic day profile,
two habits, and fifteen tasks spread across categories and due dates:

```bash
npm run db:seed            # only runs on an empty database
npm run db:seed -- --force # wipe + reseed — shows exactly what it will delete
                           # and waits for you to type "yes" in a real terminal
```

The seed records the ids it creates (`seed_runs` table). Without `--force` it
**refuses** if the database holds any task it did not create itself, so it can
never silently clobber data you entered. `--force` prints the full deletion list
(flagging anything not from a seed run) and only proceeds on interactive
confirmation — it aborts if stdin is not a TTY.

### 6. Run

```bash
npm run dev
```

Open <http://localhost:3000>. You will be redirected to `/login`; enter your
`APP_PASSPHRASE`. The session cookie lasts 30 days.

---

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (also full typecheck) |
| `npm test` | Unit tests for `lib/time.ts` (timezone + work-window math) |
| `npm run db:generate` | Turn `db/schema.ts` changes into a new SQL migration |
| `npm run db:migrate` | Apply pending migrations to `DATABASE_URL` |
| `npm run db:push` | Push schema straight to the DB without a migration file (dev only) |
| `npm run db:studio` | Browse the database in Drizzle Studio |
| `npm run db:seed` | Seed sample data (see above) |
| `npx tsx scripts/check-db.ts` | Read-only check that the schema is live |
| `node --conditions=react-server --import tsx scripts/try-compose.ts` | Dry-run compose against the real DB + model (no writes) |

---

## Project layout

```
app/
  (app)/            authenticated screens: today, inbox, week, review, settings
  login/            passphrase screen + action
  layout.tsx        fonts + design tokens
components/         UI, per-screen client components
db/
  schema.ts         every table (SPEC section 3)
  index.ts          the shared Drizzle client (Neon serverless driver)
  seed.ts           sample data
lib/
  auth.ts           session cookie + requireAuth()
  session.ts        pure token sign/verify (imported by proxy.ts)
  time.ts           IST helpers + work-window interval math  (+ time.test.ts)
  schemas.ts        Zod schemas for all form / action input
  day-profile.ts    read/seed the singleton day_profile row
drizzle/            generated, committed migrations
proxy.ts            request gate (Next.js 16's renamed "middleware")
```

---

## Deploying (later)

Deployment to Vercel, the Google Cloud OAuth client setup, and the production
redirect URI are documented when Phase 6 lands. For now: set the same three
environment variables in the Vercel project, and run `npm run db:migrate`
against the production database once.
