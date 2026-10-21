#!/usr/bin/env bash
# Nightly teardown: deletes everything that costs money while idle — the app stack (load
# balancer, containers, API Gateway) and, unless --keep-db, the database. Keeps the base
# stack (free) and the images in ECR, so the next up.sh is faster.
#
#   bash infra/scripts/down.sh            # dev account, end of a work session
#   bash infra/scripts/down.sh --keep-db  # keep the database (e.g. demo data you entered)

source "$(dirname "$0")/lib.sh"

KEEP_DB=false
for arg in "$@"; do
  case "$arg" in
    --keep-db) KEEP_DB=true ;;
    *) die "unknown option: $arg" ;;
  esac
done

require_aws
step "Account $ACCOUNT_ID, region $REGION"

step "Deleting the app stack (load balancer, ECS services, API Gateway)"
delete_stack "$APP_STACK"

if [ "$KEEP_DB" = true ]; then
  info "keeping $DB_STACK (--keep-db) — it still costs ~\$0.02/hour"
else
  step "Deleting the database stack (data is re-seeded by the next up.sh)"
  delete_stack "$DB_STACK"
fi

step "Done"
bash "$(dirname "$0")/status.sh"
