# 💰 GradPlan — Financial Planner for New Graduates

A clean personal finance app for newly graduated students. Track your **income,
expenses, installments/loans, subscriptions, and savings goals** in one place,
with automatic calculations and clear visualizations.

Single-user, password-protected, backed by a Postgres database — reach your data
from any device, not just the browser you started in.

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
- **Light & dark themes**, fully responsive (works on phone).

---

## 🚀 Running it locally

Backend: Python 3.11+, a Postgres database (this project targets [Neon](https://neon.tech)).
Frontend: no build step.

```
env\Scripts\activate        # Windows — or: source env/bin/activate on macOS/Linux
pip install -r requirements.txt

copy .env.example .env      # macOS/Linux: cp .env.example .env
# fill in DATABASE_URL (Neon's pooled connection string) and JWT_SECRET

python scripts/hash_password.py   # prints an argon2 hash — paste as AUTH_PASSWORD_HASH in .env
                                   # also set AUTH_USERNAME in .env

python scripts/init_db.py   # creates tables in the database, run once

npm start                   # uvicorn app:app --reload → http://localhost:4173
```

Log in with the username/password you hashed above. There's no offline mode and
no sign-up flow — this app has exactly one account, configured via env vars.

---

## 🧮 Running the tests

The calculation engine (`public/js/calc.js`) is pure and unit-tested with Node's
built-in test runner — no dependencies:

```
npm test
```

This only covers the frontend math; it doesn't touch the backend or the database.

---

## 📂 Project structure

```
app.py                Vercel/uvicorn entrypoint — FastAPI app, mounts public/ locally
backend/
  db.py                SQLAlchemy engine (Neon pooled connection, NullPool)
  models.py            SQLModel tables
  schemas.py            Pydantic I/O (camelCase over the wire, snake_case in the DB)
  auth.py               argon2 + JWT cookie auth, login throttling
  routes.py              /api/* data routes
  seed.py                 sample dataset
scripts/
  init_db.py            create tables (run once)
  hash_password.py      generate AUTH_PASSWORD_HASH from a typed-in password
public/
  index.html             App shell + layout
  login.html              Login page
  css/styles.css         Theme-aware styling (light/dark)
  js/
    app.js                Routing, wiring, data import/export menu, logout
    api.js                Fetch wrapper for the backend
    login.js               Login page logic
    store.js               Client-side cache + optimistic writes against the API
    calc.js                Pure calculation engine (tested)
    format.js              Currency / date / number formatting
    charts.js               Dependency-free SVG charts (validated color palette)
    forms.js                Schema-driven add/edit forms with live previews
    views.js                 Screen renderers
    ui.js                    Modal / toast / confirm helpers
test/calc.test.js       Unit tests for the calculation engine
requirements.txt        Python dependencies
```

---

## 🔐 Auth & data

Single user, password + JWT in an httpOnly cookie, 30-day sliding session. There's
no password-reset flow — to change the password, re-run
`python scripts/hash_password.py` and update `AUTH_PASSWORD_HASH`. To sign every
session out at once (e.g. if the cookie ever leaked), rotate `JWT_SECRET`.

All data lives in the Postgres database — nothing is stored in the browser except
your theme preference. Use **⚙ Data → Export backup** to keep a copy or move it to
another server.

## 💱 Currency

Pick your currency from the top bar (USD, EUR, GBP, INR, CAD, AUD, JPY, PKR, AED,
SGD, HKD). The choice is saved to your account and applied everywhere.
