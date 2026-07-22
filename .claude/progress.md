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
- **Phase 4.3** naming — Expenses page now has explicit "Recurring expenses" + "Budgets" section
  headings (each with its own add button); nav label stays "Expenses".
- **Phase 8.6** onboarding checklist — `onboardingChecklist(data)` first-run dashboard panel: 5 steps
  (account → income → expense → savings goal → first txn), done-state derived from counts, "Add →"
  per step, "load sample data", dismiss flag in `localStorage` (`gradplan.onboardDismiss`). Replaces
  the bare empty state and shows on the populated dashboard until all done/dismissed. `data-onboard`
  handled in `app.js`.
- **Phase 5.3** Due-soon "Mark paid" — non-auto-pay rows get `data-mark-paid="kind:id"`; opens a
  prefilled expense form and, `onSaved`, rolls the source record's next-due date forward via
  `nextOccurrence`. Dashboard nav items (sidebar + bottom) show a `dueSoon(data, 3)` count badge
  updated in `render()`.
- **Phase 7.1** effects toggle — `data-effects` on `<html>` (default `subtle`, `localStorage
  gradplan.effects`), sidebar-footer "▓ Effects" button, `applyEffects`/`toggleEffects` in `app.js`.
  `:root[data-effects="subtle"]` dims scanline/grid and drops the RGB-split + glitch-jitter on
  `.glitch-text`/`.brand-text strong`/`.view-title` for a single clean glow.
- **Phase 7.2** color semantics — input value text → `--text-1`, placeholder → `--muted`, field labels
  → `--text-2`, table headers → `--text-2`; base `.badge` now neutral (border `--border-2`), magenta
  moved to opt-in `.badge.accent`.
- **Phase 7.3** typography — dropped uppercase/wide letter-spacing from `.btn`, `.field label`,
  `.input-sm` (kept on headings, nav, stat/table-header labels).
- **Phase 7.4** a11y — inline field errors (`validate` returns `{ field, message }`;
  `showFieldError`/`clearFieldErrors` set `aria-invalid`/`aria-describedby` + `.field-error`, toast only
  for cross-field); dark `--muted` bumped to `#7d8590`; `aria-label` on edit/delete icon buttons. Focus
  trap already in `ui.js`.

- **Phase 8.1** selection re-render — `patchLists(collection)` in `app.js` re-renders only the affected
  `list-*` fragment(s) (transactions → txn-accounts/savings/debts) on select/select-all instead of a
  full `render()`, avoiding the scroll jump. Falls back to `render()` if no container found.
- **Phase 8.2** statement month stepping — `‹ ›` buttons beside the presets; `stepStatementMonth(±1)` +
  `isSingleMonth` in `views.js` step a single-calendar-month period, disabled for multi-month ranges.
- **Phase 8.3** currency honesty — topbar `title="Display currency (no conversion)"` (already) + a note
  in the Data modal that amounts aren't converted.
- **Phase 8.4** custom categories — category selects flagged `custom: true` get an "Other…" option that
  reveals a `[data-custom-for]` text input; `getValues` resolves `__custom__` to the typed value;
  off-list values round-trip on edit (extra selected `<option>`). Backend columns are plain strings.
- **Phase 8.5** keyboard shortcuts — `wireKeyboardShortcuts()` in `app.js`: `n` new txn, `/` focus
  ledger search (navigating to Transactions first), `g` then `d/t/a/s` jump to view; ignored while
  typing or a modal is open. Hint added to the Data modal.

## ALL PLAN PHASES COMPLETE

Every item in `improvement-plan.md` (Phases 1–8) is implemented and committed on `main`.
`node --test` green (56). No manual browser smoke test was possible this session (needs DB/login).

## Groundwork already in tree from before this session (uncommitted-then-committed under 240bf6c)

`calc.js`: `addDays`, `nextOccurrence`, `monthlySpendComparison`, `dueSoon` extra fields + tests.
`store.js`: `restore`. `ui.js`: focus trap + toast action. These back Phases 5 and 7.4.
