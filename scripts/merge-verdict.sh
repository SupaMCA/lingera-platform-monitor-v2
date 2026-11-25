#!/usr/bin/env bash
# Combines the Playwright verdict with the webhook result and writes the job summary.
set -euo pipefail

mkdir -p test-results

if [[ ! -f test-results/verdict.json ]]; then
  jq -n '{ok:false, reasons:["nicht geprüft / not checked: der Lauf hat kein Urteil geschrieben"], warnings:[]}' \
    > test-results/verdict.json
fi

if [[ ! -f test-results/webhook-status.json ]]; then
  jq -n '{ok:false, http_code:"not_sent", detail:"Webhook-Schritt ist nicht gelaufen"}' \
    > test-results/webhook-status.json
fi

jq -s '
  .[0] as $v | .[1] as $w |
  if $w.ok then $v
  else $v | .ok = false | .reasons += ["Webhook: \($w.detail)"]
  end
' test-results/verdict.json test-results/webhook-status.json > test-results/verdict-final.json
mv test-results/verdict-final.json test-results/verdict.json

{
  echo "## Plattform-Check"
  echo
  if jq -e '.ok == true' test-results/verdict.json >/dev/null; then
    echo "Ergebnis: **in Ordnung**. \`ok\` heißt, die Inhaltsstruktur wurde geprüft. Blockierte Plattformen stehen darunter und zählen nicht als ok."
  else
    echo "Ergebnis: **fehlgeschlagen**."
    echo
    echo "### Gründe"
    jq -r '.reasons[] | "- " + .' test-results/verdict.json
  fi
  if jq -e '.warnings | length > 0' test-results/verdict.json >/dev/null; then
    echo
    echo "### Nicht ok, aber kein eigener Abbruchgrund"
    jq -r '.warnings[] | "- " + .' test-results/verdict.json
  fi
  if [[ -f test-results/platform-results.json ]]; then
    echo
    echo "| Plattform | Status | Erreichbarkeit | Verifikation |"
    echo "| --- | --- | --- | --- |"
    jq -r '.[] | "| \(.platform) | \(.status) | \(.reachability) | \(.verification) |"' test-results/platform-results.json
  fi
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

echo "Final verdict:"
jq . test-results/verdict.json
