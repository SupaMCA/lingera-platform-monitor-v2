#!/usr/bin/env bash
# Opens or updates one GitHub issue when the check fails, and closes it after a green run.
# GitHub emails the repository owner on a new issue. No external notification service.
set -euo pipefail

VERDICT_FILE="test-results/verdict.json"
if [[ ! -f "$VERDICT_FILE" ]]; then
  mkdir -p test-results
  jq -n '{ok:false, reasons:["nicht geprüft / not checked: kein Urteil vorhanden"], warnings:[]}' > "$VERDICT_FILE"
fi

OK="$(jq -r '.ok' "$VERDICT_FILE")"
RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
TITLE="[monitor] Plattform-Check fehlgeschlagen"
LABEL="platform-health"

gh label create "$LABEL" \
  --color "B60205" \
  --description "Lingera platform monitor alerts" >/dev/null 2>&1 || true

EXISTING="$(gh issue list --state open --label "$LABEL" --limit 20 --json number,title \
  --jq "[.[] | select(.title == \"$TITLE\") | .number][0] // empty")"

if [[ "$OK" == "true" ]]; then
  if [[ -n "$EXISTING" ]]; then
    gh issue close "$EXISTING" --comment "$(cat <<EOF
Der Lauf ${RUN_URL} war erfolgreich.

ChatGPT-Struktur war verifiziert und der Webhook hat die Meldung angenommen. Blockierte andere Plattformen sind Warnungen und zählen nicht als \`ok\`. Dieses Issue wird geschlossen.
EOF
)"
    echo "Closed alert issue #${EXISTING}"
  else
    echo "Check passed and there is no open alert issue."
  fi
  exit 0
fi

BODY_FILE="$(mktemp)"
{
  echo "Der Plattform-Check ist fehlgeschlagen. \`ok\` wird nur vergeben, wenn die Inhaltsstruktur wirklich geprüft wurde."
  echo
  echo "Lauf: ${RUN_URL}"
  echo
  echo "## Gründe"
  jq -r '.reasons[] | "- " + .' "$VERDICT_FILE"
  if jq -e '.warnings | length > 0' "$VERDICT_FILE" >/dev/null; then
    echo
    echo "## Weitere Plattformen (nicht ok, zählen nicht als Abbruchgrund)"
    jq -r '.warnings[] | "- " + .' "$VERDICT_FILE"
  fi
  if [[ -f test-results/platform-results.json ]]; then
    echo
    echo "## Ergebnisse"
    jq -r '.[] | "- **\(.platform)**: \(.status), Erreichbarkeit \(.reachability), Verifikation \(.verification)\(if .error_message then " — " + .error_message else "" end)"' \
      test-results/platform-results.json
  fi
  echo
  echo "## Was zu tun ist"
  echo "- HTTP 401/403 am Webhook: \`MONITOR_WEBHOOK_SECRET\` wurde vermutlich rotiert. Neues Secret unter Settings → Secrets and variables → Actions eintragen. Dieser Workflow liest das Secret nur."
  echo "- ChatGPT rot: die öffentliche Share-Seite liefert die erwarteten Attribute nicht mehr, oder sie ist blockiert. \`CHATGPT_SHARE_URL\` (Secret oder Repository variable) auf eine gültige öffentliche Unterhaltung setzen. Für die eingeloggte Oberfläche, die die Extension liest, zusätzlich \`CHATGPT_STORAGE_STATE\` und \`CHATGPT_CONVERSATION_URL\` setzen. Siehe README."
  echo "- Workflow disabled: im Actions-Tab auf „Enable workflow“ klicken."
} > "$BODY_FILE"

if [[ -n "$EXISTING" ]]; then
  gh issue comment "$EXISTING" --body-file "$BODY_FILE"
  echo "Updated alert issue #${EXISTING}"
else
  gh issue create --title "$TITLE" --label "$LABEL" --body-file "$BODY_FILE"
fi
