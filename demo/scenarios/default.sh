#!/bin/sh
# The default install: every request is served, and nothing is logged.
# Starts the demo server, sends each request with curl, and stops the server. Run from the repo root:
#   sh demo/scenarios/default.sh
set -e
npm run --silent build
export PORT="${PORT:-3000}"
node demo/serve.js &
trap 'kill $!' EXIT
sleep 1

# send <description> <curl arguments...>
send() {
	echo "--- $1"
	shift
	curl -sS -i "$@"
	sleep 0.1
	echo
}

send 'A reader in Chrome' -H 'Demo-Visitor: Chrome' "http://localhost:$PORT/articles/42?ref=home"
send 'GPTBot reads the same article' -H 'Demo-Visitor: GPTBot' "http://localhost:$PORT/articles/42?ref=home"
send 'ClaudeBot posts a comment' -H 'Demo-Visitor: ClaudeBot' -H 'Content-Type: application/json' -d '{"text":"hello"}' "http://localhost:$PORT/comments"
