# Local development launcher

Starts (and stops) everything Web Design OS needs for local
development — Postgres, the API, and the web app — with one script per
platform. Platform-appropriate scripts on purpose: a `.sh` for macOS
and a `.bat`/`.ps1` pair for Windows, rather than one script trying to
paper over both shells. Both do exactly the same six things, in the
same order, against the same repository and the same
`docker-compose.yml` — there's no separate "Windows version" of the
app, just two ways to start it.

| | macOS | Windows 10/11 |
|---|---|---|
| Start | `scripts/start-mac.sh` | `scripts/start-windows.bat` |
| Stop  | `scripts/stop-mac.sh`  | `scripts/stop-windows.bat`  |

## Before the first run

The launcher **starts** the app — it doesn't set it up. Do the
one-time setup in the [repo README](../README.md#local-development)
once per machine first:

1. `apps/api/.venv` exists and dependencies are installed.
2. `apps/api/.env` exists and is filled in (`SESSION_SECRET`, `SEED_*`).
3. The database has been migrated and seeded (`alembic upgrade head`,
   `python -m app.core.seed`).
4. `apps/web/node_modules` exists (`npm install`).
5. `apps/web/.env.local` exists (copied from `.env.local.example`).

If any of these are missing, the launcher stops and tells you exactly
which one — it won't guess or half-start things.

You also need [Docker Desktop](https://www.docker.com/products/docker-desktop/)
installed. The launcher starts it for you if it isn't already running.

## Using it

**macOS:**
```
./scripts/start-mac.sh
```
(Or open it from Finder — see "Making the scripts double-clickable"
below if double-clicking opens it in a text editor instead of running
it.) When it's done, your browser opens to the login page. To stop
everything:
```
./scripts/stop-mac.sh
```

**Windows:** double-click `scripts\start-windows.bat` in File
Explorer. A console window opens and reports progress; when it's done,
your browser opens to the login page. Double-click
`scripts\stop-windows.bat` to stop everything. (Windows may show a
"Windows protected your PC" SmartScreen prompt the first time you run
a downloaded `.bat` — click **More info → Run anyway**. This is normal
for any script you didn't get from the Microsoft Store, not something
specific to this one.)

### What each start script actually does

1. Checks Docker is installed and running (starts Docker Desktop if
   it's installed but not running, and waits for it).
2. Runs `docker compose up -d postgres` and waits until Postgres
   actually accepts connections (not just "the container started").
3. Starts the API (`uvicorn app.main:app --reload --port 8000`) and
   waits for `GET /health` to return `{"status": "ok"}`.
4. Starts the web app (`next dev --port 3000`) and waits until it
   actually answers on `http://localhost:3000`.
5. Opens `http://localhost:3000/login` in your default browser.

Before starting the API or web app, each script checks whether it's
already running (by asking the API's `/health` endpoint, and by
checking whether the web app answers) — if so, it leaves it alone
instead of starting a second copy. If something *else* is already
using port 8000 or 3000, it stops and tells you, rather than silently
trying to share the port.

If any step fails — Docker won't start, Postgres never becomes ready,
the API crashes on boot — the script stops immediately, prints what
failed, and (for the API/web steps) prints the last 20 lines of that
service's log so you can see why, instead of continuing on to open a
browser tab that won't work.

### What the stop scripts do

They stop whatever is actually listening on ports 8000 and 3000 (after
checking it looks like this app's process, not some unrelated program
that happens to be using that port), then stop the Postgres container
with `docker compose stop postgres`. Your database data isn't deleted
— `docker compose stop` (not `down`) leaves the container and its data
volume in place, so the next start picks up right where you left off.

### Logs and process state

Each start writes logs to `scripts/.logs/api.log` and
`scripts/.logs/web.log` — check these first if something's behaving
oddly, or if a start attempt failed partway through. `scripts/.run/`
holds the process ids the launcher is tracking. Both directories are
git-ignored; delete either at any time, they're just runtime
scratch state, not configuration.

## Making the scripts double-clickable

**Windows:** `.bat` files run on double-click by default — nothing to
configure.

**macOS:** `.sh` files usually open in a text editor when double-clicked,
not Terminal. Easiest fix: right-click the file in Finder → **Get
Info** → **Open with** → **Terminal.app** → **Change All**. After that,
double-clicking `start-mac.sh` opens Terminal and runs it. Running it
from a terminal (`./scripts/start-mac.sh`) always works regardless of
this setting.

## Ports this uses

| Service  | Port |
|---|---|
| Web app (Next.js) | 3000 |
| API (FastAPI)      | 8000 |
| Postgres            | 5432 |

If you already have something else running on 3000 or 8000, the
launcher will tell you rather than conflicting with it silently — free
the port, or stop the other thing, and run the launcher again.
