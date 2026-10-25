# Catalog of bot detection methods and their limits

This doc lists every method a site can use to recognize a bot or an AI agent, grouped by what the method can prove. Each group states its limits. The goal is to show which options exist for actions after version 1. The version 1 recommendation stays in [the bot-verification spike](bot-verification.md), which covers its six signals in more depth. Sources were fetched on 2026-10-21.

## Read the groups as verification or detection

The methods split into two kinds:

- **Verification** says who a request is. A Web Bot Auth signature or an operator's IP list proves that a known operator sent it.
- **Detection** says a request is probably not what it claims. A TLS fingerprint that doesn't match the user-agent, or a crawl pattern, raises suspicion and proves nothing about who sent it.

The README makes this split matter. A detection signal can move a request from human to unverified bot. It can never make a request verified. Every detection group also has false positives on real people, so a detection result used in block mode blocks some humans.

Four properties decide whether a method fits Fairtoll at all:

- **Response change.** The default install changes no responses. A method that injects a script, sends a challenge, or serves a trap can only be an opt-in rollout step.
- **First request.** A method that learns from a script, a cookie, or a pattern decides about later requests, never the one in flight.
- **Off Cloudflare.** The Express adapter needs the method to work on Node, often behind a reverse proxy.
- **Real-browser agents.** ChatGPT agent, Browserbase, Atlas, and Comet drive real Chromium ([Browserbase](https://docs.browserbase.com/features/stealth-mode), [Atlas](https://simonwillison.net/2025/Oct/21/introducing-chatgpt-atlas/), [Comet](https://www.humansecurity.com/ai-agent/perplexity-comet/)). A 2026 measurement study splits them in two ([arXiv 2606.30119](https://arxiv.org/html/2606.30119v1)):
  - **Cloud agents are separable.** ChatGPT agent had its own JA4 fingerprint and came mostly from hosting IPs. Stealth modes in agent frameworks made agents easier to detect, not harder.
  - **Local agents look human.** Agents that drive the user's own Chrome, such as Claude for Chrome, shared human JA4 values and residential IPs. For them, only in-page behavior separated agent from person.

  Classifiers that combine several layers reach 0.97 accuracy across six agent frameworks ([arXiv 2606.20910](https://arxiv.org/html/2606.20910)). They need training data for each agent, which improves with many sites' data. The README places that kind of data in the hosted service.

## Compare the groups

| Group | Proves | Can verify | Changes responses | Decides first request | Works off Cloudflare | Defeated by |
| --- | --- | --- | --- | --- | --- | --- |
| [Cryptographic bot identity](#cryptographic-bot-identity) | The operator holds a published key | Yes | No | Yes | Yes | Stolen keys, or any customer of a platform that signs for its users |
| [Payment as a credential](#payment-as-a-credential) | Someone paid, or holds a paid token | Payment, not identity | A 402 or redirect, on charged paths only | Yes, after the retry | Depends on the scheme | Nothing, if settled |
| [Operator network identity](#operator-network-identity) | The request left the operator's network | Yes, for the operator | No | Yes | Yes | Shared cloud egress |
| [Edge and vendor verdicts](#edge-and-vendor-verdicts) | The vendor's own checks passed | When the vendor verified | No | Yes | Per vendor | A forged header, if the origin is reachable directly |
| [Self-declared request metadata](#self-declared-request-metadata) | Nothing. Only consistency | No | No | Yes | Yes | Any HTTP client |
| [Passive network fingerprints](#passive-network-fingerprints) | The TLS or HTTP/2 stack matches or contradicts the user-agent | No | No | Yes | Only where TLS ends in Fairtoll's process, or a proxy forwards it | `curl-impersonate`, `uTLS`, real Chrome |
| [Network reputation](#network-reputation) | The IP is hosting, cloud, or Tor | No | No | Yes | Yes, with a data file | Residential proxies |
| [Traffic patterns on one site](#traffic-patterns-on-one-site) | The client behaves like a crawler | No | No | No | Yes, with state | Low rate across many IPs |
| [Device attestation tokens](#device-attestation-tokens) | An attested Apple device in good standing | No, not a human | Yes, a 401 challenge | Yes, after the retry | Needs an issuer | An agent on a real Mac |
| [Client-side JavaScript signals](#client-side-javascript-signals) | The browser reports automation | No | Yes, script injection | No | Yes | Public stealth patches |
| [Active challenges](#active-challenges) | The client solved a puzzle or spent CPU | No | Yes, an interstitial | No | Yes | Solver services, real Chrome |
| [Traps](#traps) | The client followed a link a person cannot see | No | Yes, hidden links or fake pages | No | Yes | Careful crawlers |
| [AI tooling requests](#ai-tooling-requests) | The client asked for something only AI tools ask for | No | No | Yes | Yes | Any client, but most bots don't bother |
| [Rule compliance](#rule-compliance) | A named crawler skipped or broke robots.txt or RSL terms | No | No | No | Yes, with state | Not naming itself |
| [After-the-fact attribution](#after-the-fact-attribution) | An AI product used content served to a specific request | Links a request to an operator, later | Yes, on canary pages | No | Yes | Products that don't quote sources |

## Cryptographic bot identity

These methods have the operator sign the request with a key it publishes.

- **Web Bot Auth.** RFC 9421 signatures with a `Signature-Agent` key directory. The [bot-verification spike](bot-verification.md#web-bot-auth) covers this in full. It is in version 1.
- **Visa Trusted Agent Protocol and Mastercard Agent Pay.** Both use RFC 9421 signatures. Visa uses its own tags and a key store it has not published yet ([Visa](https://developer.visa.com/docs/trusted-agent-protocol/trusted-agent-protocol-specifications)). Mastercard runs Web Bot Auth through Cloudflare ([Cloudflare](https://blog.cloudflare.com/secure-agentic-commerce/)).
- **Skyfire KYAPay.** A `kyapay-token` header carries an ES256 JWT with human, agent, and platform claims. A site verifies it offline against Skyfire's cached JWKS ([Skyfire](https://docs.skyfire.xyz/docs/verify-and-extract-data-from-tokens)).
- **Signature Agent Card.** This draft adds metadata, such as purpose and rate expectations, to a Web Bot Auth directory. It adds no new proof ([draft](https://datatracker.ietf.org/doc/draft-meunier-webbotauth-registry/)).
- **mTLS for bots.** A draft TLS flag would ask bots for a client certificate ([draft](https://www.ietf.org/archive/id/draft-jhoyla-req-mtls-flag-02.html)). It expired in September 2025, and no operator uses it.
- **Anonymous bot credentials.** The anonymous webbotauth draft and Privacy Pass ARC would let a bot prove it is vetted without saying which bot it is ([anonymous webbotauth](https://datatracker.ietf.org/doc/draft-rescorla-anonymous-webbotauth/), [ARC](https://datatracker.ietf.org/doc/html/draft-ietf-privacypass-arc-protocol-01)). Neither defines HTTP headers yet.

**Limits.** These methods cover only operators that sign, which today means few of them. GPTBot, ClaudeBot, and PerplexityBot do not sign. Every scheme beyond Web Bot Auth and KYAPay is a draft or has no public key URL. A valid signature proves an origin controls a key. It proves that origin is a known operator only if it is on an allowlist.

## Payment as a credential

These methods prove that money moved, or that the client holds a token someone paid for.

- **x402.** The client sends `PAYMENT-SIGNATURE`, and a facilitator verifies and settles it. It is in version 1. See [the x402 section of the bot-verification spike](bot-verification.md#detect-a-paying-agent-from-the-x402-header).
- **Cloudflare pay per crawl.** The crawler sends `crawler-exact-price` or `crawler-max-price`, which its signature must cover. Cloudflare charges the crawler's Cloudflare account ([docs](https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/use-pay-per-crawl-as-ai-owner/crawl-pages/)).
- **L402.** The server answers 402 with a macaroon and a Lightning invoice. The client pays and retries with the macaroon and the payment preimage ([spec](https://docs.lightning.engineering/the-lightning-network/l402/protocol-specification)).
- **TollBit.** The CDN redirects known bot user-agents to a TollBit subdomain, and TollBit checks a short-lived JWT ([architecture](https://docs.tollbit.com/docs/platform-architecture), [tokens](https://docs.tollbit.com/tokens)).
- **RSL Open License Protocol.** A license server issues an OAuth token, and the site checks it with an RFC 7662 introspection call ([RSL](https://rslstandard.org/api)).
- **AP2 mandates.** Google's Agent Payments Protocol carries intent, cart, and payment mandates as signed verifiable credentials. `crawltoll` verifies them on page requests ([AP2](https://ap2-protocol.org/ap2/agent_authorization/), [crawltoll](https://www.npmjs.com/package/crawltoll)).
- **Stripe shared payment tokens.** These authorize one checkout through the Stripe API. They don't identify a client on page requests ([Stripe](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens)).

**Limits.** Payment proves money moved, not who sent it. Most schemes need a 402 or a redirect, so they apply only on paths the publisher charges for. Pay per crawl settles only inside Cloudflare. TollBit settles only inside TollBit. L402 needs the site to run Lightning, and the README rules out running payment infrastructure. RSL license validation is a later release per the README, and it needs a network call per token.

## Operator network identity

These methods match the client IP against what the operator publishes.

- **Published IP lists.** These are in version 1. See [the IP ranges section of the bot-verification spike](bot-verification.md#published-ip-ranges).
- **Forward-confirmed reverse DNS.** This is a PTR lookup followed by a forward lookup that must return the same IP. The [bot-verification spike](bot-verification.md#signals-left-out-of-version-1) leaves it out because every operator with a suffix also publishes a list.
- **JAFAR.** A draft standard format for operator IP lists ([draft](https://datatracker.ietf.org/doc/draft-illyes-webbotauth-jafar/)). It gives the same assurance as the lists in use today.
- **ASN lookup.** Meta points sites to its ASN in RADB ([Meta](https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/)). That covers all of Meta's IP space, not its crawler.

**Limits.**

- An IP proves the network, not the product, and not whether a person triggered the request.
- Lists built from shared cloud /32s, such as Mistral's on Azure, are only as good as the operator's control of those IPs.
- Only the Google and Common Crawl lists include IPv6.
- Express must read the real client IP behind proxies.

## Edge and vendor verdicts

These methods read a verdict that a CDN or bot vendor already computed.

| Vendor | What the origin sees | Source |
| --- | --- | --- |
| Cloudflare | `request.cf.botManagement` in a Worker, on Enterprise Bot Management zones only. A Snippet can forward the fields to an origin | [Snippet example](https://developers.cloudflare.com/rules/snippets/examples/bot-data-to-origin/) |
| AWS WAF Bot Control | Labels such as `bot:verified`, `bot:category:ai`, and `bot:web_bot_auth:verified`. They reach the origin as `x-amzn-waf-*` headers only if custom request handling is set up | [Bot Control](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-bot.html), [custom headers](https://docs.aws.amazon.com/waf/latest/developerguide/customizing-the-incoming-request.html) |
| Akamai Bot Manager | `akamai-bot` and `akamai-user-risk` headers through "Forward Bot Results to Origin" | [Auth0 integration doc](https://auth0.com/docs/secure/attack-protection/configure-akamai-supplemental-signals) |
| Fastly | `fastly.bot.category` in VCL. The customer copies it into a header. `client.bot.name` comes from the user-agent and is not verified | [Fastly](https://www.fastly.com/documentation/reference/vcl/variables/miscellaneous/fastly-bot-category/) |
| Vercel | `checkBotId()` returns `isVerifiedBot` inside the function, not as a header | [Vercel](https://vercel.com/docs/botid/verified-bots) |
| DataDome | `X-DataDome-isbot` set by its server module | [DataDome](https://docs.datadome.co/reference/validate-request.md) |
| HUMAN | `x-px-score` in its F5 integration | [HUMAN](https://docs.humansecurity.com/applications/f5bigip/configuration) |

**Limits.** A header is trustworthy only if the origin accepts traffic from that proxy alone and the proxy overwrites any client-sent copy. AWS documents this and recommends blocking client-sent `x-amzn-waf-*` headers. Fairtoll cannot check that setup from inside the request, so each vendor needs explicit opt-in config. Most of these products are paid tiers. Some vendor verdicts are verification, such as `bot:verified` from a vendor that checked Web Bot Auth. Others are detection scores. The adapter has to know which field is which.

## Self-declared request metadata

These methods read headers the client chose to send.

- `User-Agent` and robots.txt product tokens.
- `From`. RFC 9110 says a server should not use it for access control ([RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.txt)).
- User-Agent Client Hints. Low-entropy hints such as `Sec-CH-UA` come by default. High-entropy hints need `Accept-CH` ([spec](https://wicg.github.io/ua-client-hints/)).
- `Sec-Fetch-*`. Page JavaScript cannot set these headers ([MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Mode)).
- Header order and casing. Node exposes them through `req.rawHeaders`.

A browser user-agent with no `Sec-Fetch-*` headers, or a Chrome user-agent with no `Sec-CH-UA`, shows the client is not the browser it claims to be. A Chrome version string is another check. Chrome 107 and later report only the major version, as in `Chrome/141.0.0.0`, so a Chrome user-agent with a real build number is forged. `@paywalls-net/filter` runs this check and compares the version in the user-agent with the one in UA-CH ([npm](https://www.npmjs.com/package/@paywalls-net/filter)). Default clients such as `curl` and `python-requests` announce themselves in the user-agent.

**Limits.** Any non-browser client can send every one of these headers. "Forbidden" constrains only JavaScript inside a browser. Firefox and Safari users don't send UA-CH. Privacy extensions and corporate proxies rewrite headers. This is the cheapest group, with no state and no calls, and it catches only careless scripts.

## Passive network fingerprints

These methods hash how the client's TLS or HTTP/2 stack behaves.

- **JA3.** Chrome now shuffles TLS extension order, so its JA3 changes on every connection ([Fastly](https://www.fastly.com/blog/a-first-look-at-chromes-tls-clienthello-permutation-in-the-wild)).
- **JA4.** It sorts extensions, so it survives the shuffle. JA4 itself is BSD-3. JA4H, JA4T, and the rest of JA4+ use the FoxIO License, which restricts monetization ([FoxIO](https://github.com/FoxIO-LLC/ja4)).
- **HTTP/2 fingerprint.** Built from SETTINGS, WINDOW_UPDATE, PRIORITY, and pseudo-header order ([Black Hat paper](https://www.blackhat.com/docs/eu-17/materials/eu-17-Shuster-Passive-Fingerprinting-Of-HTTP2-Clients.pdf)).
- **TCP/IP fingerprint.** Built from SYN packets, as in p0f ([p0f](https://github.com/p0f/p0f)).

**Where Fairtoll can read them.**

- **Node.** There is no API for the TLS ClientHello. A local experiment on Node 24.9 saw only the negotiated cipher, protocol, and ALPN on a TLS socket. Reading the raw ClientHello means owning the socket before TLS. That is impossible when TLS ends at a load balancer, a CDN, or nginx, which is the usual Express deployment. Node's `http2` session exposes the peer's settings with defaults filled in, so only a partial HTTP/2 fingerprint is possible.
- **Proxies.** FoxIO's nginx module computes JA4 ([module](https://github.com/FoxIO-LLC/ja4-nginx-module)). CloudFront forwards `CloudFront-Viewer-JA4-Fingerprint` to the origin ([AWS](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/adding-cloudfront-headers.html)).
- **Workers.** JA3 and JA4 need Enterprise Bot Management ([Cloudflare](https://developers.cloudflare.com/bots/additional-configurations/ja3-ja4-fingerprint/)). The Request docs list `tlsClientExtensionsSha1`, `tlsClientCiphersSha1`, `tlsClientHelloLength`, and `httpProtocol` for all plans ([Request docs](https://developers.cloudflare.com/workers/runtime-apis/request/)). `tlsClientExtensionsSha1` depends on extension order, so it likely changes on every Chrome connection (inference).

**Limits.**

- `curl-impersonate`, `curl_cffi`, `uTLS`, and `tls-client` copy browser fingerprints ([curl-impersonate](https://github.com/lexiforest/curl-impersonate), [curl_cffi](https://github.com/lexiforest/curl_cffi), [uTLS](https://github.com/refraction-networking/utls), [tls-client](https://github.com/bogdanfinn/tls-client)).
- Local agents that drive the user's own Chrome produce real Chrome fingerprints. Cloud agents often have their own fingerprint, which identifies the agent only after someone labels that fingerprint.
- On Workers, `request.cf.clientTcpRtt` gives the TCP round trip ([changelog](https://developers.cloudflare.com/changelog/post/2026-04-01-l4-transport-telemetry-fields/)). Research flags residential proxies when the TLS round trip exceeds the TCP one by 50 ms ([EURECOM](https://www.eurecom.fr/publication/7056/download/sec-publi-7056.pdf)), but traffic scheduling defeats it ([NDSS 2026](https://www.ndss-symposium.org/wp-content/uploads/2026-f2086-paper.pdf)). Workers expose no TLS round trip, so Fairtoll can only log the TCP value.
- HTTP/3 fingerprints exist, but Node's QUIC support is experimental and Workers expose no QUIC fingerprint field.
- A hosted service that sells JA4+ results needs a FoxIO license.

## Network reputation

These methods ask what kind of network the IP belongs to.

- **ASN and hosting data.** Free sources:
  - IPinfo Lite, CC-BY-SA ([IPinfo](https://ipinfo.io/lite)).
  - IPtoASN, public domain ([IPtoASN](https://iptoasn.com/)).
  - MaxMind GeoLite2. Its license allows internal use only and requires deleting old copies, so the package cannot bundle it ([EULA](https://www.maxmind.com/en/geolite2/eula)).

  Workers get `request.cf.asn` and `asOrganization` on every plan ([Request docs](https://developers.cloudflare.com/workers/runtime-apis/request/)).
- **Cloud provider ranges.** [AWS](https://ip-ranges.amazonaws.com/ip-ranges.json), [Google Cloud](https://www.gstatic.com/ipranges/cloud.json), and [Azure service tags](https://learn.microsoft.com/en-us/azure/virtual-network/service-tags-overview).
- **Tor exits.** [Tor bulk exit list](https://check.torproject.org/torbulkexitlist).
- **Shared blocklists.** CrowdSec builds a community blocklist from its users' reports, and sells an AI-crawler blocklist that is free for open-source projects ([CrowdSec](https://www.crowdsec.net/blog/protecting-foss-with-free-ai-crawlers-blocklist)). DNS blocklists such as Spamhaus answer per IP ([Spamhaus DROP](https://www.spamhaus.org/drop/terms/)). `nginx-ultimate-bad-bot-blocker` ships a list of IPs seen faking Googlebot ([GitHub](https://github.com/mitchellkrogza/nginx-ultimate-bad-bot-blocker)).

**Limits.**

- Residential proxy networks route bots through home IPs and pass every hosting check.
- Real people show up on hosting IPs through VPNs, corporate egress, and cloud browsers.
- iCloud Private Relay puts many Apple users behind one IP. Apple publishes its egress ranges and says to treat them like carrier-grade NAT ([Apple](https://developer.apple.com/icloud/prepare-your-network-for-icloud-private-relay/)).
- Cloud-hosted agents acting for a real reader also sit on cloud IPs, so "datacenter" means automation is likely, not that the request is unwanted.
- The data files go stale and need regular refreshes.
- Reading a shared blocklist fits the README, the same way an ASN file does. Reporting to one is "data shared across publishers", which the README puts out of scope. A DNS blocklist also adds a lookup per uncached IP.

## Traffic patterns on one site

These methods read the site's own event log. They watch for:

- The request rate per IP, per /24, per ASN, or per fingerprint.
- HTML fetched without CSS, scripts, or images.
- robots.txt or sitemap fetches followed by a walk in sitemap or breadth-first order.
- Requests with no cookies and no `Referer`.
- One cookie moving across many IPs.

AWS Bot Control uses the same kinds of signals ([AWS](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-bot.html)).

Three refinements come from existing tools and research:

- **Key IPv6 counters by prefix.** A client gets a whole /64, and rate limiters keyed on single addresses have been bypassed by rotating inside it ([CVE-2026-15144](https://cveawg.mitre.org/api/cve/CVE-2026-15144)). `express-rate-limit` keys on a /56 by default ([npm](https://www.npmjs.com/package/express-rate-limit)).
- **Classify offline.** Supertab's SDK records raw signals per request and classifies them later in its warehouse ([Supertab](https://connect-docs.supertab.co/)). A heuristic over plain server logs caught 67.7% of bots at a 3% false-positive rate ([arXiv 2603.28546](https://arxiv.org/abs/2603.28546)). Fairtoll's event log can support the same approach and keep the request path cheap.
- **Compare against the site's own baseline.** Cloudflare's per-customer models flag traversal order and dwell time that differ from a site's normal traffic. They caught 34% of flagged requests that the global score missed ([Cloudflare](https://blog.cloudflare.com/per-customer-bot-defenses/)).

**Limits.**

- A verdict comes after many requests, never on the first.
- A crawler that sends a few requests from each of many residential IPs stays under every per-IP threshold.
- Catching that crawler needs data from many sites. The README places that in the hosted service.
- Shared NAT, Private Relay, text-only readers, cached assets, feed readers, and SEO tools all look like crawlers.
- State has a cost. Workers KV takes 60 seconds or more to converge, so hot counters need Durable Objects ([KV](https://developers.cloudflare.com/kv/concepts/how-kv-works/)). Express needs memory per process or Redis.

## Device attestation tokens

These methods ask the device to prove it passed a platform check.

- **Privacy Pass and Apple Private Access Tokens.** The site answers 401 with `WWW-Authenticate: PrivateToken`. Safari on iOS 16 or macOS Ventura and later, signed in to an Apple ID, retries with a token. The site checks the token offline against the issuer's public key and stores the nonce to stop reuse ([RFC 9577](https://www.rfc-editor.org/rfc/rfc9577.html), [Apple](https://developer.apple.com/videos/play/wwdc2022/10077/)). The `@cloudflare/privacypass-ts` library verifies tokens in JavaScript ([GitHub](https://github.com/cloudflare/privacypass-ts)).
- **Web Environment Integrity.** Google abandoned it ([repo](https://github.com/RupertBenWiser/Web-Environment-Integrity)).
- **Play Integrity and App Attest.** These attest native apps to their own backend. They don't apply to web requests.

**Limits.**

- Only Apple platforms send Private Access Tokens.
- A site must name an issuer, and the production issuers are Cloudflare and Fastly. Cloudflare's issuer is not self-serve ([Cloudflare](https://developers.cloudflare.com/privacy-pass/production-deployment-testing/)). Fastly's public issuer is for development only ([Fastly](https://www.fastly.com/blog/private-access-tokens-stepping-into-the-privacy-respecting-captcha-less)).
- A token proves an attested device, not a person. An agent driving Safari on a real Mac would likely get tokens (inference).
- The challenge is a 401 round trip, which is a response change.

## Client-side JavaScript signals

These methods run a script in the page and report what it finds.

- **`navigator.webdriver`.** True under WebDriver control ([W3C](https://www.w3.org/TR/webdriver2/), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/webdriver)).
- **DevTools protocol detection.** Page code can notice an attached `Runtime.enable` client ([rebrowser-patches](https://github.com/rebrowser/rebrowser-patches)).
- **Headless artifacts.** A mismatch between the user-agent and UA-CH, permission-state quirks, a software WebGL renderer, or an empty plugin list.
- **Canvas and audio fingerprints.**
- **Input timing.** Mouse, keyboard, and touch timing. DevTools-driven input produces events marked as trusted, so timing statistics are what's left.

**Limits.**

- Public tools defeat every one of these:
  - `puppeteer-extra-plugin-stealth` ([evasions](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth/evasions)).
  - Patchright ([GitHub](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)).
  - `undetected-chromedriver` ([GitHub](https://github.com/ultrafunkamsterdam/undetected-chromedriver)).
  - Camoufox, which patches Firefox in C++ ([GitHub](https://github.com/daijro/camoufox)).
- Agents in real Chrome pass the property checks by default. In-page behavior is different. A 2026 case study identified all seven agents it tested from their in-page behavior, where Cloudflare flagged one ([arXiv 2605.01247](https://arxiv.org/abs/2605.01247)). Behavior models need labeled data for each agent.
- Brave randomizes canvas and audio output for real users ([Brave](https://brave.com/privacy-updates/3-fingerprint-randomization/)).
- The script must be injected into HTML. On Workers that is `HTMLRewriter` ([docs](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/)). Express has no native hook. Patching `res.write` and `res.end` conflicts with `compression`, which patches the same methods ([discussion](https://github.com/nodejs/web-server-frameworks/issues/127)).
- A strict Content Security Policy needs a nonce for the script, which changes headers too.
- The result arrives by beacon or cookie, so it decides later requests only.
- Crawlers that don't run JavaScript never report anything.

## Active challenges

These methods make the client do work before it gets the page.

- **CAPTCHAs.** reCAPTCHA v3 is free for 10,000 assessments a month ([Google](https://docs.cloud.google.com/recaptcha/docs/billing-information)). hCaptcha is the other main option.
- **Cloudflare Turnstile.** Free, and it works without other Cloudflare products. The server must call `siteverify` with a secret key for each token ([plans](https://developers.cloudflare.com/turnstile/plans/), [validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)).
- **Proof of work.** Anubis issues a week-long cookie after a SHA-256 puzzle ([how it works](https://raw.githubusercontent.com/TecharoHQ/anubis/main/docs/docs/design/how-anubis-works.mdx)). ALTCHA is self-hosted and cookie-free ([GitHub](https://github.com/altcha-org/altcha)).
- **Challenges without JavaScript.** `go-away` uses a `Refresh` header, a meta refresh, or a 103 Early Hints preload that only a real browser follows ([go-away challenges](https://git.gammaspectra.live/git/go-away/wiki/Challenges)). Anubis has a meta-refresh mode ([Anubis](https://github.com/TecharoHQ/anubis)). These cost a visitor less than proof of work and still change responses.
- **Cloudflare JavaScript detections and managed challenge.** These work only on Cloudflare-proxied zones ([docs](https://developers.cloudflare.com/bots/additional-configurations/javascript-detections/)).

**Limits.**

- Solver services sell reCAPTCHA and Turnstile solves for about $1 to $3 per thousand ([2captcha](https://2captcha.com/pricing)).
- A 2024 study solved every reCAPTCHA v2 image challenge with an off-the-shelf model ([arXiv](https://arxiv.org/abs/2409.08831)).
- Proof of work proves CPU was spent, and an agent in real Chrome spends it.
- Every challenge blocks crawlers that don't run JavaScript, including ones a publisher wants to charge.
- Traditional CAPTCHAs fail people with disabilities ([W3C note](https://www.w3.org/TR/turingtest/)).
- Turnstile's secret key and its verify call sit poorly with the README's "no keys" objective. That objective targets payment keys, so this is a judgment call, not a clear violation.

## Traps

These methods plant something only a crawler would follow.

- **Hidden links.** Cloudflare AI Labyrinth links crawlers into generated decoy pages on any plan, on Cloudflare only ([Cloudflare](https://blog.cloudflare.com/ai-labyrinth/)).
- **A URL disallowed in robots.txt.** A hit shows a crawler that ignored robots.txt.
- **Tarpits.** Nepenthes serves an endless maze to waste crawler time ([Nepenthes](https://zadzmo.org/code/nepenthes/)).

**Limits.**

- Google's spam policy counts CSS-hidden links as abuse when they manipulate ranking ([Google](https://developers.google.com/search/docs/essentials/spam-policies)).
- Screen readers and keyboard users can reach visually hidden links, so a trap can catch a person. Anubis avoids this by putting its trap link inside `<script type="ignore">`, which browsers and screen readers never render but naive HTML scrapers parse ([Anubis honeypot](https://github.com/TecharoHQ/anubis/blob/main/docs/docs/admin/honeypot/overview.mdx)).
- Agents acting for a user don't read robots.txt, so a robots trap says nothing about them. RFC 9309 also says robots rules are not access control ([RFC 9309](https://www.rfc-editor.org/rfc/rfc9309)).
- Tarpits serve fake content. Nepenthes' author warns it will remove the site from search results.
- Every trap except the robots.txt one changes HTML or serves different content.

## AI tooling requests

These methods watch for requests that only AI tools make.

- **`Accept: text/markdown`.** Of seven agents Cloudflare tested, Claude Code, OpenCode, and Cursor send it by default ([Cloudflare](https://blog.cloudflare.com/agent-readiness/)). Cloudflare serves markdown to these requests on Pro plans and higher ([docs](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/)).
- **AI paths.** Requests for `/llms.txt`, `.md` URLs, or agent discovery files under `/.well-known/`. In Ahrefs' logs, SEO tools made most `llms.txt` fetches, and Claude Code fetched it more than any AI crawler ([Ahrefs](https://ahrefs.com/blog/llmstxt-study/)).

**Limits.** These signals are self-declared, so they detect and never verify. Coverage is small. They are still the only stateless signal that catches some local agents, which pass every fingerprint check. Observing them changes nothing. Serving markdown in reply is a response change.

## Rule compliance

These methods record whether a crawler that names itself follows the site's published rules. Fairtoll already publishes RSL terms, so it knows which rules exist.

- Did a declared crawler fetch robots.txt or the RSL license file before it crawled?
- Did it request paths that robots.txt disallows for its user-agent token? Known Agents returns this per request as `is_disallowed_by_robots_txt` ([npm](https://www.npmjs.com/package/@knownagents/sdk)).

Research finds AI search crawlers rarely check robots.txt ([arXiv 2505.21733](https://arxiv.org/abs/2505.21733)). This differs from the robots.txt trap because it needs no planted URL and changes no response.

**Limits.** It covers only clients that name themselves. Agents acting for a user skip robots.txt on purpose. A finding is a fact for the traffic report, not proof of identity.

## After-the-fact attribution

These methods serve content a crawler cannot know is marked, then look for it in an AI product's answers.

- **Canary pages.** Publish a page nobody links to, block the declared bots, and ask the AI product about it. Cloudflare used this to show Perplexity crawled with undeclared user-agents and IPs ([Cloudflare](https://blog.cloudflare.com/perplexity-is-using-stealth-undeclared-crawlers-to-evade-website-no-crawl-directives/)).
- **Per-request canaries.** Serve a unique token to each suspect request. If an answer quotes the token, that request's IP and fingerprint belong to that product. This variant is an inference from the canary method, not a published tool.
- **Training-data traps.** Copyright traps and similar marks show a model trained on the content. They must be long or repeated many times, need model internals that production APIs withhold, and show up only after a training cycle ([arXiv 2402.09363](https://arxiv.org/abs/2402.09363v2)).

**Limits.** This is the only method found that ties a stealth crawler to an operator without the operator's help. It is slow and manual, changes content on canary pages, and depends on the product quoting sources. Querying AI products automatically may break their terms of service (unconfirmed). It fits as an opt-in CLI tool, not a classifier signal.

## Report dimensions that are not detection

**AI referrals.** A `Referer` from `chatgpt.com` or `perplexity.ai`, or `utm_source=chatgpt.com`, shows a person arrived from an AI answer ([Seer Interactive](https://www.seerinteractive.com/insights/are-ai-sites-like-chatgpt-sending-your-website-traffic)). Fairtoll's event log could report crawls and referrals per operator, the same ratio Cloudflare Radar publishes ([Cloudflare](https://blog.cloudflare.com/ai-search-crawl-refer-ratio-on-radar)). It shows the publisher what each operator gives back for what it takes. Native apps send no `Referer`, and ChatGPT may have stopped tagging links in October 2026 (unconfirmed).

**Deterrence.** Glaze and Nightshade alter images to corrupt models trained on them ([arXiv 2310.13828](https://arxiv.org/abs/2310.13828v3)). They detect nothing. Upscaling defeats them ([arXiv 2406.12027](https://arxiv.org/abs/2406.12027)), and serving altered content only to agents is cloaking.

## Existing packages

These packages solve the same or a nearby problem. Release dates come from npm, GitHub, or Gitea on 2026-10-21.

| Package | Methods | Runs | License |
| --- | --- | --- | --- |
| [isbot](https://github.com/omrilotan/isbot) | User-agent patterns merged from seven lists, tested against real browser user-agents | Local | Unlicense |
| [arcjet/well-known-bots](https://github.com/arcjet/well-known-bots) | 811 bots with patterns, sample user-agents, and verification by IP list, reverse DNS, or Web Bot Auth | Data | MIT |
| [Arcjet](https://docs.arcjet.com/architecture) | Local user-agent and header rules, then a cloud call for IP and bot verification. Dry-run mode. Fails open after 2 seconds | Local and SaaS | Apache-2.0 SDK, paid service |
| [Known Agents](https://www.npmjs.com/package/@knownagents/sdk) | Cloud verification by Web Bot Auth and IP, with results `verified`, `verification_failed`, `not_verifiable`, and `not_identified`. robots.txt generation and AI referral tracking | SaaS | Apache-2.0 |
| [Supertab Connect](https://connect-docs.supertab.co/) | RSL license tokens checked against a JWKS. Header and user-agent bot checks. Observe mode by default. Raw signals classified later | Local and SaaS | MIT |
| [paywalls.net filter](https://www.npmjs.com/package/@paywalls-net/filter) | Cloudflare and Fastly verdicts, user-agent rules from its cloud, frozen-version checks. A cloud call per bot request, which returns 502 if the cloud is down | SaaS | MIT |
| [crawltoll](https://www.npmjs.com/package/crawltoll) | User-agent patterns, x402 v1, AP2 mandates. Fails closed for anything it calls a bot | Local and facilitator | MIT |
| [Skyfire seller SDK](https://www.npmjs.com/package/@skyfire-xyz/skyfire-seller-sdk-node) | KYAPay tokens verified offline against a JWKS | Local | MIT |
| [BotD](https://github.com/fingerprintjs/BotD) | Client-side automation signals | Browser | MIT |
| [Vercel BotID](https://vercel.com/docs/botid) | Client challenge, with paid deep analysis | SaaS on Vercel | Not stated |
| [Anubis](https://github.com/TecharoHQ/anubis) | Proof of work, meta refresh, ordered rules with weights and thresholds, crawler IP allowlists, a trap maze | Reverse proxy | MIT |
| [go-away](https://git.gammaspectra.live/git/go-away) | Rules over IP lists fetched and cached from URLs, DNS blocklists with a 1-second timeout, JA4 when it ends TLS, challenges without JavaScript | Reverse proxy | MIT |
| [CrowdSec](https://doc.crowdsec.net/) | Log parsing, behavior scenarios, a community blocklist | Local agent and community cloud | MIT |
| [ai.robots.txt](https://github.com/ai-robots-txt/ai.robots.txt) | AI user-agent list that generates robots.txt and server configs | Data | MIT |
| [Matomo device-detector](https://github.com/matomo-org/device-detector) | Bot user-agent patterns with categories | Local | LGPL-3.0 |

Six lessons from these packages apply to Fairtoll:

- **Reuse the registry.** `well-known-bots` already holds the operator registry the verification spike plans. [The verification spike](bot-verification.md#constraints-for-the-classifier-task) now recommends generating from it.
- **Keep lists fresh with a fallback.** Arcjet, Anubis, and go-away fetch lists from a URL with a selector and cache them. ai.robots.txt and isbot rebuild their lists in CI. Every package keeps a bundled copy for when the fetch fails.
- **Test every user-agent pattern.** isbot measures false positives against a browser user-agent corpus. crawltoll's `/agent/i` pattern shows the risk of skipping that test, since it matches any user-agent containing "agent".
- **Separate "failed" from "not verifiable".** A forged signature and an operator that publishes no verification method are different facts. Both are unverified bots, and the reason field should keep them apart.
- **Strip secrets before logging.** Known Agents strips about 22 auth and cookie headers, and Supertab keeps only whether a cookie was present.
- **Local verification sets Fairtoll apart.** Arcjet, Known Agents, paywalls.net, and BotID call a cloud service per request. Fairtoll verifies locally and holds no keys. crawltoll is the only other local x402 package, and it classifies by user-agent alone.

## Legal limits on client-side and fingerprint methods

EDPB Guidelines 2/2023 bring fingerprinting under ePrivacy Article 5(3). A script that reads browser properties and sends them back counts as gaining access to the device. Header-based fingerprinting can also fall in scope ([EDPB](https://edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf), paragraphs 33, 43, and 51). The guidelines do not settle whether bot detection is "strictly necessary" and therefore exempt from consent. The UK's PECR names fraud prevention as strictly necessary ([PECR Schedule A1](https://www.legislation.gov.uk/uksi/2003/2426/schedule/A1)). A publisher in the EU that turns on client-side detection may need a consent decision first. Fairtoll would ship the method and leave that decision to the publisher. That should be stated in the setup docs.

## What this means for later actions

Local agents that drive the user's own Chrome defeat most detection groups. Cloud agents and careless scrapers do not. The verification groups are still the only ones that name an AI operator on the first request. Work after version 1 that aims at AI traffic gets the most from new verification signals, such as KYAPay, Visa's key store once it ships, and vendor verdict headers.

Detection options that keep the observe-only default:

1. **Header consistency checks**, including the frozen Chrome version check. These are stateless, free, and work everywhere. They catch `curl`-class clients that claim a browser.
2. **AI tooling requests.** These are stateless and catch some local agents that nothing else catches.
3. **Rule compliance.** This uses robots.txt and RSL terms Fairtoll already publishes.
4. **Hosting-network reputation.** This is free on Workers through `request.cf.asn`. On Express it needs a data file such as IPtoASN.
5. **Traffic patterns from the local event log.** This fits "one site's data" and needs state. Key IPv6 by prefix, and classify offline where possible.
6. **Opt-in vendor verdict headers** for AWS, Akamai, DataDome, and HUMAN.

The AI referral report and the canary tool add value without classifying anything.

Options that change responses can only be opt-in rollout steps after "block unverified bots":

1. Client-side signals with a beacon.
2. Proof of work.
3. Turnstile.
4. Private Access Token challenges.
5. Traps.

### Where detection results land

Issue #7 defines the human class as "no bot signals were found". A detection hit is a bot signal, so the request is an unverified bot. Once a publisher turns on "block unverified bots", every false positive of every detection method becomes a blocked person.

Adding a detection method therefore means judging its false-positive rate first. A method that misfires on real people, such as a hosting-network check that catches VPN users, can record its finding in the reason without counting as a bot signal. Anubis takes a related approach. Its rules add weights to a score, and thresholds pick a graduated response ([Anubis thresholds](https://github.com/TecharoHQ/anubis/blob/main/docs/docs/admin/configuration/thresholds.mdx)). Version 1 adds no detection methods, so this applies to later work only.

## Unconfirmed

- Whether the `tlsClient*` fields reach Workers on the Free plan. The docs list them for all plans, but the workerd types omit them.
- Whether a free open-source package that computes JA4H needs a FoxIO license when a separate hosted service is paid.
- Whether Apple's Private Access Token issuer registration is open today.
- Akamai's `akamai-bot` header format, and whether Fastly can forward its verdict without custom VCL.
- Whether any EU data protection authority has ruled on a consent exemption for bot-detection fingerprinting.
- Turnstile `siteverify` latency. Cloudflare publishes no figure.
