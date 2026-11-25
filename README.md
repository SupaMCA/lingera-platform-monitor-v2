# Lingera Plattform-Monitor

Täglicher Check, ob die sechs KI-Plattformen für Lingera noch die Struktur haben, die zum Speichern gebraucht wird. ChatGPT wird am strengsten geprüft.

`ok` heißt: der Inhalt wurde geprüft. Eine Login-Wand, Cloudflare oder eine Seite, die nur den Markennamen zeigt, ist **nicht** `ok`.

## Was geprüft wird

| Plattform | Wann `ok` | Wenn der Runner blockiert wird |
| --- | --- | --- |
| ChatGPT | Gesprächsstruktur gefunden | Der Lauf schlägt fehl. ChatGPT muss verifiziert sein. |
| Claude, Grok, Gemini, Perplexity, DeepSeek | Sichtbare Chat-Eingabe | Status `cloudflare`, `login_wall` oder `brand_detected`. Der Lauf bleibt grün, der Status ist aber nicht `ok`. |

Ein Lauf ohne Ergebnisse endet als **nicht geprüft / not checked** und öffnet ein Issue. Er meldet die Plattformen nicht als gesund.

Die öffentliche Statusseite (`app.lingera.ai/status`) zeigt „nicht geprüft“, wenn der letzte Check älter als 36 Stunden ist. Das macht die Lingera-App, nicht dieses Repo. Dieses Repo schickt ehrliche Einzelergebnisse und alarmiert über ein GitHub-Issue.

## ChatGPT

Ohne Zugangsdaten öffnet der Check eine öffentliche Share-Seite:

`https://chatgpt.com/share/6a1a1e2e-17f8-83e8-8f2b-2c4c187db51b`

Verifiziert ist sie, wenn in `main` ein `[data-conversation-transcript]` steht und darin mindestens eine Nutzer- und eine Assistenz-Nachricht mit `data-message-role`. Fehlt das, ist der Status `selector_not_found` und der Lauf rot. Die Meldung listet, welche Attribute stattdessen da waren (`data-conversation-role`, `data-turn-key`, das alte `data-message-author-role`).

Die eingeloggte ChatGPT-Oberfläche, die die Extension liest, benutzt seit November 2026 `data-conversation-role` und `data-turn-key` in `main`. Eine Share-Seite zeigt diese Attribute heute nicht. Dafür gibt es einen zweiten Vertrag, der nur mit Secrets läuft.

## Secrets

Nichts davon ist Pflicht. Der Workflow ändert keine Secrets.

| Name | Wofür |
| --- | --- |
| `MONITOR_WEBHOOK_URL`, `MONITOR_WEBHOOK_SECRET` | Meldung an die Lingera-Statusseite. Ein HTTP-Code außer 2xx, auch 401 nach einer Rotation, macht den Lauf rot und aktualisiert das Alert-Issue. |
| `CHATGPT_SHARE_URL` | Andere öffentliche Share-URL, falls die eingebaute gelöscht wird. Geht auch als Repository variable gleichen Namens. |
| `CHATGPT_STORAGE_STATE` | Playwright-Storage-State einer eingeloggten ChatGPT-Session (JSON). |
| `CHATGPT_CONVERSATION_URL` | Eine eigene Unterhaltung mit mindestens einer Nutzer- und einer Assistenz-Nachricht. Zusammen mit dem Storage-State wird `data-conversation-role` und `data-turn-key` in `main` verlangt. |

Storage-State und Conversation-URL gelten nur gemeinsam. Traces und Screenshots werden nicht erzeugt, solange ein Storage-State gesetzt ist, damit die Session nicht in den öffentlichen Artifacts landet.

## Alarm

Bei einem Fehlschlag öffnet oder aktualisiert der Lauf ein Issue mit dem Titel `[monitor] Plattform-Check fehlgeschlagen` und dem Label `platform-health`. Ein neues Issue schickt GitHub dir per E-Mail. Ein grüner Lauf schließt das Issue. Kein zusätzlicher Dienst.

## Workflows aktiv halten

GitHub schaltet geplante Workflows in einem öffentlichen Repo nach 60 Tagen ohne Repository-Aktivität ab (`disabled_inactivity`). Läufe zählen nicht als Aktivität, Commits schon.

`Keep scheduled workflows active` (`.github/workflows/keepalive.yml`) läuft montags und donnerstags. Es schaltet Workflows mit Status `disabled_inactivity` wieder an und erzeugt erst nach 30 Tagen ohne Commit einen Keepalive-Commit. Manuell abgeschaltete Workflows lässt es aus.

Der Check läuft täglich um 09:00 UTC, über „Run workflow“, und zusätzlich bei einem Push auf `main`, der die Check-Dateien selbst ändert. Der Keepalive-Commit löst ihn nicht aus. Der API-Token kann `workflow_dispatch` nicht aufrufen (HTTP 403).

Der Token dieses Repos konnte den alten Workflow `daily-platform-check.yml` (id 282900092, Status `disabled_inactivity`) nicht einschalten (HTTP 403). Der Check liegt deshalb in der neuen Datei `platform-health.yml`. Eine neue Workflow-Datei startet aktiv; die alte Datei ist entfernt. Der Keepalive schaltet künftige `disabled_inactivity`-Zustände wieder an. Wenn der neue Workflow trotzdem aus ist: Actions → Daily Platform Health Check → **Enable workflow**.

## Lokal

```bash
npm ci
npx playwright install chromium
npx playwright test health.spec.ts
npx playwright test
```
