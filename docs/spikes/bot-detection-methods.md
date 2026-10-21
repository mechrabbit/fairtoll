# Catalog of bot detection methods and their limits

This doc lists every method a site can use to recognize a bot or an AI agent, grouped by what the method can prove. Each group states its limits. The goal is to show which options exist for actions after version 1. The version 1 recommendation stays in [the bot-verification spike](bot-verification.md), which covers its five signals in more depth. Sources were fetched on 2026-10-21.

## Read the groups as verification or detection

The methods split into two kinds:

- **Verification** says who a request is. A Web Bot Auth signature or an operator's IP list proves that a known operator sent it.
- **Detection** says a request is probably not what it claims. A TLS fingerprint that doesn't match the user-agent, or a crawl pattern, raises suspicion and proves nothing about who sent it.

The README makes this split matter. A detection signal can move a request from human to unverified bot. It can never make a request verified. Every detection group also has false positives on real people, so a detection result used in block mode blocks some humans.

Four properties decide whether a method fits Fairtoll at all:

- **Response change.** The default install changes no responses. A method that injects a script, sends a challenge, or serves a trap can only be an opt-in rollout step.
- **First request.** A method that learns from a script, a cookie, or a pattern decides about later requests, never the one in flight.
- **Off Cloudflare.** The Express adapter needs the method to work on Node, often behind a reverse proxy.
- **Real-browser agents.** ChatGPT agent, Browserbase, Atlas, and Comet drive real Chromium ([Browserbase](https://docs.browserbase.com/features/stealth-mode), [Atlas](https://simonwillison.net/2025/Oct/21/introducing-chatgpt-atlas/), [Comet](https://www.humansecurity.com/ai-agent/perplexity-comet/)). Their requests look like Chrome to every fingerprint and JavaScript check. Only signatures and IP lists identify them.

## Compare the groups

| Group | Proves | Can verify | Changes responses | Decides first request | Works off Cloudflare | Defeated by |
| --- | --- | --- | --- | --- | --- | --- |
| [Cryptographic bot identity](#cryptographic-bot-identity) | The operator holds a published key | Yes | No | Yes | Yes | Stolen keys only |
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

A browser user-agent with no `Sec-Fetch-*` headers, or a Chrome user-agent with no `Sec-CH-UA`, shows the client is not the browser it claims to be. Default clients such as `curl` and `python-requests` announce themselves in the user-agent.

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
- Agents that drive real Chrome produce real Chrome fingerprints.
- This group catches library clients that claim a browser user-agent, and nothing more.
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

**Limits.**

- Residential proxy networks route bots through home IPs and pass every hosting check.
- Real people show up on hosting IPs through VPNs, corporate egress, and cloud browsers.
- iCloud Private Relay puts many Apple users behind one IP. Apple publishes its egress ranges and says to treat them like carrier-grade NAT ([Apple](https://developer.apple.com/icloud/prepare-your-network-for-icloud-private-relay/)).
- Cloud-hosted agents acting for a real reader also sit on cloud IPs, so "datacenter" means automation is likely, not that the request is unwanted.
- The data files go stale and need regular refreshes.

## Traffic patterns on one site

These methods read the site's own event log. They watch for:

- The request rate per IP, per /24, per ASN, or per fingerprint.
- HTML fetched without CSS, scripts, or images.
- robots.txt or sitemap fetches followed by a walk in sitemap or breadth-first order.
- Requests with no cookies and no `Referer`.
- One cookie moving across many IPs.

AWS Bot Control uses the same kinds of signals ([AWS](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-bot.html)).

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
- Agents in real Chrome pass by default.
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
- Screen readers and keyboard users can reach visually hidden links, so a trap can catch a person.
- Agents acting for a user don't read robots.txt, so a robots trap says nothing about them. RFC 9309 also says robots rules are not access control ([RFC 9309](https://www.rfc-editor.org/rfc/rfc9309)).
- Tarpits serve fake content. Nepenthes' author warns it will remove the site from search results.
- Every trap except the robots.txt one changes HTML or serves different content.

## Legal limits on client-side and fingerprint methods

EDPB Guidelines 2/2023 bring fingerprinting under ePrivacy Article 5(3). A script that reads browser properties and sends them back counts as gaining access to the device. Header-based fingerprinting can also fall in scope ([EDPB](https://edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf), paragraphs 33, 43, and 51). The guidelines do not settle whether bot detection is "strictly necessary" and therefore exempt from consent. The UK's PECR names fraud prevention as strictly necessary ([PECR Schedule A1](https://www.legislation.gov.uk/uksi/2003/2426/schedule/A1)). A publisher in the EU that turns on client-side detection may need a consent decision first. Fairtoll would ship the method and leave that decision to the publisher. That should be stated in the setup docs.

## What this means for later actions

Real-browser agents defeat every detection group, so detection catches only careless scrapers. The verification groups are the only ones that identify AI operators. Work after version 1 that aims at AI traffic gets more from new verification signals than from detection. New signals include KYAPay, Visa's key store once it ships, and vendor verdict headers.

Detection options that keep the observe-only default:

1. **Header consistency checks.** These are stateless, free, and work everywhere. They catch `curl`-class clients that claim a browser.
2. **Hosting-network reputation.** This is free on Workers through `request.cf.asn`. On Express it needs a data file such as IPtoASN.
3. **Traffic patterns from the local event log.** This fits "one site's data" and needs state.
4. **Opt-in vendor verdict headers** for AWS, Akamai, DataDome, and HUMAN.

Options that change responses can only be opt-in rollout steps after "block unverified bots":

1. Client-side signals with a beacon.
2. Proof of work.
3. Turnstile.
4. Private Access Token challenges.
5. Traps.

### Decide where detection results go

The four classes have no slot for a suspected bot. A detection hit has two possible destinations:

- **Unverified bot.** Detection then blocks some real people as soon as a publisher turns on "block unverified bots".
- **Human, with a recorded reason.** Detection then shows up in the traffic report and changes no decisions.

That is a product decision for the domain types in #6, not something this research can settle.

## Unconfirmed

- Whether the `tlsClient*` fields reach Workers on the Free plan. The docs list them for all plans, but the workerd types omit them.
- Whether a free open-source package that computes JA4H needs a FoxIO license when a separate hosted service is paid.
- Whether Apple's Private Access Token issuer registration is open today.
- Akamai's `akamai-bot` header format, and whether Fastly can forward its verdict without custom VCL.
- Whether any EU data protection authority has ruled on a consent exemption for bot-detection fingerprinting.
- Turnstile `siteverify` latency. Cloudflare publishes no figure.
