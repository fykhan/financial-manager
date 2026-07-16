# Handoff: GradPlan → FastAPI + Neon + Vercel migration

Written on Windows, continuing in WSL. This file is self-contained — everything
needed to pick this up is below, no need to reach into `C:\Users\Dell\.claude\...`
(the plan file lives there but is duplicated in full here so WSL doesn't need it).

## Where things stand

**Done and pushed to `origin/main`:**
- Moved `index.html`, `css/`, `js/` → `public/` (commits `de4dd61`, then the user's
  own follow-up commit `d9d508e` "move to public").
- `server.js` temporarily points at `public/` (it gets deleted entirely once
  uvicorn takes over in step 5 of the work order below).
- `test/calc.test.js` import path fixed to `../public/js/calc.js`.
- `CLAUDE.md` got a new "Commit messages" section (see Conventions below) — note
  `CLAUDE.md` is gitignored in this repo, so it exists on disk but was never
  committed; that's a pre-existing repo choice, not something to "fix".
- `.gitignore` now excludes `env/`, `.venv/`, `.claude/`, `.env`, `.env.*`
  (keeps `.env.example`).

**Not started:** everything backend. No `app.py`, no `backend/`, no `requirements.txt`,
no `.env` yet. Task list (steps 2–7 below) is untouched.

**Pre-existing bug, not caused by this migration, not yet fixed:** `npm test` has
one failing test — `addMonths rolls the calendar forward` in `test/calc.test.js`,
off by one day, looks like a DST edge case. Confirmed present on the original
code too (verified via `git stash` + rerun before the restructure commit). Ask
the user whether to fix it now or later — it was an open question when the
session cut over.

## Repo hygiene things to know about

- **Line-ending churn**: Windows git has `core.autocrlf=true` globally. The
  user's commit `d9d508e` shows every line of every moved file as changed —
  that's CRLF conversion noise, not real edits. Check `git config core.autocrlf`
  in WSL before touching these files again; if it differs from the Windows
  setting, the next commit will show the same full-file-rewrite noise in
  reverse. Consider a `.gitattributes` with `* text=auto eol=lf` to stop the
  churn for good — optional cleanup, ask before doing it since it touches
  every file's line endings again.
- **`.claude/settings.local.json` is already committed to git** (from before
  `.claude/` was added to `.gitignore`). It only contains local permission
  allowlist entries, no secrets. Adding `.claude/` to `.gitignore` stops future
  changes from being tracked but does not untrack this file — that needs
  `git rm --cached .claude/settings.local.json` if the user wants it gone.
  Haven't done this; not asked to.
- **`env/` is a broken Linux venv** (`pyvenv.cfg`: `home = /usr/bin`, Python
  3.10.12) sitting untracked in the repo root. On Windows, `env/bin/python3`
  is a symlink to `/usr/bin/python3`, which doesn't exist — confirmed dead,
  `env/bin/python3 --version` fails with "No such file or directory". This is
  almost certainly because it was originally created *in WSL* — which means it
  may just work once you're actually running in WSL. First thing to check:
  `env/bin/python3 --version`. If it works, great, reuse it. If not, recreate:
  `rm -rf env && python3 -m venv env` (keep the name `env/` since that's what's
  gitignored and what the user referred to — don't rename to `.venv` unless
  they ask).

## Decisions already locked in (do not re-litigate, just implement)

From earlier planning rounds with the user:

- **Storage**: Neon Postgres. User has already created a Neon project directly
  at neon.com (not via the Vercel marketplace integration) — so env vars are
  **not** auto-injected into any Vercel project. Get the connection string
  from the Neon console (Dashboard → project → Connection Details). Grab
  **both** the pooled string (`...pooler...`, use as `DATABASE_URL`) and the
  direct one (`DATABASE_URL_UNPOOLED`) — Neon's console shows both.
- **Data shape**: relational tables, one per collection, mirroring
  `public/js/forms.js`'s `SCHEMAS` (see field lists in the Data model section
  of the full plan below).
- **Auth**: single user, password + argon2 hash + JWT in an httpOnly/Secure/
  SameSite cookie, 30-day sliding expiry. No 2FA, no passkeys.
- **No offline mode.** Server is the sole source of truth. Start the account
  empty — no migration path from any browser's old localStorage data.
- **Branch**: work goes directly on `main` (already established — see commits
  above). No feature branch.
- **Local dev**: plain `uvicorn`, not `vercel dev`. Local `DATABASE_URL` points
  at the same Neon project (there is no local Postgres install).
- **Python version**: target **3.12** to match Vercel's default runtime. Windows
  host only had 3.11.4 and no 3.12 — check what's available in WSL; install
  3.12 if it's easy, but 3.11 is an acceptable fallback if that's what's on hand
  (just means a version-specific bug would only ever show up in prod, which is
  a known tradeoff, not a blocker).
- **Vercel account**: user already has one. Nothing needed from it until the
  final deploy step. Don't provision anything there yet.
