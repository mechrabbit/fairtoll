// Runs the built Express adapter in a real server and sends it real HTTP requests, so its behaviour
// can be checked by reading the output rather than the tests. Run it with `npm run demo`.
import express from "express";
import { readdirSync } from "node:fs";
import { fairtoll } from "../dist/express/index.js";

const visitors = [
	["a reader in Chrome", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"],
	["OpenAI's crawler", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot"],
	["Anthropic's crawler", "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)"],
	["Perplexity's crawler", "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)"],
];

/** A small site with the middleware in front, as a publisher would install it. */
function site(middleware) {
	const app = express();
	app.use(middleware);
	app.get("/articles/:id", (req, res) => {
		res.send(`<h1>Article ${req.params.id}</h1>`);
	});
	return app;
}

/** Starts the site, sends one request per visitor, and returns each response's status and body. */
async function visit(app) {
	const server = app.listen(0);
	await new Promise((resolve) => server.once("listening", resolve));
	try {
		const responses = [];
		for (const [, userAgent] of visitors) {
			const res = await fetch(`http://localhost:${server.address().port}/articles/42?ref=home`, { headers: { "user-agent": userAgent } });
			responses.push(`${res.status} ${await res.text()}`);
		}
		return responses;
	} finally {
		server.close();
	}
}

console.log("1. Default install: fairtoll({})");
const plain = await visit(site((_req, _res, next) => next()));
// Catch anything the default install writes to stdout, stderr, or the working directory.
const filesBefore = readdirSync(".").join();
const output = [];
const writes = [process.stdout.write, process.stderr.write];
process.stdout.write = process.stderr.write = (chunk) => output.push(String(chunk));
let observed;
try {
	observed = await visit(site(fairtoll({})));
	await new Promise((resolve) => setTimeout(resolve, 50));
} finally {
	[process.stdout.write, process.stderr.write] = writes;
}
const quiet = output.length === 0 && readdirSync(".").join() === filesBefore;
visitors.forEach(([who], i) => console.log(`   ${who}: ${observed[i]}`));
console.log(`   ${quiet ? "Nothing was" : "Something was"} written to stdout, stderr, or the working directory.\n`);

console.log("2. Logging opted in: fairtoll({}, { log })");
const events = [];
const logged = await visit(site(fairtoll({}, { log: (event) => events.push(event) })));
visitors.forEach(([who], i) => console.log(`   ${who}: ${logged[i]}`));
// Logging finishes in the background, so let it settle before reading the events.
await new Promise((resolve) => setTimeout(resolve, 50));
console.log(`   ${events.length} events were logged, one per AI crawler and none for the reader:`);
for (const event of events) console.log(`   ${JSON.stringify(event)}`);

const same = (responses) => responses.every((response, i) => response === plain[i]);
const checks = [
	["Every status and body matches the same site without Fairtoll", same(observed) && same(logged)],
	["The default install wrote nothing to stdout, stderr, or the working directory", quiet],
	["Each AI crawler was logged once as an unverified bot", events.length === 3 && events.every((e) => e.class === "unverifiedBot")],
	["No event carries the query string", events.every((e) => e.path === "/articles/42")],
];
console.log("");
for (const [check, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${check}`);
process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
