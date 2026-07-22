# GradPlan improvement-plan — progress

Tracking execution of `.claude/improvement-plan.md`. One commit per phase item, repo commit style
(short, lowercase, no AI attribution). `node --test` is green as of last commit.

## Done (committed)

- **Phase 1.1** global "+ Log" quick-add — topbar `#btn-log-txn` (always visible), `#btn-add-primary`
  demoted to non-primary and still contextual, mobile `#fab-log` FAB. Commit `240bf6c`.
- **Phase 1.2 + 1.3** fast-entry transaction form (all in `forms.js`) — amount-first field order,
  category chips (`topCategoriesThisQuarter`), Today/Yesterday date shortcuts, description
  `<datalist>` autocomplete with prefill, sticky `accountId`/`type` in `localStorage`
  (`gradplan.lastTxn`), "Save & add another", `openForm(collection, id, { prefill, onSaved })` options
  bag, `data-add-prefill` on Savings/Debts "+ Add transaction" + per-card `＋` buttons. Commit `3e073ed`.
- **Phase 2** undo instead of confirm — `ui.js toast(msg, kind, { actionLabel, onAction, duration })`,
  `store.restore(collection, record)`, single + bulk delete now delete-then-undo-toast (6s); confirm
  kept only for Data-menu reset/import/sample. Commit `d95c9c8`.
- **Phase 3.1** PWA manifest — `public/manifest.webmanifest`, SVG icons in `public/icons/`
  (`icon.svg` + `icon-maskable.svg`), linked from `index.html`/`login.html`, no service worker (noted
  in CLAUDE.md). Commit `2056fe4`.

## In progress — WORKING TREE IS DIRTY (Phase 4, not yet committed)

- **Phase 4.1** Transactions top-level view — DONE in code: `renderTransactions` in `views.js`,
  registered in `RENDERERS` + `VIEW_TITLES` (`app.js`); Accounts ledger slimmed to `recentAccountsLedger`
  (recent 10 + "View all →" to `#transactions`).
- **Phase 4.2** grouped sidebar — DONE in code: Track/Plan/Report `nav-group-label`s in `index.html`
  + `.nav-group-label` CSS. Transactions nav item added.
- **Phase 3.2** bottom tab bar (mobile) — DONE in code: `<nav class="bottom-nav">` in `index.html`
  (Home / Txns / **+** center / Report / More), CSS `.bottom-nav*` (< 900px, safe-area padding, FAB
  hidden below the breakpoint, view-container + toast-host cleared), wired in `app.js` (view tabs →
  `navigate()`, center → `quickLog`, More → sidebar sheet, active tab synced in `render()`).
- **Phase 6.1** ledger search + filters — DONE: module `txnFilter = { text, category, accountId }` in
  `views.js` (`setTxnFilter`/`clearTxnFilter`, cleared on `navigate()`/hashchange); `txnFilterControls`
  now renders a debounced search box, most-used category chips, and an account select;
  `applyTxnFilter` applied in `txnAccountsListFragment` (combined with `accountFilter`). Search patches
  only `#list-txn-accounts` (keeps focus); chips/select full-render. Page reset on filter change.
- **Phase 6.2** account-card "⧩ Filter" ghost button (`data-account-filter`, shows "Filtering" when
  active) beside the whole-card click, handled before the card in `app.js`.
- **Phase 5.1** month-over-month spend delta — `statTile` gained `sub2`/`sub2Class`; `spendDeltaLine`
  builds "↓ 8% spent vs Jun" from `monthlySpendComparison` (null-safe, hidden when no prev month) on
  the Monthly-expenses tile.
- **Phase 5.2** "Last month in review" recap panel — `monthlyRecapPanel` reuses `statement()` with
  `presetRange('last-month')`; money in/out/net/saved tiles, top-3 categories, biggest expense;
  "Full statement →" (`data-recap-statement`) sets the last-month preset + navigates.
- **Phase 5.3** Due-soon "Mark paid" — non-auto-pay rows get `data-mark-paid="kind:id"`; opens a
  prefilled expense form and, `onSaved`, rolls the source record's next-due date forward via
  `nextOccurrence`. Dashboard nav items (sidebar + bottom) show a `dueSoon(data, 3)` count badge
  updated in `render()`.
- **TODO before committing Phase 4:** also add Transactions to the **bottom nav** — but that's Phase 3.2,
  do it there. Just commit 4.1 + 4.2 as-is next.

## Remaining (not started)

- **Phase 4.3** naming — rename Expenses page section headings to "Recurring expenses" / "Budgets"
  (nav label stays "Expenses").
- **Phase 8.6** onboarding checklist (dashboard first-run panel; localStorage dismiss flag).
- **Phase 7.1–7.4** theme + a11y pass. Focus trap + `restore` groundwork ALREADY in `ui.js`/`store.js`.
  Remaining: effects toggle (`data-effects`), color-semantics cleanup, typography (drop uppercase from
  table cells/buttons/labels), inline field errors, `--muted` contrast bump, icon-button `aria-label`s.
- **Phase 8.1–8.5** polish — selection re-render patching, statement month stepping `‹ ›`, currency
  "(no conversion)" label (partly done in topbar title attr), custom categories ("Other…"), keyboard
  shortcuts (`n`, `/`, `g`+`d/t/a/s`).

## Groundwork already in tree from before this session (uncommitted-then-committed under 240bf6c)

`calc.js`: `addDays`, `nextOccurrence`, `monthlySpendComparison`, `dueSoon` extra fields + tests.
`store.js`: `restore`. `ui.js`: focus trap + toast action. These back Phases 5 and 7.4.

## Sequencing to follow next (per plan table)

8.6 → 7.1–7.4 → 8.1–8.5.
Test gate: `node --test` green; add tests for any new `calc.js` fn (5.x helpers already tested).
