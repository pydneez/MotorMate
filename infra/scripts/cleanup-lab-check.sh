#!/usr/bin/env bash
# Removes the resources created while running infra/LEARNER_LAB_CHECKLIST.md, so they stop
# using the Learner Lab budget.
#
#   bash infra/scripts/cleanup-lab-check.sh            # DRY RUN: only lists what it would delete
#   bash infra/scripts/cleanup-lab-check.sh --yes      # actually delete
#   bash infra/scripts/cleanup-lab-check.sh --yes --include-ecr   # also delete the ECR repo + images
#
# Run from Git Bash (or WSL/macOS/Linux) with the AWS CLI configured for your lab session
# (see `aws sts get-caller-identity`). Safe to re-run: anything already gone is skipped.
#
# It ONLY touches checklist resources, found by name:
#   - the ECS cluster "motormate-check", its services, their task definitions and log groups
#     (including the CloudFormation stacks the ECS console created for them)
#   - load balancers / target groups whose names start with "motormate-check" or "motormate-tg"
#   - RDS instances, S3 buckets, Lambda functions and EventBridge schedules named "motormate-check*"
#   - the ECR repository "motormate-backend" — only with --include-ecr (the real deployment reuses it)
# It NEVER touches Learner Lab's own resources (RoleCreationFunction, RedshiftOverwatch,
# data-bucket-*, the "associate Learner Lab" stack), the default VPC or security group, or any
# EC2 instance.

set -uo pipefail
export MSYS_NO_PATHCONV=1           # Git Bash: don't rewrite "/ecs/..." log group names into Windows paths
export AWS_PAGER=""
REGION="${AWS_REGION:-us-east-1}"
CLUSTER="motormate-check"
PREFIX="motormate-check"
ECR_REPO="motormate-backend"

APPLY=false
INCLUDE_ECR=false
for arg in "$@"; do
  case "$arg" in
    --yes) APPLY=true ;;
    --include-ecr) INCLUDE_ECR=true ;;
    *) echo "Unknown option: $arg"; exit 2 ;;
  esac
done

aws() { command aws --region "$REGION" "$@"; }
say() { printf '\n== %s\n' "$*"; }
run() {
  if $APPLY; then
    echo "   deleting: $*"
    "$@" >/dev/null || echo "   (failed — see the error above; re-run the script once the cause is fixed)"
  else
    echo "   would run: $*"
  fi
}

if ! aws sts get-caller-identity --query Account --output text >/dev/null 2>&1; then
  echo "AWS CLI can't authenticate. Start the lab, paste fresh credentials into ~/.aws/credentials, then retry."
  exit 1
fi
echo "Account $(aws sts get-caller-identity --query Account --output text), region $REGION"
$APPLY || echo "DRY RUN — nothing will be deleted. Re-run with --yes to delete."

