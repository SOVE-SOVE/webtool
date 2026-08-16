# Web Design OS

Private internal tool for running a small web-design business (a
workspace shared by a couple of people). Read
[`docs/00_VISION.md`](docs/00_VISION.md) first — everything else in this
repo should trace back to it. Full architecture:
[`docs/02_ARCHITECTURE.md`](docs/02_ARCHITECTURE.md).

## Stack

- `apps/web` — Next.js (TypeScript), the operator dashboard + client-
  approval pages.
- `apps/api` — FastAPI (Python), all business logic, the database, AI
  agents, and third-party integrations.
- PostgreSQL, one database, owned by `apps/api`.

## Local development

### 1. Database

```
docker compose up -d postgres
```

### 2. API (`apps/api`)

```
cd apps/api
python3.12 -m venv .venv        # 3.12, not 3.14 — see docs/05_DECISIONS.md
./.venv/bin/pip install -r requirements.txt
cp .env.example .env            # fill in SESSION_SECRET and SEED_*
./.venv/bin/python -m app.core.generate_password_hash   # → SEED_ADMIN_PASSWORD_HASH
./.venv/bin/alembic upgrade head
./.venv/bin/python -m app.core.seed   # creates the first workspace + admin user
./.venv/bin/uvicorn app.main:app --reload --port 8000
```

### 3. Web (`apps/web`)

```
cd apps/web
npm install
cp .env.local.example .env.local
npm run dev
```

Then visit `http://localhost:3000/login` and sign in with the admin
email/password from the seed step above. That admin can create
teammate accounts from Settings once signed in — see
`docs/01_REQUIREMENTS.md` "Multi-user & workspace".

## Checks

```
# apps/api — needs `docker compose up -d postgres` running first
# (tests use the webdesignos_test database created alongside webdesignos)
cd apps/api
./.venv/bin/alembic check      # models vs. migrations haven't drifted
./.venv/bin/pytest             # real integration tests, real Postgres

# apps/web
cd apps/web
npm run lint
npm run test                   # vitest
npm run build                  # type-checks + production build
```

## Deploying

Not yet automated — this is local-only until an operator account exists
on a host. See "To be decided" in `docs/02_ARCHITECTURE.md` for the
target platforms (Vercel for `apps/web`; a Python-friendly host for
`apps/api`; Neon/Supabase for production Postgres).
