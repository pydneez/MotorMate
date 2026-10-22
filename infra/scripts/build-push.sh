#!/usr/bin/env bash
# Builds the backend and frontend images and pushes them to this account's ECR
# repositories (created by the motormate-base stack), tagged with the git commit.
#
#   bash infra/scripts/build-push.sh            # tag = current commit (+ "-dirty")
#   TAG=demo bash infra/scripts/build-push.sh   # any other tag
#
# Needs Docker running. up.sh calls this for you.

source "$(dirname "$0")/lib.sh"
require_aws

TAG="${TAG:-$(image_tag)}"
REGISTRY="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

step "Logging in to ECR ($REGISTRY)"
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null

for app in backend frontend; do
  image="$REGISTRY/motormate-$app:$TAG"
  if aws ecr describe-images --repository-name "motormate-$app" --image-ids imageTag="$TAG" >/dev/null 2>&1 \
     && [[ "$TAG" != *-dirty ]]; then
    info "motormate-$app:$TAG already in ECR — skipping build"
    continue
  fi
  step "Building motormate-$app:$TAG"
  (cd "$REPO_ROOT" && docker build --platform linux/amd64 -f "$app/Dockerfile" -t "$image" .)
  step "Pushing motormate-$app:$TAG"
  docker push "$image" | tail -1
done

echo "$TAG" > "$SECRETS_DIR/last-tag"
info "images ready: $REGISTRY/motormate-{backend,frontend}:$TAG"
