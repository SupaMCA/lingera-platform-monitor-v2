#!/usr/bin/env bash
# Posts platform-results.json to the Lingera monitor webhook.
# A non-2xx response (including 401 after a secret rotation) fails the step.
# The secret is never printed.
set -euo pipefail

mkdir -p test-results
RESULTS="test-results/platform-results.json"
STATUS_OUT="test-results/webhook-status.json"

write_status() {
  jq -n \
    --arg ok "$1" \
    --arg code "$2" \
    --arg detail "$3" \
    '{ok: ($ok == "true"), http_code: $code, detail: $detail}' > "$STATUS_OUT"
}

if [[ ! -f "$RESULTS" ]] || [[ "$(jq 'length' "$RESULTS")" == "0" ]]; then
  write_status false not_sent "nicht geprüft / not checked: keine Ergebnisse, Webhook nicht gesendet"
  echo "::error::No platform results. Webhook was not sent."
  exit 1
fi

if [[ -z "${MONITOR_WEBHOOK_URL:-}" ]]; then
  write_status false missing "MONITOR_WEBHOOK_URL ist nicht gesetzt"
  echo "::error::MONITOR_WEBHOOK_URL is not set"
  exit 1
fi

RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-local}/actions/runs/${GITHUB_RUN_ID:-0}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PAYLOAD="$(jq -c \
  --arg run_url "$RUN_URL" \
  --arg run_id "${GITHUB_RUN_ID:-0}" \
  --arg ts "$TIMESTAMP" \
  '{results: ., run_url: $run_url, run_id: $run_id, timestamp: $ts}' \
  "$RESULTS")"

set +e
HTTP_CODE="$(curl -sS -o test-results/webhook-body.txt -w "%{http_code}" \
  --max-time 30 \
  -X POST "$MONITOR_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${MONITOR_WEBHOOK_SECRET:-}" \
  -d "$PAYLOAD")"
CURL_EXIT=$?
set -e

if [[ -z "${HTTP_CODE}" || "$CURL_EXIT" -ne 0 && ! "$HTTP_CODE" =~ ^[0-9]+$ ]]; then
  HTTP_CODE="000"
fi

DETAIL="Webhook HTTP ${HTTP_CODE}"
if [[ "$HTTP_CODE" == "401" || "$HTTP_CODE" == "403" ]]; then
  DETAIL="Webhook HTTP ${HTTP_CODE}. MONITOR_WEBHOOK_SECRET wurde vermutlich rotiert oder fehlt. Unter Settings → Secrets and variables → Actions aktualisieren. Der Workflow ändert das Secret nicht."
fi

if [[ "$HTTP_CODE" =~ ^2[0-9][0-9]$ ]]; then
  write_status true "$HTTP_CODE" "$DETAIL"
  echo "Webhook accepted: HTTP ${HTTP_CODE}"
  exit 0
fi

SNIP="$(head -c 180 test-results/webhook-body.txt 2>/dev/null || true)"
write_status false "$HTTP_CODE" "${DETAIL} ${SNIP}"
echo "::error::${DETAIL}"
exit 1
