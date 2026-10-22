#!/usr/bin/env bash
# Builds the three images and pushes them to this account's ECR repositories (created by
# the motormate-base stack), tagged with the git commit:
#   motormate-backend   the API          (backend/Dockerfile)
#   motormate-migrate   prisma migrate   (backend/Dockerfile --target migrate)
#   motormate-frontend  the website      (frontend/Dockerfile)
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

# repository  dockerfile  build target ("-" = the Dockerfile's last stage)
while read -r repo dockerfile target; do
  image="$REGISTRY/$repo:$TAG"
  if aws ecr describe-images --repository-name "$repo" --image-ids imageTag="$TAG" >/dev/null 2>&1 \
     && [[ "$TAG" != *-dirty ]]; then
    info "$repo:$TAG already in ECR — skipping build"
    continue
  fi
  step "Building $repo:$TAG"
  target_args=()
  [ "$target" != "-" ] && target_args=(--target "$target")
  (cd "$REPO_ROOT" && docker build --platform linux/amd64 -f "$dockerfile" "${target_args[@]}" -t "$image" .)
  step "Pushing $repo:$TAG"
  docker push "$image" | tail -1
done <<'EOF'
motormate-backend backend/Dockerfile -
motormate-migrate backend/Dockerfile migrate
motormate-frontend frontend/Dockerfile -
EOF

echo "$TAG" > "$SECRETS_DIR/last-tag"
info "images ready: $REGISTRY/motormate-{backend,migrate,frontend}:$TAG"
