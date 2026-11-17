# Fairtoll

Fairtoll is middleware for Express and Next.js that shows you which AI bots and agents read your site, and lets you block them or charge them for each page. Charges are paid in USDC through [x402](https://github.com/x402-foundation/x402), straight to your own wallet. Fairtoll never holds your money and never needs a private key.

You move through three steps, and each one is a change to the config:

1. **Observe.** Log which AI bots read which pages, and change nothing.
2. **Block.** Answer AI bots with a 403, everywhere or on some paths.
3. **Charge.** Answer AI bots with a 402 and a price on some paths, and serve the page once they pay.

Undo any step by changing the config back, and your site behaves exactly as before.

## Before you start

This is an early 0.x release. Know these limits before you rely on it:

- **Bots are recognised by their user-agent only.** Fairtoll matches the names that AI crawlers and agents send, such as `GPTBot`, `ClaudeBot` and `PerplexityBot`. A bot that pretends to be a browser is treated as a reader and served the page for free. So blocking and charging only catch bots that identify themselves honestly. Checking a bot's identity cryptographically is planned.
- **Express and Next.js only.** Fairtoll needs Express 5 or Next.js 16, and Node 20 or later. A Cloudflare Worker adapter is planned.
- **It only sees requests that reach your server.** If a CDN or cache sits in front of your site, read [Behind a CDN or cache](#behind-a-cdn-or-cache).

## Install

```sh
npm install fairtoll
```

Fairtoll uses your app's own `express` 5 or `next` 16. The examples below use Express. [On Next.js](#on-nextjs) shows the one change Next.js needs and what works differently there.

## Observe

Add Fairtoll before your routes and static files, and pass a `log` function to see what it finds:

```js
import express from "express";
import { fairtoll } from "fairtoll/express";

const app = express();
app.use(fairtoll({}, { log: (event) => console.log(JSON.stringify(event)) }));
// Your static files and routes go after it.
```

The empty config `{}` observes only, so no response changes. Each request from an AI bot or agent is passed to `log` as one event:

```json
{"fairtoll":1,"time":"2026-11-04T02:49:04.185Z","path":"/articles/42","class":"unverifiedBot","reason":"user-agent claims GPTBot","action":"allow"}
```

- `class` is `unverifiedBot` for every AI request for now, because a user-agent is a claim anyone can make.
- `action` is what Fairtoll did: `allow`, `block` or `charge`.
- Requests from readers aren't logged, so your logs don't grow with every page view.

Without `log`, nothing is logged, because a path can carry a secret, such as a password reset token. You choose where events go. `log` can be async. Fairtoll doesn't wait for it, and if it fails, Fairtoll prints the error and the request is unaffected.

## On Next.js

On Next.js, Fairtoll is your app's proxy. Put it in `proxy.js`, or `proxy.ts`, at the root of your project or in `src/`:

```js
import { fairtoll } from "fairtoll/next";

export const proxy = fairtoll({}, { log: (event) => console.log(JSON.stringify(event)) });
```

It takes the same config and options as on Express, so every config in this README works on Next.js: write `export const proxy = fairtoll(...)`, importing from `fairtoll/next`, in place of `app.use(fairtoll(...))`. A few things work differently:

- Don't give the proxy a `matcher`, so that it sees every path, and choose its paths with [rules](#rules). This is the Next.js version of [mounting it at the root](#mount-it-at-the-root).
- Next.js allows one proxy. If your app already has one, keep Fairtoll's as a function, such as `const screen = fairtoll(config)`, and call `screen(request, event)` from yours before anything else. `answered(response)`, also from `fairtoll/next`, says whether Fairtoll answered the request itself with a 403 or 402. If it did, return that response unchanged. If not, keep its headers, which carry the payment receipt and the `Cache-Control` that stops a shared cache serving a paid page. Pass on the `event`, or the log may not be written. [`demo/next/proxy.js`](demo/next/proxy.js) does this (its `matcher` is only for the demo).
- Rules match the path after your `basePath`, which is what Next.js routes by.
- Rewrites in `next.config` run after the proxy, so a rewrite from a free path to a charged page gives the page away. Never point a rewrite from a free path at charged content.
- A mistake in the config doesn't stop your app, because `next build` doesn't load the proxy and the mistake would only show in production. Instead Fairtoll prints the error when the proxy loads, and passes every request on unscreened, so nothing is blocked or charged. Check your server's log after you change the config.
- A static export (`output: "export"`) has no proxy, so Fairtoll can't run there.

## Mount it at the root

On Express, always add Fairtoll with `app.use(fairtoll(...))`, before anything else that serves pages, and choose its paths with [rules](#rules). Don't mount it on a path, such as `app.use("/articles", fairtoll(...))`. A static file server mounted at the root can serve the same file under a path that never reaches a mounted middleware, such as `/x/..%2farticles/1`, so a bot could read it without being blocked or charged.

## The config

| Field | What it does |
| --- | --- |
| `ai` | What happens to AI requests on paths that no rule matches: `"allow"` (the default), `"block"` or `"charge"`. |
| `price` | The price in US dollars, above zero, as a string with at most 6 decimals, such as `"0.002"`. |
| `payTo` | Your wallet address, which every payment goes to. |
| `network` | `"base"` for real USDC, or `"base-sepolia"` for test USDC. |
| `rules` | A list of rules, each deciding `ai` for some paths. |

On Express, a mistake in the config throws when you call `fairtoll()`, so it shows when your app starts, not on a request. On Next.js, the same error is printed instead, as [On Next.js](#on-nextjs) explains. The error lists the problems it finds:

```
Invalid fairtoll config:
  payTo is needed when ai is "charge"
  network is needed when ai is "charge"
```

### Block AI bots

```js
app.use(fairtoll({ ai: "block" }));
```

Every AI request gets a 403 with the text `This site does not allow AI bots or agents.` and `Cache-Control: no-store`. `/robots.txt` is always served, so a blocked crawler can still read your crawl rules.

### Rules

A rule sets `ai` for the paths it matches, and the top-level `ai` decides every other path. Removing a rule puts its paths back on the top-level `ai`.

To block AI bots everywhere except a few public pages, block by default and allow those pages:

```js
app.use(
	fairtoll({
		ai: "block",
		rules: [
			{ path: "/", ai: "allow" },
			{ path: "/about", ai: "allow" },
			{ path: "/news/*", ai: "allow" },
		],
	}),
);
```

How rules match:

- A path is exact, such as `"/about"`, or ends in `/*`, such as `"/news/*"`, which covers `/news` and everything under it. `"/*"` covers every path.
- A rule's path is the whole path of the request.
- Case, a trailing slash and percent-encoding don't matter, so `/NEWS/a` and `/%6Eews/a` are under `/news/*`.
- When several rules match, the most specific wins: an exact path, then the wildcard with the longest prefix. The order of the rules never matters.
- Two rules can't have the same path.
- When there are rules and any of them, or the top-level `ai`, blocks or charges, an AI request whose path has a `..` segment is blocked, because parts of an app can resolve `..` to different pages.

### Charge on some paths

```js
app.use(
	fairtoll(
		{
			price: "0.002",
			payTo: "0xYourWalletAddress",
			network: "base",
			rules: [
				{ path: "/articles/*", ai: "charge" },
				{ path: "/articles/archive/*", ai: "charge", price: "0.0005" },
				{ path: "/articles/free/*", ai: "allow" },
			],
		},
		// Charging on "base" needs a mainnet facilitator. See the next section.
		{ facilitator },
	),
);
```

A charging rule uses its own `price`, or the top-level one. Every payment goes to the top-level `payTo` on the top-level `network`. To charge everywhere, set the top-level `ai` to `"charge"`.

Here is what a charged request goes through:

1. An AI bot asks for the page and gets a 402 with the price in an x402 `PAYMENT-REQUIRED` header.
2. It pays by sending the request again with a `PAYMENT-SIGNATURE` header.
3. An x402 facilitator settles the payment to your wallet before your app runs.
4. Your app serves the page, with the receipt in a `PAYMENT-RESPONSE` header.

A payment that was already used, or names the wrong price or wallet, gets the 402 again.

Fairtoll charges every request on a charged path, whatever the method and whatever your app answers, so a 404, an image or a form post there costs the bot too. Use rules to charge only the paths that hold your content. Three kinds of request are never charged:

- A CORS preflight, an `OPTIONS` request with an `Access-Control-Request-Method` header, is let through, because a 402 would break cross-origin requests to the page. Don't answer a preflight with the page itself, because a bot can send one too.
- A `HEAD` request gets the 402 and is never charged, because it has no page to pay for.
- `/robots.txt` is always served free, so a bot can still read your crawl rules.

If the facilitator can't be reached, Fairtoll serves the page unpaid and prints the error, so an outage never takes your site down. It waits 30 seconds before trying a facilitator that failed to start again. A facilitator that rejects the payment or answers with an error status gets the bot the 402, not the page.

### The facilitator

A facilitator settles x402 payments on the blockchain. Fairtoll never runs one or holds funds. By default it uses x402.org's facilitator, which only settles on testnets, so on `"base-sepolia"` you need nothing else.

To charge real USDC on `"base"`, pass a facilitator that settles on mainnet, or Fairtoll reports a config error. [Coinbase's](https://docs.cdp.coinbase.com/x402/welcome) is one, and needs a Coinbase Developer Platform API key:

```sh
npm install @coinbase/x402
```

```js
// Reads the CDP_API_KEY_ID and CDP_API_KEY_SECRET environment variables.
import { facilitator } from "@coinbase/x402";

app.use(fairtoll(config, { facilitator }));
```

Any facilitator works if you pass an object with its `url`, along with any options x402's `HTTPFacilitatorClient` takes.

### Try charging on testnet first

Your config works the same on `"base-sepolia"`, with test USDC that has no value, so charge there before `"base"`.

To see a paid request settle through your config before you charge real money, pay for one page on testnet with a test wallet:

```sh
FAIRTOLL_TESTNET_KEY=0x... npx fairtoll testnet config.json
```

It always charges on Base Sepolia, even when your config says `"base"`, and the wallet only signs payments there, so the run can't spend real money. [docs/testnet.md](docs/testnet.md) shows what it prints and how to get a test wallet and test USDC.

## Set prices from fairtoll.net

If you have a site on fairtoll.net, Fairtoll can load its config from there, so you change prices and rules in the dashboard without a redeploy. Pass the site's key, and keep your wallet and network in your own code:

```js
app.use(
	fairtoll(
		{ payTo: "0xYourWalletAddress", network: "base" },
		{ site: { key: process.env.FAIRTOLL_SITE_KEY }, facilitator },
	),
);
```

- The config from fairtoll.net sets `ai`, `price` and `rules`. Your wallet and network only ever come from your code, so fairtoll.net can't change where your money goes. A config from fairtoll.net that sets `payTo` or `network` is refused.
- The first request after your app starts waits up to a second for the config. After that no request waits: Fairtoll fetches the config again in the background once it is a minute old, so a change in the dashboard reaches your site within about a minute.
- Until a fetch succeeds, the config in your code applies, so you can write your whole config there as a fallback.
- If fairtoll.net can't be reached, or sends a config with a mistake in it, Fairtoll prints the error and keeps the last config it had. Your pages keep loading either way.
- Without `site`, Fairtoll never contacts fairtoll.net. Events passed to `log` are never sent there.

## Behind a CDN or cache

Fairtoll only acts on requests that reach your server. A CDN or cache in front of your site can answer a bot with a page it cached for a reader, without asking your server, so the bot is neither blocked nor charged. Fairtoll's 403 and 402 responses are marked `no-store` so that a cache never replays them, but your pages themselves can still be cached.

If your site is behind a cache:

- Block AI bots in the cache too. Cloudflare and most CDNs have a setting for it.
- Don't let the cache serve charged paths to AI bots, for example by not caching those paths.

## When something goes wrong

Fairtoll fails open. If it can't read a request, classify it, or reach the facilitator, it prints the error and passes the request on to your app as if Fairtoll weren't there. On Express, only a mistake in the config or options stops your app, and only at startup. On Next.js, nothing does.

## Contributing

To work on Fairtoll, read [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Fairtoll is licensed under the [Apache License 2.0](LICENSE).
