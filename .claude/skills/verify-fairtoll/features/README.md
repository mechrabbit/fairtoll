# Fairtoll verification map

This directory is the maintained source for verifying what Fairtoll does to real requests. Read this index, then use the feature file as the recipe. Every recipe drives the demo server through `verify.sh`, described in `../SKILL.md`.

## Baseline preconditions

- Dependencies are installed with `npm ci`.
- `V=.claude/skills/verify-fairtoll/verify.sh` and a fresh run directory `R` outside the repo.
- `$V start "$R" <settings>` printed `doctor: ok`. Each recipe names its settings file.
- Never drive a server this run didn't start.

## Driving conventions

- Name visitors with `-H 'Demo-Visitor: <name>'`, not hand-written user-agents, so requests match the demo's documented visitors.
- Pair each changed request with a control: the same request to `/open`, or as `Chrome`.
- Read `server.log` after each request for the `logged` event and the response status.
- Stop the server with `$V stop "$R"` when done, failed runs included. Keep `$R`.

## Proof and skip reporting

- Proof is `curl.txt` and `server.log` from the run, and `curl.png` and `server.png` from `$V shot`.
- Report a recipe step that could not run with the command you tried and what was missing. Never report it as verified through another endpoint.

## Features

- [Observe](./observe.md): the default install, which passes every request through unchanged.
- [Event log](./event-log.md): the `log` option, which reports each AI bot or agent request and what Fairtoll did.
- [Block AI bots and agents](./block.md): `ai: "block"`, which answers AI bots and agents with a 403 and always serves `/robots.txt`.
- [Config validation](./config-validation.md): an invalid config or option stops the site at startup, not on a request.
