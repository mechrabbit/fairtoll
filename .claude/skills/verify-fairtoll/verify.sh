#!/bin/sh
# Starts, checks, drives, screenshots and stops one demo server for a verification run. Everything the run
# makes goes in its run directory, and stop removes only the pid file, so the evidence outlives the server.
# Run from the repo root:
#   verify.sh start  <run-dir> [settings.json]   build, start on $PORT or a free port, wait until ready
#   verify.sh doctor <run-dir>                   read-only: is this run's server worth driving?
#   verify.sh send   <run-dir> <path> [curl args...]   curl -sS -i the path, appended to curl.txt
#   verify.sh shot   <run-dir> [title]           render curl.txt and server.log to curl.png and server.png
#   verify.sh stop   <run-dir>                   stop the server this run started
set -eu
cmd=${1:?usage: verify.sh start|doctor|send|shot|stop <run-dir> ...}
dir=${2:?run directory required}
shift 2
here=$(dirname "$0")

# The pid file's process, if it is still this run's demo server.
server_pid() {
	[ -f "$dir/pid" ] || return 1
	pid=$(cat "$dir/pid")
	kill -0 "$pid" 2>/dev/null || return 1
	ps -o args= -p "$pid" | grep -q 'demo/serve.js' || return 1
	echo "$pid"
}

doctor() {
	pid=$(server_pid) || { echo "doctor: no live demo server for $dir"; return 1; }
	port=$(cat "$dir/port")
	grep -q "Listening on http://localhost:$port\$" "$dir/server.log" || { echo "doctor: server.log has no Listening line for port $port"; return 1; }
	# Any path outside the endpoints gets the demo's 404, which names the endpoints. Another app on the port would not.
	curl -sS "http://localhost:$port/verify-doctor" | grep -q 'Send requests under one of the endpoints' || { echo "doctor: port $port does not answer like the demo server"; return 1; }
	stale=$(find src demo/serve.js -newer dist/express/index.js -type f | head -1)
	[ -z "$stale" ] || { echo "doctor: $stale changed after the build, so restart the run"; return 1; }
	echo "doctor: ok, pid $pid, http://localhost:$port, $(sed -n 2p "$dir/server.log" | sed 's/^ *//')"
}

case $cmd in
start)
	if server_pid >/dev/null; then echo "start: $dir already has a running server"; exit 1; fi
	mkdir -p "$dir"
	npm run --silent build
	port=${PORT:-$(node -e "const s=require('net').createServer().listen(0,()=>{console.log(s.address().port);s.close()})")}
	echo "$port" >"$dir/port"
	# npm run demo:serve is the build above plus this line. Starting node directly makes $! the server itself.
	PORT=$port nohup node demo/serve.js "$@" >"$dir/server.log" 2>&1 &
	echo $! >"$dir/pid"
	for _ in $(seq 50); do
		grep -q '^Known visitors' "$dir/server.log" && break
		kill -0 "$(cat "$dir/pid")" 2>/dev/null || break
		sleep 0.2
	done
	doctor || { cat "$dir/server.log"; exit 1; }
	;;
doctor) doctor ;;
send)
	path=${1:?path required}
	shift
	port=$(cat "$dir/port")
	{
		printf '$ curl -sS -i'
		for arg in "$@"; do printf " '%s'" "$arg"; done
		printf " 'http://localhost:%s%s'\n" "$port" "$path"
		curl -sS -i "$@" "http://localhost:$port$path" 2>&1 || true
		printf '\n\n'
	} | tee -a "$dir/curl.txt"
	# The server prints the response line once the response has finished, so give it a moment to reach the log.
	sleep 0.2
	;;
shot) node "$here/shot.mjs" "$dir" "${1:-}" ;;
stop)
	if pid=$(server_pid); then kill "$pid"; echo "stop: stopped pid $pid"; else echo "stop: nothing running for $dir"; fi
	rm -f "$dir/pid"
	;;
*) echo "unknown command $cmd"; exit 1 ;;
esac
