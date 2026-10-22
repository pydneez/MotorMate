#!/usr/bin/env bash
# Deletes EVERYTHING the MotorMate scripts created in this account: app, database and
# base stacks, including the ECR repositories and their images and the log groups.
# Use it when you're finished with an account (or to start over from nothing).
#
#   bash infra/scripts/nuke.sh         # DRY RUN: shows what would be deleted
#   bash infra/scripts/nuke.sh --yes   # actually delete

source "$(dirname "$0")/lib.sh"

APPLY=false
for arg in "$@"; do
  case "$arg" in
    --yes) APPLY=true ;;
    *) die "unknown option: $arg" ;;
  esac
done

require_aws
step "Account $ACCOUNT_ID, region $REGION"
for stack in "$APP_STACK" "$DB_STACK" "$BASE_STACK"; do
  info "$stack: $(stack_status "$stack")"
done

if [ "$APPLY" != true ]; then
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
info "everything removed; secrets in infra/.secrets/$ACCOUNT_ID.env are kept for next time"