# ── 1. ECS services (the console creates each one through a CloudFormation stack) ────────
say "ECS services in cluster $CLUSTER"
TASK_FAMILIES=()
if aws ecs describe-clusters --clusters "$CLUSTER" --query "clusters[?status=='ACTIVE'].clusterName" --output text | grep -q .; then
  for svc in $(aws ecs list-services --cluster "$CLUSTER" --query "serviceArns[]" --output text); do
    name="${svc##*/}"
    td=$(aws ecs describe-services --cluster "$CLUSTER" --services "$name" --query "services[0].taskDefinition" --output text)
    TASK_FAMILIES+=("$(echo "${td##*/}" | cut -d: -f1)")
    stack=$(aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE ROLLBACK_COMPLETE UPDATE_ROLLBACK_COMPLETE \
      --query "StackSummaries[?starts_with(StackName, 'ECS-Console-V2-Service-${name}')].StackName | [0]" --output text)
    if [ -n "$stack" ] && [ "$stack" != "None" ]; then
      echo " - service $name (created by stack $stack)"
      run aws cloudformation delete-stack --stack-name "$stack"
      $APPLY && { echo "   waiting for the stack to finish deleting (a few minutes)…"; aws cloudformation wait stack-delete-complete --stack-name "$stack"; }
    else
      echo " - service $name"
      run aws ecs update-service --cluster "$CLUSTER" --service "$name" --desired-count 0
      run aws ecs delete-service --cluster "$CLUSTER" --service "$name" --force
    fi
  done
else
  echo " - none (cluster not found)"
fi

# ── 2. Load balancers and target groups (if the service stack didn't already remove them) ─
say "Load balancers"
for lb in $(aws elbv2 describe-load-balancers --query "LoadBalancers[?starts_with(LoadBalancerName, '$PREFIX')].LoadBalancerArn" --output text); do
  echo " - ${lb#*loadbalancer/}"
  run aws elbv2 delete-load-balancer --load-balancer-arn "$lb"
  $APPLY && aws elbv2 wait load-balancers-deleted --load-balancer-arns "$lb"
done
say "Target groups"
for tg in $(aws elbv2 describe-target-groups --query "TargetGroups[?starts_with(TargetGroupName, '$PREFIX') || starts_with(TargetGroupName, 'motormate-tg')].TargetGroupArn" --output text); do
  echo " - ${tg#*targetgroup/}"
  run aws elbv2 delete-target-group --target-group-arn "$tg"
done

# ── 3. The cluster itself (and its console stack, if any) ──────────────────────────────
say "ECS cluster $CLUSTER"
cluster_stack=$(aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE ROLLBACK_COMPLETE \
  --query "StackSummaries[?starts_with(StackName, 'Infra-ECS-Cluster-${CLUSTER}')].StackName | [0]" --output text)
if [ -n "$cluster_stack" ] && [ "$cluster_stack" != "None" ]; then
  echo " - cluster (created by stack $cluster_stack)"
  run aws cloudformation delete-stack --stack-name "$cluster_stack"
elif aws ecs describe-clusters --clusters "$CLUSTER" --query "clusters[?status=='ACTIVE'].clusterName" --output text | grep -q .; then
  echo " - cluster $CLUSTER"
  run aws ecs delete-cluster --cluster "$CLUSTER"
else
  echo " - none"
fi

# ── 4. Task definitions and their CloudWatch log groups ─────────────────────────────────
say "Task definitions and log groups"
if [ ${#TASK_FAMILIES[@]} -eq 0 ]; then echo " - none found through the cluster's services"; fi
for family in "${TASK_FAMILIES[@]}"; do
  for td in $(aws ecs list-task-definitions --family-prefix "$family" --status ACTIVE --query "taskDefinitionArns[]" --output text); do
    echo " - task definition ${td##*/}"
    run aws ecs deregister-task-definition --task-definition "$td"
  done
  if aws logs describe-log-groups --log-group-name-prefix "/ecs/$family" --query "logGroups[].logGroupName" --output text | grep -q .; then
    echo " - log group /ecs/$family"
    run aws logs delete-log-group --log-group-name "/ecs/$family"
  fi
done

# ── 5. Other checklist services, only when named motormate-check* ───────────────────────
say "RDS databases named $PREFIX*"
for db in $(aws rds describe-db-instances --query "DBInstances[?starts_with(DBInstanceIdentifier, '$PREFIX')].DBInstanceIdentifier" --output text); do
  echo " - $db (no final snapshot)"
  run aws rds delete-db-instance --db-instance-identifier "$db" --skip-final-snapshot --delete-automated-backups
done

say "S3 buckets named $PREFIX*"
for bucket in $(aws s3api list-buckets --query "Buckets[?starts_with(Name, '$PREFIX')].Name" --output text); do
  echo " - $bucket (emptied first)"
  run aws s3 rb "s3://$bucket" --force
done

say "EventBridge schedules named $PREFIX*"
for schedule in $(aws scheduler list-schedules --name-prefix "$PREFIX" --query "Schedules[].Name" --output text 2>/dev/null); do
  echo " - $schedule"
  run aws scheduler delete-schedule --name "$schedule"
done

say "Lambda functions named $PREFIX*"
for fn in $(aws lambda list-functions --query "Functions[?starts_with(FunctionName, '$PREFIX')].FunctionName" --output text); do
  echo " - $fn"
  run aws lambda delete-function --function-name "$fn"
  if aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/$fn" --query "logGroups[].logGroupName" --output text | grep -q .; then
    run aws logs delete-log-group --log-group-name "/aws/lambda/$fn"
  fi
done

# ── 6. ECR (kept by default: the real deployment pushes to the same repository) ─────────
say "ECR repository $ECR_REPO"
if aws ecr describe-repositories --repository-names "$ECR_REPO" >/dev/null 2>&1; then
  if $INCLUDE_ECR; then
    echo " - $ECR_REPO and all its images"
    run aws ecr delete-repository --repository-name "$ECR_REPO" --force
  else
    echo " - kept (images cost about \$0.10/GB-month; add --include-ecr to delete)"
  fi
else
  echo " - none"
fi

say "Done"
$APPLY || echo "That was a dry run. Re-run with --yes to delete the resources listed above."
echo "Not touched on purpose: EC2 instances, Elastic IPs, security groups, the default VPC, and Learner Lab's own resources."
