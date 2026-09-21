# GradPlan UI/UX Improvement Plan

Source: comprehensive repo review (2026-07-21). Goal: reduce logging friction, clarify the
plan-vs-actual split, improve legibility — the levers that drive daily use and retention.

Conventions that constrain every change below (from CLAUDE.md + code):
- No framework, no build step. Views are template-string functions in `views.js`; interactivity is
  event delegation via `data-*` attributes handled in `app.js`'s `wire()`.
- Store mutations are optimistic with rollback (`store.js optimisticWrite`). IDs are client-generated
  (`uid()`), and the backend `POST /api/{collection}` uses `session.merge()` — re-creating a deleted
  record with its old id is a clean upsert. This is what makes Undo (Phase 2) cheap.
- Any new financial math goes in `calc.js` (pure, DOM-free) with tests in `test/calc.test.js` using
  `approx()`.
- New record fields touch 4 places: `backend/models.py`, `backend/schemas.py` (+ blank-string
  validator for optional number/date), `backend/seed.py`, `forms.js` SCHEMAS.

---

## Phase 1 — Logging friction (highest retention impact)

### 1.1 Global "+ Log" quick-add, available everywhere
Problem: adding a transaction requires navigating to Accounts/Savings/Debts and finding the section
button. On Dashboard the topbar "+ Add" is hidden entirely (`app.js:41`).

