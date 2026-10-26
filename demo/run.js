// Runs one scenario against the built Express adapter in a real server, and prints a transcript for a
// person to read: each request and response, the events passed to `log`, and anything written to stdout,
// stderr, or the working directory. The transcript is the same on every run of the same code, so two runs,
// or two branches, can be compared with diff.
// Usage: npm run demo -- demo/scenarios/<name>.json
import express from "express";
import { execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fairtoll } from "../dist/express/index.js";

const [scenarioPath] = process.argv.slice(2);
if (!scenarioPath) {
	console.error("Usage: npm run demo -- <scenario.json>");
	process.exit(2);
}
// A scenario is { config, log?, requests: [{ name?, as?, method?, path, headers?, body? }] }. `config` goes to
// fairtoll() unchanged, so a scenario can use config fields this runner has never heard of.
const scenario = JSON.parse(readFileSync(scenarioPath, "utf8"));

/** Visitors a request can name with `as`, so a scenario needn't spell out their user-agent strings. */
const visitors = {
	Chrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
	"Safari on iPhone": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
	Googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
	GPTBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
	"ChatGPT-User": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
	ClaudeBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
	PerplexityBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
	CCBot: "CCBot/2.0 (https://commoncrawl.org/faq/)",
};
for (const request of scenario.requests) {
	if (request.as === undefined) continue;
	// Any capitalisation works, so "gptbot" finds GPTBot.
	const visitor = Object.keys(visitors).find((name) => name.toLowerCase() === String(request.as).toLowerCase());
	if (visitor === undefined) {
		console.error(`Unknown visitor "${request.as}". Known visitors: ${Object.keys(visitors).join(", ")}`);
		process.exit(2);
	}
	if (Object.keys(request.headers ?? {}).some((header) => header.toLowerCase() === "user-agent")) {
		console.error(`A request can't have both "as" and a user-agent header: "${request.as}"`);
		process.exit(2);
	}
	request.headers = { "user-agent": visitors[visitor], ...request.headers };
	request.name ??= visitor;
}

/** Which code made the transcript, so a reader can tell whether it matches the branch under review. */
function codeVersion() {
	try {
		const commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
		const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim() !== "";
		return `commit ${commit}${dirty ? " with uncommitted changes" : ""}`;
	} catch {
		return "unknown commit";
	}
}

/** A site that answers any request with its method, path, and body, so a changed response is easy to see. */
function site(middleware) {
	const app = express();
	app.use((_req, res, next) => {
		// The Date header changes every second, so leave it out to keep the transcript the same on every run.
		res.sendDate = false;
		next();
	});
	if (middleware) app.use(middleware);
	app.use(express.text({ type: "*/*" }), (req, res) => {
		res.send(`${req.method} ${req.path}${typeof req.body === "string" && req.body ? `\n${req.body}` : ""}`);
	});
	return app;
}

const events = [];
const output = [];

/** Starts the site and sends each request in order, collecting what each one caused. */
async function send(app) {
	const server = app.listen(0);
	await new Promise((resolve) => server.once("listening", resolve));
	try {
		const results = [];
		for (const { method = "GET", path, headers = {}, body } of scenario.requests) {
			const res = await fetch(`http://localhost:${server.address().port}${path}`, { method, headers, body });
			const response = { status: res.status, headers: [...res.headers], body: await res.text() };
			// Logging finishes in the background, so let it settle before taking this request's events.
			await new Promise((resolve) => setTimeout(resolve, 50));
			results.push({ response, events: events.splice(0), output: output.splice(0).join("") });
		}
		return results;
	} finally {
		server.close();
	}
}

const version = codeVersion();
const withoutFairtoll = await send(site());

// Run in an empty directory, and catch stdout and stderr, so anything written shows in the transcript.
const workDir = process.cwd();
process.chdir(mkdtempSync(join(tmpdir(), "fairtoll-demo-")));
const writes = [process.stdout.write, process.stderr.write];
process.stdout.write = process.stderr.write = (chunk) => output.push(String(chunk));
let startupError;
let results = [];
try {
	const middleware = fairtoll(scenario.config, scenario.log ? { log: (event) => events.push(event) } : {});
	results = await send(site(middleware));
} catch (error) {
	startupError = error instanceof Error ? error.message : String(error);
} finally {
	[process.stdout.write, process.stderr.write] = writes;
}
const filesWritten = readdirSync(".");
process.chdir(workDir);

const indent = (text) => text.replace(/\n$/, "").replaceAll("\n", "\n      ");
const lines = [
	`Scenario: ${scenarioPath}`,
	`Code: ${version}, Node ${process.version}`,
	`Config: ${JSON.stringify(scenario.config)}`,
	`Logging: ${scenario.log ? "on" : "off"}`,
];
if (startupError !== undefined) lines.push("", `fairtoll() threw at startup: ${startupError}`);
results.forEach(({ response, events: logged, output: printed }, i) => {
	const { name, method = "GET", path, headers = {}, body } = scenario.requests[i];
	const same = JSON.stringify(response) === JSON.stringify(withoutFairtoll[i].response);
	lines.push("", `${i + 1}. ${name ?? `${method} ${path}`}`, `   Request: ${method} ${path}`);
	for (const [header, value] of Object.entries(headers)) lines.push(`      ${header}: ${value}`);
	if (body !== undefined) lines.push(`      ${indent(body)}`);
	lines.push(`   Response: ${response.status}, ${same ? "same as" : "DIFFERENT FROM"} the site without fairtoll`);
	for (const [header, value] of response.headers) lines.push(`      ${header}: ${value}`);
	lines.push(`      ${indent(response.body)}`);
	// The time differs on every run, so only whether it was set is shown.
	const shown = logged.map((event) => JSON.stringify({ ...event, time: typeof event.time === "string" ? "<set>" : event.time }));
	lines.push(`   Logged:${shown.length === 0 ? " nothing" : ""}`, ...shown.map((event) => `      ${event}`));
	lines.push(`   Server output:${printed === "" ? " none" : `\n      ${indent(printed)}`}`);
});
lines.push("", `Files written: ${filesWritten.length === 0 ? "none" : filesWritten.join(", ")}`);
console.log(lines.join("\n"));
