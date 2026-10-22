# Deploying MotorMate to AWS (Learner Lab)

Everything needed to run MotorMate in **your own** AWS Academy Learner Lab account:
three CloudFormation stacks and a few Bash scripts. Any team member can bring the whole
environment up, and tear it down again, with one command each.

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

| Stack | Template | What's in it | After `down.sh` |
|---|---|---|---|
| `motormate-base` | `cloudformation/base.yml` | VPC, 2 public + 2 isolated subnets, security groups, ECR repos (backend, migrate, frontend), ECS cluster, invoice-PDF S3 bucket (private, encrypted, HTTPS-only, LabRole/voclabs only), SNS topic for customer emails, log groups | kept (pennies; SNS email is free at this volume) |
| `motormate-db` | `cloudformation/db.yml` | RDS PostgreSQL 16, `db.t3.micro`; the migrate task definition | deleted (re-seeded by `up.sh`) |
| `motormate-app` | `cloudformation/app.yml` | load balancer, 2 ECS services, API Gateway, daily-jobs Lambda + 2 EventBridge Scheduler schedules (09:00, 18:30 Bangkok) | deleted |

Why it looks like this (Learner Lab limits, tested Oct 2026): CloudFront is denied and
Amplify's role is restricted, so HTTPS comes from API Gateway and the frontend is a
container too; no IAM roles can be created, so every container uses `LabRole`; a NAT
Gateway would eat the $50 budget, so containers sit in public subnets behind security
groups that only accept traffic from the load balancer.

## Before you start

- **Git Bash** (comes with Git for Windows), the **AWS CLI v2**, and **Docker Desktop**
  running. On Windows, run the scripts from Git Bash, not PowerShell or WSL.
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

The site lives at the API Gateway address, `https://<id>.execute-api.us-east-1.amazonaws.com`.
It's a new address every time the app stack is created (after `down.sh` → `up.sh`), so look
it up rather than bookmarking it. `up.sh` prints it at the end; afterwards:

```bash
aws cloudformation describe-stacks --stack-name motormate-app \
  --query "Stacks[0].Outputs[?OutputKey=='SiteUrl'].OutputValue" --output text
```

In the AWS console (region **N. Virginia, us-east-1**):

- **CloudFormation** → Stacks → `motormate-app` → **Outputs** tab → `SiteUrl`, or
- **API Gateway** → APIs → `motormate` → **Invoke URL** on the API's page (the `$default` stage).

`LoadBalancerUrl` on the same Outputs tab is the plain-HTTP load balancer — only for
debugging; sign-in needs the HTTPS `SiteUrl`.

## All scripts

| Script | What it does |
|---|---|
| `up.sh [--multi-az]` | base → database + images (in parallel) → migrations → app → seed. Safe to re-run: it updates what changed. `--multi-az` for the demo account. |
| `build-push.sh` | builds the three images (backend, migrate, frontend), tags them with the git commit (`-dirty` if uncommitted), pushes to ECR. Skips images already pushed. |
| `migrate.sh` | runs `prisma migrate deploy` as a one-off container from the small migrate image. |
| `seed.sh` | runs the seed as a one-off backend container (`node dist-seed/prisma/seed.js`); upserts, so re-running is harmless. |
| `smoke.sh` | end-to-end check through the HTTPS address. |
| `status.sh` | stack states, running containers, database, cost per hour. |
| `down.sh [--keep-db]` | deletes the app stack and the database (or keeps it with `--keep-db`). |
| `nuke.sh [--yes]` | deletes all three stacks, ECR images and logs. Dry run without `--yes`. |
| `cleanup-lab-check.sh` | removes leftovers from `LEARNER_LAB_CHECKLIST.md` (the one-off lab test). |

Secrets (`DB_PASSWORD`, `JWT_SECRET`, `NEXTAUTH_SECRET`, `JOB_TOKEN`) are generated on the first `up.sh`
into `infra/.secrets/<account-id>.env` (gitignored) and passed to CloudFormation as hidden
(`NoEcho`) parameters. Don't commit or share that folder.

## Deploying a new version

Commit, then run `up.sh` again: it builds images for the new commit and ECS rolls the
containers over one at a time (the backend keeps one container serving). Database
migrations run first, as a one-off task (`migrate.sh`), so new containers never start
against an old schema. The API image doesn't contain the Prisma CLI — that's what keeps it
small — so migrations have their own image.

Upgrading an environment created before the migrate step existed: run `down.sh` first —
the ECS cluster moved from the app stack to the base stack.

## Demo account (Nov 8–17)

```bash
bash infra/scripts/up.sh --multi-az   # primary + standby database, like the kickoff diagram
```

Leave it running through the presentation; the dev account keeps the nightly `down.sh`.

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
- **API Gateway** has a 30-second request limit; the slowest MotorMate request is well
  under a second. Plain-HTTP fallback for dev: the `LoadBalancerUrl` stack output.
