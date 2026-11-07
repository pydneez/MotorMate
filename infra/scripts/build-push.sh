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

# Log in with a private Docker config (gitignored, under infra/.secrets): Docker Desktop's
# Windows credential store can't hold ECR's long token ("The stub received bad data").
# - Docker only stores logins in the file when the file already lists a registry, hence
#   the seeded empty entry; the token in it expires after 12 hours.
# - docker.exe needs a Windows path (lib.sh turns Git Bash's path conversion off).
# - The private config has no contexts, so pin the daemon the current context points at.
export DOCKER_HOST="${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}"
docker_config="$SECRETS_DIR/docker-config"
mkdir -p "$docker_config"
printf '{"auths":{"%s":{}}}\n' "$REGISTRY" > "$docker_config/config.json"
export DOCKER_CONFIG="$(cygpath -w "$docker_config" 2>/dev/null || echo "$docker_config")"

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
