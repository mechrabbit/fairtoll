# Fairtoll verification map

This directory is the maintained source for verifying what Fairtoll does to real requests. Read this index before driving the demo server, then use the matching feature file as the recipe.

## Baseline preconditions

- Run from the repo root, with `node_modules` installed by `npm ci`.
- Start a server with `sh .claude/skills/verify-fairtoll/scripts/demo.sh start "$DIR" <settings>`, where `$DIR` is a new directory in your scratchpad. Each feature names the settings file it needs.
- `sh .claude/skills/verify-fairtoll/scripts/demo.sh doctor "$DIR"` passes.
- Never drive a server this run did not start, such as one on port 3000.

## Driving conventions

- `$H` is `.claude/skills/verify-fairtoll/scripts/demo.sh`.
- Send every request with `sh $H send "$DIR" <name> <path> [curl args]`, using a name that says what it shows, such as `gptbot-blocked`.
- Name visitors with `-H 'Demo-Visitor: <name>'`, not hand-written user-agents, unless the journey is about a user-agent.
- Payments stay in the server's memory. A replay journey needs the same server that settled the payment, and a fresh payment needs a fresh signature from `sh $H pay`.

## Proof and skip reporting

- Proof for a step is its `<name>.txt` (request and full response) and `<name>.server.txt` (server lines it caused).
- Record the feature ID with every artifact you cite.
- A step that can't be driven through the demo is reported as unverified with the reason. It isn't reported as verified by a unit test or a different endpoint.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the behavior a publisher or visitor sees. It then uses exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with demo.sh`, and `Gotchas`.

## Features

- [Observe](./observe.md) covers classification of readers and AI bots, the event log, and pass-through on `/monitor`.
- [Block](./block.md) covers the 403 for AI bots on `/blocked`, readers passing through, and the `/robots.txt` exemption.
- [Charge](./charge.md) covers the 402 price, paying, replay rejection, charged POSTs, free preflights, and readers on `/charged`.
- [Config validation](./config-validation.md) covers an invalid config stopping the site at startup with a message naming each field.
