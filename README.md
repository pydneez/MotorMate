# MotorMate

A cloud-based Car Maintenance & Service Management System — centralizes customer and
vehicle records, tracks full service history, manages the work-order lifecycle, tracks
parts inventory, and sends maintenance reminders.

DES424 Cloud-based Application Development · Thammasat SIIT

For architecture, stack decisions, and conventions, see [`CLAUDE.md`](./CLAUDE.md) — it's
kept up to date as the single source of truth and doubles as onboarding context.

## Tech stack

Next.js + NextAuth.js (frontend) · NestJS + Prisma (backend) · PostgreSQL · AWS
(ECS Fargate containers behind an ALB, API Gateway for HTTPS, RDS, S3, SES, EventBridge)

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — **start it before
  the steps below** (the whale icon must say "running")
- [Node.js 22 LTS](https://nodejs.org/)
- pnpm 11 — the repo pins the exact version; the simplest way to get it is
  `corepack enable` (ships with Node), or `npm install -g pnpm@11`
- Access to the GitHub repository (the owner adds you under **Settings → Collaborators**)

On Windows, run the commands in Git Bash or PowerShell from the repo folder.

## Getting started

1. **Clone the repo**
   ```bash
   git clone <repo-url> MotorMate
   cd MotorMate
   ```

2. **Copy environment files** — there are three separate `.env.example` files, each
   scoped to what that part of the app actually reads (root for Docker Compose, one per
   app):
   ```bash
   cp .env.example .env
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```
   The defaults work as-is — no edits needed. They're **local-only** development values
   (your database only listens on your own machine), so there's nothing to ask a teammate
   for and nothing to keep secret. Never reuse them on AWS; the deploy scripts generate
   their own.

3. **Start the local database**
   ```bash
   docker compose up -d
   ```
   This starts Postgres 16 (the same version as AWS) on `localhost:5433` — not the usual
   5432, so it can't clash with a Postgres installed on your machine — plus pgAdmin, an
   optional database browser, at http://localhost:5050 (sign in with
   `PGADMIN_DEFAULT_EMAIL` / `PGADMIN_DEFAULT_PASSWORD` from the root `.env`). Data lives in
   a Docker volume, so it survives restarts. Check it's healthy with:
   ```bash
   docker compose ps
   ```

4. **Install dependencies**
   ```bash
   pnpm install
   ```

5. **Apply the database schema and load sample data**
   ```bash
   npm run db:migrate
   npm run db:seed
   ```
   `db:migrate` creates the tables and then generates the Prisma client (the typed
   database code the backend uses — Prisma 7 no longer does that step on its own).
   Sample logins (all with password `password123`): `admin@motormate.example`,
   `advisor@motormate.example`, `mechanic@motormate.example`, and the customer
   `jordan.lee@example.com`.

6. **Run the apps**
   ```bash
   npm run dev:backend     # backend API on http://localhost:8080/v1
   npm run dev:frontend    # frontend on http://localhost:3000
   ```
   Run these in two terminal tabs. `npm run` just looks up the script name in
   `package.json` — pnpm still needs to be installed, since each script's body is
   `pnpm --filter <name> dev` (`--filter` runs a script in one workspace package,
   matched by its `package.json` `name` (`backend`/`frontend`), not its directory name).
   Both scripts first build the shared `packages/types` package (`npm run build:types`);
   if you edit shared types while the apps are running, re-run that command.

7. **Open the app** at http://localhost:3000 and sign in with one of the sample logins
   above — each role (admin, advisor, mechanic, customer) sees a different dashboard.

### Just want to try the app? (Docker only)

If you only want to test the app — not develop it — you don't need Node or pnpm. After
steps 1–2 (clone, copy the env files), run:

```bash
docker compose --profile app up --build
```

This builds the same container images that run on AWS, sets up the database (migrations
and sample data), and serves the app at http://localhost:3000 — sign in with the sample
logins above. The first build takes a few minutes. Stop it with `Ctrl+C`, then
`docker compose --profile app down`. It uses ports 3000 and 8080, so stop any
`npm run dev:*` servers first.

### Something not working?

- **`Can't reach database server` / authentication failed** — Docker Desktop isn't
  running, or your `.env` files weren't copied from the examples. `docker compose ps`
  should show `motormate-postgres` as healthy.
- **Port 5433, 3000 or 8080 already in use** — another copy of the app (or another
  project) is running; stop it, or change the port in `docker-compose.yml` and the
  matching `.env` value.
- **Login says "Can't reach the server"** — the backend isn't running (step 6), or
  `NEXT_PUBLIC_API_URL` in `frontend/.env` doesn't end in `/v1`.

## Everyday commands

| Command | What it does |
|---|---|
| `docker compose up -d` | Start local Postgres (run once per machine reboot / after `down`) |
| `docker compose down` | Stop Postgres (data is preserved in the volume) |
| `docker compose down -v` | Stop Postgres **and delete all local data** — use to reset a broken local DB |
| `npm run db:studio` | Open a GUI to browse/edit local DB data |
| `npm run db:migrate` | Apply schema changes after pulling new migrations, then regenerate the Prisma client |
| `npm run db:generate` | Regenerate the Prisma client only (e.g. after switching branches) |
| `npm run db:seed` | Populate sample data (safe to re-run, upserts) |
| `npm run typecheck` | Type-check every package |
| `npm run test` | Run unit tests in every package |
| `npm run test:integration` | Run backend tests against a real Postgres (`motormate_test` database — create it once, see below) |

### Integration test database

Integration tests use their own database so they never touch your dev data. Create it once
(use the `POSTGRES_USER` from your root `.env`):

```bash
docker exec motormate-postgres psql -U <POSTGRES_USER> -d motormate -c "CREATE DATABASE motormate_test"
```

The tests apply migrations to it automatically and wipe it before and after each run.

## Working with teammates

Everyone runs their **own** local Postgres via Docker — nobody shares a database for
day-to-day dev. To keep local data consistent enough to be useful:

- Always pull and run new Prisma migrations after pulling `main` (`npm run db:migrate`).
- Use `npm run db:seed` to populate sample data (one login per role, three customers
  with Thai phone numbers and plates, ten inventory parts, an open and a completed work
  order, and a pending appointment) instead of hand-creating test records. Safe to
  re-run — it won't duplicate rows.
- Never commit `.env` — only `.env.example` should be in git. Local `.env` values
  (database password, `JWT_SECRET`, `NEXTAUTH_SECRET`) are per machine and never need
  sharing; AWS secrets are generated per account into the gitignored `infra/.secrets/`.
  If a real secret ever must be shared, use a shared password-manager vault (e.g.
  Bitwarden or 1Password) — never Git, chat, or Jira.

## Deploying to AWS

Each team member can run the whole app in their own AWS Academy Learner Lab account with
`bash infra/scripts/up.sh`, and must tear it down with `bash infra/scripts/down.sh` before
ending the lab session. Full guide: [infra/README.md](infra/README.md).

## Project structure

```
frontend/        Next.js frontend
backend/          NestJS backend
packages/types/  Shared TypeScript types used by both apps
infra/           AWS deployment (CloudFormation + scripts)
docker-compose.yml
```