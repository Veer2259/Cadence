# Deploying Cadence to Vercel

Single-user app, Postgres on Neon, Gemini for the model calls. No Google
Calendar sync — that is Phase 6 and is not built.

---

## 1. Environment variables

Paste these into **Vercel → Project → Settings → Environment Variables**, for
**Production, Preview and Development**.

### Required — the app will not start without these

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | your Neon connection string | Use the **pooled** connection (`-pooler` in the host). Must include `?sslmode=require`. |
| `APP_PASSPHRASE` | the passphrase you type to unlock | The only auth. Choose a real one before going public — anyone with the URL and this string is in. |
| `SESSION_SECRET` | a long random string | **Minimum 16 characters**, enforced in `lib/session.ts`. Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `GEMINI_API_KEY` | your Google AI Studio key | Required while `LLM_PROVIDER=gemini`. |

### Recommended

| Variable | Value | Notes |
|---|---|---|
| `LLM_PROVIDER` | `gemini` | Defaults to `gemini` if unset. The only other value is `anthropic`. |

### Optional

| Variable | When you need it |
|---|---|
| `ANTHROPIC_API_KEY` | Only if you set `LLM_PROVIDER=anthropic`. |
| `GEMINI_COMPOSE_MODEL` | Pin the daily planner to a specific model. Currently pinned to `gemini-3.5-flash-lite` locally to protect quota — **for real use set `gemini-3.7-flash` or leave unset.** |
| `GEMINI_CAPTURE_MODEL` | Pin the lightweight model. |
| `GEMINI_REASON_MODEL` | Pin the breakdown model. |

Anything in `.env.example` that is not listed above (`CAPTURE_TOKEN`,
`GOOGLE_*`, `ENCRYPTION_KEY`) belongs to unbuilt Phase 6 work. **Do not set
them** — no code reads them.

> Do not paste `.env.local` itself. It is gitignored and stays local.

---

## 2. Fluid compute

**Vercel → Project → Settings → Functions → Fluid compute: ON.**

Compose, rebalance, capture and breakdown each declare `maxDuration = 300`.
Without Fluid compute the Hobby ceiling is 60 seconds, and a slow compose —
they have taken up to ~2.5 minutes under load — is killed mid-call. You would
see a function timeout rather than a plan.

`maxDuration` is a **ceiling, not a reservation**: a two-second call is billed
as a two-second call.

It is set on the page segments, not the action files, because Server Actions
inherit `maxDuration` from the page they are invoked from. It is also on the
`(app)` layout, because the assistant rail lives there and can trigger a
compose or rebalance from any page in the group.

---

## 3. Deploy

1. Push to GitHub, import the repo in Vercel. Framework preset: **Next.js**.
   Build command and output directory: leave as detected.
2. Set the environment variables above **before** the first build — the build
   reads `DATABASE_URL`.
3. Deploy.

### Run the migrations against production

The build does **not** migrate. Run this locally with your **production**
`DATABASE_URL` in the environment:

```bash
npm run db:migrate
```

There are 11 migrations (`0000`–`0010`). The most recent few matter:

- `0008` — the planning layer plus the adaptive-layer capture columns
- `0009` — the goal layer; **drops the `milestones` table**
- `0010` — learned focus hours; **drops `day_profile.sharp_hours`**

If you skip this, every screen 500s with `relation ... does not exist`.

---

## 4. Verify after the first deploy

Work through these in order. The first three are the ones that catch a broken
deploy.

1. **Model ids resolved.** Open the deployment's **Runtime Logs** and look for
   one line at boot:
   ```
   [models] ✓ all 3 configured gemini model ids exist: compose=…, capture=…, reason=…
   ```
   A `✗` line names the bad id and suggests near matches. `not verified` means
   `GEMINI_API_KEY` did not reach the function.

2. **Log in.** Visit `/login`, enter `APP_PASSPHRASE`. Landing back on `/login`
   means the passphrase does not match; a 500 usually means `SESSION_SECRET` is
   missing or under 16 characters.

3. **Every screen renders.** `/today`, `/inbox`, `/goals`, `/week`, `/review`,
   `/settings`. A `Failed query … does not exist` on any of them means step 3's
   migration did not run.

4. **Plan a day.** `/today` → *Plan my day*. This is the real end-to-end test:
   database read, model call, validation, persistence. Watch it complete rather
   than time out — that is what Fluid compute is for.

5. **Install it on your phone.** Open the deployed URL in mobile Chrome or
   Safari → *Add to Home Screen*. It should install as **Cadence** with the
   ribbon icon and open straight to `/today` with no browser chrome.

6. **Timezone.** The Today heading must show *your* date. Everything is
   computed in `Asia/Kolkata` regardless of where the function runs, so a
   Vercel region change cannot shift your day — but check the date once.

7. **Focus hours are honest.** `/review` → *Focus hours* should say nothing is
   learned yet. That is correct on a fresh deploy; scores appear after a few
   debriefs.

---

## 5. Known limitations at launch

- **Gemini free tier is roughly 20 requests/day** on 3.6/3.7 Flash and 500/day
  on 3.5 Flash Lite. A compose is 1 call (3 at worst). If planning starts
  failing with a daily-quota message, that is the cause, and the app says so
  explicitly with a reset time.
- **Backups.** Neon has point-in-time restore on paid plans; on free, take
  your own dump before anything destructive.
- **Anyone with the URL and the passphrase is in.** There is one user and one
  secret by design (SPEC section 8). Do not share the URL.
