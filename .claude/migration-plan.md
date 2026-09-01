# GradPlan → Multi-User + React Native (web + mobile) — migration plan

Two major refactors, sequenced. **Refactor A** turns the single-user backend into a
multi-tenant one without losing the data that's already in Neon, and adds a way to pull data
in from other GradPlan deployments. **Refactor B** replaces the vanilla-JS `public/` frontend
with an Expo / React Native app that ships to iOS, Android **and** web from one codebase,
translated screen-by-screen from what exists today.

Written against the repo as verified on 2026-09-01 (commit `f02f8f3`). Note `CLAUDE.md` is
stale on the data model — it documents 5 collections; there are actually **9** plus settings.
The inventory below is the accurate one.

---

## 1. Current state (verified, not from CLAUDE.md)

### Backend

| File | Lines | What it does |
|---|---|---|
| `app.py` | 31 | FastAPI entrypoint, router order, `/` redirect on cookie, static mount gated on `VERCEL` |
| `backend/models.py` | 170 | 10 SQLModel tables + `login_attempts` |
| `backend/routes.py` | 225 | Generic CRUD over a `COLLECTIONS` registry, snapshot/wipe/import/sample/reset, server-side cascade delete |
| `backend/auth.py` | 163 | argon2 + JWT httpOnly cookie, 30-day sliding, per-IP throttle. **Credentials in env vars, no users table** |
| `backend/schemas.py` | 347 | `CamelModel` (snake_case DB ↔ camelCase API), `Literal` vocabularies, blank-string coercion |
| `backend/recurring.py` | 159 | Auto-pay catch-up; runs on **every** `GET /api/data` |
| `backend/seed.py` | 90 | Sample dataset |
| `backend/db.py` | 30 | Neon pooled engine, `NullPool`, `pool_pre_ping` |

**Tables**: `settings` (single row, `id=1`), `income`, `expenses`, `installments`,
`subscriptions`, `goals` (app-facing name "savings"), `budgets`, `accounts`, `debts`,
`transactions`, `login_attempts`. **No `user_id` anywhere.**

**Referential graph** (matters a lot for Refactor A6 — this is the complete set of
cross-record references):

```
transactions.account_id    → accounts.id
transactions.to_account_id → accounts.id
transactions.debt_id       → debts.id
transactions.saving_id     → goals.id
income.account_id          → accounts.id
expenses.account_id        → accounts.id
subscriptions.account_id   → accounts.id
installments.account_id    → accounts.id
```

Record ids are **client-generated strings** (`id_` + base36, `store.js uid()`), which is what
makes `POST /api/{collection}` idempotent via `session.merge()`.

### Frontend (`public/`, no build step)

| File | Lines | Role | Portability to RN |
|---|---|---|---|
| `calc.js` | 968 | 40+ pure financial functions | **Verbatim** — already DOM-free |
| `format.js` | 95 | `Intl` money/date, currency list | **Verbatim** (Hermes `Intl` caveat, §B1) |
| `store.js` | 282 | Cache, pub/sub, optimistic writes + rollback, cascade delete/undo, import/export | Near-verbatim once `toast` import is inverted |
| `api.js` | 35 | fetch wrapper, cookie auth, 401 → redirect | Small rewrite (token auth, no `location`) |
| `charts.js` | 157 | Inline-SVG donut / bars / progress / line | Math reusable, rendering rewritten |
| `forms.js` | 751 | `SCHEMAS` for 9 collections + live previews | Schema data reusable, renderer rewritten |
| `views.js` | 1858 | 11 screens as HTML strings + statement doc + drill-downs + list/selection/filter/pagination state | **Full rewrite** |
| `app.js` | 550 | Routing, event delegation, data menu, theme, shortcuts | **Full rewrite** |
| `ui.js` | 115 | Modal / toast / confirm / download | **Full rewrite** |
| `login.js` | 43 | Login page | Rewrite (small) |
| `css/styles.css` | 2217 | 6 themes, tokens + structural overrides | Rewrite as JS tokens (§B3) |

**Screens** (11): dashboard, transactions, income, expenses, installments, subscriptions,
savings, accounts, debts, statement, guide.

**Tests**: `test/calc.test.js` — 65 tests, `node --test`. `tests/*.py` — pytest against
in-memory SQLite with `client` / `anon` / `session` fixtures. Both suites green.

---

## 2. Sequencing: multi-user first

**Do Refactor A before Refactor B.** Reasons:

