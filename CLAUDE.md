# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commit messages

Keep commits simple and lazy — short, lowercase, casual, no fluff. Never mention Claude, AI, or add
a Co-Authored-By line. Just describe what changed in a few words, like a dev committing to their own
side project.

## What this is

GradPlan — a personal finance app: income, expenses, installments/loans, subscriptions, savings,
accounts, a transaction ledger, debts (owed to/by you), and budgets, with net worth and cash-flow
math on top. Static HTML/CSS/vanilla JS frontend (ES modules, no build step, no framework) in
`public/`, backed by a FastAPI app (`app.py` + `backend/`) and a single-user Postgres database on
Neon. There is no offline mode — the server is the sole source of truth, and every session requires
logging in with the one configured account.

## Commands

```
npm start        # uvicorn app:app --reload — serves public/ + /api at http://localhost:4173
npm test          # node --test — runs test/calc.test.js against public/js/calc.js (frontend-only)
npm run test:api  # pytest — runs tests/ against the FastAPI app + an in-memory SQLite DB
npm run test:all  # both of the above
```

Before `npm start` works, activate the Python venv and install deps:

```
env\Scripts\activate      # Windows
source env/bin/activate   # macOS/Linux
pip install -r requirements.txt
```

For the backend test suite, also install `requirements-dev.txt`:
`pip install -r requirements.txt -r requirements-dev.txt`.

You also need a local `.env` (copy `.env.example`) with `DATABASE_URL` pointing at the Neon project,
plus `AUTH_USERNAME` / `AUTH_PASSWORD_HASH` / `JWT_SECRET`. Generate the password hash with
`python scripts/hash_password.py`. Create tables once with `python scripts/init_db.py`.

Run a single frontend test file: `node --test test/calc.test.js`.
Run a single backend test file: `pytest tests/test_recurring.py`, or `pytest tests/test_crud.py -k accounts`.
There's no lint/typecheck script configured.

## Architecture

**Frontend** (`public/`): plain ES module imports (`public/js/*.js`), loaded by `index.html` with no
bundler. Data flows one way: **store → render**, triggered by a pub/sub subscription, not a framework.

