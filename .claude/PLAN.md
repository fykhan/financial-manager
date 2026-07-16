# GradPlan → Vercel + FastAPI + Neon Postgres — full plan

This is the complete plan as approved by the user, copied in full so it's
available without reaching into the Windows-side global plan file at
`C:\Users\Dell\.claude\plans\glowing-squishing-panda.md`. See `HANDOFF.md` in
this same folder for current progress against this plan.

## Context

GradPlan is currently a zero-backend static app: all data lives in one browser's
`localStorage` under `gradplan.v1`. That means the data exists on exactly one device and
dies with the browser profile. The goal is to reach it from anywhere and update it — which
requires real hosting, a real database, and a login.

The blocker for the original idea (SQLite or a JSON file on disk): **Vercel functions have an
ephemeral filesystem.** A `.db` or `.json` written at runtime is wiped on every cold start and
redeploy, and concurrent instances each get a private copy. Persistence must be network-backed.

**Decisions already made:** Neon Postgres via Vercel's integration · relational tables (one per
collection) · single user, password + JWT httpOnly cookie, 30-day sliding session · server is
the source of truth, no offline mode, start with an empty account · uvicorn for local dev ·
commit to `main`.

**Update since this plan was first written:** the user created the Neon project directly
at neon.com rather than through Vercel's marketplace integration — so env vars are **not**
auto-injected into Vercel. The connection string has to be copied manually from the Neon
console into both the local `.env` and, later, Vercel's project env vars. Everything else
below still holds.

**Outcome:** same app, same UI, reachable at a URL, behind a login, with data in Postgres.

## Architecture

