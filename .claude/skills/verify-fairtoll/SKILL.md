---
name: verify-fairtoll
description: Launch fairtoll's Express demo server, drive it with curl as named visitors (GPTBot, Chrome, ...), and capture transcripts and PNG screenshots as proof. Use to confirm a change to fairtoll's behaviour works in a real HTTP request path, and to make the demo screenshot every behaviour-changing PR needs.
---

# Verify fairtoll

Fairtoll is a library, so there is no app of its own to open. What a publisher's visitors touch is HTTP: Fairtoll runs as Express middleware in front of a site. The repo's demo, `demo/serve.js`, is that site, built from `dist/` the way a publisher installs Fairtoll. Driving it with curl is the user path. `demo/README.md` explains the demo for people; this skill is the recipe for an agent.

The demo has one endpoint per way a publisher can use Fairtoll, and every endpoint echoes the method, path, and body it served:

| Path | Setup |
| --- | --- |
| `/open/...` | No Fairtoll |
| `/monitor/...` | `fairtoll(config, options)` from the settings file |
| `/blocked/...` | The same with `ai: "block"` on top |
| `/robots.txt` | Behind the `/blocked` setup |
| anything else | 404 that lists the endpoints |

A `Demo-Visitor: <name>` header swaps in a real user-agent before Fairtoll sees the request. The names are `Chrome`, `Safari on iPhone`, `Googlebot`, `GPTBot`, `ChatGPT-User`, `ClaudeBot`, `PerplexityBot` and `CCBot`. Use `curl -A '...'` for any other user-agent.

The settings files are `demo/settings/default.json` (`fairtoll({})`) and `demo/settings/logging.json` (`fairtoll({}, { log })`, which prints each event the server logs). A settings file is `{ description, config?, log? }`, and `config` goes to `fairtoll()` unchanged, so you can write a one-off settings file into the run directory to try any config.

All commands below run from the repo root. `V=.claude/skills/verify-fairtoll/verify.sh`.

## Launch

Install once per checkout with `npm ci`. Then pick a run directory outside the repo, such as `R=${TMPDIR:-/tmp}/fairtoll-verify/<short-name>`, and start:

```sh
$V start "$R" demo/settings/logging.json
```

`start` builds `dist/` (what `npm run demo:serve` does first), starts `node demo/serve.js` on `$PORT` or a free port, waits for the startup banner to end with `Known visitors: ...`, and then runs the doctor. It prints `doctor: ok, pid <pid>, http://localhost:<port>, <settings description>` when the server is ready. There is no data directory, database, or seed data: a fresh checkout after `npm ci` is the full state. If it fails, it prints `server.log`, which says why, such as an invalid config or a port in use.

The run directory then holds `port`, `pid`, and `server.log`, the server's whole output.

## Doctor

```sh
$V doctor "$R"
```

It only reads, and it passes when all of these hold:

- The pid in `$R/pid` is alive and is `node demo/serve.js`.
- `server.log` says it is listening on the port in `$R/port`, so the port is this run's and not another server's.
- `GET /verify-doctor` answers with the demo's 404 text.
- No file under `src/` or `demo/serve.js` changed after `dist/` was built. If one did, the server runs old code: stop and start again.

Run it whenever a response surprises you, before you trust what it says.

## Drive

```sh
$V send "$R" /monitor/articles/42 -H 'Demo-Visitor: GPTBot'
$V send "$R" /comments -H 'Demo-Visitor: ClaudeBot' -H 'Content-Type: application/json' -d '{"text":"hi"}'
$V send "$R" / -H 'Demo-Visitor: GPTBot' --request-target '/monitor/articles/%2e%2e/admin'
```

`send <run-dir> <path> [curl args...]` runs `curl -sS -i <args> http://localhost:<port><path>`, prints the command and the full response, and appends both to `$R/curl.txt`. Use `--request-target` for a raw target that curl would otherwise normalise, such as dot segments. The server's line for each request, any `logged {...}` event, anything Fairtoll writes to stderr, and `response <status>` land in `$R/server.log`.

To compare settings or branches, start a second run with its own run directory. Runs never share a port or files, so they can run side by side. They do share `dist/`, so build and verify one branch at a time in a given checkout, or use a separate worktree per branch.

`sh demo/scenarios/visitors.sh <settings>` is the repo's fixed scenario: a reader, GPTBot reading, and ClaudeBot posting to each endpoint. It prints one transcript, uses port 3000 unless `PORT` is set, and stops its own server. Use it for a quick overall picture, and `verify.sh` for anything you need to prove.

## Evidence

```sh
$V shot "$R" "This PR"
```

`shot` renders `curl.txt` to `curl.png` and `server.log` to `server.png` in the run directory, as terminal-style images with the title on top. It needs Playwright with Chromium, which `require("playwright")` must find. A behaviour-changing PR must show these images in its description (a project rule). Earlier PRs committed them to a `pr-screenshots/` directory, linked them by commit SHA from `raw.githubusercontent.com`, and then removed the directory in a later commit.

Proof standards:

- Send real HTTP requests to the demo server. Calling `screen()` or `classify()` directly, or reading the tests, is not proof.
- Capture the request and the response together, which `send` does, and the server's side of the same request, which `server.log` holds. A 403 alone doesn't show what Fairtoll classified. The `logged` event does, when logging is on.
- Show the contrast. Send the same request to `/open` or as `Chrome` next to the one that changes, so a reader sees the difference Fairtoll makes.
- For a fix, run the same requests on `main` and on the branch, in separate run directories, and show both.
- Check side effects, not just status. A block must carry `Cache-Control: no-store`. A logged event's `path` must be the path Express served.

## Cleanup

```sh
$V stop "$R"
```

`stop` kills only the pid this run started, and only if it is still `demo/serve.js`. It deletes `$R/pid` and nothing else, so `curl.txt`, `server.log`, and the PNGs stay in `$R`. Run it after every attempt, failed ones too. Never kill by process name or by port, because another run or the person's own demo may be on the machine. A one-off settings file you wrote into `$R` can stay there as part of the record.

## Feature map

`features/README.md` indexes the user-facing behaviours, with a recipe and expected results for each. Read the feature file for what you are changing and drive every entry point it lists.
