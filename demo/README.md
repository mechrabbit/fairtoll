# Demo

The demo shows what Fairtoll does to real HTTP requests, without reading its code or its tests. It is a small Express site, built from `dist/` the way a publisher installs Fairtoll, that you send requests to with curl.

```sh
npm run demo:serve -- demo/settings/logging.json
curl -i -H 'Demo-Visitor: GPTBot' http://localhost:3000/articles/42
```

The site answers any request with its method, path, and body, so a changed response is easy to see. The server prints each request with the user-agent Fairtoll saw, then any events passed to `log`, anything Fairtoll writes to stdout or stderr, and the response status.

## Settings

Each run has one Fairtoll setup in front of the whole site, as a publisher would install it. A settings file picks it, and `demo/settings/default.json` is used when none is given:

| Settings file | How Fairtoll is set up |
| --- | --- |
| `default.json` | As installed by default, `fairtoll({})`, with nothing passed in |
| `logging.json` | With logging on, `fairtoll({}, { log })` |
| `none.json` | No Fairtoll, to compare against |

To compare setups, send the same requests to a run with each. Fairtoll can't block or charge yet, so there are no settings for those. When it can, each is a new settings file.

A settings file looks like this:

```json
{ "description": "Fairtoll with logging on", "config": {}, "log": true }
```

With a `config`, Fairtoll is in front of the site, and the config is passed to `fairtoll()` unchanged, so a new config field needs no change to the demo. `log: true` turns on the `log` option. Without a `config`, there is no Fairtoll. An invalid config stops the server at startup.

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

`visitors.sh` sends a reader, an AI crawler reading, and an AI crawler posting. Run it once per settings file to compare them. To write a new scenario, copy it and change the `send` lines.

## Checking a change

Write the scenario and describe the transcript you expect before the work starts. Then read the transcript the change produces, or run the scenario on its branch yourself. A change to `demo/serve.js`, a settings file, or a scenario changes what the transcript can show, so review it as closely as the change itself.
