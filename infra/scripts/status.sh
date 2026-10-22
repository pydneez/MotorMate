#!/usr/bin/env bash
# Shows what's deployed, what's running, and roughly what it costs per hour.
#
#   bash infra/scripts/status.sh

source "$(dirname "$0")/lib.sh"
require_aws

step "Stacks (account $ACCOUNT_ID, $REGION)"
for stack in "$BASE_STACK" "$DB_STACK" "$APP_STACK"; do
  info "$(printf '%-15s %s' "$stack" "$(stack_status "$stack")")"
done

cost=0
step "Running"
if [ "$(stack_status "$APP_STACK")" != "NONE" ]; then
  aws ecs describe-services --cluster motormate --services backend frontend \
    --query 'services[].[serviceName,runningCount,desiredCount]' --output text 2>/dev/null \
    | while read -r name running desired; do info "$name: $running/$desired tasks"; done
  info "site: $(stack_output "$APP_STACK" SiteUrl)"
  # 3 tasks (~\$0.012 + \$0.005 public IP each), load balancer (~\$0.03 incl. its 2 IPs)
  cost=$(awk "BEGIN { print $cost + 0.08 }")
fi
db="$(aws rds describe-db-instances --db-instance-identifier motormate \
  --query 'DBInstances[0].[DBInstanceStatus,MultiAZ]' --output text 2>/dev/null || true)"
if [ -n "$db" ]; then
  info "database: $db (status, Multi-AZ)"
  case "$db" in *True*) cost=$(awk "BEGIN { print $cost + 0.036 }") ;; *) cost=$(awk "BEGIN { print $cost + 0.018 }") ;; esac
fi
info "≈ \$$cost/hour while this is up"