1. A changes the API contract (auth shape, per-user scoping, import semantics) that B consumes.
   Porting the UI first means writing every screen against an API that is about to change, then
   reworking auth in two clients instead of one.
2. A is backend-heavy and lands in the *existing* web app, so it can be shipped and proven in
   production while the RN rewrite hasn't started.
3. A's data migration is the riskiest step in the whole programme (live production data). It
   deserves to happen while the frontend is a known-good constant.

---

# REFACTOR A — Multi-user

## A0. Decisions to confirm before writing code

| # | Decision | Recommendation | Why |
|---|---|---|---|
| A0.1 | Identity field | **Email** as login, with `display_name` | Needed later for password reset + it's what people expect; current `AUTH_USERNAME` is a single string |
| A0.2 | Signup policy | **Closed by default**: `SIGNUP_MODE=invite\|open\|off`, invite code in env | A personal finance app open to the internet is an abuse magnet; keeps the current security posture |
| A0.3 | Password reset | **Admin CLI** (`scripts/reset_password.py`) for v1, no email | Email delivery is a whole subsystem; not worth it at this user count |
| A0.4 | Primary key | **Composite `(user_id, id)`** | Makes cross-user overwrite via `session.merge()` structurally impossible (§A1.2) |
| A0.5 | Migrations | **Add Alembic**, multi-user is revision 0001 | CLAUDE.md's "no Alembic, rare schema change" assumed one user and disposable data; neither holds now |
| A0.6 | Token transport | Cookie for web, **Bearer for native**, both accepted | RN has no browser cookie jar; needed by Refactor B anyway |

## A1. Schema

### A1.1 New `users` table

```python
class User(SQLModel, table=True):
    __tablename__ = "users"
    id: str = Field(primary_key=True)          # "usr_" + token_urlsafe, server-generated
    email: str = Field(index=True, unique=True)
    password_hash: str
    display_name: str = Field(default="")
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=_now)
```

Server-generated id (unlike record ids) — clients must never choose it.

### A1.2 `user_id` on every data table

All 10 data tables (`settings`, `income`, `expenses`, `installments`, `subscriptions`,
`goals`, `budgets`, `accounts`, `debts`, `transactions`) get:

```python
user_id: str = Field(foreign_key="users.id", primary_key=True, index=True)
```

Composite PK `(user_id, id)` on the 9 collections; `settings` becomes **one row per user**
keyed by `user_id` alone (the `id=1` singleton disappears).

Why composite rather than "keep `id` as PK and filter by `user_id`": `POST /api/{collection}`
upserts with `session.merge()`. With a single-column PK, a client that posts a record carrying
*another user's* id would silently overwrite that user's row. Composite PK makes that a
different row entirely. **`user_id` is always taken from the JWT and never read from the
request body** — strip it if present.

### A1.3 Throttle table

`login_attempts` gains `email` (nullable) so throttling is per-IP **and** per-account; today a
single IP limit is shared across all users, which one attacker could use to lock everyone out.

## A2. Data migration — preserving what's in Neon today

This is the step that must not lose data. Sequence:

1. **Snapshot**: create a Neon branch off `main` (`pre-multiuser-YYYYMMDD`). This is the
   rollback. Also `pg_dump` to a local file, and one `GET /api/data` saved as JSON — three
   independent copies.
2. **Rehearse on a branch**: point a local `.env` at the Neon *branch*, run the migration
   there first, run the full pytest suite plus a manual pass over the app. Only then touch
   `main`.
3. **Migration, additive-first** (Alembic revision `0001_multiuser`):
   - `CREATE TABLE users`.
   - Insert **one owner user** from env (`AUTH_USERNAME` → email, existing
     `AUTH_PASSWORD_HASH` reused verbatim so the current password keeps working).
   - Add `user_id` to all 10 tables as **nullable**.
   - `UPDATE <table> SET user_id = '<owner id>' WHERE user_id IS NULL` — this is the step that
     preserves current data by adopting it into the owner account.
   - Migrate `settings`: the `id=1` row becomes the owner's settings row.
   - `SET NOT NULL`, drop old PK, add composite PK, add FK + indexes.
4. **Verify before dropping anything**: row counts per table before/after must match exactly;
   a `GET /api/data` diff (as the owner) against the JSON saved in step 1 must be empty apart
   from field ordering. Script this as `scripts/verify_migration.py` rather than eyeballing it.