- Topbar: keep the contextual "+ Add" (adds current view's collection) but add a second,
  always-visible **"+ Log"** button (`id="btn-log-txn"`) that opens the transaction form from any
  view, including Dashboard. On Dashboard show only "+ Log".
- Mobile: render "+ Log" as a fixed floating action button (FAB), bottom-right, above the toast host
  (only under the 900px breakpoint; hide when the bottom nav's center "+" exists — see 3.2, the FAB
  is superseded by it).
- Wire in `app.js wire()`; the FAB lives in `index.html` (static chrome, not a view).

### 1.2 Fast-entry transaction form
All in `forms.js`, transactions schema only:
- **Field order**: amount first (autofocus, `inputmode="decimal"`), then description, then the rest.
  `ui.js openModal()` already focuses the first field — reordering the schema is enough.
- **Category chips**: below the category select, render the user's 5 most-used categories this
  quarter as tappable chips (compute from `store.getData().transactions`; module-local helper in
  forms.js — it's data-derived UI, not financial math, so it doesn't need calc.js). Clicking a chip
  sets the select.
- **Sticky defaults**: remember last-used `accountId` and `type` in `localStorage`
  (`gradplan.lastTxn`) and use as `def` when adding (never when editing).
- **Date shortcuts**: "Today / Yesterday" mini-buttons next to the date field.
- **Save & add another**: second submit button; on success, re-open a fresh form (keep date +
  account, clear amount/description) and toast. Implement as a `data-act="save-add"` button whose
  handler sets a flag before the same submit path runs.
- **Description autocomplete**: `<datalist>` fed by unique past descriptions (most recent 50).
  When a datalist description is picked, prefill category + account + amount from the most recent
  matching transaction (listen for `input` on the description field, exact match against history).

### 1.3 Context-aware prefill
`openForm(collection, id, { prefill } = {})` gains an options bag (backward compatible):
- Prefill values are applied like `record` values for an add form (merge under `record ?? prefill`).
- Savings page "+ Add transaction" → `prefill: { type: 'savings' }`; Debts page →
  `{ type: 'debt' }`. Pass through a new `data-add-prefill` attribute on those buttons
  (JSON-encoded), read in `app.js`'s `[data-add]` handler.
- Per-card actions (optional, same mechanism): a "+ " button on a savings/debt card prefills the
  specific `savingId`/`debtId`.
- Ensure `applyVisibility()` runs after prefill so conditional fields show correctly.

Acceptance: from any view, a repeat expense is loggable in ≤ 4 interactions (open, amount,
description-pick, save).

---

## Phase 2 — Undo instead of confirm

Replace delete confirm dialogs with an undo toast. Applies to single delete (`app.js` `[data-del]`,
`forms.js` delete button) and bulk delete (`[data-bulk-delete]`).

- `ui.js`: extend `toast(message, kind, { actionLabel, onAction, duration })` — renders an inline
  button; clicking it runs `onAction` and dismisses. Default duration for undo toasts: 6s.
- `app.js`: on delete, snapshot the record(s) first (`store.getById`), call `store.remove()`
  immediately (no confirm), toast `Deleted "name" · Undo`. Undo calls `store.add(collection, rec)`
  — but `store.add` regenerates the id, so add `store.restore(collection, record)` that POSTs the
  record verbatim (keeps original id/createdAt; `session.merge` upserts it). Bulk: restore all.
- Keep `confirmDialog` ONLY for the destructive-at-scale actions in the Data menu (reset all,
  import, load sample).
- Edge cases: deleting an account that transactions reference — transactions keep the dangling
  `accountId` and views already render `'—'` for unknown accounts, so undo restores consistency;
  no special handling needed. Toast host must remain clickable (it already is, `z-index 60`).

---

## Phase 3 — Mobile: installable + bottom nav

### 3.1 PWA manifest
- Add `public/manifest.webmanifest`: name GradPlan, `display: standalone`, theme/background colors
  from the dark palette (`#0a0a0f`), `start_url: /`.
- Icons: generate `public/icons/icon-192.png`, `icon-512.png`, and a maskable variant from the ₲
  brand mark (script it with a small SVG→PNG step, or hand-place SVG icons — manifest accepts SVG
  with `"type": "image/svg+xml"`; prefer SVG to avoid binary assets in the repo).
- Link from `index.html` and `login.html` (`<link rel="manifest">`, `theme-color` meta,
  `apple-touch-icon`).
- No service worker (app is online-only by design); note this in CLAUDE.md.

### 3.2 Bottom tab bar (mobile only)
- `index.html`: add `<nav class="bottom-nav">` with 5 slots: Dashboard, Transactions (see 4.1),
  **+ Log** (center, primary-styled), Statement, More.
- "More" opens the existing sidebar as a sheet (reuse `.sidebar.open`).
- CSS: hidden ≥ 900px; fixed bottom, `env(safe-area-inset-bottom)` padding; the view container
  gets bottom padding on mobile so content isn't covered (already has 60px — bump as needed).
- Highlight active tab from `navigate()` alongside the sidebar `aria-current` sync.
- The hamburger `menu-toggle` stays (top-left) but becomes secondary.

---

## Phase 4 — Information architecture

### 4.1 Transactions as a top-level view
- New `renderTransactions(data)` in `views.js`: the full ledger currently embedded in Accounts
  (`txnAccountsListFragment`) promoted to its own page, plus (from 6.1) search + category filter
  chips + account filter dropdown. Accounts keeps its cards, net-worth chart, and a *recent* 10-row
  ledger with "View all →" linking to `#transactions`.
- Register in `RENDERERS`, `VIEW_TITLES`, sidebar nav, bottom nav. `viewTitle`, hash routing, and
  "+ Add" contextual behavior all follow automatically from the existing registry pattern.

### 4.2 Grouped sidebar
- Three labelled groups (plain `<div class="nav-group-label">`, not collapsible):
  - **Track**: Dashboard, Transactions, Accounts
  - **Plan**: Income, Expenses, Installments, Subscriptions, Savings, Debts
  - **Report**: Statement
- Pure `index.html` + CSS change; nav click delegation is unchanged.

### 4.3 Naming
- Keep collection keys/URLs stable (server contract). Display-name only: "Expenses" view title →
  "Recurring costs" is tempting but the Expenses page also hosts Budgets; decision: rename the
  *section headings inside* the page ("Recurring expenses", "Budgets") and leave nav label
  "Expenses". Revisit after 4.1 ships.

---

## Phase 5 — Dashboard: context, recap, actionable due-soon

### 5.1 Month-over-month deltas (calc.js + tests)
- New `monthlySpendComparison(data, refISO)` in `calc.js`: posted expense-transaction totals for
  the ref calendar month vs. the previous month (reuse `inCalendarMonth` generalized to accept a
  month offset, or add `monthWindow(refISO, offset)` helper). Returns
  `{ current, previous, deltaPct | null }` (null when previous === 0 — don't show a fake %).
- Dashboard tiles: append sub-lines like `↓ 8% vs Jun` with pos/neg class. Only when transaction
  data exists for both months.
- Tests: fixed `refISO` across month boundaries, empty-previous-month, year rollover (Jan vs Dec).

### 5.2 Monthly recap panel
- Dashboard panel "Last month in review" (renders only if last month had posted transactions):
  money in/out/net (reuse `statement(data, from, to)` with last month's bounds — already computes
  everything), top 3 categories, biggest single expense, savings net. Link "Full statement →" that
  sets the statement preset to `last-month` and navigates (`setStatementPreset` is already
  exported).

### 5.3 Actionable "Due soon"
- Each non-auto-pay row (no `accountId` on the source record) gets a **Mark paid** button:
  `data-mark-paid="kind:id"` → opens the transaction form prefilled (type expense, amount, name as
  description, today, category best-guess) via the 1.3 prefill mechanism. On successful save,
  advance the source record's next date by one cycle (`addMonths`/cycle-aware helper in calc.js —
  subscriptions advance `nextRenewal` by their cycle, expenses `nextDate` by frequency; needs a
  small `nextOccurrence(dateISO, frequency)` helper + tests). Wire the advance through the form's
  submit success path (pass an `onSaved` callback into `openForm` options).
- Nav badge: small count on the Dashboard tab/nav item when `dueSoon(data, 3)` is non-empty.
  Recompute inside `render()`.

---

## Phase 6 — Find things: search & filters

### 6.1 Ledger search + filters (Transactions view)
- Module-level filter state in `views.js` (same pattern as `accountFilter`/`spendMode`):
  `{ text, category, accountId }`, cleared on `navigate()`.
- Controls above the register: text input (`data-txn-search`, `input` event with ~200ms debounce,
  patches only `#list-txn-accounts` innerHTML via `LIST_FRAGMENTS` — do NOT full-render per
  keystroke or the input loses focus), category chip row, account select.
- Filtering is display-only slicing before `paginate()`.

### 6.2 Account-card filter discoverability
- Add an explicit filter icon/label on account cards ("⧩ Filter" ghost button) in addition to the
  whole-card click; keep the `title` tooltip.

---

## Phase 7 — Visual design & accessibility

Theme identity stays (cyberpunk is the brand); this phase removes its legibility taxes. All in
`styles.css` unless noted.

### 7.1 Effects toggle
- New setting `settings.effects: 'on' | 'subtle'` (default `'subtle'`), persisted like currency
  (touches `backend/models.py` settings row, `schemas.py`, and the settings PATCH — or, simpler and
  chosen: `localStorage` like theme, since it's per-device taste). Toggle button in sidebar footer.
- `'subtle'`: scanline overlay opacity → 0.25, grid → 0.25, disable `glitch-jitter` animation and
  the RGB-split text-shadow on `.view-title`/`.brand-text` (single clean glow instead).
- Implement via `:root[data-effects="subtle"]` overrides of `--scanline-op`, `--grid-op`, plus
  animation/text-shadow resets.

### 7.2 Color semantics cleanup
- Inputs: value text `--text-1` (not neon green); placeholder `--muted` (not magenta). Focus ring
  stays green.
- Field labels: `--text-2` instead of `--accent-2`.
- Table headers: `--text-2`, keep the tinted background.
- Reserve `--good/--warning/--serious/--critical` strictly for status; audit `.badge` defaults
  (base badge magenta → neutral border like `.badge.cat`; magenta only for genuinely accented
  chips).

### 7.3 Typography
- Drop `text-transform: uppercase; letter-spacing` from: table cells (headers keep it), buttons
  (`.btn`), field labels, `.input-sm`. Keep for `h2/h3` headings, nav items, stat labels.
- Body/table text stays JetBrains Mono (identity + tabular numbers are genuinely useful here).

### 7.4 Accessibility
- Modal focus trap in `ui.js`: keydown Tab handler cycling focusables inside `.modal`; store the
  opener element and restore focus on `closeModal()`.
- Inline field errors: `validate()` failures highlight the offending field (`aria-invalid`,
  `.field-error` message under it, `aria-describedby`) instead of only a toast. Toast stays for
  server failures.
- Bump `--muted` in dark mode to `#7d8590` (≥ 4.5:1 on `#0a0a0f` at the sizes used); re-check
  light-mode `#667085` on `#f2f4f3` (passes).
- `aria-label`s on the icon-only edit/delete buttons already exist as `title` — add matching
  `aria-label`.

---

## Phase 8 — Polish batch

- **8.1 Selection re-render**: checkbox `[data-select]`/`[data-select-all]` handlers currently
  full-`render()` (scroll jump). Patch only the list fragment + bulk bar via `LIST_FRAGMENTS`
  (bulk bar is inside the fragment already — verify per fragment).
- **8.2 Statement month stepping**: `‹ ›` buttons beside presets; when active period is a single
  calendar month, step month±1 (new preset value `custom` with computed bounds; `setStatementRange`
  exists). Disable `›` beyond the current month? No — future months are valid (scheduled txns).
- **8.3 Currency label honesty**: tooltip/label → "Display currency (no conversion)"; add the same
  note in the Data modal.
- **8.4 Custom categories**: allow free-text category. In `forms.js`, category selects get an
  "Other…" option that swaps the select for a text input (`data-custom-category` handler). Budgets
  and `spendingByCategory` already key by string, so custom values flow through everything,
  including the backend (category columns are plain strings). Chips (1.2) surface the user's own
  categories automatically.
- **8.5 Keyboard shortcuts** (`app.js`, ignore when typing in an input/modal open): `n` → quick-add
  transaction, `/` → focus ledger search (navigating to Transactions first if needed), `g` then
  `d/t/a/s` → dashboard/transactions/accounts/statement. Small help hint in the Data modal.
- **8.6 Onboarding checklist** (from review §3): Dashboard first-run panel replacing the bare empty
  state — steps: add account → income → recurring expense → savings goal → first transaction. Each
  step's done-state derives from data counts (no new persistence); a "dismiss" flag in
  `localStorage`. Panel also links "Load sample data". Shows until all done or dismissed.

---

## Sequencing & sizing

| Order | Phase | Size | Depends on |
|---|---|---|---|
| 1 | 1.1–1.3 quick-add + fast form + prefill | M | — |
| 2 | 2 undo | S/M | — |
| 3 | 3.1 manifest | S | — |
| 4 | 4.1–4.2 Transactions view + grouped nav | M | — |
| 5 | 3.2 bottom nav | S | 4.1 |
| 6 | 6.1–6.2 search/filters | M | 4.1 |
| 7 | 5.1–5.3 deltas, recap, mark-paid | M/L | 1.3 (prefill), calc tests |
| 8 | 8.6 onboarding checklist | S | 1.1 |
| 9 | 7.1–7.4 theme + a11y pass | M | do late; touches everything visually |
| 10 | 8.1–8.5 polish | S each | 6.1 for 8.5's `/` |

Testing gates per phase: `node --test` green (add tests for every new calc.js function: 5.1
comparison, 5.3 nextOccurrence); manual smoke of add/edit/delete/undo on desktop + 375px mobile
emulation; print statement still clean (`@media print` untouched by 7.x).

Commit style: one commit per phase item, short lowercase messages (repo convention), no AI
attribution.
