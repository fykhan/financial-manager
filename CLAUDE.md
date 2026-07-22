# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commit messages

Keep commits simple and lazy — short, lowercase, casual, no fluff. Never mention Claude, AI, or add
a Co-Authored-By line. Just describe what changed in a few words, like a dev committing to their own
side project.

## What this is

GradPlan — a personal finance planner for new graduates (income, expenses, installments/loans,
subscriptions, savings goals). Static HTML/CSS/vanilla JS frontend (ES modules, no build step, no
framework) in `public/`, backed by a FastAPI app (`app.py` + `backend/`) and a single-user Postgres
database on Neon. There is no offline mode — the server is the sole source of truth, and every session
requires logging in with the one configured account.

## Commands

```
npm start        # uvicorn app:app --reload — serves public/ + /api at http://localhost:4173
npm test         # node --test — runs test/calc.test.js against public/js/calc.js (frontend-only)
```

Before `npm start` works, activate the Python venv and install deps:

```
env\Scripts\activate      # Windows
source env/bin/activate   # macOS/Linux
pip install -r requirements.txt
```

You also need a local `.env` (copy `.env.example`) with `DATABASE_URL` pointing at the Neon project,
plus `AUTH_USERNAME` / `AUTH_PASSWORD_HASH` / `JWT_SECRET`. Generate the password hash with
`python scripts/hash_password.py`. Create tables once with `python scripts/init_db.py`.

Run a single test file: `node --test test/calc.test.js`. There's no lint/typecheck script configured.

## Architecture

**Frontend** (`public/`): plain ES module imports (`public/js/*.js`), loaded by `index.html` with no
bundler. Data flows one way: **store → render**, triggered by a pub/sub subscription, not a framework.

