# Event log

With a `log` option, Fairtoll passes the publisher one event per request from an AI bot or agent, saying what it was, why, which path it asked for, and what Fairtoll did. Human requests are never logged.

## Sub-features

- `log-ai` logs an AI crawler's request with `class`, `reason`, `path` and `action`.
- `log-human-skipped` logs nothing for a reader.
- `log-path-routed` logs the path Express routed on, without the query string, even for dot segments and backslashes.
- `log-action` logs `allow` under `/monitor` and `block` under `/blocked`.

## How to get to it (user POV)

- A publisher adds `app.use(fairtoll({}, { log: (event) => ... }))`. In the demo that is `demo/settings/logging.json`, which prints each event as `   logged {...}`.

## Driving it with verify.sh

Preconditions:

- `$V start "$R" demo/settings/logging.json` printed `doctor: ok`.

- **AI request.** Run `$V send "$R" '/monitor/articles/42?ref=home' -H 'Demo-Visitor: GPTBot'`. `200`. `server.log` has `logged {"fairtoll":1,"time":"...","path":"/monitor/articles/42","class":"unverifiedBot","reason":"user-agent claims GPTBot","action":"allow"}`. The query string is not in `path`.
- **Reader.** Run `$V send "$R" /monitor/articles/42 -H 'Demo-Visitor: Chrome'`. `200`, and no `logged` line follows that request in `server.log`.
- **Routed path.** Run `$V send "$R" / -H 'Demo-Visitor: GPTBot' --request-target '/monitor/articles/%2e%2e/admin'`. The response body is `GET /monitor/articles/%2e%2e/admin`, and the logged `path` is the same, not `/monitor/admin`.
- **Blocked action.** Run `$V send "$R" /blocked/articles/42 -H 'Demo-Visitor: ClaudeBot'`. `403`, and the event has `"action":"block"` and `"reason":"user-agent claims ClaudeBot"`.

## Gotchas

- The event is logged without waiting, so it can follow `response <status>` in `server.log`. `send` pauses briefly, but match events to requests by `path`, not by line order alone.
- `/open` has no Fairtoll and never logs.
- `class` is `unverifiedBot` for every AI user-agent today, because a user-agent is only a claim. `verifiedAiBuyer` and `payingAgent` have no way in yet.
- The doctor's own `GET /verify-doctor` lines show up in `server.log`. They come from curl's user-agent, so they never log an event.
