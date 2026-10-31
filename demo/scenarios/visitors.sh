#!/bin/sh
# A reader, an AI crawler reading, and an AI crawler posting, sent to each endpoint of the demo server with
# the given settings. Starts the demo server, sends each request with curl, and stops the server. Run from
# the repo root:
#   sh demo/scenarios/visitors.sh demo/settings/logging.json
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

for endpoint in open monitor blocked charged; do
	send "A reader in Chrome, /$endpoint" -H 'Demo-Visitor: Chrome' "http://localhost:$PORT/$endpoint/articles/42?ref=home"
	send "GPTBot reads the same article, /$endpoint" -H 'Demo-Visitor: GPTBot' "http://localhost:$PORT/$endpoint/articles/42?ref=home"
	send "ClaudeBot posts a comment, /$endpoint" -H 'Demo-Visitor: ClaudeBot' -H 'Content-Type: application/json' -d '{"text":"hello"}' "http://localhost:$PORT/$endpoint/comments"
done
