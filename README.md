# Fairtoll

Fairtoll is an open-source package that lets a publisher see, block, and charge for AI traffic on their own site, on Cloudflare or off it. This README is the guidepost for the people building it. It sets what the package must do, the rules every change keeps, and how to decide what belongs here. The Fairtoll proposal covers the paid hosted service and the business around both.

## Why the package exists

AI products read a publisher's pages and answer the reader directly. The visit never happens, so the ad or subscription revenue never happens either. The largest publishers negotiate licensing deals. Most publishers have no leverage to do that.

The tools to change that exist now:

- The [x402](https://github.com/x402-foundation/x402) protocol lets an agent pay per request with HTTP 402 and USDC.
- The [RSL](https://rslstandard.org/) standard lets a publisher post machine-readable terms, including pay-per-crawl and pay-per-inference.
- Cloudflare blocks AI crawlers by default on many sites and has its own paid-access products, Pay Per Use and the Monetization Gateway.

Three things are still missing. Publishers have no safe way to try this on their own site. They have no good way to set prices. And roughly 80% of sites aren't on Cloudflare. The package covers the first gap and the off-Cloudflare sites. Pricing belongs to the hosted service.

Publishers don't want to block AI. They want to be paid for what it takes. Blocking matters because it gives them leverage. It turns "why pay when it's free?" into "what does it cost to go without?"

## The package's job

The package is how Fairtoll gets onto publishers' sites and earns their trust. It must be useful on its own. It is never a crippled free tier of the hosted service. If a change makes the package worse alone so the hosted service looks better, the change is wrong.

## Objectives

1. **Show publishers their AI traffic first.** The default install only observes. It records which bots and agents visit, how often, and which pages they read. It changes no responses.
2. **Make every step reversible.** A publisher moves from observing, to blocking unverified bots, to charging on a few paths, to a full policy. Each step is a config change. Turning a step off restores the site exactly.
3. **Never break the site.** Fail open. If the package throws, the page serves normally.
4. **Run on and off Cloudflare from the same config.** A policy written for the Express adapter works unchanged in the Cloudflare Worker adapter.
5. **Hold no money and no keys.** Payments settle directly to the publisher's wallet. The package never takes custody and never needs a private key.
6. **Open the door to the hosted service without nagging.** The package connects through a pricing hook and an optional event feed. Both are off by default, and the package never prompts anyone to sign up.

## Rules for deciding

**One site's data or many.** If a feature works with one publisher's data, it goes in the package. If it gets better with many publishers' data, it goes in the hosted service. Static prices belong here. Dynamic prices belong in the hosted service.

**On Cloudflare, complement.** Cloudflare already does default blocking, Pay Per Use, and the Monetization Gateway. The Worker adapter adds what Cloudflare doesn't do. It observes before anything is blocked, publishes RSL terms, and serves prices to Cloudflare's origin-controlled pricing. Don't rebuild a Cloudflare feature inside the Worker adapter.

**Off Cloudflare, do the whole job.** The Express adapter classifies requests, applies the policy, blocks, charges through x402, and publishes RSL terms itself.

**Build on the standards.** Charging uses the official `@x402` packages. Licensing terms follow RSL. Never reimplement payments.

**Verify with cryptography, not names.** Classify requests by cryptographic signals where they exist. A user-agent string is a claim anyone can fake. The bar against small single-maintainer x402 paywalls, such as `crawltoll`, is safe defaults and real bot verification.

## The domain

These concepts are fixed by the objectives. Their names and shapes in code are open.

Every request gets one of four classes:

- A human.
- A verified AI buyer.
- An unverified bot.
- A paying agent.

A per-path policy maps each class to one of four actions:

- Allow.
- Block.
- Require a license.
- Charge.

A publisher's rollout moves through four steps: observe, block unverified bots, charge on a few paths, and full policy. Each step is a valid state of the config, not a separate mode of the code.

Prices come from a pricing hook. The default hook returns the static price from the config. The hosted service can supply a different hook.

## Scope for version 1

- Request classification into the four classes.
- The policy engine, with allow, block, require a license, and charge, per path.
- Pay for access through x402, built on the official `@x402` packages.
- Pay per use, limited to generating RSL terms. License validation comes in a later release.
- The pricing hook, with a static default.
- A local event log of classified requests and policy decisions.
- Adapters for the Cloudflare Worker and Express. More adapters come later.
- A setup CLI with a testnet mode, so a publisher sees a paid request succeed before charging real money.

## Out of scope

These never belong in the package:

- Dynamic pricing.
- Data shared across publishers.
- Payouts.
- Running an x402 facilitator.

## Open questions that affect the build

- How does Cloudflare's origin-controlled pricing work in practice? The Worker adapter's pricing endpoint depends on the answer. The team is confirming it with Cloudflare.
- Does `@x402/core` handle a different price on each request cleanly? The pricing hook depends on the answer.
- Is the license permissive or source-available?
- Is the name Fairtoll available on GitHub, domains, and the USPTO register?

## How we know it's working

The package ships after the validation phase finds a clear publisher pain. The hosted pilot starts only when installs move past observe-only. Track these signals:

- Installs, and the share of installs that move past observe-only.
- Issues and contributions from people outside the team.

## License

To be decided. See the open questions.
