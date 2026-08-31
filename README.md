# Cadence

A single-user AI day planner. Full specification in [SPEC.md](./SPEC.md).

Stack: Next.js 16 (App Router, TypeScript strict) · Tailwind CSS v4 · Postgres on
Neon · Drizzle ORM + drizzle-kit · Zod · date-fns.

---

## Build status

| Phase | Scope | State |
|---|---|---|
| **1 — Foundation** | Schema, migrations, seed, auth, task/bucket CRUD, day-profile editor, inbox | **done** |
| 2 — Compose & ribbon | The planner, Today screen, plan commit | not started |
| 3 — Debrief & calibration | Actuals logging, calibration, carry-over | not started |
| 4 — Rebalance & chat rail | Mid-day replan, assistant, capture | not started |
| 5 — Week & review | Deadline pressure, charts | not started |
| 6 — Calendar, PWA, capture endpoint | Google Calendar sync, iOS shortcut | not started |

No model calls exist yet. `ANTHROPIC_API_KEY` and the Google / capture variables
are placeholders until their phases.

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
npm run db:seed            # only runs if the DB is empty
npm run db:seed -- --force # wipe buckets / tasks / habits first, then reseed
```

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
