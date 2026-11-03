# Observe

With the default install, Fairtoll changes no responses. It classifies each request, and when the publisher passes a `log` function, it receives one event per AI bot request with its path, class, reason and action. Readers get no event.

## Sub-features

- `observe-passthrough` serves every visitor the same response as with no Fairtoll.
- `observe-classify` classifies a user-agent naming an AI agent as `unverifiedBot`, and anything else as human.
- `observe-event` sends one event per bot request to `log`, with the path and no query string.
- `observe-no-human-event` sends no event for a human.
- `observe-silent-default` logs nothing when no `log` is passed.

## How to get to it (user POV)

- A publisher mounts `fairtoll({})` or `fairtoll({}, { log })`, which is `/monitor` with `default.json` or `logging.json`.
- A visitor requests any page under the mount.

## Driving it with demo.sh

Preconditions:

- A server started with `demo/settings/logging.json`, and doctor passes.

- **Reader passes.** Send `sh $H send "$DIR" chrome-monitor '/monitor/articles/42?ref=home' -H 'Demo-Visitor: Chrome'`. The response is `200` with body `GET /monitor/articles/42`, and the server lines have no `logged` line.
- **Bot passes and is logged.** Send `sh $H send "$DIR" gptbot-monitor '/monitor/articles/42?ref=home' -H 'Demo-Visitor: GPTBot'`. The response is `200` with the same body. The server lines have one `logged` event with `"path":"/monitor/articles/42"`, `"class":"unverifiedBot"`, `"reason":"user-agent claims GPTBot"` and `"action":"allow"`.
- **Control.** Send `sh $H send "$DIR" gptbot-open '/open/articles/42?ref=home' -H 'Demo-Visitor: GPTBot'`. Its body and status match `gptbot-monitor`, and it has no `logged` line.
- **Not an AI crawler.** Send `sh $H send "$DIR" googlebot-monitor /monitor/articles/42 -H 'Demo-Visitor: Googlebot'`. The response is `200` and there is no `logged` line, because Googlebot is classified as human.
- **Silent default.** Stop, start a new run with `demo/settings/default.json`, and send `gptbot-monitor` again. The response is `200` and the server lines have no `logged` line.

## Gotchas

- Classification is by user-agent only, so `unverifiedBot` is the only bot class the demo can show. `verifiedAiBuyer` and `payingAgent` have no cryptographic signal to drive yet.
- The event is logged asynchronously. `send` waits 0.2s; if a `logged` line is missing, read `server.log` before calling it absent.
- Express's `X-Powered-By` and `ETag` headers come from the demo site, not Fairtoll. Compare them against `/open`.
