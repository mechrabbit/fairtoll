#!/bin/sh
# One AI crawler sent to paths under /paths that a rule charges, a rule blocks, and no rule matches, next to a
# reader, a CORS preflight, and the same request to /monitor. Starts the demo server, sends each request with
# curl, and stops the server. Run from the repo root:
#   sh demo/scenarios/paths.sh demo/settings/logging.json
set -e
npm run --silent build
export PORT="${PORT:-3000}"
node demo/serve.js "$@" &
server=$!
trap 'kill $server 2>/dev/null' EXIT
sleep 1
# Stop if the server didn't start, such as when the port is in use, so no request reaches another server.
kill -0 $server 2>/dev/null || exit 1

# send <description> <curl arguments...>
send() {
	echo "--- $1"
	shift
	curl -sS -i "$@"
	sleep 0.1
	echo
}

# sign <file holding a 402>: the PAYMENT-SIGNATURE for the price in its PAYMENT-REQUIRED header, from demo/pay.js.
sign() {
	node demo/pay.js "$(tr -d '\r' < "$1" | grep -i '^payment-required:' | cut -d' ' -f2-)"
}

site="http://localhost:$PORT"
quote=$(mktemp)
trap 'kill $server 2>/dev/null; rm -f "$quote"' EXIT
send "A reader in Chrome reads a premium article" -H 'Demo-Visitor: Chrome' "$site/paths/premium/1"
send "GPTBot reads the premium article without paying, which a rule charges \$0.01 for" -H 'Demo-Visitor: GPTBot' "$site/paths/premium/1" | tee "$quote"
echo "--- GPTBot signs a payment for the price in PAYMENT-REQUIRED with demo/pay.js"
payment=$(sign "$quote")
echo
send "GPTBot sends the request again with its payment" -H 'Demo-Visitor: GPTBot' -H "PAYMENT-SIGNATURE: $payment" "$site/paths/premium/1"
send "GPTBot asks for the premium article with its path percent-encoded, which the rule still matches" -H 'Demo-Visitor: GPTBot' "$site/paths/%70remium/1"
send "GPTBot's CORS preflight for the premium article, which is never charged" -X OPTIONS -H 'Demo-Visitor: GPTBot' -H 'Access-Control-Request-Method: POST' "$site/paths/premium/1"
send "GPTBot reads a private page, which a rule blocks" -H 'Demo-Visitor: GPTBot' "$site/paths/private/1"
send "GPTBot reads an article no rule matches, which follows the top-level ai" -H 'Demo-Visitor: GPTBot' "$site/paths/articles/1"
send "GPTBot reads the same premium path on /monitor, which has no rules" -H 'Demo-Visitor: GPTBot' "$site/monitor/premium/1"
send "GPTBot reads robots.txt, which is always free" -H 'Demo-Visitor: GPTBot' "$site/robots.txt"
