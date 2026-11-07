# Deploying MotorMate to AWS

Everything needed to run MotorMate in AWS: three CloudFormation stacks and a few Bash
scripts. Any team member can bring the whole environment up, and tear it down again, with
one command each. The same scripts deploy in two modes, picked automatically:

| | **learner-lab** (your Learner Lab dev account) | **full** (the course's demo account) |
|---|---|---|
| HTTPS front door | API Gateway HTTP API (CloudFront is denied) | **CloudFront**; static files cached |
| Load balancer | port 80 open to anywhere | **only CloudFront**: its address list + a secret header, anything else gets 403 |
| IAM | `LabRole` for everything (no roles can be created) | **one least-privilege role per job** |
| Secrets | hidden stack parameters → container env vars | **Secrets Manager** (`motormate/app-…`, `motormate/db-…`) |
| Frontend → API (server side) | through the load balancer | private DNS: `backend.motormate.local` (Cloud Map) |

`up.sh` uses **learner-lab** when you're signed in as a Learner Lab session (the
`voclabs` role) and **full** otherwise; `--lab` / `--full` override it.

Learner-lab mode:

```
Browser ──HTTPS──▶ API Gateway HTTP API  (https://<id>.execute-api.us-east-1.amazonaws.com)
                        │ every path, proxied
                        ▼
                  Load balancer :80 ── /v1, /v1/* ──▶ backend  (NestJS, 2 containers)
                                  └── everything else ──▶ frontend (Next.js, 1 container)
                                                              │
     backend containers ──5432──▶ RDS PostgreSQL (isolated subnets, encrypted, 7-day backups)
     container logs ──▶ CloudWatch: /motormate/backend, /motormate/frontend
```

Full mode (demo account, `--multi-az --frontend-count 2`):

```
Browser ──HTTPS──▶ CloudFront (https://<id>.cloudfront.net)   /_next/static/* cached
                        │ + X-Origin-Verify header
                        ▼
                  Load balancer :80  (CloudFront only; anything else → 403)
                        ├── /v1, /v1/* ──▶ backend  × 2 (one per AZ)
                        └── everything else ──▶ frontend × 2 (one per AZ)
                                                   │ server-side API calls
                                                   └──▶ backend.motormate.local:8080
     backend ──5432──▶ RDS PostgreSQL primary (AZ a) ⇄ standby (AZ b)
     secrets ──▶ Secrets Manager → injected into the containers at start
```

| Stack | Template | What's in it | After `down.sh` |
|---|---|---|---|
| `motormate-base` | `cloudformation/base.yml` | VPC, 2 public + 2 isolated subnets, security groups, ECR repos (backend, migrate, frontend), ECS cluster, invoice-PDF S3 bucket (private, encrypted, HTTPS-only, only the backend + whoever runs the scripts), SNS topic for customer emails, log groups; in full mode the 5 IAM roles | kept (pennies; SNS email is free at this volume) |
| `motormate-db` | `cloudformation/db.yml` | RDS PostgreSQL 16, `db.t3.micro` (Multi-AZ with `--multi-az`); the migrate task definition | deleted (re-seeded by `up.sh`) |
| `motormate-app` | `cloudformation/app.yml` | load balancer, 2 ECS services, the HTTPS front door (CloudFront or API Gateway), daily-jobs Lambda + 2 EventBridge Scheduler schedules (09:00, 18:30 Bangkok); in full mode the app secret and the private DNS namespace | deleted |

