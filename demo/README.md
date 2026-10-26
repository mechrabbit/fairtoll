# Demo

The demo shows what Fairtoll does to real HTTP requests, without reading its code or its tests. It is a small Express site, built from `dist/` the way a publisher installs Fairtoll, that you send requests to with curl.

```sh
npm run demo:serve
curl -i -H 'Demo-Visitor: GPTBot' http://localhost:3000/default/articles/42
```

Each endpoint has Fairtoll set up a different way, so the same request sent to each shows the difference. The endpoints come from a settings file, `demo/settings.json` by default:

| Endpoint | How Fairtoll is set up |
| --- | --- |
| `/default` | As installed by default, `fairtoll({})`, with nothing passed in |
| `/logs` | With logging on, `fairtoll({}, { log })` |
| `/none` | No Fairtoll, to compare against |

Fairtoll can't block or charge yet, so there are no endpoints for those. When it can, each is a new entry in the settings file.

Each endpoint answers any request under it with its method, path, and body, so a changed response is easy to see. The server prints each request with the user-agent Fairtoll saw, then any events passed to `log`, anything Fairtoll writes to stdout or stderr, and the response status.

## Settings

To try other setups, write a settings file and pass it, as in `npm run demo:serve -- my-settings.json`:

```json
{
	"endpoints": {
		"/logs": { "description": "Fairtoll with logging on", "config": {}, "log": true },
		"/none": { "description": "No Fairtoll, to compare against" }
	}
}
```

An endpoint with a `config` has Fairtoll in front, and the config is passed to `fairtoll()` unchanged, so a new config field needs no change to the demo. `log: true` turns on the `log` option. An endpoint without a `config` has no Fairtoll. An invalid config stops the server at startup, naming the endpoint.

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

A scenario is a shell script in `demo/scenarios/` that builds the package, starts the server, sends its requests with curl, and stops the server. To use other settings, pass the file to `node demo/serve.js` in the script. Its output is one transcript: each request's description, the server's lines, and curl's full response.

```sh
sh demo/scenarios/endpoints.sh
```

`endpoints.sh` sends the same visitors to each endpoint. To write a new one, copy it and change the `send` lines.

## Checking a change

Write the scenario and describe the transcript you expect before the work starts. Then read the transcript the change produces, or run the scenario on its branch yourself. A change to `demo/serve.js` or to a scenario changes what the transcript can show, so review it as closely as the change itself.
