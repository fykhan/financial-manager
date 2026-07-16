# 💰 GradPlan — Financial Planner for New Graduates

A clean, zero-setup personal finance app for newly graduated students. Track your
**income, expenses, installments/loans, subscriptions, and savings goals** in one
place, with automatic calculations and clear visualizations.

No accounts, no servers, no database. Everything lives privately in your own
browser (localStorage), and you can export a backup or a spreadsheet any time.

---

## ✨ Features

- **Dashboard** — monthly income, expenses, net cash flow and savings rate at a
  glance, plus a spending-by-category donut, income-vs-expenses comparison, debt
  and goals health, and a "renewing soon" alert.
- **Income** — multiple sources at any frequency (weekly → yearly), auto-normalized
  to a monthly figure.
- **Expenses** — categorized recurring costs with each item's share of your total.
- **Installments / loans** — enter principal, term, APR and start date; it
  auto-computes the monthly payment, remaining balance, lifetime interest, payoff
  date and progress (proper amortization when interest is involved).
- **Subscriptions** — recurring services with billing cycle, monthly cost and next
  renewal countdown.
- **Savings goals** — target, amount saved, monthly contribution → projected
  completion date and whether you're on track for a deadline.
- **Automatic calculations** — frequency normalization, net cash flow, savings
  rate, debt-to-income ratio, amortization schedules and goal projections.
- **Easy input / output** — quick modal forms with live previews; export to
  **JSON** (full backup) or **CSV** (spreadsheet); import a backup; print or save
  as PDF.
- **Light & dark themes**, fully responsive (works on phone), and offline-capable.

---

## 🚀 Running it

It's a static site — no build step.

**Option A — just open it**

```
open index.html      # macOS
# or double-click index.html
```

**Option B — local server** (recommended, avoids browser module restrictions)

```
npm start
# → open http://localhost:4173
```

You can also use any static server, e.g. `python3 -m http.server`.

---

## 🧮 Running the tests

The calculation engine (`js/calc.js`) is pure and unit-tested with Node's built-in
test runner — no dependencies:

```
npm test
```

---

## 📂 Project structure

```
index.html          App shell + layout
css/styles.css      Theme-aware styling (light/dark)
js/
  app.js            Routing, wiring, data import/export menu
  store.js          Data model + localStorage persistence + sample data
  calc.js           Pure calculation engine (tested)
  format.js         Currency / date / number formatting
  charts.js         Dependency-free SVG charts (validated color palette)
  forms.js          Schema-driven add/edit forms with live previews
  views.js          Screen renderers
  ui.js             Modal / toast / confirm helpers
test/calc.test.js   Unit tests for the engine
server.js           Zero-dependency static dev server
```

---

## 🔐 Privacy

All data stays in your browser. Nothing is uploaded anywhere. Use **⚙ Data →
Export backup** to keep a copy or move it to another device.

## 💱 Currency

Pick your currency from the top bar (USD, EUR, GBP, INR, CAD, AUD, JPY, PKR, AED,
SGD, HKD). The choice is saved and applied everywhere.