**Roles in full mode** (each can do only what's listed):

| Role | Used by | Allowed |
|---|---|---|
| `ExecutionRole` | ECS, starting any task | pull images, write logs, read `motormate/*` secrets |
| `BackendTaskRole` | the API containers | S3 get/put on `invoices/*` in our bucket (and list it, so a missing PDF is a 404); SNS publish/subscribe/unsubscribe/read subscriptions on our topic |
| `NoPermissionsTaskRole` | frontend, migrations | nothing |
| `JobsFunctionRole` | the daily-jobs Lambda | its logs, read `motormate/*` secrets |
| `SchedulerRole` | EventBridge Scheduler | invoke `motormate-daily-jobs` only |

Why learner-lab mode looks like this (tested Oct 2026): CloudFront is denied and Amplify's
role is restricted, so HTTPS comes from API Gateway and the frontend is a container too; no
IAM roles can be created, so every container uses `LabRole`. In both modes a NAT Gateway
would cost more than the rest together, so containers sit in public subnets behind
security groups that only accept traffic from the load balancer (and, for the backend,
the frontend).

## Before you start

- **Git Bash** (comes with Git for Windows), the **AWS CLI v2**, and **Docker Desktop**
  running. On Windows, run the scripts from Git Bash, not PowerShell or WSL.
- Check that Git Bash can find the AWS CLI: `aws --version`. If it says "command not
  found", open a **new** Git Bash window (one opened before the install doesn't see it), or
  add it to your profile once:

  ```bash
  echo 'export PATH="$PATH:/c/Program Files/Amazon/AWSCLIV2"' >> ~/.bashrc && source ~/.bashrc
  ```

  (A per-user install lives in `/c/Users/<you>/AppData/Local/Programs/Amazon/AWSCLIV2`.)
  Without it every script stops with "AWS credentials missing or expired".
- Start the lab (AWS Academy → Learner Lab → **Start Lab**), then **AWS Details → AWS CLI:
  Show** and paste the three lines into `~/.aws/credentials` under `[default]`. They expire
  with the session — repeat every time. Check with `aws sts get-caller-identity`.
- Region `us-east-1` (override with `AWS_REGION=us-west-2`).

## Daily use

```bash
bash infra/scripts/up.sh        # ~15 min from nothing (RDS is the slow part); prints the site URL
bash infra/scripts/smoke.sh     # health, login page, sign-in, an authenticated API call
bash infra/scripts/status.sh    # what's running and roughly what it costs
bash infra/scripts/down.sh      # BEFORE you end the lab session
```

**Always run `down.sh` when you stop working.** Learner Lab keeps resources running — and
billing — after the session ends. While up, the environment costs about **$0.10/hour**.

Sign in with the seeded logins (password `password123`): `admin@`, `advisor@`,
`mechanic@motormate.example`, customer `jordan.lee@example.com`.

### Finding the site URL

The site lives at the API Gateway address, `https://<id>.execute-api.us-east-1.amazonaws.com`
(learner-lab mode) or the CloudFront address, `https://<id>.cloudfront.net` (full mode).
It's a new address every time the app stack is created (after `down.sh` → `up.sh`), so look
it up rather than bookmarking it. `up.sh` prints it at the end; afterwards:

```bash
aws cloudformation describe-stacks --stack-name motormate-app \
  --query "Stacks[0].Outputs[?OutputKey=='SiteUrl'].OutputValue" --output text
```

In the AWS console (region **N. Virginia, us-east-1**):

- **CloudFormation** → Stacks → `motormate-app` → **Outputs** tab → `SiteUrl`, or
- **API Gateway** → APIs → `motormate` → **Invoke URL** on the API's page (the `$default` stage), or
- **CloudFront** → Distributions → "MotorMate" → **Distribution domain name** (full mode).

`LoadBalancerUrl` on the same Outputs tab is the plain-HTTP load balancer — only for
debugging in learner-lab mode (sign-in needs the HTTPS `SiteUrl`); in full mode it answers
every request with 403.

## All scripts

| Script | What it does |
|---|---|
| `up.sh [--multi-az\|--single-az] [--frontend-count N] [--lab\|--full]` | base → database + images (in parallel) → migrations → app → seed. Safe to re-run: it updates what changed. Options you leave out keep their deployed value. |
| `build-push.sh` | builds the three images (backend, migrate, frontend), tags them with the git commit (`-dirty` if uncommitted), pushes to ECR. Skips images already pushed. |
| `migrate.sh` | runs `prisma migrate deploy` as a one-off container from the small migrate image. |
| `seed.sh` | runs the seed as a one-off backend container (`node dist-seed/prisma/seed.js`); upserts, so re-running is harmless. `--demo` adds ~6 months of demo history instead (`seed-demo.js`; runs once) — use it on the demo account. |
| `smoke.sh` | end-to-end check through the HTTPS address: login, roles, reports + CSV, list filters, visits, invoice PDF, daily jobs; in full mode also that the load balancer refuses direct requests (403) and that pages come through CloudFront. |
| `status.sh` | stack states and mode, running containers, database (Multi-AZ or not), cost per hour. |
| `failover-test.sh [--tasks\|--all]` | high-availability check: polls the site every 2 s while forcing an RDS failover to the standby (and/or stopping one task per service), then reports how long requests failed. |
| `down.sh [--keep-db]` | deletes the app stack and the database (or keeps it with `--keep-db`). |
| `nuke.sh [--yes]` | deletes all three stacks, ECR images and logs. Dry run without `--yes`. |
| `cleanup-lab-check.sh` | removes leftovers from `LEARNER_LAB_CHECKLIST.md` (the one-off lab test). |

Secrets (`DB_PASSWORD`, `JWT_SECRET`, `NEXTAUTH_SECRET`, `JOB_TOKEN`, `ORIGIN_SECRET`) are
generated on the first `up.sh` into `infra/.secrets/<account-id>.env` (gitignored) and
passed to CloudFormation as hidden (`NoEcho`) parameters. Learner-lab mode hands them to
the containers as environment variables; full mode stores them in Secrets Manager and the
containers read them at start. Don't commit or share that folder.

## Deploying a new version

Commit, then run `up.sh` again: it builds images for the new commit and ECS rolls the
containers over one at a time (the backend keeps one container serving). Database
migrations run first, as a one-off task (`migrate.sh`), so new containers never start
against an old schema. The API image doesn't contain the Prisma CLI — that's what keeps it
small — so migrations have their own image.

Upgrading an environment created before the migrate step existed: run `down.sh` first —
the ECS cluster moved from the app stack to the base stack.

## Demo account (Nov 8–17)

The course's demo account is a shared AWS account with an IAM user per team (not Learner
Lab), so it deploys in **full** mode. Put its keys in an AWS CLI profile (here
`motormate-demo`) and point the scripts at it:

