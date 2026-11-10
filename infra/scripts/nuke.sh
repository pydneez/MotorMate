#!/usr/bin/env bash
# Deletes EVERYTHING the MotorMate scripts created in this account: app, database and
# base stacks, including the ECR repositories and their images and the log groups.
# Use it when you're finished with an account (or to start over from nothing).
# Afterwards it lists anything still named "motormate" in the account, so you can show a
# shared account is clean (secrets only scheduled for deletion aren't listed or billed).
#
#   bash infra/scripts/nuke.sh         # DRY RUN: shows what would be deleted, and what exists
#   bash infra/scripts/nuke.sh --yes   # actually delete, then check for leftovers

source "$(dirname "$0")/lib.sh"

APPLY=false
for arg in "$@"; do
  case "$arg" in
    --yes) APPLY=true ;;
    *) die "unknown option: $arg" ;;
  esac
done

# leftovers — prints each motormate resource that still exists; returns 1 if there are any.
leftovers() {
  local found=0 line
  # check <kind> <aws command…> — the command prints names (whitespace-separated), or nothing.
  check() {
    local kind="$1"; shift
    for line in $("$@" 2>/dev/null | tr '\t' '\n' | grep -v '^None$'); do
      info "  $kind: $line"; found=1
    done
  }
  check "stack" aws cloudformation list-stacks \
    --query "StackSummaries[?starts_with(StackName,'motormate') && StackStatus!='DELETE_COMPLETE'].StackName" --output text
  check "database" aws rds describe-db-instances \
    --query "DBInstances[?starts_with(DBInstanceIdentifier,'motormate')].DBInstanceIdentifier" --output text
  check "db snapshot" aws rds describe-db-snapshots \
    --query "DBSnapshots[?starts_with(DBInstanceIdentifier,'motormate')].DBSnapshotIdentifier" --output text
  check "load balancer" aws elbv2 describe-load-balancers \
    --query "LoadBalancers[?starts_with(LoadBalancerName,'motormate')].LoadBalancerName" --output text
  check "ECS cluster" aws ecs describe-clusters --clusters motormate \
    --query "clusters[?status=='ACTIVE'].clusterName" --output text
  check "CloudFront distribution" aws cloudfront list-distributions \
    --query "DistributionList.Items[?Comment=='MotorMate'].Id" --output text
  check "Cloud Map namespace" aws servicediscovery list-namespaces \
    --query "Namespaces[?Name=='motormate.local'].Id" --output text
  check "Lambda" aws lambda list-functions \
    --query "Functions[?starts_with(FunctionName,'motormate')].FunctionName" --output text
  check "schedule" aws scheduler list-schedules --name-prefix motormate --query "Schedules[].Name" --output text
  check "secret" aws secretsmanager list-secrets \
    --query "SecretList[?starts_with(Name,'motormate/')].Name" --output text
  check "S3 bucket" aws s3api list-buckets \
    --query "Buckets[?starts_with(Name,'motormate')].Name" --output text
  check "ECR repository" aws ecr describe-repositories \
    --query "repositories[?starts_with(repositoryName,'motormate')].repositoryName" --output text
  check "SNS topic" aws sns list-topics --query "Topics[?contains(TopicArn,':motormate')].TopicArn" --output text
  check "log group" aws logs describe-log-groups --log-group-name-prefix /motormate \
    --query "logGroups[].logGroupName" --output text
  check "log group" aws logs describe-log-groups --log-group-name-prefix /aws/lambda/motormate \
    --query "logGroups[].logGroupName" --output text
  check "IAM role" aws iam list-roles \
    --query "Roles[?starts_with(RoleName,'motormate')].RoleName" --output text
  check "VPC" aws ec2 describe-vpcs --filters Name=tag:Name,Values=motormate \
    --query "Vpcs[].VpcId" --output text
  [ "$found" = 0 ]
}

require_aws
step "Account $ACCOUNT_ID, region $REGION"
for stack in "$APP_STACK" "$DB_STACK" "$BASE_STACK"; do
  info "$stack: $(stack_status "$stack")"
done

if [ "$APPLY" != true ]; then
  step "MotorMate resources in this account now"
  leftovers && info "  (none)"
  info "dry run — re-run with --yes to delete all of the above (images and logs included)"
  exit 0
fi

for stack in "$APP_STACK" "$DB_STACK" "$BASE_STACK"; do
  if [ "$stack" = "$BASE_STACK" ] && [ "$(stack_status "$BASE_STACK")" != "NONE" ]; then
    # CloudFormation can't delete a bucket that still has objects in it.
    bucket="$(stack_output "$BASE_STACK" InvoiceBucket)"
    if [ -n "$bucket" ] && [ "$bucket" != "None" ]; then
      step "Emptying s3://$bucket (invoice PDFs)"
      aws s3 rm "s3://$bucket" --recursive --only-show-errors
    fi
  fi
  step "Deleting $stack"
  delete_stack "$stack"
done
rm -f "$SECRETS_DIR/last-tag"

step "Checking for leftovers (anything still named motormate)"
if leftovers; then
  info "nothing left — this account no longer bills for MotorMate"
else
  die "the resources above still exist; delete them in the console, or re-run nuke.sh --yes"
fi
info "secrets in infra/.secrets/$ACCOUNT_ID.env are kept for next time"
