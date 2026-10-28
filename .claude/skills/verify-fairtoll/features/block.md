# Block AI bots and agents

With `ai: "block"`, Fairtoll answers AI bots and agents with a 403 that says the site doesn't allow them, and lets every human through. `/robots.txt` is always served, so a blocked crawler can still read the site's rules.

## Sub-features

- `block-ai` answers an AI crawler with `403` and the body `This site does not allow AI bots or agents.`
- `block-no-store` sends `Cache-Control: no-store` with the 403, so a shared cache can't replay it to readers.
- `block-reader` lets a reader and a search crawler (`Googlebot`) through unchanged.
- `block-robots` serves `/robots.txt` to an AI crawler.
- `block-any-method` blocks a POST the same as a GET.

## How to get to it (user POV)

- A publisher adds `app.use(fairtoll({ ai: "block" }))`. In the demo that is `/blocked` under any settings file, and `/robots.txt`.

## Driving it with verify.sh

Preconditions:

- `$V start "$R" demo/settings/logging.json` printed `doctor: ok`. Logging makes the decision visible in `server.log`.

- **AI crawler.** Run `$V send "$R" /blocked/articles/42 -H 'Demo-Visitor: GPTBot'`. `403`, `Cache-Control: no-store`, `Content-Type: text/plain`, body `This site does not allow AI bots or agents.`
- **Same request without Fairtoll.** Run `$V send "$R" /open/articles/42 -H 'Demo-Visitor: GPTBot'`. `200`, body `GET /open/articles/42`.
- **Reader.** Run `$V send "$R" /blocked/articles/42 -H 'Demo-Visitor: Chrome'`. `200`, body `GET /blocked/articles/42`.
- **Search crawler.** Run `$V send "$R" /blocked/articles/42 -H 'Demo-Visitor: Googlebot'`. `200`.
- **Other AI agents.** Repeat the AI crawler step for `ChatGPT-User`, `PerplexityBot` and `CCBot`. Each gets the 403. For an agent with no `Demo-Visitor` name, use `-A 'Bytespider'`.
- **POST.** Run `$V send "$R" /blocked/comments -H 'Demo-Visitor: ClaudeBot' -H 'Content-Type: application/json' -d '{"text":"hi"}'`. `403`.
- **robots.txt.** Run `$V send "$R" /robots.txt -H 'Demo-Visitor: GPTBot'`. `200`, body `User-agent: GPTBot` / `Disallow: /`, and the logged event has `"action":"allow"`.

## Gotchas

- Matching is by user-agent token and ignores case, so `-A 'gptbot'` is blocked too. Use a real `Demo-Visitor` name in proofs so the request is one a reader recognises.
- `/blocked` exists under every settings file, because the demo always adds `ai: "block"` to the settings' config. To prove a config that blocks by itself, write a settings file with `"config": {"ai": "block"}` into `$R` and drive `/monitor`.