```bash
export AWS_PROFILE=motormate-demo
aws sts get-caller-identity                                   # your des424-… user
bash infra/scripts/up.sh --multi-az --frontend-count 2        # ~20–25 min the first time
bash infra/scripts/seed.sh --demo                             # 6 months of demo history
bash infra/scripts/smoke.sh
bash infra/scripts/failover-test.sh --all                     # HA check; note the numbers
```

- Other teams use the same account: the scripts only touch `motormate-*` stacks, the
  `motormate` cluster and our own resources, so they can't affect anyone else's.
- Only the person who ran `up.sh` can empty the invoice bucket (`nuke.sh`) — the bucket
  policy allows the backend and that deployer. Someone else should run `up.sh` first.
- Leave it running through the presentation (≈ $0.13/hour with Multi-AZ and 4 containers);
  the dev account keeps the nightly `down.sh`. After the course: `nuke.sh --yes`.

## When something goes wrong

- **A stack fails:** the script prints the failing resources and reasons. CloudFormation
  rolls back by itself; fix and re-run `up.sh`. A stack stuck in `ROLLBACK_COMPLETE` must
  be deleted first (`down.sh`, or `nuke.sh --yes`).
- **Containers keep restarting:** CloudWatch → Log groups → `/motormate/backend` or
  `/motormate/frontend`. ECS's circuit breaker rolls a bad deployment back.
- **Expired credentials:** every script stops with "AWS credentials missing or expired" —
  refresh `~/.aws/credentials`.
- **Customer emails:** SES is blocked in Learner Lab, so they go through SNS. Each email
  address is subscribed automatically and its owner clicks "Confirm subscription" in AWS's
  email once (it can land in spam). To test, sign up with your own address (or give a
  seeded customer your address), confirm, then press **Run daily jobs now** on the
  Reminders page. Subscriptions are per address and live on the topic in the base stack,
  so a confirmed address stays confirmed across `down.sh`/`up.sh` (`nuke.sh` deletes them).
  If you click AWS's **Unsubscribe** link, that address gets no more emails — test with a
  fresh address (Gmail `you+motormate2@gmail.com` works) or delete the subscription in the
  SNS console first. Emails that couldn't be sent show as "Not sent" under Sent emails.
- **Daily jobs:** logs in CloudWatch → `/aws/lambda/motormate-daily-jobs`; run one by hand
  with `aws lambda invoke --function-name motormate-daily-jobs --cli-binary-format
  raw-in-base64-out --payload '{"job":"morning"}' out.json`. The schedules only exist while
  the app stack is up.
- **API Gateway** has a 30-second request limit (CloudFront's origin timeout is set to 30 s
  too); the slowest MotorMate request is well under a second. Plain-HTTP fallback for dev:
  the `LoadBalancerUrl` stack output.
- **Full mode, 403 "Forbidden" on the site:** the load balancer didn't get CloudFront's
  secret header — usually `ORIGIN_SECRET` in `infra/.secrets/<account>.env` changed
  without re-running `up.sh`. Re-run it.
- **Full mode, a task won't start ("ResourceInitializationError … secret"):** the execution
  role can only read secrets named `motormate/*`; check the task's stopped reason in the
  ECS console.
- **Full mode, a new CloudFront distribution** takes ~5–10 minutes to create and ~10 to
  delete; `up.sh` / `down.sh` wait for it.