5. Keep the pre-migration Neon branch for at least a week after cutover.

## A3. Auth rewrite (`backend/auth.py`)

| Now | After |
|---|---|
| `verify_credentials()` reads `AUTH_USERNAME`/`AUTH_PASSWORD_HASH` env | Looks up `users` by email; argon2 verify against the row. Keep the dummy-verify-on-miss timing defence |
| JWT payload `{iat, exp}` | `{sub: user_id, iat, exp}`; `require_auth` resolves and returns the `User` |
| `require_auth` returns `None` | Returns `User`; routes take it as a dependency |
| Cookie only | Cookie **or** `Authorization: Bearer` (cookie wins if both). Same token either way |
| Throttle by IP | Throttle by IP **and** email |
| — | `POST /api/auth/signup` (gated by `SIGNUP_MODE`), `POST /api/auth/password` (change, requires current password), `GET /api/auth/me` returns `{id, email, displayName}` instead of `{ok: true}` |

`JWT_SECRET` rotation remains the global kill switch. Logout still only clears the cookie
(unchanged limitation — document it, don't pretend otherwise); a `token_version` column on
`users` is the follow-up if per-user revocation is ever needed.

## A4. Route scoping (`backend/routes.py`)

Mechanical but must be exhaustive — **every** `select()` gains a user filter. Checklist:

- [ ] `_get_settings(session, user)` → `select(Settings).where(Settings.user_id == user.id)`, creating the row on first access
- [ ] `_snapshot(session, user)` — all 9 `select()` calls
- [ ] `_wipe(session, user)` — all 9 deletes
- [ ] `_cascade_delete(session, user, ...)` — the 3 branches (accounts / debts / savings) and their sub-queries
- [ ] `create_record` — inject `user_id` from token, ignore any in body; `session.merge()` now upserts on `(user_id, id)`
- [ ] `update_record` / `delete_record` — `session.get(Model, (user.id, record_id))`
- [ ] `update_settings`
- [ ] `import_data`, `load_sample`, `reset_data` — scoped wipe, scoped insert

A **negative test per route** (user A cannot read/patch/delete user B's row → 404, not 403 —
don't leak existence) is the acceptance criterion here, not code review.

## A5. `recurring.py` scoping

`apply_due_transactions(session)` → `apply_due_transactions(session, user_id)`; all four
loops filter by user, and `account_ids` is built from that user's accounts only.

**Scaling note**: this runs on every `GET /api/data`. Single-user, that's fine. Multi-user it
stays fine (still one user's rows per request) — but it does mean a user with years of stale
`next_date` pointers pays the catch-up cost on their next login. The `MAX_CATCHUP_PERIODS = 24`
cap already bounds it. Leave as-is; revisit only if data grows.

## A6. Cross-deployment data transfer

The requirement: *"with multi user, new data can be transferred from other deployments"*.
Today `POST /api/data/import` **wipes and replaces**. That's wrong for this use case — someone
bringing data from another GradPlan instance into an account that already has data would lose
what's here. Two modes are needed:

### A6.1 Export envelope

`store.exportJSON()` currently emits the raw cache (`version: 1` + 10 keys). Wrap it:

```json
{
  "schemaVersion": 2,
  "exportedAt": "2026-09-01T12:00:00Z",
  "source": { "deployment": "gradplan-prod", "userId": "usr_…" },
  "data": { "settings": {…}, "income": […], … }
}
```

The importer must accept **both** the v1 bare shape (every backup anyone has today, plus
exports from un-migrated deployments) and v2. That back-compat is non-negotiable — it's what
makes "transfer from another deployment" work at all.

### A6.2 Import modes

- **`replace`** — current behaviour, scoped to the calling user. Keep for "restore my backup".
- **`merge`** — append the incoming data to what's already there. This is the cross-deployment
  path and needs **id remapping**, because two deployments can independently mint the same
  `id_…` string, and even when they don't, merging must not let an incoming record collide
  with an existing one.

### A6.3 The remap algorithm (`backend/transfer.py`, new module)

```
1. For each of the 9 collections, for each incoming record:
     if (user_id, incoming.id) already exists  →  assign a fresh server-side id
     else                                      →  keep the incoming id
   Record every change in  remap[collection][old_id] = new_id
2. Rewrite the 8 reference fields listed in §1 using remap:
     transactions.accountId / toAccountId  → remap["accounts"]
     transactions.debtId                   → remap["debts"]
     transactions.savingId                 → remap["savings"]
     income/expenses/subscriptions/installments .accountId → remap["accounts"]
   A reference pointing at an id not present in the payload is set to NULL,
   not left dangling (recurring.py already guards, but don't rely on it).
3. Insert everything in one transaction.
4. settings: merge mode never overwrites the user's currency/name.
5. Return the FullData snapshot + a summary { added: {...}, remapped: N }.
```

Tests for this module are the highest-value tests in Refactor A: two payloads with colliding
ids, a payload whose transactions reference accounts, a payload with a dangling reference, a
v1 (bare) payload, and an idempotency check (importing the same file twice in `merge` mode
doubles the data — that's correct and should be asserted, not accidental).

## A7. Existing web-app changes (`public/`)

Deliberately minimal — this frontend is going to be replaced, so do only what's needed:

- `api.js` — no change for cookie auth; add `Authorization` header support only if the token
  path is wanted early.
- `login.js` — email field instead of username; surface signup only if `SIGNUP_MODE=open`.
- `app.js` data menu — add "Import (merge)" alongside the existing import, and show the
  logged-in email somewhere (the sidebar footer already has the Log out button).
- `store.js` — `exportJSON()` emits the v2 envelope; `importJSON(text, mode)`.

## A8. Tests

New pytest files:

- `tests/test_multiuser_isolation.py` — the negative matrix from §A4 (every route × another user's record).
- `tests/test_auth_users.py` — signup gating, login by email, password change, per-account throttle, bearer-token path.
- `tests/test_transfer.py` — §A6.3's cases.
- `tests/test_migration.py` — build a v1-shaped SQLite DB, run the backfill logic, assert every row is owned and nothing was lost.

`conftest.py` needs `client` (user A) **and** `client_b` (user B) fixtures; existing fixtures
keep working by creating the owner user during setup instead of setting `AUTH_USERNAME`.
`test/calc.test.js` is untouched by all of this — Refactor A must leave all 65 green.

## A9. Rollout

1. Merge behind unchanged behaviour: with exactly one user, the app looks identical.
2. Migrate the Neon branch, rehearse, verify (§A2).
3. Migrate `main` during a quiet window; keep the pre-migration branch.
4. Remove `AUTH_USERNAME` / `AUTH_PASSWORD_HASH` from Vercel env **only after** confirming
   login works against the `users` table. `JWT_SECRET` stays.
5. Create the second user; re-run the isolation matrix against production.

---

# REFACTOR B — React Native (Expo, web + iOS + Android)

## B0. Decisions to confirm

| # | Decision | Recommendation | Why |
|---|---|---|---|
| B0.1 | Framework | **Expo (SDK 54+) + expo-router** | File-based routing, `expo export --platform web` covers the web target, EAS handles native builds |
| B0.2 | Language | **TS for the new app, plain JS for `packages/core`** | Keeps `calc.js` (968 lines) and its 65 tests running **unchanged** under `node --test`. Add JSDoc types for editor support; convert later if desired |
| B0.3 | Repo layout | **npm workspaces monorepo** | `packages/core` shared by the RN app and (during transition) the old web app |
| B0.4 | Styling | **StyleSheet factories driven by a theme object** (no NativeWind) | The 6 themes are token-driven already; a `useTheme()` + `makeStyles(theme)` pattern maps directly and avoids a second styling dialect |
| B0.5 | Old web app | **Keep `public/` serving until RN-web reaches parity** | No window where the app is unusable; also the reference implementation to diff against |
| B0.6 | Theme fidelity | **Web keeps full fidelity, native gets documented approximations** | Several CSS effects have no RN equivalent (§B3) — decide this up front rather than discovering it per-screen |

## B1. Monorepo + shared core

```
gradplan/
├── apps/
│   ├── mobile/          # Expo app → iOS, Android, web
│   └── web-legacy/      # today's public/, deleted at cutover
├── packages/
│   └── core/            # platform-free logic
├── backend/             # unchanged by Refactor B
├── test/                # calc.test.js keeps pointing at packages/core
└── tests/               # pytest
```

`packages/core` contents, in porting order:

| Module | Source | Change needed |
|---|---|---|
| `calc.js` | `public/js/calc.js` | **None.** Move file, update the test import path |
| `format.js` | `public/js/format.js` | None, but verify `Intl` on Hermes. Expo ships `Intl` support; if number/currency formatting misbehaves on Android, add `@formatjs/intl-*` polyfills. **Test this on day one** — `money()` is used on every screen |
| `constants.js` | `forms.js` top matter | Extract `FREQ_OPTIONS`, `EXPENSE_CATEGORIES`, `ACCOUNT_TYPES`, `TXN_TYPES`, `TXN_CATEGORIES`, `DEBT_DIRECTIONS`, … verbatim |
| `schemas.js` | `forms.js` `SCHEMAS` | Keep the field descriptors + `validate` functions; drop the HTML-rendering assumptions. Option-producing closures (`accountOptions()`) take `data` as an argument instead of reaching into the store |
| `charts-math.js` | `charts.js` | Arc/segment/scale math extracted; returns geometry, not SVG strings |
| `api.js` | `public/js/api.js` | Rewrite: injectable `getToken()`/`baseUrl`, throws a typed `UnauthorizedError` instead of `location.href = …` |
| `store.js` | `public/js/store.js` | Invert the `toast` dependency (`store.configure({ onError })`); everything else — optimistic write, rollback, cascade, undo snapshots — ports as-is |
| `themes.js` | `css/styles.css` token blocks | 6 theme objects (§B3) |

**Milestone B1**: `npm test` (the 65 calc tests) passes from the new location before any RN
code exists.

## B2. Expo scaffold

Blank Expo app building for **all three targets** before any real screen is written — catching
RN-web incompatibilities on day one is much cheaper than on screen 9. Deliverable: app boots,
`useTheme()` returns a theme, one styled `<Text>` renders on iOS simulator, Android emulator
and `expo start --web`.

Wire up: `expo-router`, `expo-secure-store`, `react-native-svg`, `expo-print`, `expo-sharing`,
`expo-document-picker`, `expo-file-system`, `@react-native-async-storage/async-storage`.

## B3. Theme translation — the honest fidelity table

The 6 themes lean heavily on CSS that RN's style engine simply doesn't have. Decide per effect
now:

| CSS feature | Used by | RN (native) | Plan |
|---|---|---|---|
| CSS custom properties | all themes | none | Theme objects + `useTheme()` |
| `clip-path` chamfers | dark/light | **unsupported** | `react-native-svg` frame component behind the card, or fall back to `borderRadius: 0` on native, full fidelity on web |
| Multi-layer `text-shadow` | dark, bauhaus, maximalism | single shadow only | Native: keep the strongest layer. Web: full stack via `Platform.select` |
| `background-clip: text` gradient | maximalism headings | **unsupported** | `MaskedView` + `expo-linear-gradient`, or solid accent on native |
| `backdrop-filter: blur()` | dark, maximalism | `expo-blur` | Direct swap (`BlurView`) |
| Repeating gradient patterns (dots/stripes) | all except neumorphism | no CSS backgrounds | `react-native-svg` `<Pattern>` layer component, rendered once behind content |
| Dual inset/outset shadows | neumorphism | **no inset shadows** | Native approximation: `react-native-shadow-2` or layered views. This theme loses the most; document it |
| Wobbly asymmetric `border-radius` (`/` syntax) | handdrawn | per-corner only, no ellipse | Approximate with 4 different corner radii — visibly close, not identical |
| `:hover` | all | no hover on touch | Web-only via `Pressable` hover props; native uses pressed state |
| `@keyframes` | maximalism, handdrawn | `Animated` / Reanimated | Port the 3 that matter (pulse-glow, gradient-shift, wiggle); respect `prefers-reduced-motion` equivalent |

**Recommendation**: implement themes in two tiers — `tokens` (colors, spacing, radii, fonts:
100% portable) and `effects` (per-platform, with native approximations). Ship dark/light/bauhaus
first (highest portability), then handdrawn/neumorphism/maximalism.

Fonts: all 8 families load via `expo-font` / `expo-google-fonts` instead of a `<link>`.

## B4. UI primitives (replacing `ui.js`)

| `ui.js` | RN replacement |
|---|---|
| `openModal` / `closeModal` / `initModalChrome` | `<Modal>` + a `ModalProvider` context; forms render as children instead of HTML strings |
| `toast(msg, kind, {actionLabel, onAction})` | Toast context + component. **The undo-action variant must survive** — it's how every delete works |
| `confirmDialog` | `<Alert>` on native / custom modal on web |
| `download(filename, text, mime)` | `expo-file-system` write + `expo-sharing` share sheet; on web keep the Blob+anchor path |

## B5. Data layer

`packages/core/store.js` (pub/sub) wrapped in a `StoreProvider` + `useStore()` hook. The
existing subscribe/notify model maps cleanly onto `useSyncExternalStore`, so React re-renders
where the old app called `render()`.

Auth: token in `expo-secure-store` (native) / cookie (web), read by `api.js`'s injected
`getToken()`. Session restore on cold start → `GET /api/auth/me`.

`localStorage` users today — `gradplan.theme`, `gradplan.effects`, `gradplan.lastTxn` (sticky
transaction prefill) — all move to `AsyncStorage`.

## B6. Navigation

| Now | After |
|---|---|
| Hash routes (`#income`) + `RENDERERS` map in `app.js` | `expo-router` file routes: `app/(tabs)/dashboard.tsx`, `app/(tabs)/transactions.tsx`, … |
| Sidebar (>900px) / bottom tab bar (<900px) | `useWindowDimensions()`: drawer+sidebar on wide, bottom tabs on narrow. Native is always the narrow layout |
| Drill-down modals (`data-drill`) | Modal route group (`app/(modals)/drill/[key].tsx`) |
| Keyboard shortcuts (`n`, `/`, `g`+`d/t/a/s`) | Web-only; keep behind `Platform.OS === 'web'` |

## B7. Screen-by-screen port (the bulk of the work)

Ordered easiest → hardest, so the component vocabulary is settled before the hard screens.
Each row is "done" when it renders the same numbers as the legacy app against the same account.

| # | Screen | Source | Notes / improvements |
|---|---|---|---|
| 1 | **Login** | `login.js` (43) | Email + password, signup link if enabled. Smallest possible first slice through the whole stack |
| 2 | **Income** | `renderIncome` (42) | Establishes the list-row + `+ Add` + swipe/menu-actions pattern reused by 4 screens |
| 3 | **Expenses** | `renderExpenses` (87) | Adds category grouping + share-of-total |
| 4 | **Subscriptions** | `renderSubscriptions` (100) | Renewal countdown |
| 5 | **Savings** | `renderSavings` (36) | Progress bars (first chart primitive) |
| 6 | **Debts** | `renderDebts` (70) | Two-direction totals |
| 7 | **Installments** | `renderInstallments` (43) | Amortization display; math already in `calc.js` |
| 8 | **Accounts** | `renderAccounts` (109) | Balances, per-account ledger, selection state, adjust-balance flow |
| 9 | **Dashboard** | `renderDashboard` (260) | Densest screen: stat tiles, donut, comparison bars, net-worth line, due-soon, budgets, onboarding checklist. Do it after the chart primitives exist |
| 10 | **Transactions** | `renderTransactions` (42) + filter/selection/pagination machinery | **Improvement: replace pagination with `FlatList` virtualization.** The existing `setPage`/`resetPage` state exists to keep the DOM small — a virtualized list removes that need. Keep filters + multi-select + bulk delete |
| 11 | **Statement** | `renderStatement` (59) + `statementCSV` + `statementDocument` (250) | Hardest. Period presets, month stepping, keyword chips, per-group filter bubbles, running balance, reconciliation. **Improvement: filters move to a bottom sheet on narrow screens** |
| 12 | **Guide** | `renderGuide` + `mdToHtml` | `public/guide.md` ships as a bundled asset; either keep the tiny markdown subset parser and render to RN components, or use `react-native-markdown-display` |

## B8. Forms

`forms.js`'s schema-driven design is the biggest asset in the port — keep the data, replace the
renderer:

- `<FormField>` switches on `field.type`: `text` (8 uses) → `TextInput`; `number` (15) →
  `TextInput` with `keyboardType="decimal-pad"`; `select` (21) → platform picker / action sheet;
  `date` (7) → `@react-native-community/datetimepicker`; `textarea` (9) → multiline `TextInput`.
- `visibleIf` predicates, `half` layout hints, `def` defaults, per-collection `validate()` —
  all carry over unchanged.
- Live previews (`previewInstallment`, `previewGoal`) become derived state — they already call
  pure `calc.js` functions.
- Preserve: submit disabled in-flight, modal stays open on failure with input intact, "Save &
  add another", sticky `accountId`/`type` prefill, category chips, date shortcuts.

## B9. Charts

`charts.js` builds SVG strings; `react-native-svg` gives the same primitives as components on
all three platforms. Port order: `progressBar` → `compareBars` → `donut` → `lineChart`.
Per-theme palettes come from `themes.js`. `<title>` tooltips become `onPress` → detail popover
(better on touch than hover anyway).

## B10. Platform capabilities

| Capability | Web today | Native |
|---|---|---|
| Print / save PDF | hidden iframe + `window.print()` | **`expo-print` `printToFileAsync({ html })`** — `statementDocument()` already returns a complete standalone HTML document, so this ports nearly free. Then `expo-sharing` |
| JSON/CSV export | Blob + `<a download>` | `expo-file-system` + share sheet |
| Import backup | `<input type="file">` | `expo-document-picker` |
| PWA manifest / install | `manifest.webmanifest` | Superseded by real app builds; keep the manifest for the web target |

## B11. Tests

- `test/calc.test.js` — **unchanged**, now importing from `packages/core`. This is the safety
  net for the entire port; it must stay green at every commit.
- Component tests with `@testing-library/react-native` for `<FormField>` (all 5 types) and the
  chart primitives.
- One end-to-end smoke per platform (Maestro or Detox on native, Playwright on web): log in →
  add a transaction → see it in the ledger → delete → undo.
- Backend suite untouched by Refactor B.

## B12. Cutover

Parity gate: all 12 screens ported, both test suites green, and a manual diff of Dashboard +
Statement numbers between legacy web and RN-web against the same account.

Then choose:
- **(a)** Replace `public/` with the `expo export` web build on Vercel, delete `apps/web-legacy`.
- **(b)** Keep the legacy static site for desktop and serve RN-web only where it wins.

Recommend (a) for maintenance (one frontend, not two) — but measure the exported bundle size
and first-paint against the current zero-build site before committing; a static vanilla app is
hard to beat on load time, and that's a real regression to accept knowingly rather than by
accident.

---

## 3. Cross-cutting: what must not regress

Behaviours that are easy to lose in a rewrite and are load-bearing here:

1. **Optimistic write + rollback + toast** on every mutation (`store.optimisticWrite`).
2. **Undo instead of confirm** for deletes — 6-second toast with an action.
3. **Cascade delete** for accounts/debts/savings, *and* its undo (`removeCascade` /
   `restoreCascade`), mirrored client and server.
4. **Idempotent create** — client-generated ids + `session.merge()`. This is what makes undo a
   clean restore; it survives into multi-user as `(user_id, id)`.
5. **Auto-pay catch-up** posting on load, with the `MAX_CATCHUP_PERIODS` cap and the
   `_payment_index` re-anchoring fix (see the comments in `recurring.py` — that logic was
   fixed once already; don't reintroduce the drift bug).
6. **Money stored in native frequency**, normalized at render via `toMonthly`/`toYearly` —
   never store a pre-converted monthly value.
7. **camelCase API ↔ snake_case DB** via `CamelModel`, and the blank-string → `None`
   validators (`forms.js` sends `''`, not `null`).
8. Statement/CSV/print all deriving from the single `statement()` function so the three always
   agree.

## 4. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Data loss during multi-user migration | Critical | Three independent snapshots, Neon-branch rehearsal, scripted row-count + snapshot-diff verification (§A2) |
| A missed `user_id` filter leaks data across users | Critical | Exhaustive negative test matrix (§A8), not code review |
| Id collision on cross-deployment merge | High | Remap + reference rewrite with tests (§A6.3) |
| Theme fidelity loss on native | Medium | Decided up front (§B3), tiered rollout, native approximations documented |
| `Intl` gaps on Hermes break currency formatting | Medium | Verify in B2 before any screen work; polyfill if needed |
| RN-web bundle heavier than the current static site | Medium | Measure at B12 before deleting the legacy app |
| Scope creep from "improvements while porting" | Medium | Only the three named in §B7 (virtualized transactions, statement filter sheet, touch popovers). Everything else goes to `improvement-plan.md` |

## 5. Suggested commit sequence

Refactor A: `users table + user_id columns` → `alembic + migration script` → `auth on users
table` → `scope routes to user` → `scope recurring` → `import merge + id remap` → `isolation
tests` → `web app login/import tweaks`.

Refactor B: `monorepo + move core` → `expo scaffold, 3 targets` → `theme tokens` → `ui
primitives` → `store/api hooks` → `login screen` → one commit per screen in §B7's order →
`print/export/import` → `e2e smoke` → `cutover`.

Repo commit style applies throughout: short, lowercase, casual, no AI attribution.
