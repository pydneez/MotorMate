#!/usr/bin/env bash
# Brings the whole MotorMate environment up in your Learner Lab account (or updates it):
# base → database + images (in parallel) → migrations → app → seed. Safe to re-run;
# ~15 minutes from nothing, mostly waiting for RDS.
#
#   bash infra/scripts/up.sh             # dev: single-AZ database
#   bash infra/scripts/up.sh --multi-az  # demo account: primary + standby database
#
# Afterwards: smoke.sh to check it, status.sh to see what's running, and down.sh before
# you stop working — Learner Lab keeps billing after the session ends.

source "$(dirname "$0")/lib.sh"

MULTI_AZ=false
for arg in "$@"; do
  case "$arg" in
    --multi-az) MULTI_AZ=true ;;
    *) die "unknown option: $arg" ;;
  esac
done

require_aws
load_secrets
step "Account $ACCOUNT_ID, region $REGION"
export TAG="${TAG:-$(image_tag)}"
REGISTRY="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
LAB_ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/LabRole"

step "1/5 Base stack (network, security groups, ECR, ECS cluster, logs)"
deploy_stack "$BASE_STACK" base.yml

step "2/5 Database stack and images (in parallel)"
db_log="$SECRETS_DIR/db-deploy.log"
( deploy_stack "$DB_STACK" db.yml "DbPassword=$DB_PASSWORD" "MultiAZ=$MULTI_AZ" \
    "MigrateImage=$REGISTRY/motormate-migrate:$TAG" "LabRoleArn=$LAB_ROLE_ARN" ) > "$db_log" 2>&1 &
db_pid=$!
info "database deploying in the background (log: infra/.secrets/db-deploy.log)"
bash "$(dirname "$0")/build-push.sh"
info "waiting for the database…"
wait "$db_pid" || { cat "$db_log"; die "database stack failed"; }

step "3/5 Database migrations"
bash "$(dirname "$0")/migrate.sh"

step "4/5 App stack (load balancer, ECS services, API Gateway)"
deploy_stack "$APP_STACK" app.yml \
  "BackendImage=$REGISTRY/motormate-backend:$TAG" \
  "FrontendImage=$REGISTRY/motormate-frontend:$TAG" \
  "LabRoleArn=$LAB_ROLE_ARN" \
  "DbPassword=$DB_PASSWORD" "JwtSecret=$JWT_SECRET" "NextAuthSecret=$NEXTAUTH_SECRET" "JobToken=$JOB_TOKEN"
info "waiting for the containers to pass health checks…"
aws ecs wait services-stable --cluster motormate --services backend frontend

step "5/5 Seed data"
bash "$(dirname "$0")/seed.sh"

step "Up and running"
info "Site:  $(stack_output "$APP_STACK" SiteUrl)"
info "Check: bash infra/scripts/smoke.sh"
info "Stop:  bash infra/scripts/down.sh   (before you end the lab session)"
