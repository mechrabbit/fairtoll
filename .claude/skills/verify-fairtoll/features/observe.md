# Observe

The default install, `fairtoll({})`, observes only. Every visitor, human or AI, gets exactly the response the site would give without Fairtoll.

## Sub-features

- `observe-reader` passes a reader's request through unchanged.
- `observe-ai` passes an AI crawler's request through unchanged, GET and POST alike, body included.
- `observe-silent` writes nothing to the server's output without a `log` option.

## How to get to it (user POV)

- A publisher adds `app.use(fairtoll({}))`. In the demo that is `/monitor` under `demo/settings/default.json`.

## Driving it with verify.sh

Preconditions:

- `$V start "$R" demo/settings/default.json` printed `doctor: ok`.

- **Reader.** Run `$V send "$R" /monitor/articles/42 -H 'Demo-Visitor: Chrome'`. `200`, body `GET /monitor/articles/42`.
- **AI crawler reads.** Run `$V send "$R" /monitor/articles/42 -H 'Demo-Visitor: GPTBot'`. `200`, the same body.
- **AI crawler posts.** Run `$V send "$R" /monitor/comments -H 'Demo-Visitor: ClaudeBot' -H 'Content-Type: application/json' -d '{"text":"hi"}'`. `200`, body `POST /monitor/comments` and then `{"text":"hi"}`.
- **Control.** Send the same three requests to `/open/...`. Each response matches its `/monitor` twin apart from `Date` and the path prefix.
- **Silent.** `server.log` shows only the request line and `response 200` for each request: no `logged` line and no `fairtoll:` line.

## Gotchas

- `Date`, `ETag` and `Content-Length` differ between `/open` and `/monitor` because the echoed path differs. Compare status and body, not the whole header block.
- The default setup with no `log` installs a middleware that does nothing, so `observe-silent` proves that shortcut and not classification. Use the event log feature to see classification.
