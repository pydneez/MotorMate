# Deploying MotorMate to AWS

Everything needed to run MotorMate on the course's demo account: three CloudFormation stacks
and a few Bash scripts.

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
     container logs ──▶ CloudWatch: /motormate/backend, /motormate/frontend
```

| Stack | Template | What's in it | After `down.sh` |
|---|---|---|---|
| `motormate-base` | `cloudformation/base.yml` | VPC, 2 public + 2 isolated subnets, security groups, ECR repos (backend, migrate, frontend), ECS cluster, invoice-PDF S3 bucket (private, encrypted, HTTPS-only, only the backend + whoever runs the scripts), SNS topic for customer emails, log groups, the 5 IAM roles | kept |
| `motormate-db` | `cloudformation/db.yml` | RDS PostgreSQL 16, `db.t3.micro`, Multi-AZ; the migrate task definition | deleted |
| `motormate-app` | `cloudformation/app.yml` | load balancer, 2 ECS services, CloudFront, daily-jobs Lambda + 2 EventBridge Scheduler schedules (09:00, 18:30 Bangkok), the app secret and the private DNS namespace | deleted |

**IAM roles** (each can do only what's listed):

| Role | Used by | Allowed |
|---|---|---|
| `ExecutionRole` | ECS, starting any task | pull images, write logs, read `motormate/*` secrets |
| `BackendTaskRole` | the API containers | S3 get/put on `invoices/*` in our bucket (and list it, so a missing PDF is a 404); SNS publish/subscribe/unsubscribe/read subscriptions on our topic |
| `NoPermissionsTaskRole` | frontend, migrations | nothing |
| `JobsFunctionRole` | the daily-jobs Lambda | its logs, read `motormate/*` secrets |
| `SchedulerRole` | EventBridge Scheduler | invoke `motormate-daily-jobs` only |

A NAT Gateway would cost more than the rest together, so containers sit in public subnets
behind security groups that only accept traffic from the load balancer (and, for the backend,
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
- Put the demo account's keys in an AWS CLI profile named `motormate-demo`, and select it in
  **every** new terminal before running a script. Without it the scripts use whatever
  credentials are active, which may be a different account.

  ```bash
  export AWS_PROFILE=motormate-demo
  aws sts get-caller-identity     # must show your des424-… user in account 528301714999
  ```

- Region `us-east-1` (override with `AWS_REGION=us-west-2`).

## Deploying

```bash
bash infra/scripts/up.sh --multi-az --frontend-count 2        # ~20–25 min the first time
bash infra/scripts/seed.sh --demo                             # 6 months of demo history
bash infra/scripts/smoke.sh
bash infra/scripts/failover-test.sh --all                     # HA check; note the numbers
```

Sign in with the seeded logins (password `password123`): `admin@`, `advisor@`,
`mechanic@motormate.example`, customer `jordan.lee@example.com`, platform admin
`platform@motormate.example`.

- It's a shared account: the scripts only touch `motormate-*` stacks, the `motormate` cluster
  and our own resources, so they can't affect other teams.
- **Leave it running through the Nov 17 presentation** (≈ $0.13/hour with Multi-AZ and 4
  containers). Don't run `down.sh` or `nuke.sh` before then: both delete the database.
- After the course: `bash infra/scripts/nuke.sh --yes`. Only the person who ran `up.sh` can
  empty the invoice bucket, because the bucket policy allows the backend and that deployer.
  Someone else should run `up.sh` first.

### Finding the site URL

The site lives at the CloudFront address, `https://<id>.cloudfront.net`. `up.sh` prints it at
the end; afterwards:

```bash
aws cloudformation describe-stacks --stack-name motormate-app \
  --query "Stacks[0].Outputs[?OutputKey=='SiteUrl'].OutputValue" --output text
```

Or in the AWS console (region **N. Virginia, us-east-1**): **CloudFormation** → Stacks →
`motormate-app` → **Outputs** tab → `SiteUrl`, or **CloudFront** → Distributions →
"MotorMate" → **Distribution domain name**.

## All scripts

| Script | What it does |
|---|---|
| `up.sh [--multi-az\|--single-az] [--frontend-count N]` | base → database + images (in parallel) → migrations → app → seed. Safe to re-run: it updates what changed. Options you leave out keep their deployed value. |
| `build-push.sh` | builds the three images (backend, migrate, frontend), tags them with the git commit (`-dirty` if uncommitted), pushes to ECR. Skips images already pushed. |
| `migrate.sh` | runs `prisma migrate deploy` as a one-off container from the small migrate image. |
| `seed.sh [--demo]` | runs the seed as a one-off backend container (`node dist-seed/prisma/seed.js`); upserts, so re-running is harmless. `--demo` adds ~6 months of demo history and the second shop instead (`seed-demo.js`; each part runs once). |
| `smoke.sh` | end-to-end check through the HTTPS address: login, roles, reports + CSV, list filters, visits, invoice PDF, daily jobs, that the load balancer refuses direct requests and that pages come through CloudFront. |
| `status.sh` | stack states, running containers, database (Multi-AZ or not), cost per hour. |
| `failover-test.sh [--tasks\|--all]` | high-availability check: polls the site every 2 s while forcing an RDS failover to the standby (and/or stopping one task per service), then reports how long requests failed. |
| `down.sh [--keep-db]` | deletes the app stack and the database (or keeps it with `--keep-db`). |
| `nuke.sh [--yes]` | deletes all three stacks, ECR images and logs. Dry run without `--yes`. |

Secrets (`DB_PASSWORD`, `JWT_SECRET`, `NEXTAUTH_SECRET`, `JOB_TOKEN`, `ORIGIN_SECRET`) are
generated on the first `up.sh` into `infra/.secrets/<account-id>.env` (gitignored), passed to
CloudFormation as hidden (`NoEcho`) parameters and stored in Secrets Manager; the containers
read them at start. Don't commit or share that folder.

## Deploying a new version

Commit, then run `up.sh` again: it builds images for the new commit and ECS rolls the
containers over one at a time. Database migrations run first, as a one-off task
(`migrate.sh`), so new containers never start against an old schema. The API image doesn't
contain the Prisma CLI — that's what keeps it small — so migrations have their own image.

## High-availability results

Measured on Nov 7, 2026, polling a database-backed route every 2 s:

| Test | AWS | What the site's users saw |
|---|---|---|
| RDS forced failover (us-east-1a ⇄ us-east-1b) | 50 s from "failover started" to "completed" | 2 of 47 requests failed, over ~9 s |
| One backend + one frontend task stopped (same AZ) | ECS started replacements | all 36 requests succeeded |

CloudFront served static files from its cache from the second request on
(`X-Cache: Hit from cloudfront`); the API is never cached.

## When something goes wrong

- **A stack fails:** the script prints the failing resources and reasons. CloudFormation
  rolls back by itself; fix and re-run `up.sh`. A stack stuck in `ROLLBACK_COMPLETE` must
  be deleted before it can be created again.
- **Containers keep restarting:** CloudWatch → Log groups → `/motormate/backend` or
  `/motormate/frontend`. ECS's circuit breaker rolls a bad deployment back.
- **"AWS credentials missing or expired":** check that `AWS_PROFILE=motormate-demo` is set
  in this terminal and that `aws sts get-caller-identity` works.
- **403 "Forbidden" on the site:** the load balancer didn't get CloudFront's secret header —
  usually `ORIGIN_SECRET` in `infra/.secrets/<account>.env` changed without re-running
  `up.sh`. Re-run it.
- **A task won't start ("ResourceInitializationError … secret"):** the execution role can
  only read secrets named `motormate/*`; check the task's stopped reason in the ECS console.
- **A new CloudFront distribution** takes ~5–10 minutes to create and ~10 to delete; the
  scripts wait for it. CloudFront's origin timeout is 30 s; the slowest MotorMate request is
  well under a second.
- **Customer emails:** SES is sandbox-only in this account, so they go through SNS. Each email
  address is subscribed automatically and its owner clicks "Confirm subscription" in AWS's
  email once (it can land in spam). To test, sign up with your own address (or give a
  seeded customer your address), confirm, then press **Run daily jobs now** on the
  Reminders page. Subscriptions are per address and live on the topic in the base stack,
  so a confirmed address stays confirmed unless `nuke.sh` deletes the topic.
  If you click AWS's **Unsubscribe** link, that address gets no more emails — test with a
  fresh address (Gmail `you+motormate2@gmail.com` works) or delete the subscription in the
  SNS console first. Emails that couldn't be sent show as "Not sent" under Sent emails.
- **Daily jobs:** logs in CloudWatch → `/aws/lambda/motormate-daily-jobs`; run one by hand
  with `aws lambda invoke --function-name motormate-daily-jobs --cli-binary-format
  raw-in-base64-out --payload '{"job":"morning"}' out.json`.

The stacks also have a Learner Lab mode for AWS Academy accounts (`up.sh --lab`); it's
described in the comments at the top of `cloudformation/app.yml`.
