# Changelog

Each release's changes, newest first. Fairtoll follows [semantic versioning](https://semver.org/). Before 1.0, a minor version can break the config or the API.

## 0.1.0 (unreleased)

The first release.

- Observe, block or charge AI bots and agents, chosen per path with rules. The empty config only observes.
- Bots are recognised by their user-agent.
- Charging uses x402, paid in USDC on Base or Base Sepolia, settled by a facilitator straight to the publisher's wallet.
- Adapters for Express 5 (`fairtoll/express`) and Next.js 16 (`fairtoll/next`).
- `answered(response)` from `fairtoll/next` tells a site's own proxy whether Fairtoll answered a request with a 403 or 402.
- `fairtoll testnet`, a command that pays for one charged page through your config on Base Sepolia, so you see a payment settle before charging real money.
- An optional event log of AI requests and what Fairtoll did with each.
- The config is checked when Fairtoll starts, and the error lists every invalid field it finds.
- Fails open: if Fairtoll can't screen a request, or can't reach the facilitator, the page is served.
