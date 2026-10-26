# Demo

The demo shows what Fairtoll does to real HTTP requests, without reading its code or its tests. It is a small Express site with `fairtoll` in front, built from `dist/` the way a publisher installs it, that you send requests to with curl.

```sh
npm run demo:serve -- --log
curl -i -H 'Demo-Visitor: GPTBot' http://localhost:3000/articles/42
```

The site answers every request with its method, path, and body, so a changed response is easy to see. The server prints each request with the user-agent Fairtoll saw, then any events passed to `log`, anything Fairtoll writes to stdout or stderr, and the response status.

Leave out `--log` to run the default install. A config file goes after the flags, as in `npm run demo:serve -- --log config.json`, and is passed to `fairtoll()` unchanged, so a new config field needs no change to the demo. `PORT` sets the port.

## Naming a visitor

A `Demo-Visitor` header sends the request as a known visitor, with that visitor's real user-agent string. The server swaps it in and removes the header before Fairtoll sees the request. Capitalisation doesn't matter, and an unknown name gets a 400 that lists the known ones.

| `Demo-Visitor` | Who it is |
| --- | --- |
| `Chrome` | A reader in desktop Chrome |
| `Safari on iPhone` | A reader on a phone |
| `Googlebot` | Google's search crawler, which is not an AI crawler |
| `GPTBot` | OpenAI's training crawler |
| `ChatGPT-User` | ChatGPT fetching a page for a user |
| `ClaudeBot` | Anthropic's crawler |
| `PerplexityBot` | Perplexity's crawler |
| `CCBot` | Common Crawl, whose data trains many models |

To send any other user-agent, leave out the header and use `curl -A '...'`.

## Scenarios

A scenario is a shell script in `demo/scenarios/` that builds the package, starts the server with its flags, sends its requests with curl, and stops the server. Its output is one transcript: each request's description, the server's lines, and curl's full response.

```sh
sh demo/scenarios/logging.sh
```

`default.sh` is the default install and `logging.sh` turns logging on. To write a new one, copy either and change the `node demo/serve.js` flags and the `send` lines.

## Checking a change

Write the scenario and describe the transcript you expect before the work starts. Then read the transcript the change produces, or run the scenario on its branch yourself. A change to `demo/serve.js` or to a scenario changes what the transcript can show, so review it as closely as the change itself.
