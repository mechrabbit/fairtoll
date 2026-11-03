#!/bin/sh
# An AI crawler on /paths, whose rules charge only under /paths/premium and block only under /paths/drafts: it
# reads other pages free, pays for a premium page, and is refused a draft and a premium page reached through
# "..". A reader and the same crawler on /monitor, which has no rules, read the premium page free. Each
# description ends with the status it should get. Starts the demo server, sends each request with curl, and
# stops the server. Run from the repo root:
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
premium="$site/paths/premium/42"
quote=$(mktemp)
trap 'kill $server 2>/dev/null; rm -f "$quote"' EXIT
send "GPTBot reads an article no rule covers: 200" -H 'Demo-Visitor: GPTBot' "$site/paths/articles/42"
send "GPTBot reads a premium article without paying: 402, asking 10000 millionths of a USDC" -H 'Demo-Visitor: GPTBot' "$premium" | tee "$quote"
echo "--- GPTBot signs a payment for the price in PAYMENT-REQUIRED with demo/pay.js"
payment=$(sign "$quote")
echo
send "GPTBot reads the premium article again with its payment: 200" -H 'Demo-Visitor: GPTBot' -H "PAYMENT-SIGNATURE: $payment" "$premium"
send "GPTBot reads the premium article with other capitals, which the rule still covers: 402" -H 'Demo-Visitor: GPTBot' "$site/PATHS/Premium/42"
send "GPTBot reads a draft: 403" -H 'Demo-Visitor: GPTBot' "$site/paths/drafts/1"
send "GPTBot reaches the premium article through an encoded ..: 403" -H 'Demo-Visitor: GPTBot' "$site/paths/articles/%2e%2e/premium/42"
send "GPTBot reaches the premium article through a .., which --path-as-is sends as written: 403" -H 'Demo-Visitor: GPTBot' --path-as-is "$site/paths/articles/../premium/42"
send "A reader in Chrome reads the premium article: 200" -H 'Demo-Visitor: Chrome' "$premium"
send "GPTBot reads the same premium article on /monitor, which has no rules: 200" -H 'Demo-Visitor: GPTBot' "$site/monitor/premium/42"
send "GPTBot reads robots.txt, which is always free: 200" -H 'Demo-Visitor: GPTBot' "$site/robots.txt"
