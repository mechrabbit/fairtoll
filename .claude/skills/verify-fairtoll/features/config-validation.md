# Config validation

An invalid config or option throws when the middleware is created, so the publisher's site fails at startup with a message naming each bad field, instead of misbehaving on a request.

## Sub-features

- `config-unknown-field` rejects a field Fairtoll doesn't know.
- `config-bad-value` rejects a bad `ai`, `price`, `payTo` or `network`, with what it must be.
- `config-charge-needs` rejects `ai: "charge"` without `price`, `payTo` and `network`.
- `config-null-is-unset` treats a `null` field like an unset one.

## How to get to it (user POV)

- A publisher passes a config to `fairtoll(...)` when the site starts. In the demo it is the `config` of a settings file.

## Driving it with demo.sh

Preconditions:

- No server running in `$DIR`. Write each settings file into `$DIR`, not into `demo/settings/`.

- **Bad values.** Write `{"description":"bad config","config":{"ai":"charge","price":"free","payTo":"0x0000000000000000000000000000000000000000","network":"base-mainnet","color":"red"}}` to `$DIR/bad.json` and run `sh $H start "$DIR" "$DIR/bad.json"`. It exits 1. `$DIR/server.log` holds `Could not set up Fairtoll: Invalid fairtoll config:` followed by one line each for `color is not a known field`, `price must be a price in dollars...`, `payTo must be a wallet address...` and `network must be one of "base", "base-sepolia"`. Doctor then fails with `no server from this run is up`.
- **Charge needs fields.** Write `{"description":"charge without fields","config":{"ai":"charge"}}` to `$DIR/charge-bare.json` and start with it. It exits 1 with `price is needed when ai is "charge"`, and the same for `payTo` and `network`.
- **Null is unset.** Write `{"description":"null ai","config":{"ai":null},"log":true}` to `$DIR/nulls.json` and start with it. It starts, and `sh $H send "$DIR" gptbot-monitor /monitor/articles/42 -H 'Demo-Visitor: GPTBot'` returns `200` with a `logged` event whose `"action":"allow"`, the same as an unset `ai`.

## Gotchas

- `/blocked` and `/charged` add their own `ai` on top of `config`, so `config.ai` affects only `/monitor`. A `config` that's invalid only with `ai: "charge"`, such as one missing `payTo`, still stops the server, because `/charged` is created at startup.
- Don't set `price`, `payTo` or `network` to `null` in a settings file to test null-is-unset. `/charged` spreads `config` over its own charge fields, so a `null` there removes the demo's value and startup fails with `price is needed when ai is "charge"`. That is the demo's merge, not Fairtoll.
- `start` overwrites `server.log` on every run. Copy it to `<case>.server.log` before the next start in the same directory, or the evidence for the previous case is lost.
