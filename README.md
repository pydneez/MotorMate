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

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js 20+](https://nodejs.org/)
- [pnpm](https://pnpm.io/installation) (`npm install -g pnpm`)

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
   The defaults work as-is for local development — no edits needed to get running.
   Already have a `frontend/.env` from before the API moved under `/v1`? Change
   `NEXT_PUBLIC_API_URL` to `http://localhost:8080/v1`.

3. **Start local Postgres**
   ```bash
   docker compose up -d
   ```
   This starts a Postgres 16 container on `localhost:5433` (mapped from the container's
   internal 5432, to avoid clashing with any native Postgres install on your machine) with
   a named volume, so your data survives container restarts. Check it's healthy with:
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

## Everyday commands

| Command | What it does |
|---|---|
| `docker compose up -d` | Start local Postgres (run once per machine reboot / after `down`) |
| `docker compose down` | Stop Postgres (data is preserved in the volume) |
| `docker compose down -v` | Stop Postgres **and delete all local data** — use to reset a broken local DB |
| `npm run db:studio` | Open a GUI to browse/edit local DB data |
| `npm run db:migrate` | Apply schema changes after pulling new migrations |
| `npm run db:seed` | Populate sample data (safe to re-run, upserts) |
| `pnpm lint` | Lint both apps |
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
- Never commit `.env` — only `.env.example` should be in git.

## Project structure

```
frontend/        Next.js frontend
backend/          NestJS backend
packages/types/  Shared TypeScript types used by both apps
docker-compose.yml
```