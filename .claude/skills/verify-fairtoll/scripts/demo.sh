#!/bin/sh
# Drives the Fairtoll demo server (demo/serve.js) for verification. Every command takes the run's evidence
# directory, which holds the server's pid, port and log, and each request's response next to the server
# lines it caused. Run from the repo root:
#   demo.sh start  <dir> [settings.json]   build, start on a free port, wait until it answers
#   demo.sh doctor <dir>                   read-only: is this run's server up, ours, and built from current src
#   demo.sh send   <dir> <name> <path> [curl args...]   send one request, save <name>.txt and <name>.server.txt
#   demo.sh pay    <dir> <name>            print a PAYMENT-SIGNATURE for the 402 saved as <name>.txt
#   demo.sh stop   <dir>                   stop this run's server; the evidence stays
set -eu

command=${1:-}
dir=${2:-}
if [ -z "$command" ] || [ -z "$dir" ]; then
	sed -n '2,9p' "$0" >&2
	exit 2
fi
shift 2

running() {
	[ -f "$dir/server.pid" ] && kill -0 "$(cat "$dir/server.pid")" 2>/dev/null
}

case "$command" in
start)
	if running; then
		echo "A server from this run is already up (pid $(cat "$dir/server.pid")). Stop it first." >&2
		exit 1
	fi
	mkdir -p "$dir"
	npm run --silent build
	# PORT picks the port; without it, ask the OS for a free one so runs never share a server.
	port=${PORT:-$(node -e 'const s=require("node:net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})')}
	PORT=$port node demo/serve.js "$@" >"$dir/server.log" 2>&1 &
	echo $! >"$dir/server.pid"
	echo "$port" >"$dir/port"
	tries=0
	until grep -q "^Listening on " "$dir/server.log"; do
		if ! running || [ $tries -ge 50 ]; then
			echo "The server did not start. Its log:" >&2
			cat "$dir/server.log" >&2
			sh "$0" stop "$dir" >/dev/null
			exit 1
		fi
		tries=$((tries + 1))
		sleep 0.2
	done
	sh "$0" doctor "$dir"
	echo "Ready at http://localhost:$port"
	;;
doctor)
	if ! running; then
		echo "FAIL: no server from this run is up ($dir/server.pid missing or dead)"
		exit 1
	fi
	port=$(cat "$dir/port")
	echo "ok: pid $(cat "$dir/server.pid") is alive"
	if ! grep -q "^Listening on http://localhost:$port$" "$dir/server.log"; then
		echo "FAIL: the log does not say this server listens on $port"
		exit 1
	fi
	# Any path outside the endpoints gets the demo's own 404, so this proves the port is the demo, not something else.
	if ! curl -sS "http://localhost:$port/doctor-probe" | grep -q "Send requests under one of the endpoints"; then
		echo "FAIL: port $port does not answer like the demo server"
		exit 1
	fi
	echo "ok: port $port answers as the demo server"
	stale=$(find src -name '*.ts' -newer dist/express/index.js | head -n 5)
	if [ -n "$stale" ]; then
		echo "FAIL: dist is older than src, so the server runs old code. Restart it. Newer files:"
		echo "$stale"
		exit 1
	fi
	echo "ok: dist is built from the current src"
	echo "ok: settings $(sed -n 's/^Settings: //p' "$dir/server.log")"
	;;
send)
	name=$1
	path=$2
	shift 2
	port=$(cat "$dir/port")
	before=$(wc -l <"$dir/server.log")
	# Quote each argument, so the recorded command can be pasted back into a shell.
	quoted=""
	for arg in "$@"; do quoted="$quoted '$(printf '%s' "$arg" | sed "s/'/'\\\\''/g")'"; done
	{
		echo "\$ curl -sS -i$quoted 'http://localhost:$port$path'"
		curl -sS -i "$@" "http://localhost:$port$path"
	} >"$dir/$name.txt"
	# The server prints the response line after curl returns, so give it a moment.
	sleep 0.2
	tail -n +"$((before + 1))" "$dir/server.log" >"$dir/$name.server.txt"
	cat "$dir/$name.txt"
	echo
	echo "--- server"
	cat "$dir/$name.server.txt"
	;;
pay)
	name=$1
	node demo/pay.js "$(tr -d '\r' <"$dir/$name.txt" | grep -i '^payment-required:' | cut -d' ' -f2-)"
	;;
stop)
	if running; then
		pid=$(cat "$dir/server.pid")
		kill "$pid"
		while kill -0 "$pid" 2>/dev/null; do sleep 0.1; done
		echo "Stopped pid $pid"
	fi
	rm -f "$dir/server.pid" "$dir/port"
	echo "Evidence kept in $dir"
	;;
*)
	sed -n '2,9p' "$0" >&2
	exit 2
	;;
esac
