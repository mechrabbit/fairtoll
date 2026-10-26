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
	"requests": [{ "name": "OpenAI's crawler", "method": "GET", "path": "/articles/42", "headers": { "user-agent": "GPTBot/1.2" } }]
}
```

`config` is passed to `fairtoll()` unchanged, so a scenario can use a new config field without changing the runner. `log: true` turns on the `log` option. In a request, only `path` is required. `body` is a string.

## Checking a change

The transcript names the commit it ran on, and is the same on every run of the same code. To check a change, write the scenario and describe the transcript you expect before the work starts. Then read the transcript the change produces, or run the scenario on its branch yourself and compare with `diff`. A change to `demo/run.js` changes what the transcript can show, so review it as closely as the change itself.
