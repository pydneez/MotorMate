#!/usr/bin/env bash
# Brings the whole MotorMate environment up (or updates it): base → database + images (in
# parallel) → migrations → app → seed. Safe to re-run; ~15 minutes from nothing, mostly
# waiting for RDS and CloudFront.
#
#   AWS_PROFILE=motormate-demo bash infra/scripts/up.sh --multi-az --frontend-count 2
#
# Options you leave out keep their current deployed value (Multi-AZ and 2 frontend tasks on
# a first deploy), so a plain re-run never switches Multi-AZ off or scales the frontend down.
#
# Afterwards: smoke.sh to check it, status.sh to see what's running.

source "$(dirname "$0")/lib.sh"

MULTI_AZ="" FRONTEND_COUNT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --multi-az) MULTI_AZ=true ;;
    --single-az) MULTI_AZ=false ;;
    --frontend-count)
      FRONTEND_COUNT="${2:-}"; shift
      [[ "$FRONTEND_COUNT" =~ ^[1-9]$ ]] || die "--frontend-count needs a number from 1 to 9" ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

require_aws
load_secrets
MULTI_AZ="${MULTI_AZ:-$(stack_param "$DB_STACK" MultiAZ)}"; MULTI_AZ="${MULTI_AZ:-true}"
FRONTEND_COUNT="${FRONTEND_COUNT:-$(stack_param "$APP_STACK" FrontendCount)}"; FRONTEND_COUNT="${FRONTEND_COUNT:-2}"
step "Account $ACCOUNT_ID, region $REGION — Multi-AZ database: $MULTI_AZ, frontend tasks: $FRONTEND_COUNT"
export TAG="${TAG:-$(image_tag)}"
REGISTRY="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

# AWS's list of the addresses CloudFront uses to reach origins; the load balancer only
# accepts these.
PREFIX_LIST="$(aws ec2 describe-managed-prefix-lists \
  --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
  --query 'PrefixLists[0].PrefixListId' --output text)"
[[ "$PREFIX_LIST" == pl-* ]] || die "couldn't find CloudFront's origin-facing prefix list in $REGION"

step "1/5 Base stack (network, security groups, roles, ECR, ECS cluster, logs)"
deploy_stack "$BASE_STACK" base.yml "DeployerArn=$(deployer_arn)"

step "2/5 Database stack and images (in parallel)"
db_log="$SECRETS_DIR/db-deploy.log"
( deploy_stack "$DB_STACK" db.yml "DbPassword=$DB_PASSWORD" "MultiAZ=$MULTI_AZ" \
    "MigrateImage=$REGISTRY/motormate-migrate:$TAG" ) > "$db_log" 2>&1 &
db_pid=$!
info "database deploying in the background (log: infra/.secrets/db-deploy.log)"
bash "$(dirname "$0")/build-push.sh"
info "waiting for the database…"
wait "$db_pid" || { cat "$db_log"; die "database stack failed"; }

step "3/5 Database migrations"
bash "$(dirname "$0")/migrate.sh"

step "4/5 App stack (load balancer, ECS services, CloudFront — a new distribution takes ~5–10 minutes)"
deploy_stack "$APP_STACK" app.yml \
  "BackendImage=$REGISTRY/motormate-backend:$TAG" \
  "FrontendImage=$REGISTRY/motormate-frontend:$TAG" \
  "FrontendCount=$FRONTEND_COUNT" \
  "CloudFrontPrefixListId=$PREFIX_LIST" \
  "DbPassword=$DB_PASSWORD" "JwtSecret=$JWT_SECRET" "NextAuthSecret=$NEXTAUTH_SECRET" "JobToken=$JOB_TOKEN" \
  "OriginSecret=$ORIGIN_SECRET"
info "waiting for the containers to pass health checks…"
aws ecs wait services-stable --cluster motormate --services backend frontend

step "5/5 Seed data"
bash "$(dirname "$0")/seed.sh"

step "Up and running"
info "Site:  $(stack_output "$APP_STACK" SiteUrl)"
info "Check: bash infra/scripts/smoke.sh"
info "HA:    bash infra/scripts/failover-test.sh"
