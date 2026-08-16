# Web Design OS

Private internal tool for running a solo web-design business. Read
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
cp .env.example .env            # fill in SESSION_SECRET and OPERATOR_*
./.venv/bin/python -m app.core.generate_password_hash   # → OPERATOR_PASSWORD_HASH
./.venv/bin/alembic upgrade head
./.venv/bin/uvicorn app.main:app --reload --port 8000
```

### 3. Web (`apps/web`)

```
cd apps/web
npm install
cp .env.local.example .env.local
npm run dev
```

Then visit `http://localhost:3000/login` and sign in with the operator
email/password set in `apps/api/.env`.

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
