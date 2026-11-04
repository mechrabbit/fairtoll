---
name: verify-fairtoll
description: Prove a Fairtoll change works by driving the real Express adapter, built from dist/ the way a publisher installs it, through the demo server with curl. Use after changing classification, blocking, charging (x402), event logging, or config validation, or whenever a claim about what Fairtoll does to a request needs evidence beyond unit tests.
---

# Verify Fairtoll

Fairtoll is a library, so a user is a publisher who mounts its Express middleware and the bots and readers who request their pages. The demo server (`demo/serve.js`) is that publisher's site. It mounts the built package from `dist/` on four endpoints and answers every request with its method and path, so any change Fairtoll makes to a response is visible:

| Endpoint | Setup |
| --- | --- |
| `/open` | No Fairtoll |
| `/monitor` | `fairtoll(config)`: classify and let through |
| `/blocked` | `config` plus `ai: "block"`: 403 for AI bots |
| `/charged` | `config` plus `ai: "charge"`, $0.002 on Base Sepolia to `0x…dEaD`, settled by a stand-in facilitator at `/facilitator` on the same server |
| `/robots.txt` | Behind the `/blocked` setup |

`config` and logging come from a settings file, `demo/settings/default.json` (`fairtoll({})`) or `demo/settings/logging.json` (`fairtoll({}, { log })`). A new settings file is the way to drive a different config. No money moves and no wallet needs funds: the stand-in facilitator checks price, wallet and replay, not signatures.

Other surfaces: there is no Cloudflare Worker adapter yet. The `worker` project in `npm test` runs the core code in the Workers runtime. The setup CLI in CONTRIBUTING.md's scope doesn't exist yet. `demo/scenarios/*.sh` are human-readable transcripts on a fixed port; for proof use the helper below, which isolates runs and splits evidence per request.

The feature map in [features/README.md](features/README.md) lists what to drive. Read it before choosing what to prove.

## Helper

`.claude/skills/verify-fairtoll/scripts/demo.sh`, run from the repo root. Every command takes the run's evidence directory `<dir>`. Put it in your scratchpad, such as `$SCRATCH/verify-fairtoll/<run-id>`, never inside the repo.

```sh
H=.claude/skills/verify-fairtoll/scripts/demo.sh
sh $H start  <dir> [demo/settings/logging.json]
sh $H doctor <dir>
sh $H send   <dir> <name> <path> [curl args...]
sh $H pay    <dir> <name>
sh $H stop   <dir>
```

## Launch

```sh
npm ci            # only when node_modules is missing @x402/core, express or viem; build fails with TS2307 otherwise
sh $H start "$DIR" demo/settings/logging.json
```

`start` builds with `npm run build`, picks a free port (or uses `PORT`), starts `node demo/serve.js` with its output in `<dir>/server.log`, waits for the `Listening on http://localhost:<port>` line, then runs `doctor`. It prints `Ready at http://localhost:<port>` when the server is usable. There is no data dir, database or seed: every start is a fresh state, except that the stand-in facilitator's record of settled payments lives in the server's memory and resets only on restart.

An invalid config in the settings file makes the server exit at startup. `start` then prints the log, which holds `Could not set up Fairtoll: Invalid fairtoll config: ...`, and exits 1. When that's the behavior under test, it is the evidence.

Runs are isolated by port and directory, so several can run side by side. `start` refuses a directory whose server is still up.

## Doctor

`sh $H doctor "$DIR"` is read-only. It checks that the pid in `<dir>` is alive, that its log says it listens on the recorded port, that the port answers with the demo's own 404 text, and that `dist/` is newer than every file in `src/`. It also prints the settings in use. Run it first whenever anything looks off. A `dist is older than src` failure means the server runs old code: `stop`, then `start` again.

## Drive

`send` sends one request to the run's server and writes two files: `<dir>/<name>.txt` holds the curl command and the full response, headers included, and `<dir>/<name>.server.txt` holds the server lines that request caused. It prints both.

```sh
sh $H send "$DIR" gptbot-monitor /monitor/articles/42 -H 'Demo-Visitor: GPTBot'
```

- **Visitor.** `-H 'Demo-Visitor: <name>'` sends a real user-agent string. The names are `Chrome`, `Safari on iPhone`, `Googlebot`, `GPTBot`, `ChatGPT-User`, `ClaudeBot`, `PerplexityBot` and `CCBot`, in any case. An unknown name gets a 400 that lists them. For any other user-agent, use `-A '...'` with no `Demo-Visitor`.
- **Body.** `-H 'Content-Type: application/json' -d '{"text":"hello"}'` makes the request a POST with that body, which the endpoint echoes back.
- **Pay.** After a 402 is saved as `<name>`, `sh $H pay "$DIR" <name>` prints the `PAYMENT-SIGNATURE` value for its price, from a new empty wallet, and prints what it pays to stderr. Send it with `-H "PAYMENT-SIGNATURE: $sig"`.

Server lines to read in `<name>.server.txt`:

- `GET /path   user-agent: ...` is the user-agent Fairtoll saw.
- `logged {"fairtoll":1,...,"class":...,"reason":...,"action":...}` is an event, printed only with `log: true` and never for a human.
- `facilitator settles <amount> from <address>` or `facilitator rejects: <reason>` is the settle call.
- `fairtoll: ...` lines are Fairtoll's own error reports when it fails open.
- `response <status>` is the status the site sent. A charged request also prints the stand-in facilitator's own `response 200`, before or after the page's, so match each `response` to its request line rather than taking the first.

## Evidence

The proof for a claim is the `<name>.txt` and `<name>.server.txt` pair for each request that shows it, plus `server.log`, all in `<dir>`. Standards:

- Drive the real path. Requests go through HTTP to the built package. Never import `src/` or call internal functions as proof, and never change `demo/serve.js` to make a journey pass. A change to it changes what proof can show, so it needs the same review as the change itself.
- Capture the action and the result: the request sent, the full response with headers, and the server lines it caused, not only a status code.
- Check the side effects alongside the response: the `logged` event's class, reason and action; the facilitator's settle or reject line; `PAYMENT-RESPONSE` and `Cache-Control` headers.
- Compare to a control. The same request to `/open`, or as `Chrome`, shows what Fairtoll changed.
- The stand-in facilitator is the one mock. It stands where the x402 facilitator boundary already is, so a charge proof shows Fairtoll's side of a payment, not a real settlement. Say so in any report.

## Cleanup

```sh
sh $H stop "$DIR"
```

`stop` kills only the pid this run started, waits for it to exit, and removes `server.pid` and `port`. The responses, server lines and `server.log` stay in `<dir>`. Never kill by process name or port: another run or the user's own `npm run demo:serve` may be on a neighbouring port. Run `stop` after a failed attempt too.