- **Commit style** (now codified in `CLAUDE.md`): short, lowercase, casual,
  no fluff, **never mention Claude/AI, never add a Co-Authored-By line.**
  This overrides the default Claude Code commit-message convention — follow
  the repo's `CLAUDE.md`, not the harness default, for every commit here.
- **Secrets discipline**: the user should never paste the Neon connection
  string, the login password, or the JWT secret into chat. They fill in a
  local `.env` themselves. `scripts/hash_password.py` (not yet written) will
  let them generate an argon2 hash locally from a password that never leaves
  their machine.

## Work order (steps 2–7 of 7; step 1 is done)

Each step should leave the app runnable. Mirrors the task list (task IDs #2–#7
in this conversation's tracker — that tracker is session-scoped and won't
carry over, so re-create with TaskCreate if picking this up as a fresh session,
using the subjects below):

2. **Backend skeleton** — `app.py` (FastAPI `app`, Vercel auto-detects it),
   `backend/db.py` (SQLAlchemy engine: pooled `DATABASE_URL`, `NullPool`,
   `pool_pre_ping=True`, rewrite `postgresql://` → `postgresql+psycopg://`),
   `backend/models.py` (SQLModel tables per the Data model section below),
   `scripts/init_db.py` (`SQLModel.metadata.create_all()`, run manually, no
   Alembic). Verify tables actually land in Neon before moving on.
3. **Auth** — `backend/auth.py` (argon2 verify, JWT cookie, `require_auth`
   dependency, sliding 30-day expiry), login routes (`POST /api/auth/login`,
   `POST /api/auth/logout`, `GET /api/auth/me`), `public/login.html` +
   `public/js/login.js`, a small `login_attempts` table for throttling
   (10 failures / 15 min / IP — in-memory counters don't survive serverless
   instances), `scripts/hash_password.py`.
4. **Data routes** — `backend/schemas.py` (Pydantic with `alias_generator=
   to_camel`, `populate_by_name=True` — API stays camelCase, DB stays
   snake_case, so `calc.js`/`views.js` need zero changes), `backend/routes.py`:
   `GET /api/data`, `POST/PATCH/DELETE /api/{collection}`, `PATCH /api/settings`,
   `POST /api/data/import|sample|reset`. `backend/seed.py` ports the sample
   dataset from `public/js/store.js`'s `withSample()`.
5. **Frontend swap** — `public/js/api.js` (fetch wrapper, `credentials:
   'same-origin'`, 401 → redirect to login). Rewrite `store.js`'s `persist()`
   to fire a background HTTP call instead of writing localStorage; mutations
   still update the in-memory cache and notify listeners **synchronously first**
   (so `getData()`/`getById()`/`exportJSON()`/`exportCSV()`/`getSettings()`
   all stay sync — only two files import `store.js`: `app.js` and `forms.js`),
   roll back + toast on failure. New `store.init()` does `GET /api/data`,
   awaited before first render in `app.js`'s now-async `boot()`. `forms.js`'s
   submit handler (currently sync, toasts "Saved" and closes the modal on the
   same tick with no failure path) becomes `async`, disables the submit button
   in flight, moves `closeModal()` into the success branch. Delete `server.js`.
6. **Docs** — rewrite `CLAUDE.md`'s "What this is" (currently says
   "zero-backend, client-side... no runtime dependencies" — both false now)
   and `README.md` to describe the real architecture, commands, env vars, and
   the JWT-rotation kill switch.
7. **Deploy** — connect the Neon project's connection string into Vercel as
   env vars (manual, since it wasn't provisioned through Vercel's own
   integration), set `AUTH_USERNAME`/`AUTH_PASSWORD_HASH`/`JWT_SECRET`, set
   `main` as the production branch (`origin/HEAD` currently points at
   `claude/student-financial-planner-g9axwk`, not `main` — this needs fixing
   explicitly in Vercel's project settings, don't rely on the default). Deploy
   to preview, run through the full login → add → refresh → edit → delete →
   logout loop, then promote to production.

## Full plan reference (data model, API surface, verification steps)

The complete original plan — architecture diagram, per-table column lists,
the Neon pooling rationale, exact API routes, and the verification checklist
— is at `C:\Users\Dell\.claude\plans\glowing-squishing-panda.md` on the
Windows side (reachable from WSL at
`/mnt/c/Users/Dell/.claude/plans/glowing-squishing-panda.md` if that mount is
available). If it's not reachable, the summaries above cover every decision;
the only thing not fully repeated here is the exact per-table column list,
which is quick to regenerate from `public/js/forms.js`'s `SCHEMAS` object
(that's what the tables mirror 1:1, snake_cased).

## First things to do in the new session

1. `env/bin/python3 --version` — see if the venv already works under WSL.
2. Get the Neon connection strings from the Neon console into a local `.env`
   (gitignored, never in chat).
3. Confirm `npm test` still passes (minus the one pre-existing failure noted
   above) and `npm start` still serves the app from `public/`.
4. Resume at work-order step 2 (backend skeleton).
