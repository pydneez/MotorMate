#!/usr/bin/env bash
# High-availability check for the demo account. While polling the site every 2 seconds (an
# API route that reads the database, through the public HTTPS address), it forces an RDS
# failover to the standby, and with --tasks also stops one backend and one frontend task.
# It then reports how long requests failed and where the database ended up.
#
#   bash infra/scripts/failover-test.sh            # database failover (needs up.sh --multi-az)
#   bash infra/scripts/failover-test.sh --tasks    # stop one task per service instead
#   bash infra/scripts/failover-test.sh --all      # both, one after the other
#
# Expect roughly 1–2 minutes of failed requests for the database (DNS moves to the standby)
# and none for the tasks when each service runs 2 (the load balancer stops sending them
# traffic and ECS starts replacements).

source "$(dirname "$0")/lib.sh"

DB_TEST=true TASK_TEST=false
case "${1:-}" in
  "") ;;
  --tasks) DB_TEST=false; TASK_TEST=true ;;
  --all) TASK_TEST=true ;;
  *) die "unknown option $1 (use --tasks, --all, or nothing)" ;;
esac

require_aws
URL="$(stack_output "$APP_STACK" SiteUrl)"
[ -n "$URL" ] && [ "$URL" != "None" ] || die "$APP_STACK isn't deployed — run up.sh first"

token="$(curl -s -X POST "$URL/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@motormate.example","password":"password123"}' \
  --max-time 20 | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p' || true)"
[ -n "$token" ] || die "couldn't sign in as the seeded admin at $URL"

log="$(mktemp)"
stop="$(mktemp -u)"
poll() { # one line per request: <epoch seconds> <status>
  while [ ! -e "$stop" ]; do
    echo "$(date +%s) $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$URL/v1/settings/shop" \
      -H "Authorization: Bearer $token" || echo 000)" >> "$log"
    sleep 2
  done
}

# report <label> — summarises the polls since the last report, then starts a fresh log.
report() {
  local total failed first last
  total="$(wc -l < "$log" | tr -d ' ')"
  failed="$(awk '$2 != "200"' "$log" | wc -l | tr -d ' ')"
  if [ "$failed" = 0 ]; then
    info "$1: all $total requests succeeded"
  else
    first="$(awk '$2 != "200" { print $1; exit }' "$log")"
    last="$(awk '$2 != "200" { t = $1 } END { print t }' "$log")"
    info "$1: $failed of $total requests failed, over about $((last - first + 2)) seconds"
  fi
  : > "$log"
}

poll & poller=$!
trap 'touch "$stop"; wait "$poller" 2>/dev/null; rm -f "$log" "$stop"' EXIT
sleep 6

if [ "$DB_TEST" = true ]; then
  read -r multi_az az standby <<< "$(aws rds describe-db-instances --db-instance-identifier motormate \
    --query 'DBInstances[0].[MultiAZ,AvailabilityZone,SecondaryAvailabilityZone]' --output text)"
  [ "$multi_az" = True ] || die "the database isn't Multi-AZ — deploy with up.sh --multi-az first"
  step "Database failover: primary in $az, standby in $standby"
  aws rds reboot-db-instance --db-instance-identifier motormate --force-failover \
    --query 'DBInstance.DBInstanceStatus' --output text > /dev/null
  info "failover started; waiting for the database to be available again"
  sleep 20
  aws rds wait db-instance-available --db-instance-identifier motormate
  sleep 30 # keep polling a little after RDS reports it's back
  now="$(aws rds describe-db-instances --db-instance-identifier motormate \
    --query 'DBInstances[0].AvailabilityZone' --output text)"
  info "primary is now in $now (was $az)"
  report "Database failover"
fi

if [ "$TASK_TEST" = true ]; then
  step "Stopping one backend task and one frontend task"
  for service in backend frontend; do
    task="$(aws ecs list-tasks --cluster motormate --service-name "$service" --desired-status RUNNING \
      --query 'taskArns[0]' --output text)"
    running="$(aws ecs list-tasks --cluster motormate --service-name "$service" --desired-status RUNNING \
      --query 'length(taskArns)' --output text)"
    [ "$running" -ge 2 ] || info "note: $service runs only $running task — expect an outage until ECS replaces it"
    az="$(aws ecs describe-tasks --cluster motormate --tasks "$task" --query 'tasks[0].availabilityZone' --output text)"
    aws ecs stop-task --cluster motormate --task "$task" --reason "failover-test.sh" --query 'task.lastStatus' --output text > /dev/null
    info "stopped $service task ${task##*/} in $az"
  done
  info "waiting for ECS to replace them"
  sleep 20
  aws ecs wait services-stable --cluster motormate --services backend frontend
  report "Task failure"
fi

step "Done"
