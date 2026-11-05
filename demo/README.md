# Demo

The demo shows what Fairtoll does to real HTTP requests, without reading its code or its tests. It is a small Express site, built from `dist/` the way a publisher installs Fairtoll, that you send requests to with curl.

```sh
npm run demo:serve
curl -i -H 'Demo-Visitor: GPTBot' http://localhost:3000/monitor/articles/42
```

It has one endpoint for each way a publisher can use Fairtoll, so the same request sent to each shows the difference:

| Endpoint | How the publisher uses Fairtoll |
| --- | --- |
| `/open` | Not at all: no Fairtoll |
| `/monitor` | Fairtoll classifies each request and lets it through |
| `/blocked` | Fairtoll answers AI bots and agents with a 403, and lets everyone else through |
| `/charged` | Fairtoll answers AI bots and agents with a 402 and a price, serves the page once they pay, charges every method but a CORS preflight, and lets everyone else through |
| `/paths` | Fairtoll has rules: it charges AI bots and agents $0.01 under `/paths/premium/`, blocks them under `/paths/private/`, and lets every other path through |

`/charged` charges $0.002 on Base Sepolia, paid to `0x000000000000000000000000000000000000dEaD`. It settles payments through a stand-in facilitator on the same server, at `/facilitator`, so no money moves and no wallet needs funds. The stand-in settles a payment that names the right price and wallet, and rejects one it has already settled. It checks no signature, so the demo shows Fairtoll's side of a payment, not a real one.

To pay, take the `PAYMENT-REQUIRED` header from a 402 and sign a payment for it with `demo/pay.js`, which prints the `PAYMENT-SIGNATURE` header to send back:

```sh
node demo/pay.js "<PAYMENT-REQUIRED header value>"
curl -i -H 'Demo-Visitor: GPTBot' -H "PAYMENT-SIGNATURE: <what pay.js printed>" http://localhost:3000/charged/articles/42
```

`/paths` runs the settings' config with two rules added, `{ "path": "/paths/premium/*", "ai": "charge", "price": "0.01" }` and `{ "path": "/paths/private/*", "ai": "block" }`, and the same wallet and network as `/charged`. A rule's path is the whole path, not the part under where Fairtoll is mounted. Paths no rule matches follow the config's own `ai`, which is `"allow"` unless the settings set it. A rule matches the page a request names, so `/paths/PREMIUM/1` and `/paths/%70remium/1` are charged too, and an AI request whose path has a `..` segment, such as `/paths/premium/1/..%2f..%2farticles`, is blocked, because Express routes it under `/paths/premium` while it resolves to `/paths/articles`. The `Config` type in `src/core/config.ts` documents how rules match.

The site's `/robots.txt` sits behind the same setup as `/blocked`, and every visitor gets it, because blocking always lets `/robots.txt` through.

Each endpoint answers any request under it with its method, path, and body, so a changed response is easy to see. Any other path gets a 404 listing the endpoints. The server prints each request with the user-agent Fairtoll saw, then any events passed to `log`, anything Fairtoll writes to stdout or stderr, and the response status.

## Settings

A settings file holds the publisher's other setup, which applies to every endpoint that has Fairtoll. `demo/settings/default.json` is used when none is given:

| Settings file | Setup |
| --- | --- |
| `default.json` | As installed by default, `fairtoll({})`, with nothing passed in |
| `logging.json` | With logging on, `fairtoll({}, { log })` |

To compare settings, send the same requests to a run with each, as in `npm run demo:serve -- demo/settings/logging.json`. A settings file looks like this:

```json
{ "description": "Fairtoll with logging on", "config": {}, "log": true }
```

`config` is passed to `fairtoll()` unchanged, so a new config field needs no change to the demo, and defaults to `{}`. `/blocked` sets `ai` to `"block"` on top of it, and `/charged` sets `ai` to `"charge"`, with the price, wallet and network above unless `config` sets them. `/paths` sets `rules`, replacing any the settings have. `log: true` turns on the `log` option. An invalid config stops the server at startup.

`PORT` sets the port, and the server stops with an error if the port is in use.

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

A scenario is a shell script in `demo/scenarios/` that builds the package, starts the server with the settings file it's given, sends its requests with curl, and stops the server. Its output is one transcript: each request's description, the server's lines, and curl's full response.

```sh
sh demo/scenarios/visitors.sh demo/settings/logging.json
```

`visitors.sh` sends a reader, an AI crawler reading, and an AI crawler posting to each endpoint. Run it once per settings file to compare settings. `charging.sh` has a crawler on `/charged` get a price, pay it, read the page, and try the same payment again, and ClaudeBot pay to post a comment. `paths.sh` sends the same AI crawler to paths under `/paths` that a rule charges, a rule blocks, and no rule matches, and has it pay on the charged one. To write a new scenario, copy it and change the `send` lines.

## Next.js

`demo/next/` is the same site as a Next.js app, with Fairtoll in its `proxy.js`, so the same curl requests show the Next.js adapter. It has `/open`, `/monitor`, `/blocked` and `/charged`, configured as above, with logging always on, and the same `Demo-Visitor` header and stand-in facilitator. It has no settings files, `/paths` or `/robots.txt`.

```sh
npm run demo:next
curl -i -H 'Demo-Visitor: GPTBot' http://localhost:3000/blocked/articles/42
```

It runs a production build with `next start`, so the proxy behaves as it would when deployed. Each request prints a line, then the event Fairtoll logged, then either the status Fairtoll answered with or that the request was passed on to the page.

## Checking a change

Write the scenario and describe the transcript you expect before the work starts. Then read the transcript the change produces, or run the scenario on its branch yourself. A change to `demo/serve.js`, a settings file, or a scenario changes what the transcript can show, so review it as closely as the change itself.
