# Shared helpers for the MotorMate deploy scripts — sourced, not run.
#
# Every script runs from Git Bash (or WSL/macOS/Linux) with the AWS CLI configured for
# your Learner Lab session; credentials expire with the session, so refresh
# ~/.aws/credentials each time (AWS Details → AWS CLI: Show).

set -euo pipefail
export MSYS_NO_PATHCONV=1           # Git Bash: don't rewrite "/motormate/..." into Windows paths
export AWS_PAGER=""
REGION="${AWS_REGION:-us-east-1}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CFN_DIR="infra/cloudformation"
SECRETS_DIR="$REPO_ROOT/infra/.secrets"

BASE_STACK="motormate-base"
DB_STACK="motormate-db"
APP_STACK="motormate-app"

aws() { command aws --region "$REGION" "$@"; }

step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# Fails early with a clear message instead of a wall of AWS errors.
require_aws() {
  ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" \
    || die "AWS credentials missing or expired — start the lab and refresh ~/.aws/credentials"
  export ACCOUNT_ID
}

# Secrets live in infra/.secrets/<account>.env (gitignored), generated once per account,
# so every `up` reuses them. They reach CloudFormation as hidden (NoEcho) parameters.
load_secrets() {
  local file="$SECRETS_DIR/$ACCOUNT_ID.env"
  if [ ! -f "$file" ]; then
    mkdir -p "$SECRETS_DIR"
    {
      echo "DB_PASSWORD=$(openssl rand -hex 20)"
      echo "JWT_SECRET=$(openssl rand -hex 32)"
      echo "NEXTAUTH_SECRET=$(openssl rand -hex 32)"
    } > "$file"
    info "generated new secrets in infra/.secrets/$ACCOUNT_ID.env"
  fi
  # Added in Step 5 — older secrets files get it on their next run.
  if ! grep -q '^JOB_TOKEN=' "$file"; then
    echo "JOB_TOKEN=$(openssl rand -hex 32)" >> "$file"
    info "added JOB_TOKEN to infra/.secrets/$ACCOUNT_ID.env"
  fi
  # shellcheck disable=SC1090
  source "$file"
}

stack_status() {
  aws cloudformation describe-stacks --stack-name "$1" --query 'Stacks[0].StackStatus' \
    --output text 2>/dev/null || echo "NONE"
}

stack_output() {
  aws cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}

# deploy_stack <stack> <template file> [Key=Value ...]
deploy_stack() {
  local stack="$1" template="$2"; shift 2
  local args=()
  wait_until_settled "$stack"
  [ $# -gt 0 ] && args=(--parameter-overrides "$@")
  (cd "$REPO_ROOT" && aws cloudformation deploy --stack-name "$stack" \
    --template-file "$CFN_DIR/$template" --no-fail-on-empty-changeset "${args[@]}") \
    || { show_stack_errors "$stack"; die "deploying $stack failed"; }
}

# A stack still being created/updated/deleted (e.g. by an interrupted earlier run) can't be
# deployed over: wait for it first. A failed first create must be deleted before retrying.
wait_until_settled() {
  local stack="$1" status
  status="$(stack_status "$stack")"
  case "$status" in
    *_IN_PROGRESS)
      info "$stack is $status — waiting for it to finish"
      while status="$(stack_status "$stack")"; [[ "$status" == *_IN_PROGRESS ]]; do sleep 15; done ;;
  esac
  if [ "$status" = "ROLLBACK_COMPLETE" ]; then
    info "$stack failed to create earlier — deleting it before retrying"
    delete_stack "$stack"
  fi
}

delete_stack() {
  local stack="$1"
  [ "$(stack_status "$stack")" = "NONE" ] && { info "$stack: already gone"; return; }
  aws cloudformation delete-stack --stack-name "$stack"
  aws cloudformation wait stack-delete-complete --stack-name "$stack" \
    || { show_stack_errors "$stack"; die "deleting $stack failed"; }
  info "$stack: deleted"
}

show_stack_errors() {
  aws cloudformation describe-stack-events --stack-name "$1" \
    --query "StackEvents[?contains(ResourceStatus,'FAILED')].[LogicalResourceId,ResourceStatusReason]" \
    --output text 2>/dev/null | head -10 >&2 || true
}

# Image tag: the git commit, plus "-dirty" when the app sources have uncommitted changes.
# (cd instead of `git -C`: with MSYS_NO_PATHCONV, Windows git can't read a /c/... path.)
image_tag() {
  (
    cd "$REPO_ROOT"
    local tag
    tag="$(git rev-parse --short HEAD)"
    git diff --quiet HEAD -- backend frontend packages pnpm-lock.yaml || tag="$tag-dirty"
    echo "$tag"
  )
}