Vercel serves `public/**` from its CDN and runs the FastAPI app as a single function. Vercel
auto-detects a top-level `app` in a root `app.py`
([docs](https://vercel.com/docs/frameworks/backend/fastapi)).

```
app.py              # FastAPI `app` — Vercel entrypoint (auto-detected)
backend/
  __init__.py
  db.py             # engine, session dependency
  models.py         # SQLModel tables (snake_case columns)
  schemas.py        # Pydantic I/O (camelCase via alias_generator)
  auth.py           # argon2 verify, JWT cookie, require_auth dependency
  routes.py         # /api/* routers
  seed.py           # sample dataset (ported from store.js withSample)
public/             # MOVED: was repo root — DONE, see HANDOFF.md
  index.html
  login.html        # new
  css/styles.css
  js/*.js
scripts/
  init_db.py        # create tables
  hash_password.py  # generate AUTH_PASSWORD_HASH
requirements.txt
.python-version     # 3.12
vercel.json
```

Static files move into `public/`. Vercel's docs are explicit that `app.mount("/public", ...)`
should **not** be used. So mount static only for local dev, guarded on Vercel's own env var:

```python
if not os.getenv("VERCEL"):
    app.mount("/", StaticFiles(directory="public", html=True), name="static")
```

Local uvicorn serves everything; on Vercel the CDN serves `public/` and the function owns
`/api/*`. FastAPI routes live exclusively under `/api/` in both cases, so behaviour matches.

## Data model

Five tables mirroring `forms.js` `SCHEMAS` (`public/js/forms.js:15-72`) plus a single-row
`settings`. No `users` table — single user, credentials in env vars.

| Table | Columns (beyond `id`, `created_at`) |
|---|---|
| `settings` | `currency`, `name` (single row, id=1) |
| `income` | `source`, `amount`, `frequency`, `type`, `notes` |
| `expenses` | `name`, `category`, `amount`, `frequency`, `notes` |
| `installments` | `name`, `principal`, `apr`, `term_months`, `monthly_payment` (nullable), `start_date`, `notes` |
| `subscriptions` | `name`, `amount`, `cycle`, `category`, `next_renewal`, `notes` |
| `goals` | `name`, `target`, `saved`, `monthly_contribution`, `deadline`, `notes` |

Constraints discovered during exploration that the schema must respect:

- **`id` stays a client-generated string.** `store.js`'s `uid()` already mints
  `id_<base36>` before any write. Keep that — it makes optimistic updates trivial and writes
  idempotent. Do not use a DB sequence.
- **JSON stays camelCase.** `calc.js` and `views.js` read `termMonths`, `monthlyPayment`,
  `nextRenewal`, `monthlyContribution`, `startDate` directly. Columns are snake_case;
  Pydantic schemas convert via `alias_generator=to_camel` + `populate_by_name=True`. This
  keeps `calc.js` and its tests untouched.
- **Do not make enums stricter than the calc engine.** `calc.js` accepts `'one-time'`
  as valid-but-zero (see `test/calc.test.js`) though it is absent from `FREQ_OPTIONS`. Store
  frequency/cycle as plain strings, validate in Pydantic against calc's superset.
- **`monthlyPayment` blank means auto-calc**, not zero. `getValues()` in `forms.js`
  coerces empty numbers to `''`, not null — map `''` → SQL `NULL` at the schema boundary.

`SQLModel.metadata.create_all()` via `scripts/init_db.py`, run manually. No Alembic — single
user, rare schema change; it can be added later if that stops being true.

## Neon connection (serverless footguns)

The Vercel-managed Neon integration sets `DATABASE_URL` (pooled, PgBouncer) and
`DATABASE_URL_UNPOOLED` (direct)
([docs](https://neon.com/docs/guides/vercel-managed-integration)). Since the Neon project was
created directly (not via that integration), get the equivalent two connection strings
manually from the Neon console: the "pooled connection" (has `-pooler` in the hostname) and
the direct one.

- Use the **pooled** connection string for `DATABASE_URL`. Direct connections get exhausted by
  function concurrency.
- Use **`NullPool`** — PgBouncer already pools; two poolers fight each other.
- `pool_pre_ping=True` — Neon's free tier scales to zero, so idle connections go stale.
- Rewrite the scheme: Neon gives `postgresql://`, psycopg3 needs `postgresql+psycopg://`.

Expect ~500ms on the first request after idle. That is the free tier waking, not a bug.

## Auth

Env vars: `AUTH_USERNAME`, `AUTH_PASSWORD_HASH` (argon2), `JWT_SECRET`.

- `POST /api/auth/login` → verify argon2, set JWT in `httpOnly; Secure; SameSite=Lax` cookie.
- `POST /api/auth/logout` → clear cookie.
- `GET  /api/auth/me` → 200 or 401; the frontend boot check.
- `require_auth` dependency guards every data route.
- **Sliding 30-day expiry**: re-issue the cookie when the token is >1 day old.
- **Kill switch**: rotating `JWT_SECRET` invalidates every session everywhere. Documented in README.
- **Throttling**: in-memory counters are useless across serverless instances, so back it with a
  small `login_attempts` table — block after 10 failures in 15 min per IP. argon2's ~100ms cost
  already makes brute force expensive; this covers the rest.

`scripts/hash_password.py` generates the hash locally. The plaintext password never enters the
repo or the env — only its hash does.

## API

All under `/api`, all requiring auth except the login route.

- `GET  /api/data` — the whole dataset in one shot; hydrates the client cache at boot.
- `POST /api/{collection}` — create (client supplies `id`).
- `PATCH /api/{collection}/{id}` — update.
- `DELETE /api/{collection}/{id}` — delete.
- `PATCH /api/settings` — currency / name.
- `POST /api/data/import` — replace everything (existing JSON backup format).
- `POST /api/data/sample` — seed sample data.
- `POST /api/data/reset` — erase everything.

`{collection}` validated against the same five-name whitelist as `store.js`.

## Frontend changes

The seam is narrow: **only `app.js` and `forms.js` import `store.js`.** `views.js`,
`charts.js`, `calc.js`, `format.js`, and `test/calc.test.js` never touch it — they take `data`
as an argument. So the sync render path can be preserved entirely.

**Strategy: hydrate once, then optimistic writes.** `store.js` keeps its in-memory `data`
object and its `subscribe`/`persist` pub-sub contract. Only the persistence backend changes.

- `js/api.js` (new) — fetch wrapper, `credentials: 'same-origin'`, 401 → redirect to login.
- `js/store.js` — `persist()` swaps localStorage for a background HTTP call. Mutations update
  the cache and notify listeners **synchronously** (so `getData()`, `getById()`, `exportJSON()`,
  `exportCSV()`, and `getSettings().currency` all stay sync), then fire the request. On failure:
  roll back the cache, notify again, and toast. New exported `init()` does `GET /api/data`.
- `js/app.js` — `boot()` becomes async: `await store.init()` before first `render()`. On 401,
  redirect to `/login.html`. Reword the data-menu copy ("stored privately in this browser" is
  no longer true).
- `js/forms.js` — the submit handler currently toasts "Saved" and closes the modal on the same
  tick, with no failure path. Make it `async`, disable the submit button in flight, and move
  `closeModal()` into the success branch so a failed write doesn't discard typed input.
- `public/login.html` + `js/login.js` (new) — reuse `.panel`, `.field`, `.input`,
  `.btn.btn-primary.btn-block`, `.brand` from `css/styles.css`. Needs one new
  `.auth-shell { display:grid; place-items:center; min-height:100vh }` class (no full-page
  centering primitive exists today). Must include the `#toast-host` div from `index.html`
  or `toast()` throws, and must set `data-theme` itself or it renders light.

**Theme stays in localStorage** (`gradplan.theme`) — it's a UI preference, not data, and it
must work before login. Unaffected by this migration.

`store.js` currently swallows write failures silently (`catch { /* quota */ }`). The network
layer must not inherit that — a failed save is now something the user needs to know about.

## Local dev

`npm start` → `uvicorn app:app --reload` (serving `public/` + `/api`). `server.js` is deleted;
it's a static file server with no routes to extend. `npm test` keeps running `node --test`
against `calc.js`.

Recreate the venv if needed: the existing `env/` was a **Linux** venv (`pyvenv.cfg` said
`home = /usr/bin`, Python 3.10) which is dead on Windows — but this whole migration is now
continuing in WSL, where that venv may simply work again (check before recreating). If it
needs recreating: `python3 -m venv env`, keep the name `env/` (already gitignored).

Pin `.python-version` to **3.12** to match Vercel's default. If 3.12 isn't easily available,
3.11 is an acceptable fallback — it just means a version-specific bug would only ever surface
in prod, a known and accepted tradeoff, not a blocker.

Local `DATABASE_URL` points at the Neon project directly (no local Postgres install).

## Work order

Each step leaves the app runnable.

1. **Restructure** — move `index.html`, `css/`, `js/` into `public/`. No logic change; confirm
   the app still loads and still works off localStorage. **DONE**, pushed to `origin/main`.
2. **Backend skeleton** — `app.py`, `backend/db.py`, `models.py`, `scripts/init_db.py`.
   Verify tables land in Neon.
3. **Auth** — `auth.py`, login routes, `login.html`, throttle table.
4. **Data routes** — CRUD + settings + import/sample/reset.
5. **Frontend swap** — `api.js`, rewrite `store.js` persistence, async `boot()`, async form submit.
6. **Docs** — rewrite `CLAUDE.md` (it opens with "zero-backend, client-side" and "no runtime
   dependencies", both now false) and `README.md`.
7. **Deploy** — set Neon connection string + auth env vars in Vercel manually (no marketplace
   integration was used), set **main** as the production branch (`origin/HEAD` currently points
   at `claude/student-financial-planner-g9axwk`).

The uncommitted HKD currency change (`js/format.js`, `README.md`) from before this migration
started was unrelated and was preserved, not reverted, when the restructure commit landed.

## Verification

- `npm test` — `test/calc.test.js` never touches `store.js`, so it must stay green throughout.
  It's the regression anchor for the whole migration. (Note: one pre-existing failing test,
  `addMonths rolls the calendar forward`, exists independent of this migration — see
  `HANDOFF.md` for status.)
- New `pytest` tests for the parts with real logic: argon2 verify + JWT round-trip, a rejected
  bad password, an unauthenticated 401 on a data route, and a full record round-trip asserting
  the API emits **camelCase** and that a blank `monthlyPayment` survives as `null`.
- End-to-end locally, against the Neon project: log in → add an expense → hard-refresh and
  confirm it persisted → edit it → delete it → change currency and confirm it sticks →
  log out and confirm `/` bounces to login.
- Failure path: stop the network, add a record, confirm the optimistic write rolls back and
  toasts rather than silently lying.
- Then deploy to a Vercel preview and repeat the login + add + refresh loop before pointing
  main at production.

## Known risks

- **Vercel's static/function routing is not reproduced by uvicorn.** This is the accepted
  trade-off of local uvicorn over `vercel dev`. Mitigated by FastAPI owning only `/api/*` in
  both environments, but if `/` misroutes on first deploy, the fix is a `vercel.json` rewrite.
- **Pushing to main auto-deploys** once Vercel is connected. Everything through step 6 is
  verified locally before Vercel is connected at all.
- **Financial data on the public internet.** Security rests on a strong password + argon2 +
  httpOnly/Secure cookie. Worth choosing a long unique password when generating the hash.

## Original Q&A that produced these decisions (for context on "why")

Four questions, asked before any code was written:

1. **Storage** — chose Neon Postgres over Turso/libSQL, Vercel Blob/Upstash KV (single-JSON-doc,
   rejected because concurrent-device writes would clobber each other), and Supabase (rejected,
   its bundled auth is overkill for one user).
2. **Data shape** — chose relational tables over a single JSON blob, to avoid last-write-wins
   clobbering and to leave room for future queries/history.
3. **Auth strength** — chose password + JWT cookie over TOTP 2FA (extra step, recovery-code
   complexity not worth it for personal use) and passkeys/WebAuthn (nicest UX but most
   implementation complexity, needs a fallback device path).
4. **Offline/data migration** — chose "server-only, start fresh" over migrating existing
   localStorage data (user had no real data worth migrating) and over an offline-first cache
   (rejected — real conflict-resolution complexity for no clear benefit here).

Follow-up decisions made while scoping further:
- Branch: directly on `main`, not a feature branch or the pre-existing `claude/...` branch.
- Local dev: plain uvicorn, not `vercel dev` (faster iteration, accepted routing-parity risk).
- Accounts: Vercel already existed; Neon was the one to newly provision.
- Session length: 30-day sliding, with `JWT_SECRET` rotation as the documented kill switch.
