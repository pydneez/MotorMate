#!/usr/bin/env bash
# Quick end-to-end check of a deployed environment through its public HTTPS address:
# the API health route, the login page, sign-in with the seeded admin, and an
# authenticated API call.
#
#   bash infra/scripts/smoke.sh

source "$(dirname "$0")/lib.sh"
require_aws

URL="$(stack_output "$APP_STACK" SiteUrl)"
[ -n "$URL" ] && [ "$URL" != "None" ] || die "$APP_STACK isn't deployed — run up.sh first"
step "Smoke test against $URL"

failed=0
check() { # check <label> <expected status> <curl args...>
  local label="$1" expected="$2"; shift 2
  local status
  status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@" || true)"
  if [ "$status" = "$expected" ]; then info "✔ $label ($status)"; else info "✖ $label: got $status, expected $expected"; failed=1; fi
}

check "GET /v1 (API health)" 200 "$URL/v1"
check "GET /login (frontend)" 200 "$URL/login"
check "GET /api/auth/providers (NextAuth)" 200 "$URL/api/auth/providers"

token="$(curl -s -X POST "$URL/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@motormate.example","password":"password123"}' \
  --max-time 20 | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p' || true)"
if [ -n "$token" ]; then info "✔ POST /v1/auth/login (seeded admin)"; else info "✖ POST /v1/auth/login returned no token"; failed=1; fi
check "GET /v1/customers with the token" 200 "$URL/v1/customers" -H "Authorization: Bearer $token"
check "GET /v1/customers without a token" 401 "$URL/v1/customers"

[ "$failed" = 0 ] || die "smoke test failed"
step "All checks passed"
