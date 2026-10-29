#!/bin/sh
# An AI crawler that gets a price, pays it, and reads the page, then tries the same payment again, next to a
# reader, a crawler that pays to post a comment, and a crawler reading robots.txt. Starts the demo server,
# sends each request with curl, and stops the server. Run from the repo root:
#   sh demo/scenarios/charging.sh demo/settings/logging.json
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

url="http://localhost:$PORT/charged/articles/42"
comments="http://localhost:$PORT/charged/comments"
send "A reader in Chrome" -H 'Demo-Visitor: Chrome' "$url"
quote=$(mktemp)
trap 'kill $server 2>/dev/null; rm -f "$quote"' EXIT
send "GPTBot reads the article without paying" -H 'Demo-Visitor: GPTBot' "$url" | tee "$quote"
echo "--- GPTBot signs a payment for the price in PAYMENT-REQUIRED with demo/pay.js"
payment=$(sign "$quote")
echo
send "GPTBot sends the article request again with its payment" -H 'Demo-Visitor: GPTBot' -H "PAYMENT-SIGNATURE: $payment" "$url"
send "GPTBot sends the same payment a second time" -H 'Demo-Visitor: GPTBot' -H "PAYMENT-SIGNATURE: $payment" "$url"
send "ClaudeBot posts a comment without paying, which is charged like a read" -H 'Demo-Visitor: ClaudeBot' -H 'Content-Type: application/json' -d '{"text":"hello"}' "$comments" | tee "$quote"
echo "--- ClaudeBot signs a payment for that price with demo/pay.js"
payment=$(sign "$quote")
echo
send "ClaudeBot posts the comment again with its payment" -H 'Demo-Visitor: ClaudeBot' -H 'Content-Type: application/json' -H "PAYMENT-SIGNATURE: $payment" -d '{"text":"hello"}' "$comments"
send "GPTBot reads robots.txt, which is always free" -H 'Demo-Visitor: GPTBot' "http://localhost:$PORT/robots.txt"
