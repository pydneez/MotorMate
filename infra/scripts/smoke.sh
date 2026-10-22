#!/usr/bin/env bash
# Quick end-to-end check of a deployed environment through its public HTTPS address:
# the API health route, the login page, sign-in with the seeded admin, an
# authenticated API call, the invoice PDF link, and the daily jobs (Lambda → API → SNS).
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

# Invoice PDF: the API returns a presigned S3 link; fetching it must give a real PDF.
invoice_id="$(curl -s --max-time 20 "$URL/v1/invoices?pageSize=1" -H "Authorization: Bearer $token" \
  | sed -n 's/^{"items":\[{"id":"\([^"]*\)".*/\1/p' || true)"
if [ -z "$invoice_id" ]; then
  info "✖ GET /v1/invoices returned no invoice to download (is the seed loaded?)"; failed=1
else
  pdf_url="$(curl -s --max-time 30 "$URL/v1/invoices/$invoice_id/pdf" -H "Authorization: Bearer $token" \
    | sed -n 's/.*"url":"\([^"]*\)".*/\1/p' | sed 's/\\u0026/\&/g' || true)"
  magic="$(curl -s --max-time 30 "$pdf_url" | head -c 5 || true)"
  case "$pdf_url" in
    https://*.s3.*amazonaws.com/*) where="presigned S3 link" ;;
    *) where="not an S3 link" ;;
  esac
  if [ "$magic" = "%PDF-" ] && [ "$where" = "presigned S3 link" ]; then
    info "✔ GET /v1/invoices/:id/pdf → $where → PDF"
  else
    info "✖ invoice PDF: got \"$magic\" from a $where"; failed=1
  fi
fi

# Daily jobs: the endpoint refuses a missing token; the Lambda (as the schedules call it)
# runs a job through the API; "Run daily jobs now" works for the admin.
check "POST /v1/jobs/close-day without the job token" 403 -X POST "$URL/v1/jobs/close-day"
lambda_out="$(mktemp)"
# aws.exe is a Windows program and MSYS_NO_PATHCONV is on, so hand it a Windows path.
lambda_out_arg="$(cygpath -w "$lambda_out" 2>/dev/null || echo "$lambda_out")"
# A failed function returns {"errorMessage": …} instead of the job summary.
lambda_err="$(aws lambda invoke --function-name motormate-daily-jobs --cli-binary-format raw-in-base64-out \
  --payload '{"job":"close-day"}' "$lambda_out_arg" 2>&1 >/dev/null || true)"
if grep -q '"noShows"' "$lambda_out" 2>/dev/null; then
  info "✔ Lambda motormate-daily-jobs → POST /v1/jobs/close-day ($(cat "$lambda_out"))"
else
  info "✖ Lambda motormate-daily-jobs: $(cat "$lambda_out" 2>/dev/null) $lambda_err"; failed=1
fi
rm -f "$lambda_out"
run="$(curl -s -X POST --max-time 25 "$URL/v1/reminders/run" -H "Authorization: Bearer $token" || true)"
case "$run" in
  *'"morning"'*'"failed":0'*) info "✔ POST /v1/reminders/run ($run)" ;;
  *) info "✖ POST /v1/reminders/run: $run"; failed=1 ;;
esac

[ "$failed" = 0 ] || die "smoke test failed"
step "All checks passed"
