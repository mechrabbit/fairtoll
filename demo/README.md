# Demo

The demo shows what Fairtoll does to real HTTP requests, without reading its code or its tests. You write a scenario, run it, and read the transcript.

```sh
npm run demo -- demo/scenarios/logging.json
```

This builds the package, serves a small Express site with `fairtoll` in front of it, and sends the scenario's requests. The site answers every request with its method, path, and body. The transcript shows, for each request:

- the request and the full response,
- whether the response is the same as the same site gives without Fairtoll,
- the events passed to `log`,
- anything written to stdout or stderr.

It ends with any files written to the working directory, and says if `fairtoll()` threw at startup.

## Writing a scenario

```json
{
	"config": {},
	"log": true,
	"requests": [
		{ "as": "GPTBot", "path": "/articles/42" },
		{ "as": "Chrome", "method": "POST", "path": "/comments", "body": "hello" }
	]
}
```

`config` is passed to `fairtoll()` unchanged, so a scenario can use a new config field without changing the runner. `log: true` turns on the `log` option.

In a request, only `path` is required. `as` sends the request as a known visitor, with that visitor's real user-agent string. Capitalisation doesn't matter. The known visitors are:

| `as` | Who it is |
| --- | --- |
| `Chrome` | A reader in desktop Chrome |
| `Safari on iPhone` | A reader on a phone |
| `Googlebot` | Google's search crawler, which is not an AI crawler |
| `GPTBot` | OpenAI's training crawler |
| `ChatGPT-User` | ChatGPT fetching a page for a user |
| `ClaudeBot` | Anthropic's crawler |
| `PerplexityBot` | Perplexity's crawler |
| `CCBot` | Common Crawl, whose data trains many models |

To send something else, leave out `as` and set the header yourself, as in `"headers": { "user-agent": "..." }`. A request can also have a `name` for the transcript, a `method`, other `headers`, and a `body` string.

## Checking a change

The transcript names the commit it ran on, and is the same on every run of the same code. To check a change, write the scenario and describe the transcript you expect before the work starts. Then read the transcript the change produces, or run the scenario on its branch yourself and compare with `diff`. A change to `demo/run.js` changes what the transcript can show, so review it as closely as the change itself.

## Trying requests by hand

To poke at Fairtoll with curl instead of a scenario, start the same site as a server:

```sh
npm run demo:serve -- --log
curl -A 'GPTBot/1.2' http://localhost:3000/articles/42
```

Each request prints a line, then the response status, any events passed to `log`, and anything Fairtoll writes, as they happen. At startup it prints a curl command for each known visitor, with its full user-agent string. Leave out `--log` to run the default install. A config file goes after the flags, as in `npm run demo:serve -- --log config.json`, and `PORT` sets the port.

This is for exploring. Nothing is saved, and responses aren't compared with the site without Fairtoll, so use a scenario for anything you hand over or check later.
