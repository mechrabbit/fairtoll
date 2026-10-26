#!/bin/sh
# The same visitors on each endpoint in demo/settings.json: every endpoint serves every request the same
# way, and only /logs logs each AI crawler once.
# Starts the demo server, sends each request with curl, and stops the server. Run from the repo root:
#   sh demo/scenarios/endpoints.sh
set -e
npm run --silent build
export PORT="${PORT:-3000}"
node demo/serve.js &
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

send 'A reader in Chrome, without Fairtoll' -H 'Demo-Visitor: Chrome' "http://localhost:$PORT/none/articles/42?ref=home"
send 'GPTBot, without Fairtoll' -H 'Demo-Visitor: GPTBot' "http://localhost:$PORT/none/articles/42?ref=home"
send 'A reader in Chrome, default install' -H 'Demo-Visitor: Chrome' "http://localhost:$PORT/default/articles/42?ref=home"
send 'GPTBot, default install' -H 'Demo-Visitor: GPTBot' "http://localhost:$PORT/default/articles/42?ref=home"
send 'A reader in Chrome, with logging' -H 'Demo-Visitor: Chrome' "http://localhost:$PORT/logs/articles/42?ref=home"
send 'GPTBot, with logging' -H 'Demo-Visitor: GPTBot' "http://localhost:$PORT/logs/articles/42?ref=home"
send 'ClaudeBot posts a comment, with logging' -H 'Demo-Visitor: ClaudeBot' -H 'Content-Type: application/json' -d '{"text":"hello"}' "http://localhost:$PORT/logs/comments"
