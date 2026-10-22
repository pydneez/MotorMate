#!/usr/bin/env bash
# Applies pending database migrations (`prisma migrate deploy`) as a one-off ECS task
# using the migrate image. Runs before every rollout, so new API containers never start
# against an old schema. up.sh calls it.
#
#   bash infra/scripts/migrate.sh

source "$(dirname "$0")/lib.sh"
require_aws

[ "$(stack_status "$DB_STACK")" = "NONE" ] && die "$DB_STACK isn't deployed — run up.sh first"

subnets="$(aws cloudformation list-exports --query "Exports[?Name=='motormate-PublicSubnets'].Value" --output text)"
# The database only accepts connections from the backend security group.
sg="$(aws cloudformation list-exports --query "Exports[?Name=='motormate-BackendSecurityGroup'].Value" --output text)"

step "Applying database migrations (one-off migrate task)"
task_arn="$(aws ecs run-task --cluster motormate --launch-type FARGATE \
  --task-definition motormate-migrate \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$sg],assignPublicIp=ENABLED}" \
  --query 'tasks[0].taskArn' --output text)"
info "task ${task_arn##*/} started; waiting for it to finish (about a minute)"
aws ecs wait tasks-stopped --cluster motormate --tasks "$task_arn"

exit_code="$(aws ecs describe-tasks --cluster motormate --tasks "$task_arn" \
  --query 'tasks[0].containers[0].exitCode' --output text)"
if [ "$exit_code" != "0" ]; then
  reason="$(aws ecs describe-tasks --cluster motormate --tasks "$task_arn" --query 'tasks[0].stoppedReason' --output text)"
  die "migrations failed (exit $exit_code, $reason) — see CloudWatch log group /motormate/backend, stream prefix migrate/"
fi
info "migrations applied"
