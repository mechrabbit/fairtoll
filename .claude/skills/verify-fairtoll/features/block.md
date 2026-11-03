# Block

With `ai: "block"`, Fairtoll answers AI bots and agents with a 403 that no shared cache may replay, and lets readers through unchanged. `/robots.txt` is always served, so a blocked crawler can still read the site's rules.

## Sub-features

- `block-bot` gives an AI bot a 403, `Cache-Control: no-store`, and the text `This site does not allow AI bots or agents.`
- `block-any-method` blocks a bot's POST like its GET, before the site reads the body.
- `block-human` serves a reader the page unchanged.
- `block-robots` serves `/robots.txt` to a blocked bot.

## How to get to it (user POV)

- A publisher mounts `fairtoll({ ai: "block" })`, which is `/blocked`.
- The site's `/robots.txt` is behind the same middleware.

## Driving it with demo.sh

Preconditions:

- A server started with `demo/settings/logging.json`, and doctor passes.

- **Bot blocked.** Send `sh $H send "$DIR" gptbot-blocked /blocked/articles/42 -H 'Demo-Visitor: GPTBot'`. The response is `403 Forbidden` with `Cache-Control: no-store` and body `This site does not allow AI bots or agents.`. The server lines have a `logged` event with `"action":"block"` and `response 403`.
- **Bot POST blocked.** Send `sh $H send "$DIR" claudebot-post-blocked /blocked/comments -H 'Demo-Visitor: ClaudeBot' -H 'Content-Type: application/json' -d '{"text":"hello"}'`. The response is the same 403, and the body does not echo `{"text":"hello"}`.
- **Reader passes.** Send `sh $H send "$DIR" chrome-blocked /blocked/articles/42 -H 'Demo-Visitor: Chrome'`. The response is `200` with body `GET /blocked/articles/42`.
- **Robots served.** Send `sh $H send "$DIR" gptbot-robots /robots.txt -H 'Demo-Visitor: GPTBot'`. The response is `200`, `text/plain`, with body `User-agent: GPTBot` / `Disallow: /`. The `logged` event has `"path":"/robots.txt"` and `"action":"allow"`.

## Gotchas

- The 403 is decided by the user-agent claim alone. A bot with a browser user-agent gets through, which is expected at this stage, not a regression.
- Only `/robots.txt` at the mount root is exempt. `/blocked/robots.txt` is a normal path under the mount and is blocked.