- **`public/js/store.js`** — single source of truth on the client. Holds the in-memory `data` object
  (`{ settings, income[], expenses[], installments[], subscriptions[], goals[] }`), hydrated once via
  `init()` (`GET /api/data`, awaited in `app.js`'s `boot()`). Mutations (`add/update/remove/getById/
  updateSettings`) apply to the in-memory cache and notify subscribers **synchronously**, then fire a
  background HTTP call via `api.js`; a failed call rolls the cache back, re-notifies, and toasts.
  `loadSample()`/`resetAll()`/`importJSON()` are full round trips — the bulk data is server-generated
  (sample) or server-validated (import/reset), so the client replaces its cache with the server's
  response rather than predicting it.
- **`public/js/api.js`** — thin fetch wrapper (`credentials: 'same-origin'`); a 401 response redirects
  to `/login.html`.
- **`public/js/calc.js`** — pure, DOM-free calculation engine (frequency normalization, loan
  amortization, goal projections, the dashboard `summary()`). This is the only module with unit tests
  (`test/calc.test.js`) — any change to financial math should get a corresponding test using the
  `approx()` helper for float comparisons.
- **`public/js/views.js`** — renders each screen (dashboard/income/expenses/installments/subscriptions/
  goals) to an HTML string from `store` data + `calc` results. No classes/components — just functions
  returning template strings.
- **`public/js/forms.js`** — schema-driven add/edit modals. Each collection has a field `SCHEMAS` entry
  (name/type/options/validation); installments and goals additionally get a live calculation preview
  (`previewInstallment`/`previewGoal`) that re-renders on every `input` event using `calc.js`. The submit
  handler is `async`: it disables the submit button while the request is in flight and only closes the
  modal on success, so a failed save leaves the typed input intact.
- **`public/js/charts.js`** — dependency-free inline-SVG charts (donut, comparison bars, progress bars)
  using a validated categorical palette keyed off the current theme (light/dark).
- **`public/js/ui.js`** — modal/toast/confirm-dialog chrome shared by `app.js`, `forms.js`, and
  `login.js`.
- **`public/js/format.js`** — currency/date/number formatting via `Intl`; holds the supported currency
  list and the module-level "current currency" used everywhere else.
- **`public/js/app.js`** — the controller: hash-based routing (`#income`, `#goals`, ...), event
  delegation for nav/add/edit/delete buttons, theme toggle, currency selector, logout, and the
  import/export/reset data menu. `boot()` is `async` — it awaits `store.init()` before the first
  `render()`. `store.subscribe(render)` means any store mutation anywhere re-renders the current view
  automatically.
- **`public/login.html` + `public/js/login.js`** — standalone login page (own `<html data-theme>`,
  its own `#toast-host`), posts to `/api/auth/login` and redirects to `/` on success.

**Backend** (`app.py`, `backend/`):

- **`app.py`** — FastAPI entrypoint. Includes the auth and data routers, then mounts `public/` as
  static files for local dev only (`if not os.getenv("VERCEL")`) — Vercel's CDN serves `public/`
  directly in production and only routes `/api/*` to this function. Router registration order matters:
  routers are included before the static mount so `/api/*` isn't shadowed by the catch-all.
- **`backend/db.py`** — SQLAlchemy engine against Neon's **pooled** connection string
  (`DATABASE_URL`), rewriting `postgresql://` → `postgresql+psycopg://`. Uses `NullPool` (Neon's own
  PgBouncer already pools) and `pool_pre_ping=True` (the free tier scales to zero, so idle connections
  go stale). `create_all()` imports `backend.models` internally before calling
  `SQLModel.metadata.create_all()` — that import is load-bearing, not decorative: without it the
  metadata is empty and `create_all()` silently creates zero tables.
- **`backend/models.py`** — SQLModel tables, one per collection plus `settings` (single row, id=1) and
  `login_attempts` (throttle log). Columns are snake_case; `id` on the five collection tables is a
  **client-generated string** (mirrors `store.js`'s `uid()`), not a DB sequence — that's what makes
  `POST /api/{collection}` idempotent under retry (see routes.py).
- **`backend/schemas.py`** — Pydantic I/O models. `CamelModel` sets
  `alias_generator=to_camel, populate_by_name=True` so the API surface stays camelCase (matching what
  `calc.js`/`views.js`/`forms.js` already expect) while the DB stays snake_case. A few optional fields
  (`monthlyPayment`, `startDate`, `nextRenewal`, `deadline`) get a `field_validator` that coerces `""` →
  `None`, because `forms.js`'s `getValues()` sends blank number/date inputs as `''`, not `null`.
- **`backend/routes.py`** — all data routes under `/api`, gated by `require_auth`. Generic per-collection
  CRUD via a `COLLECTIONS` registry (name → table/schema tuple) validated against the same five-name
  whitelist as `store.js`. `POST /api/{collection}` uses `session.merge()` rather than a bare insert —
  since the id is client-generated, a retried create should update-in-place, not 409.
- **`backend/auth.py`** — single user, no `users` table; credentials live in env vars
  (`AUTH_USERNAME`, `AUTH_PASSWORD_HASH` via argon2). `require_auth` reads the JWT from an httpOnly
  cookie and re-issues it if it's more than a day old (sliding 30-day expiry). Rotating `JWT_SECRET` is
  the documented kill switch — it invalidates every outstanding session at once, and note that
  **logout only clears the browser's cookie**; it does not revoke the token server-side, so a copy of
  the cookie held elsewhere remains valid until it expires or the secret rotates. Login attempts are
  throttled per-IP (10 failures / 15 min) via the `login_attempts` table, because in-memory counters
  don't survive across serverless function instances.
- **`backend/seed.py`** — the sample dataset, ported 1:1 from the old client-side `withSample()`.
- **`scripts/init_db.py`** — `SQLModel.metadata.create_all()`, run manually. No Alembic — single user,
  rare schema change.
- **`scripts/hash_password.py`** — prompts for a password (never touches argv/env) and prints its
  argon2 hash for `AUTH_PASSWORD_HASH`.

### PWA

`public/manifest.webmanifest` (linked from `index.html` + `login.html`) makes the app installable —
standalone display, dark theme color, SVG icons in `public/icons/` (a normal + a maskable variant, SVG
so there are no binary assets in the repo). There is deliberately **no service worker**: the app is
online-only (the server is the sole source of truth), so there's nothing to cache for offline use.

### User guide

`public/guide.md` is a plain-markdown usage guide, rendered in-app as the `#guide` view. `views.js`
fetches it once (`loadGuide()`), converts it with a tiny self-contained markdown subset parser
(`mdToHtml` — headings/lists/blockquotes/hr + inline bold/italic/code/links, all HTML-escaped first),
caches the HTML, and `renderGuide()` returns it; `app.js`'s `render()` triggers the lazy load and
re-renders once ready. It's the only view that pulls an extra static asset. Edit the guide by editing
the markdown — no code change needed. Non-collection views like `guide`/`statement` have no add form,
so the topbar "+ Add" is gated on `forms.hasForm(current)`.

### Conventions worth knowing

- Money amounts are stored in their native frequency (e.g. `frequency: 'monthly'|'weekly'|...`) and
  normalized via `calc.toMonthly`/`toYearly` at render time — never store a pre-converted monthly value.
- Dates are ISO strings (`YYYY-MM-DD`); `calc.js` functions accept an optional `refISO` reference date
  (defaults to "now") so calculations are testable with a fixed date.
- `data-*` attributes drive event delegation in `app.js` (`data-view`, `data-edit`, `data-del`,
  `data-add`) instead of per-element listeners — new interactive elements should follow this pattern.
- Health/status levels are a fixed vocabulary: `good | warning | serious | critical`, mapped to CSS
  variables (`--good`, `--warning`, etc.) — reuse `assessSavingsRate`/`assessDTI` as the pattern for any
  new health indicator.
- Adding a field to a record type touches four places: `backend/models.py` (column),
  `backend/schemas.py` (In/Out/Patch, plus a blank-string validator if it's an optional number/date),
  `backend/seed.py` (sample data), and `public/js/forms.js`'s `SCHEMAS` (form field).
