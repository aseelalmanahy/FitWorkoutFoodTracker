#!/usr/bin/env bash
# Smoke test of a deployment, from outside the app, through the proxy:  ./smoke.sh https://app.example.com
# Optional sign-in check with a synthetic account: SMOKE_EMAIL and SMOKE_PASSWORD in the environment (never in a file
# in Git). SMOKE_CACERT points curl at a private CA (CI's Caddy internal CA). Prints no secret. Exit 0 only if all pass.
set -uo pipefail
BASE="${1:?usage: smoke.sh <https origin>}"
CURL=(curl -sS --max-time 20); [ -n "${SMOKE_CACERT:-}" ] && [ -f "$SMOKE_CACERT" ] && CURL+=(--cacert "$SMOKE_CACERT")
# CI only, before Caddy's internal CA exists to trust: extra curl options (for example --insecure). Never on a server.
if [ -n "${SMOKE_CURL_OPTS:-}" ]; then read -r -a extra <<< "$SMOKE_CURL_OPTS"; CURL+=("${extra[@]}"); fi
fails=0
check() { if [ "$2" = 1 ]; then echo "PASS  $1"; else echo "FAIL  $1${3:+: $3}"; fails=$((fails + 1)); fi; }
hdr=$(mktemp); trap 'rm -f "$hdr" "${jar:-}"' EXIT

body=$("${CURL[@]}" -D "$hdr" "$BASE/api/health"); code=$(awk 'NR==1{print $2}' "$hdr")
check "health answers ok, with the database" "$([ "$code" = 200 ] && [ "$body" = '{"status":"ok"}' ] && echo 1)" "$code $body"
"${CURL[@]}" -o /dev/null -D "$hdr" "$BASE/login"; code=$(awk 'NR==1{print $2}' "$hdr")
check "the login page loads" "$([ "$code" = 200 ] && echo 1)" "$code"
for h in strict-transport-security content-security-policy x-content-type-options referrer-policy; do
  check "header $h" "$(grep -qi "^$h:" "$hdr" && echo 1)"
done
check "no Server header" "$(grep -qi '^server:' "$hdr" || echo 1)"
http="http://${BASE#https://}"
code=$("${CURL[@]}" -o /dev/null -w '%{http_code} %{redirect_url}' "$http/login")
check "plain http redirects to https" "$([[ "$code" =~ ^30[178]\ https:// ]] && echo 1)" "$code"
code=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$BASE/api/sessions")
check "private data needs a session (401)" "$([ "$code" = 401 ] && echo 1)" "$code"
code=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$BASE/api/health/db-identity")
check "the database identity endpoint is off in production (404)" "$([ "$code" = 404 ] && echo 1)" "$code"

if [ -n "${SMOKE_EMAIL:-}" ] && [ -n "${SMOKE_PASSWORD:-}" ]; then
  jar=$(mktemp)
  payload=$(printf '{"email":"%s","password":"%s"}' "$SMOKE_EMAIL" "$SMOKE_PASSWORD")
  code=$("${CURL[@]}" -o /dev/null -D "$hdr" -c "$jar" -w '%{http_code}' -H 'content-type: application/json' -H "origin: $BASE" --data-binary @- "$BASE/api/auth/login" <<< "$payload")
  cookie=$(grep -i '^set-cookie: fit_session=' "$hdr" | head -1)
  check "a synthetic account signs in" "$([ "$code" = 200 ] && echo 1)" "$code"
  check "its session cookie is Secure, HttpOnly and SameSite" "$(echo "$cookie" | grep -qi 'secure' && echo "$cookie" | grep -qi 'httponly' && echo "$cookie" | grep -qi 'samesite' && echo 1)"
  code=$("${CURL[@]}" -o /dev/null -b "$jar" -w '%{http_code}' "$BASE/api/sessions")
  check "a signed-in request is answered" "$([ "$code" = 200 ] || [ "$code" = 409 ] && echo 1)" "$code (409 = no profile yet, also correct)"
  "${CURL[@]}" -o /dev/null -b "$jar" -H "origin: $BASE" -X POST "$BASE/api/auth/logout"
fi
[ "$fails" = 0 ] && echo "SMOKE PASSED" || echo "SMOKE FAILED: $fails check(s)"
[ "$fails" = 0 ]
