// Measures how much time Fairtoll adds to a request, by sending the same request to an endpoint without
// Fairtoll and to one for each setup, in a shuffled order each round, and comparing the medians. Each request is
// sent once as a reader and once as an AI bot, so the blocking setup's 403 is measured too. The server
// runs in its own process so the client doesn't slow it, and both sides of each comparison take turns in the
// same run on the same machine, so a slower machine slows both.
// Usage: npm run bench, or npm run bench -- --check to fail if the default setup adds more than the limit below.
import express from "express";
import { fork } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { fairtoll } from "../dist/express/index.js";

// --check fails if the default setup adds more than the lower of these shares, both measured in the same run so
// they scale with the machine's speed. Logging by default would add 12 to 20% of the request without Fairtoll.
// The default setup measures up to about 2.5% of that request, and up to about 17% of what logging adds, from
// noise alone, even on a busy machine. A failed run is retried, so one unlucky run passes.
const maxShareOfRequest = 0.1;
const maxShareOfLogging = 0.25;

const setups = {
	"no Fairtoll": [],
	default: [fairtoll({})],
	"logging on": [fairtoll({}, { log: () => {} })],
	blocking: [fairtoll({ ai: "block" })],
};
const visitors = {
	reader: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0.0.0 Safari/537.36",
	"AI bot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
};
// One request for each setup and visitor, with the status it must answer, so a setup that stops working fails the run.
const requests = Object.keys(setups).flatMap((setup, i) =>
	Object.entries(visitors).map(([visitor, userAgent]) => ({
		name: `${setup}, ${visitor}`,
		path: `/${i}/articles/42?ref=feed`,
		userAgent,
		status: setup === "blocking" && visitor === "AI bot" ? 403 : 200,
	})),
);

if (process.argv[2] === "serve") {
	const app = express();
	Object.values(setups).forEach((middleware, i) => app.use(`/${i}`, ...middleware, (req, res) => res.send(`${req.originalUrl}\n`)));
	const server = app.listen(0, () => process.send(server.address().port));
} else {
	const check = process.argv.includes("--check");
	const attempts = check ? 3 : 1;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		const medians = await measure(check ? 5000 : 20000);
		const without = medians["no Fairtoll, reader"];
		const extra = medians["default, reader"] - without;
		const limit = Math.min(without * maxShareOfRequest, (medians["logging on, reader"] - without) * maxShareOfLogging);
		if (!check || extra <= limit) process.exit(0);
		const percent = ((extra / without) * 100).toFixed(1);
		console.log(`The default setup added ${extra.toFixed(3)} ms, ${percent}% of the request without Fairtoll (attempt ${attempt} of ${attempts})\n`);
	}
	process.exit(1);
}

/** Sends every request once per round, prints each one's latency, and returns the medians in ms by name. */
async function measure(rounds) {
	const server = fork(fileURLToPath(import.meta.url), ["serve"]);
	const port = await new Promise((resolve) => server.once("message", resolve));
	const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
	const timings = requests.map(() => []);
	try {
		// The first rounds are slow while Node compiles the code, so they warm up and aren't counted.
		for (let round = -2000; round < rounds; round++) {
			for (const i of shuffled(requests.keys())) {
				const ms = await time(port, agent, requests[i]);
				if (round >= 0) timings[i].push(ms);
			}
		}
	} finally {
		agent.destroy();
		server.kill();
	}
	const medians = Object.fromEntries(requests.map(({ name }, i) => [name, percentile(timings[i], 0.5)]));
	for (const [i, { name }] of requests.entries()) {
		const extra = medians[name] - medians[`no Fairtoll, ${name.split(", ")[1]}`];
		console.log(`${name.padEnd(20)} median ${medians[name].toFixed(3)} ms   p99 ${percentile(timings[i], 0.99).toFixed(3)} ms   extra ${extra >= 0 ? "+" : ""}${extra.toFixed(3)} ms`);
	}
	console.log();
	return medians;
}

/** The time in ms from sending a request until its whole response has arrived. */
function time(port, agent, { name, path, userAgent, status }) {
	const start = performance.now();
	return new Promise((resolve, reject) => {
		http.get({ port, path, agent, headers: { "user-agent": userAgent } }, (res) => {
			if (res.statusCode !== status) reject(new Error(`${name} answered ${res.statusCode}, not ${status}`));
			res.resume();
			res.on("end", () => resolve(performance.now() - start));
		}).on("error", reject);
	});
}

function shuffled(items) {
	const array = [...items];
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
	return array;
}

function percentile(values, p) {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length * p)];
}
