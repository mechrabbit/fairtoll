# Charge

With `ai: "charge"`, Fairtoll answers an AI bot with a 402 and an x402 price until it pays. A settled payment gets the page with a `PAYMENT-RESPONSE` header, a reused payment gets a 402 again, every method but a CORS preflight is charged, and readers pass free.

## Sub-features

- `charge-quote` gives an unpaid bot a 402 with `PAYMENT-REQUIRED` naming 2000 (millionths of USDC), `payTo` `0x…dEaD` and network `eip155:84532`, plus `Cache-Control: no-store`.
- `charge-pay` serves the page to a bot whose payment settles, with `PAYMENT-RESPONSE` and `Cache-Control: private`.
- `charge-replay` refuses a payment that already settled, with a 402.
- `charge-post` charges a bot's POST like a read, and serves it with its body once paid.
- `charge-preflight` lets a CORS preflight through free.
- `charge-human` serves a reader free.

## How to get to it (user POV)

- A publisher mounts `fairtoll({ ai: "charge", price, payTo, network }, { facilitator })`, which is `/charged`.
- A paying agent reads the 402, signs a payment for its price, and sends the request again with `PAYMENT-SIGNATURE`.

## Driving it with demo.sh

Preconditions:

- A server started with `demo/settings/logging.json`, and doctor passes.
- `charge-replay` runs on the same server as the `charge-pay` it replays.

- **Reader free.** Send `sh $H send "$DIR" chrome-charged /charged/articles/42 -H 'Demo-Visitor: Chrome'`. The response is `200` with body `GET /charged/articles/42` and no `PAYMENT-REQUIRED`.
- **Quote.** Send `sh $H send "$DIR" gptbot-quote /charged/articles/42 -H 'Demo-Visitor: GPTBot'`. The response is `402 Payment Required` with `PAYMENT-REQUIRED` and `Cache-Control: no-store`. Decode it with `tr -d '\r' < "$DIR/gptbot-quote.txt" | sed -n 's/^PAYMENT-REQUIRED: //p' | base64 -d`; `accepts[0]` has `"amount":"2000"`, `"network":"eip155:84532"` and `"payTo":"0x000000000000000000000000000000000000dEaD"`. The `logged` event has `"action":"charge"`.
- **Pay.** Run `sig=$(sh $H pay "$DIR" gptbot-quote)`. Stderr says `Paying 2000 millionths of a USDC to 0x…dEaD on eip155:84532`. Send `sh $H send "$DIR" gptbot-paid /charged/articles/42 -H 'Demo-Visitor: GPTBot' -H "PAYMENT-SIGNATURE: $sig"`. The response is `200` with `PAYMENT-RESPONSE`, `Cache-Control: private` and body `GET /charged/articles/42`. The server lines have `facilitator settles 2000 from 0x…`. The decoded `PAYMENT-RESPONSE` has `"success":true` and a `transaction`.
- **Replay.** Send `sh $H send "$DIR" gptbot-replay /charged/articles/42 -H 'Demo-Visitor: GPTBot' -H "PAYMENT-SIGNATURE: $sig"`. The response is `402`, the server lines have `facilitator rejects: payment_already_used`, and the body is not the page.
- **Charged POST.** Send `sh $H send "$DIR" claudebot-post-quote /charged/comments -H 'Demo-Visitor: ClaudeBot' -H 'Content-Type: application/json' -d '{"text":"hello"}'`, which gets `402`. Run `sig=$(sh $H pay "$DIR" claudebot-post-quote)`, then send `claudebot-post-paid` with the same arguments plus `-H "PAYMENT-SIGNATURE: $sig"`. The response is `200` with body `POST /charged/comments` and `{"text":"hello"}`.
- **Free preflight.** Send `sh $H send "$DIR" gptbot-preflight /charged/articles/42 -X OPTIONS -H 'Demo-Visitor: GPTBot' -H 'Origin: https://example.com' -H 'Access-Control-Request-Method: GET'`. The response is `200` with body `OPTIONS /charged/articles/42`, and the `logged` event has `"action":"allow"`.
- **Bare OPTIONS charged.** Send `gptbot-options` the same way without `Access-Control-Request-Method`. The response is `402`.

## Gotchas

- The stand-in facilitator checks the amount, wallet and replay, not the signature, and moves no money. A proof here shows Fairtoll's side of x402, not a real settlement on Base Sepolia.
- Fail open when the facilitator is unreachable (pass the request on unpaid, with a `fairtoll: charging a request failed` line) can't be driven: `demo/serve.js` fixes the facilitator URL and settings can't override it. Report it as unverified through the demo; it is covered in `test/node/express-charge.test.ts`.
- The first charged request makes a `GET /facilitator/supported` call, which shows up in that request's server lines. Later ones don't.
- A restart clears the facilitator's settled payments, so a replay across restarts settles again. That is a demo artifact, not a Fairtoll bug.
- `PAYMENT-REQUIRED` and `PAYMENT-RESPONSE` are base64 JSON. Assert on decoded fields, not the encoded string, which changes with every wallet and nonce.
