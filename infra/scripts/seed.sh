#!/usr/bin/env bash
# Runs the seed (sample logins, customers, vehicles, parts) as a one-off ECS task using
# the backend image. The seed upserts, so running it again is harmless. up.sh calls it.
#
#   bash infra/scripts/seed.sh

source "$(dirname "$0")/lib.sh"
require_aws

[ "$(stack_status "$APP_STACK")" = "NONE" ] && die "$APP_STACK isn't deployed — run up.sh first"

subnets="$(aws cloudformation list-exports --query "Exports[?Name=='motormate-PublicSubnets'].Value" --output text)"
sg="$(aws cloudformation list-exports --query "Exports[?Name=='motormate-BackendSecurityGroup'].Value" --output text)"

step "Seeding the database (one-off backend task)"
task_arn="$(aws ecs run-task --cluster motormate --launch-type FARGATE \
  --task-definition motormate-backend \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$sg],assignPublicIp=ENABLED}" \
  --overrides '{"containerOverrides":[{"name":"backend","command":["node","dist-seed/prisma/seed.js"]}]}' \
  --query 'tasks[0].taskArn' --output text)"
info "task ${task_arn##*/} started; waiting for it to finish (about a minute)"
aws ecs wait tasks-stopped --cluster motormate --tasks "$task_arn"

exit_code="$(aws ecs describe-tasks --cluster motormate --tasks "$task_arn" \
  --query 'tasks[0].containers[0].exitCode' --output text)"
if [ "$exit_code" != "0" ]; then
  reason="$(aws ecs describe-tasks --cluster motormate --tasks "$task_arn" --query 'tasks[0].stoppedReason' --output text)"
  die "seed failed (exit $exit_code, $reason) — see CloudWatch log group /motormate/backend"
fi
info "seeded: admin@ / advisor@ / mechanic@motormate.example, jordan.lee@example.com (password123)"
