# Spike: signals that verify AI bots and agents

This spike answers issue #4 for the classifier in issue #7. It lists the signals a site can check today to tell a verified AI crawler or agent from one that only claims a name. It recommends the version 1 signal set and the order the classifier checks them. Sources were fetched on 2026-10-21. Claims marked "unconfirmed" had no primary source the spike could reach.

## Recommendation for version 1

The classifier checks these signals in this order and stops at the first one that decides the class:

1. **x402 payment header.** A well-formed `PAYMENT-SIGNATURE` or `X-PAYMENT` header makes the request a paying agent. The charge step confirms the payment.
2. **Cloudflare verified-bot fields**, in the Worker adapter only. `request.cf.botManagement.verifiedBot === true` makes the request a verified AI buyer.
3. **Web Bot Auth signature.** A valid signature from an operator in the registry makes the request a verified AI buyer. A signature that fails, or one from an origin outside the registry, makes it an unverified bot.
4. **Published IP ranges, matched to the user-agent claim.** A client IP inside the claimed operator's published list makes the request a verified AI buyer.
5. **Bot claim with no passing check.** A known AI user-agent, or any `Signature` header, with no passing check above makes the request an unverified bot.
6. **No bot signals.** Everything else is a human.

Version 1 leaves out reverse DNS, the Cloudflare bot score, and TLS fingerprints. See [Signals left out of version 1](#signals-left-out-of-version-1). [The catalog of bot detection methods](bot-detection-methods.md) covers every other method and its limits.

The order follows three reasons:

- The payment header comes first because it routes the request to the charge step, and the charge step does its own verification through the facilitator.
- The Cloudflare fields come next because they cost nothing to read, and the README says the Worker adapter complements Cloudflare rather than redoing its work.
- Signatures rank above IP ranges because a signature proves possession of a key the operator published. An IP proves only which network the request left from.

A signature that fails decides the request as an unverified bot. The classifier does not fall through to the IP check. A real signer does not send bad signatures, so a failed one is the strongest sign of a forgery. The same rule makes the forged-signature test in #7 simple to state.

The classifier never decides "verified" from a cold or failed lookup. If a key directory or IP list cannot load within its timeout, the classifier skips that signal and goes on down the list. A request that claims a bot name then lands on step 5 as an unverified bot. The page still serves, so this keeps the fail-open rule. Verification fails closed and the site fails open.

## Compare the signals

| Signal | Issuer | How a site verifies | Off Cloudflare | Network calls | Cost per request |
| --- | --- | --- | --- | --- | --- |
| Web Bot Auth (RFC 9421 signature) | The bot operator signs with its own Ed25519 key | Fetch the key directory named in `Signature-Agent`, then verify the signature over `@authority` and `signature-agent` | Yes | One HTTPS GET per operator origin on a cache miss. None when cached | One Ed25519 verify. About 128 µs with `node:crypto` and 172 µs with WebCrypto, measured on a 2014 Xeon under Node 24.9. The published figure is about 273k cycles ([ed25519.cr.yp.to](https://ed25519.cr.yp.to/)) |
| Published IP ranges | The bot operator publishes a JSON list of CIDR prefixes | Match the client IP against the list for the operator that the user-agent claims | Yes | One GET per list on a cache miss. None when cached | One CIDR lookup. Microseconds (estimate) |
| Forward-confirmed reverse DNS | The operator's DNS zone | PTR lookup, check the hostname suffix, then forward A or AAAA lookup that must return the same IP | Yes. Workers can run it through `node:dns` over DNS-over-HTTPS ([docs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/)) | Two or more DNS queries per uncached IP | Two network round trips on a miss |
| Cloudflare `request.cf.botManagement` | Cloudflare, after its own IP, rDNS, or Web Bot Auth checks | Read `verifiedBot`, `signedAgent`, and `request.cf.verifiedBotCategory` | No. Cloudflare Workers only | None | A property read |
| x402 payment header | The paying client signs a payment payload | Decode and schema-check it in the classifier. The facilitator verifies and settles it in the charge step | Yes | None in the classifier | A base64 decode and a zod parse |
| User-agent string | Anyone | Nothing to verify | Yes | None | A regex match. A claim only, never a verification |

## Web Bot Auth

**Spec.** RFC 9421 defines the `Signature` and `Signature-Input` headers ([RFC 9421](https://www.rfc-editor.org/rfc/rfc9421)). The IETF webbotauth working group owns the bot profile. Its current draft is `draft-ietf-webbotauth-httpsig-protocol-00` from 2026-09-01, which absorbed the older architecture and directory drafts ([datatracker](https://datatracker.ietf.org/doc/draft-ietf-webbotauth-httpsig-protocol/)). The draft has these rules:

- A signed request carries `Signature`, `Signature-Input`, and `Signature-Agent`.
- The signature covers `@authority` or `@target-uri`, plus the `signature-agent` header.
- `created`, `expires`, and `tag="web-bot-auth"` are required. Expiry is recommended to be at most 24 hours.
- `keyid` is the JWK SHA-256 thumbprint. HMAC is forbidden.
- `Signature-Agent` is now a structured dictionary, as in `sig1="https://chatgpt.com"`. Verifiers may also accept the older bare-string form.

**Verification.** The site follows these steps:

1. Parse the three headers and drop signatures whose tag is not `web-bot-auth`.
2. Take the origin from `Signature-Agent`. Accept only an origin in the operator registry.
3. Fetch `/.well-known/http-message-signatures-directory` from that origin over HTTPS, without following redirects. The body is a JWKS with media type `application/http-message-signatures-directory+json`.
4. Find the key by origin and key id, then verify the signature and its `created` and `expires` window.

The draft sets negative-cache entries to expire within 5 minutes. Operators rotate keys by publishing the new key before they retire the old one.

**Library.** Cloudflare's `web-bot-auth` package (v0.2.0, 2026-08-31) exports `verify`, `parseSignatureAgentHeader`, and `verifierFromJWK` from `web-bot-auth/crypto` ([GitHub](https://github.com/cloudflare/web-bot-auth)). It uses only `crypto.subtle` and Fetch `Request` headers. That means it runs on Workers and on Node 20.19.3, 22.13.0, or later, where WebCrypto Ed25519 is stable ([Node docs](https://nodejs.org/api/webcrypto.html), [Workers docs](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)). `verify` does not fetch directories. The caller passes a resolver that returns the key. The README says the code is not audited.

**Why the registry is an allowlist.** `Signature-Agent` is supplied by the client. Anyone can host a directory and sign with its key, so a valid signature from an unknown origin proves only that the sender controls that origin. Fetching an arbitrary origin inline is also a server-side request forgery risk and adds latency to the request. The classifier fetches only the origins in its operator registry. A publisher can add origins in config.

## Published IP ranges

Most operators publish the same JSON shape as Google: `{"creationTime": "...", "prefixes": [{"ipv4Prefix": "..."} | {"ipv6Prefix": "..."}]}`. The lists are per agent, so the check pairs the user-agent claim with the matching list. A ChatGPT-User IP that sends a GPTBot user-agent does not verify as GPTBot. A matching IP proves which operator's network sent the request. It does not prove which product sent it or whether a person triggered it.

No operator states a refresh interval. The `creationTime` values show some lists change daily, such as ChatGPT-User and Googlebot, while others have not changed in over a year, such as Bingbot and PerplexityBot. The recommendation is to refresh every 6 hours and keep the last good list on error. This interval is the spike's choice, not an operator's.

## Who supports each signal

| Operator | Agent | Web Bot Auth | IP list | Reverse DNS suffix |
| --- | --- | --- | --- | --- |
| OpenAI | ChatGPT agent | Yes. [Directory](https://chatgpt.com/.well-known/http-message-signatures-directory), [Cloudflare](https://blog.cloudflare.com/signed-agents/) | None found | None |
| OpenAI | GPTBot, OAI-SearchBot, ChatGPT-User | Not documented | [gptbot.json](https://openai.com/gptbot.json), [searchbot.json](https://openai.com/searchbot.json), [chatgpt-user.json](https://openai.com/chatgpt-user.json). [Docs](https://developers.openai.com/api/docs/bots) | None |
| Anthropic | ClaudeBot, Claude-User, Claude-SearchBot | Not documented | One shared list, [bots.json](https://claude.com/crawling/bots.json), not split by agent. [Docs](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) | None |
| Google | Google-Agent | Yes, experimental, for some requests. [Docs](https://developers.google.com/crawling/docs/crawlers-fetchers/web-bot-auth) | [user-triggered-agents.json](https://developers.google.com/static/crawling/ipranges/user-triggered-agents.json) | `google-proxy-*.google.com`, `*.gae.googleusercontent.com` |
| Google | Googlebot, Google-CloudVertexBot, GoogleOther | No | [common-crawlers.json](https://developers.google.com/static/crawling/ipranges/common-crawlers.json). [Docs](https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests) | `crawl-*.googlebot.com`, `geo-crawl-*.geo.googlebot.com` |
| Google | Google-Extended | n/a. It is a robots.txt token with no user-agent of its own | n/a | n/a |
| Perplexity | PerplexityBot, Perplexity-User | Not documented | [perplexitybot.json](https://www.perplexity.com/perplexitybot.json), [perplexity-user.json](https://www.perplexity.com/perplexity-user.json). [Docs](https://docs.perplexity.ai/guides/bots) | None |
| Microsoft | Bingbot | Not documented | [bingbot.json](https://www.bing.com/toolbox/bingbot.json). [Docs](https://www.bing.com/webmasters/help/how-to-verify-bingbot-3905dc26) | `*.search.msn.com` (unconfirmed from a primary source) |
| Microsoft | Copilot | Not documented | No separate list found (unconfirmed) | None |
| Apple | Applebot | Not documented | [applebot.json](https://search.developer.apple.com/applebot.json). [Docs](https://support.apple.com/en-us/119829) | `*.applebot.apple.com` |
| Amazon | Amazonbot, Amzn-SearchBot, Amzn-User | Bedrock AgentCore Browser signs, opt-in preview. [Docs](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-web-bot-auth.html) | [ip-addresses](https://developer.amazon.com/amazonbot/ip-addresses/). [Docs](https://developer.amazon.com/amazonbot) | `*.crawl.amazonbot.amazon` (unconfirmed) |
| Meta | meta-externalagent, meta-externalfetcher | Not documented | No list. Meta points to its ASN in RADB, which covers all of Meta's IP space. [Docs](https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/) | None |
| Mistral | MistralAI-User | Not documented | [mistralai-user-ips.json](https://mistral.ai/mistralai-user-ips.json). [Docs](https://docs.mistral.ai/robots) | None |
| DuckDuckGo | DuckAssistBot | Yes. [Directory](https://assistbot.duckduckgo.com/.well-known/http-message-signatures-directory) | [duckassistbot.json](https://duckduckgo.com/duckassistbot.json). [Docs](https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot) | None |
| You.com | YouBot | Yes. [Directory](https://you.com/.well-known/http-message-signatures-directory) | One /24 in the docs, no JSON. [Docs](https://you.com/docs/youbot) | `youbot-*.search.you.com` |
| Common Crawl | CCBot | Not documented | [ccbot.json](https://index.commoncrawl.org/ccbot.json). [Docs](https://commoncrawl.org/ccbot) | `*.crawl.commoncrawl.org`, IPv4 only |
| Browserbase | Browser agents | Yes. [Directory](https://www.browserbase.com/.well-known/http-message-signatures-directory) | None | None |
| Cloudflare | Browser Rendering | Yes, always on. [Docs](https://developers.cloudflare.com/browser-rendering/reference/automatic-request-headers/) | None | None |
| ByteDance, Cohere | Bytespider, cohere-ai | No primary source found | No primary source found | No primary source found |

More agents publish live key directories than the table lists. These include [Exa](https://crawler.exa.ai/.well-known/http-message-signatures-directory), [Manus](https://api.manus.im/.well-known/http-message-signatures-directory), [Context7](https://context7.com/.well-known/http-message-signatures-directory), [Shopify CloudSurf](https://cloudsurf.shopify.io/.well-known/http-message-signatures-directory), [Kernel](https://www.kernel.sh/.well-known/http-message-signatures-directory), and [Lane](https://agent.getonlane.com/.well-known/http-message-signatures-directory). Arcjet's `well-known-bots` registry tracks them. Manus's keys carry no `kid`, so key lookup must fall back to the thumbprint.

Cloudflare's own verified-bot list is the [Radar verified bots directory](https://radar.cloudflare.com/verified-bots). The spike could not fetch it, so the table has no column for Cloudflare listing. Since 2026-07-01, Cloudflare files signed agents under verified bots, and it accepts Web Bot Auth or IP validation as proof ([docs](https://developers.cloudflare.com/bots/concepts/bot/verified-bots/)).

## Cloudflare fields in the Worker adapter

The Worker reads these fields ([bot management variables](https://developers.cloudflare.com/bots/reference/bot-management-variables/), [Request docs](https://developers.cloudflare.com/workers/runtime-apis/request/)):

- `request.cf.botManagement.verifiedBot` is true when Cloudflare verified the bot.
- `request.cf.botManagement.signedAgent` is true when the agent passed Web Bot Auth at Cloudflare's edge.
- `request.cf.verifiedBotCategory` is a string such as `"AI Crawler"`, `"AI Assistant"`, or `"AI Search"`.
- `request.cf.botManagement.score` runs from 1 to 99, and 0 means the score was not computed.

`botManagement` exists only on Enterprise zones with Bot Management ([verified_bot field](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/cf.bot_management.verified_bot/)). Free, Pro, and Business plans get Bot Fight Mode or Super Bot Fight Mode as zone settings, and none of their docs promise a field in Workers. Most publishers on Cloudflare will therefore not have these fields. On those plans the Worker adapter verifies Web Bot Auth and IP ranges itself. This does not rebuild a Cloudflare feature, because Cloudflare does not expose its result to those plans.

The classifier uses only `verifiedBot === true` and `signedAgent === true`. A false or missing value is not evidence of anything. The classifier does not use the score, for two reasons:

- The score is a heuristic, not a cryptographic check.
- `wrangler dev` fills `botManagement` with a placeholder `score: 99` and `verifiedBot: false` (miniflare 4.20260730.0, `fallbackCf`). A score of 99 must never read as "human".

The type in `@cloudflare/workers-types` lags the docs. It has no `signedAgent`, `ja4`, `jsDetection`, or `verifiedBotCategory`, and it types `botManagement` as always present ([cf.d.ts](https://github.com/cloudflare/workerd/blob/main/types/defines/cf.d.ts)). The adapter defines its own narrow type with every field optional and parses `request.cf` at the boundary.

## Detect a paying agent from the x402 header

x402 v2 sends the payment in the `PAYMENT-SIGNATURE` request header. x402 v1 sends it in `X-PAYMENT`. Both carry base64-encoded JSON ([v2 transport](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md), [v1 transport](https://github.com/x402-foundation/x402/blob/main/specs/transports-v1/http.md)). In `@x402/core` 2.28.0, the client writes `PAYMENT-SIGNATURE` for version 2 and `X-PAYMENT` for version 1. The server's `extractPayment` reads only `PAYMENT-SIGNATURE` (`dist/esm/chunk-FV2JN4FK.mjs`, lines 2137, 2141, and 3088). The header names are string literals, not exported constants.

The classifier runs these checks and calls no facilitator:

1. Read `PAYMENT-SIGNATURE`. If the charge step supports v1, also read `X-PAYMENT`.
2. Reject a header longer than a fixed cap before decoding it.
3. Decode it with `decodePaymentSignatureHeader` from `@x402/core/http`, inside `try`. The function throws on bad base64 or bad JSON and does no schema check.
4. Validate the result with `parsePaymentPayload` from `@x402/core/schemas`. It is a zod union on `x402Version`.

A payload that passes makes the request a paying agent. The reason records "payment claimed", not "paid". A forged, well-formed header costs nothing to send. Only the charge step proves payment, through `x402HTTPResourceServer.processHTTPRequest`, which verifies with the facilitator and then settles. A header that fails to decode or parse does not make the request a paying agent. The classifier records the failure and goes on to the next signal.

This puts one constraint on the policy engine in #8. The paying-agent class must lead to the charge action. If a publisher maps the paying-agent class to allow, a forged header gets free access.

Cloudflare pay per crawl uses its own headers, `crawler-exact-price` and `crawler-max-price`, which the crawler must cover in its Web Bot Auth signature ([docs](https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/use-pay-per-crawl-as-ai-owner/crawl-pages/)). Cloudflare charges at its edge as merchant of record, so these headers are not a Fairtoll payment signal. The event log may record them as intent.

## Signals left out of version 1

**Reverse DNS.** Every operator in the table that documents a reverse-DNS suffix also publishes an IP list. YouBot is the exception, and it signs. Reverse DNS would add two or more DNS round trips per uncached IP and verify no extra operator. Add it later if an operator ships a suffix without a list.

**Cloudflare bot score and TLS fingerprints.** These are heuristics. The README requires cryptographic signals, and the score has the placeholder problem described above.

**`navigator.webdriver`.** Chrome sets it to true under `--enable-automation`, `--headless`, or `--remote-debugging-port=0`, and Firefox sets it under Marionette ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/webdriver)). It exists only inside the page's JavaScript, not in the request. Reading it means the package injects a script and receives a beacon, which changes the response that observe mode promises to leave alone. The result also arrives after the server has answered the request it describes. The client sets the value itself, and stealth tooling hides it. Crawlers that do not run JavaScript, such as GPTBot, never report it. At best it could mark a browser as automated. It can never mark a request as verified.

**Forwarded bot headers on lower Cloudflare plans.** A Transform Rule or Snippet can copy `cf.client.bot` into a request header for the Worker ([example](https://developers.cloudflare.com/rules/snippets/examples/bot-data-to-origin/)). The rule must overwrite any client-sent copy, or anyone can forge the header. That is a setup step the CLI could own later, not a version 1 signal.

**Visa Trusted Agent Protocol and Mastercard Agent Pay.** Both build on RFC 9421 with their own tags. Visa uses `agent-browser-auth` and `agent-payer-auth` ([spec](https://developer.visa.com/docs/trusted-agent-protocol/trusted-agent-protocol-specifications)), and Mastercard runs through Cloudflare ([blog](https://blog.cloudflare.com/secure-agentic-commerce/)). Neither publishes a key directory URL yet.

## Constraints for the classifier task

Issue #7 should build on these points:

- **Operator registry.** Ship a static table with one row per operator agent. Each row has the user-agent pattern, the IP list URLs, and the Web Bot Auth origins. Publishers can extend it in config. Generate the table from [arcjet/well-known-bots](https://github.com/arcjet/well-known-bots) instead of writing it by hand. It is MIT-licensed and covers 811 bots. Each entry already holds accepted and forbidden user-agent patterns, sample user-agents to test the patterns against, and verification sources. Those sources are IP-list URLs with a JSONPath selector, reverse-DNS masks, and Web Bot Auth directories. A build script can turn the AI-category entries into the table and keep the attribution. Fixes go upstream. The classifier's reason carries the operator, the agent, and the method (`cloudflare`, `web-bot-auth`, or `ip-range`). That lets the event log and later policy rules tell Googlebot from GPTBot, because both are in the verified AI buyer class.
- **Timeouts and caches.** Every directory and IP list fetch has a timeout, 500 ms as a starting value, and a cache. The cache keeps a floor TTL of 1 hour, because `chatgpt.com` serves its directory with `cache-control: no-store`. Keep the last good copy on error, and negative-cache failures for 5 minutes. On Workers, isolates do not share memory, so back the in-memory cache with the Cache API.
- **Accept both `Signature-Agent` forms.** Google sends the dictionary form and the WG draft requires it. Cloudflare's own verifier still rejects it ([docs](https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/)).
- **Match keys by `kid` or by thumbprint.** Google's key ids are six-character `kid` values such as `mhxuPw`, not JWK thumbprints. Treat the directory's self-signature as advisory, because operators sign it inconsistently.
- **Rebuild `@authority` correctly in Express.** The signature covers the host the client used. Behind a proxy, Express needs `trust proxy` set to read `X-Forwarded-Host` and the real client IP. If this is misconfigured, signatures fail and every IP is the proxy's, so verification fails closed and the site still serves.
- **Anthropic's list is shared across its three agents.** A match verifies the operator, not the specific agent.
- **IPv6.** Only the Google and Common Crawl lists include IPv6. An IPv6 request that claims any other operator cannot verify by IP.

## Unconfirmed

- Which `Signature-Agent` form ChatGPT agent sends. It is probably the legacy string, because Cloudflare verifies ChatGPT agent and rejects the dictionary form. This is an inference.
- Whether Cloudflare forwards `Signature`, `Signature-Input`, and `Signature-Agent` to the Worker. This needs a live test.
- What a non-Enterprise production Worker sees in `request.cf.botManagement`. It may be absent, or it may hold defaults.
- Whether OpenAI's Atlas browser or ChatGPT-User sign requests. The OpenAI help page returned 403.
- The Amazon Bedrock AgentCore key directory URL, and the reverse-DNS suffixes for Bingbot and Amazonbot from a primary source.
- Any Web Bot Auth support from Anthropic, Perplexity, or Microsoft.