- **`public/js/store.js`** — single source of truth on the client. Holds the in-memory `data` object
  (`{ settings, income[], expenses[], installments[], subscriptions[], savings[], accounts[],
  transactions[], budgets[], debts[] }`), hydrated once via `init()` (`GET /api/data`, awaited in
  `app.js`'s `boot()`). Mutations (`add/update/remove/getById/updateSettings`) apply to the in-memory
  cache and notify subscribers **synchronously**, then fire a background HTTP call via `api.js`; a
  failed call rolls the cache back, re-notifies, and toasts. `loadSample()`/`resetAll()`/
  `importJSON()` are full round trips — the bulk data is server-generated (sample) or server-validated
  (import/reset), so the client replaces its cache with the server's response rather than predicting
  it. Deleting an **account, debt, or saving** cascades — it would otherwise orphan transactions that
  reference it (and, for accounts, leave dangling auto-pay links): `removeCascade()`/`restoreCascade()`
  compute the blast radius (`cascadeImpact()`, used for a warning dialog before the delete) and keep it
  undoable client-side, while the backend performs the same cleanup atomically in `delete_record`
  (see `routes.py`) — the client only ever fires one DELETE.
- **`public/js/api.js`** — thin fetch wrapper (`credentials: 'same-origin'`); a 401 response redirects
  to `/login.html`.
- **`public/js/calc.js`** — pure, DOM-free calculation engine: frequency normalization, loan
  amortization, savings projections, the dashboard `summary()`, net worth (`currentNetWorth`,
  `netWorthHistory`), per-account/debt/saving running balances, budget status, due-soon/scheduled
  transaction forecasting, and the statement engine (date-range + keyword + filter matching used by
  the Statement view). This is the only module with unit tests (`test/calc.test.js`) — any change to
  financial math should get a corresponding test using the `approx()` helper for float comparisons.
- **`public/js/views.js`** — renders each screen (dashboard/income/expenses/installments/
  subscriptions/savings/accounts/transactions/debts/statement/guide) to an HTML string from `store`
  data + `calc` results, plus drill-down detail modals (`renderDrillDown`), a printable/exportable
  Statement builder (date-range presets, keyword chips, CSV export), and per-collection row selection
  for bulk actions. No classes/components — just functions returning template strings.
- **`public/js/forms.js`** — schema-driven add/edit modals. Each collection has a field `SCHEMAS` entry
  (name/type/options/validation); installments and savings additionally get a live calculation preview
  (`previewInstallment`/`previewSaving`) that re-renders on every `input` event using `calc.js`. Also
  owns `openAdjustBalance()` (a balance-correction transaction for an account) and the delete flow —
  `deleteRecord()` routes through `store.removeCascade` for accounts/debts/savings and a plain
  `store.remove` otherwise. The submit handler is `async`: it disables the submit button while the
  request is in flight and only closes the modal on success, so a failed save leaves the typed input
  intact.
- **`public/js/charts.js`** — dependency-free inline-SVG charts (donut, comparison bars, progress bars)
  using a validated categorical palette keyed off the current theme (light/dark).
- **`public/js/ui.js`** — modal/toast/confirm-dialog chrome shared by `app.js`, `forms.js`, and
  `login.js`.
- **`public/js/format.js`** — currency/date/number formatting via `Intl`; holds the supported currency
  list and the module-level "current currency" used everywhere else.
- **`public/js/app.js`** — the controller: hash-based routing (`#income`, `#accounts`, `#statement`,
  ...), event delegation for nav/add/edit/delete buttons, theme + effects toggles, currency selector,
  logout, the import/export/reset data menu, and `quickLog()` (fast-path "log a transaction" reachable
  from the topbar, the mobile bottom-nav, and a floating action button). `boot()` is `async` — it
  awaits `store.init()` before the first `render()`. `store.subscribe(render)` means any store mutation
  anywhere re-renders the current view automatically. There's a mobile bottom tab bar in addition to
  the sidebar nav (`#bottom-nav`), driven by the same `data-view` delegation pattern.
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
- **`backend/models.py`** — SQLModel tables: `income`, `expenses`, `installments`, `subscriptions`,
  `goals` (app-facing name `savings` — the table kept its original name to avoid orphaning rows written
  before the rename), `accounts`, `debts`, `budgets`, `transactions`, plus `settings` (single row, id=1)
  and `login_attempts` (throttle log). Columns are snake_case; `id` on the nine collection tables is a
  **client-generated string** (mirrors `store.js`'s `uid()`), not a DB sequence — that's what makes
  `POST /api/{collection}` idempotent under retry (see routes.py). Income/expenses/subscriptions/
  installments carry an optional `account_id` + `next_date`/`next_due_date` auto-pay link, advanced by
  `backend/recurring.py`. `Transaction` is the shared ledger row: `type` is one of
  `expense|income|transfer|debt|savings`, and depending on type it uses `account_id`/`to_account_id`
  (transfers), `debt_id`/`debt_direction` (moves a debt's own balance, independent of any account), or
  `saving_id`/`saving_direction` (moves real money between an account and a savings bucket — unlike a
  debt transaction, a `contribute` actually debits the account).
- **`backend/schemas.py`** — Pydantic I/O models. `CamelModel` sets
  `alias_generator=to_camel, populate_by_name=True` so the API surface stays camelCase (matching what
  `calc.js`/`views.js`/`forms.js` already expect) while the DB stays snake_case. Vocabulary fields
  (`Frequency`, `TxnType`, `AccountType`, `DebtDirection`, `DebtTxnDirection`, `SavingTxnDirection`) are
  `Literal`-constrained on the `*In`/`*Patch` write path — mirroring the `<select>` options in
  `forms.js` and the exact strings `calc.js` filters on — but the `*Out` read models widen the same
  field back to plain `str`, because rows written before the constraint existed must still round-trip
  through `GET /api/data`. A handful of optional fields (`monthlyPayment`, `startDate`, `nextRenewal`,
  `accountId`, `creditLimit`, ...) get a `field_validator` that coerces `""` → `None`, because
  `forms.js`'s `getValues()` sends blank number/date/select inputs as `''`, not `null`.
- **`backend/routes.py`** — all data routes under `/api`, gated by `require_auth`. Generic per-collection
  CRUD via a `COLLECTIONS` registry (name → table/In/Out/Patch schema tuple) validated against the same
  nine-name whitelist as `store.js`. `POST /api/{collection}` uses `session.merge()` rather than a bare
  insert — since the id is client-generated, a retried create should update-in-place, not 409.
  `GET /api/data` runs `recurring.apply_due_transactions()` first, so opening the app is what "ticks
  the clock." Deleting an account/debt/saving runs `_cascade_delete()` in the same transaction: it
  removes transactions that reference the deleted row and, for accounts, clears the `account_id`
  auto-pay link on any income/expense/subscription/installment that pointed at it — mirrors the
  client-side cascade in `store.js` so a direct API call can't leave orphans either.
- **`backend/recurring.py`** — auto-pay catch-up: for any income/expense/subscription/installment with
  both an `account_id` and a next-due date, posts a `Transaction` (and advances the pointer) for every
  occurrence whose date has already arrived, capped at `MAX_CATCHUP_PERIODS` per record as a safety
  valve against a very stale date. Runs on every `GET /api/data` — there's no background worker.
  Installments derive every due date from `start_date` by counting elapsed payments
  (`_payment_index`) rather than walking the stored pointer forward, specifically to avoid two bugs:
  a clamped "31st of the month" schedule permanently drifting to the 28th after February, and a
  drifted pointer letting a term post one payment more than it should.
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

### Backend tests (`tests/`)

Pytest against the real FastAPI app, but pointed at a throwaway **in-memory SQLite** DB instead of
Neon — nothing in this suite can reach production data.

- **`tests/conftest.py`** — pins `DATABASE_URL=sqlite://` (and other auth env vars) *before* `app.py`
  is imported, because `python-dotenv`'s `load_dotenv()` never overrides an already-set variable — this
  is what keeps a real `.env` pointing at Neon from ever being touched by the suite. `get_session` is
  also overridden per-test via `app.dependency_overrides` as a second, independent layer. Key fixtures:
  `engine` (fresh `StaticPool` SQLite engine per test, tables created from `SQLModel.metadata`),
  `session` (direct DB access for asserting state the API doesn't expose), `anon` (a `TestClient` with
  no session cookie), `client` (an `anon` client that has already logged in — `TestClient` persists the
  cookie across requests).
- **`tests/payloads.py`** — one minimal valid create-payload (`MINIMAL`) and one patchable field/value
  (`PATCH`) per collection, keyed by the same nine names `routes.COLLECTIONS` uses. Adding a new
  collection to the app means adding an entry here to pick it up in the parametrized CRUD/auth tests.
- **`tests/test_auth.py`**, **`test_crud.py`**, **`test_cascade.py`**, **`test_recurring.py`**,
  **`test_data_roundtrip.py`** — auth gating (walks every data route to catch one added without
  `require_auth`) and login throttling; generic CRUD + validation across all nine collections; the
  account/debt/saving cascade-delete cleanup; the `recurring.py` catch-up engine (including the
  installment drift/over-posting fixes above); and full export→import round-tripping.

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
re-renders once ready. Non-collection views like `guide`/`statement` have no add form, so the topbar
"+ Add" is gated on `forms.hasForm(current)`.

### Conventions worth knowing

- Money amounts are stored in their native frequency (e.g. `frequency: 'monthly'|'weekly'|...`) and
  normalized via `calc.toMonthly`/`toYearly` at render time — never store a pre-converted monthly value.
- Dates are ISO strings (`YYYY-MM-DD`); `calc.js` functions accept an optional `refISO` reference date
  (defaults to "now") so calculations are testable with a fixed date.
- `data-*` attributes drive event delegation in `app.js` (`data-view`, `data-edit`, `data-del`,
  `data-add`) instead of per-element listeners — new interactive elements should follow this pattern.
- Health/status levels are a fixed vocabulary: `good | warning | serious | critical`, mapped to CSS
  variables (`--good`, `--warning`, etc.) — reuse `assessSavingsRate`/`assessDTI`/`assessBudget` as the
  pattern for any new health indicator.
- Adding a field to a record type touches four places: `backend/models.py` (column),
  `backend/schemas.py` (In/Out/Patch, plus a blank-string validator if it's an optional number/date/
  select), `backend/seed.py` (sample data), and `public/js/forms.js`'s `SCHEMAS` (form field). Adding a
  whole new collection additionally touches `routes.py`'s `COLLECTIONS` registry, `store.js`'s
  `COLLECTIONS` whitelist, and `tests/payloads.py`.
- A `Transaction`'s meaning depends on its `type`: `debt`/`savings` transactions carry their own
  `*_id`/`*_direction` pair and don't necessarily touch an `account_id`; `transfer` uses both
  `account_id` and `to_account_id`. Don't assume every transaction has a single account.

## Other directories in this working tree

`financial-manager/` (this project) sits alongside a sibling `savrr-backend/` (FastAPI + Supabase
backend, formerly `savrr/`) and `savrr-mobile-app/` (React Native client, empty so far) directories at
the workspace root — separate git repos. Savrr reuses GradPlan's domain logic, but nothing in them is
part of GradPlan.
