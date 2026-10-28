# Config validation

`fairtoll()` checks its config and options when the site starts. A mistake, such as an unknown field or a bad value, stops startup with a message naming each field, so it never shows up later as a broken request.

## Sub-features

- `config-unknown-field` rejects a field Fairtoll doesn't know.
- `config-bad-value` rejects `ai` other than `"allow"` or `"block"`, and reports every error at once.
- `config-valid` starts normally with `{}` and with `{"ai": "block"}`.

## How to get to it (user POV)

- A publisher passes a config to `fairtoll(...)` and starts the site. In the demo the config comes from the settings file's `config`.

## Driving it with verify.sh

Preconditions:

- No server is running for `$R`. Each step starts and fails on its own.

- **Bad value.** Run `mkdir -p "$R"`, then `printf '%s' '{"description":"bad ai","config":{"ai":"maybe","rules":[]}}' > "$R/bad.json"` and then `$V start "$R" "$R/bad.json"`. `start` exits non-zero and prints `server.log`, which has `Could not set up Fairtoll: Invalid fairtoll config:` and then `  rules is not a known field` and `  ai must be "allow" or "block"`. No `Listening on` line.
- **Valid block config.** Run `printf '%s' '{"description":"block by config","config":{"ai":"block"}}' > "$R/block.json"`, then `$V start "$R" "$R/block.json"`. `doctor: ok`. Then `$V send "$R" /monitor/articles/42 -H 'Demo-Visitor: GPTBot'` gives `403`. Then `$V stop "$R"`.

## Gotchas

- A failed `start` leaves its `server.log` in `$R`, and the next `start` overwrites it. Use a separate run directory per step when you need both logs as proof.
- `/blocked` adds `ai: "block"` to whatever the settings give, so an invalid config fails for both endpoints at once. That is one startup error, not two.
