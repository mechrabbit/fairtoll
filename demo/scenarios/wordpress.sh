#!/bin/sh
# A reader, AI crawlers on a page a rule blocks and a post a rule charges, by their paths and by the query strings
# WordPress also routes by, and one on a page no rule matches, sent to the local WordPress with the config in
# demo/wordpress/config.json. Starts the site, sends each request with curl, and stops the site. Run from the repo root:
#   sh demo/scenarios/wordpress.sh
set -e
export PORT="${PORT:-8080}"
sh demo/wordpress/serve.sh &
server=$!
# serve.sh ends by running PHP's server in its place, so this stops it.
trap 'kill $server 2>/dev/null' EXIT
# The first run downloads and installs WordPress, so wait until the site answers.
for _ in $(seq 60); do curl -s -o /dev/null "http://localhost:$PORT/" && break; sleep 1; done
kill -0 $server 2>/dev/null || exit 1
tmp=$(mktemp -d)

# send <description> <curl arguments...>
# Prints the status and the headers Fairtoll sets, then a plain-text body, or a page's title.
send() {
	echo "--- $1"
	shift
	curl -sS -D "$tmp/headers" -o "$tmp/body" "$@"
	grep -iE '^(HTTP|cache-control|content-type)' "$tmp/headers"
	if grep -qi '^content-type: text/plain' "$tmp/headers"; then cat "$tmp/body"; else grep -o '<title>[^<]*' "$tmp/body" | sed 's/<title>/title: /'; fi
	sleep 0.1
	echo
}

chrome='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
gptbot='Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot'
claudebot='Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'
perplexitybot='Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)'

send "A reader in Chrome, on the sample page a rule blocks" -A "$chrome" "http://localhost:$PORT/sample-page/"
send "GPTBot on the same page" -A "$gptbot" "http://localhost:$PORT/sample-page/"
send "ClaudeBot on the same page, written in capitals" -A "$claudebot" "http://localhost:$PORT/SAMPLE-PAGE/"
send "GPTBot on the post a rule charges, which the plugin can't do yet, so it observes" -A "$gptbot" "http://localhost:$PORT/hello-world/"
send "GPTBot posting to /?page_id=2, which WordPress serves as the sample page" -A "$gptbot" -d '' "http://localhost:$PORT/?page_id=2"
send "A reader doing the same" -A "$chrome" -d '' "http://localhost:$PORT/?page_id=2"
send "GPTBot reading the sample page through the REST API, as /?rest_route=, which the /wp-json/* rule covers" -A "$gptbot" "http://localhost:$PORT/?rest_route=/wp/v2/pages/2"
send "GPTBot on /?p=1, which is the charged post, so it's observed, and WordPress redirects it to the post's permalink" -A "$gptbot" "http://localhost:$PORT/?p=1"
send "PerplexityBot on the home page, which no rule matches" -A "$perplexitybot" "http://localhost:$PORT/"
