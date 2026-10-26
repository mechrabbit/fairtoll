// Serves a small site with the built Express adapter in front, for sending real requests to with curl.
// Each request prints a line, then any events passed to `log` and anything Fairtoll writes, as they happen.
// Usage: npm run demo:serve -- [--log] [config.json]
import express from "express";
import { readFileSync } from "node:fs";
import { fairtoll } from "../dist/express/index.js";

/** Known visitors' real user-agent strings, so a request can name a visitor instead of knowing its string. */
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

const args = process.argv.slice(2);
const log = args.includes("--log");
const configPath = args.find((arg) => arg !== "--log");
const config = configPath ? JSON.parse(readFileSync(configPath, "utf8")) : {};
const port = Number(process.env.PORT ?? 3000);

const app = express();
// A Demo-Visitor header, such as `Demo-Visitor: GPTBot`, becomes that visitor's user-agent before Fairtoll
// sees the request, and the header itself is removed. Any capitalisation of the name works.
app.use((req, res, next) => {
	const named = req.get("demo-visitor");
	if (named !== undefined) {
		const visitor = Object.keys(visitors).find((name) => name.toLowerCase() === named.toLowerCase());
		if (visitor === undefined) {
			console.log(`Unknown Demo-Visitor "${named}", so the request was refused`);
			res.status(400).send(`Unknown Demo-Visitor "${named}". Known visitors: ${Object.keys(visitors).join(", ")}\n`);
			return;
		}
		req.headers["user-agent"] = visitors[visitor];
		delete req.headers["demo-visitor"];
	}
	console.log(`${req.method} ${req.originalUrl}   user-agent: ${req.get("user-agent") ?? "none"}`);
	res.on("finish", () => console.log(`   response ${res.statusCode}`));
	next();
});
app.use(fairtoll(config, log ? { log: (event) => console.log(`   logged ${JSON.stringify(event)}`) } : {}));
// The site answers any request with its method, path, and body, so a changed response is easy to see.
app.use(express.text({ type: "*/*" }), (req, res) => {
	res.send(`${req.method} ${req.path}${typeof req.body === "string" && req.body ? `\n${req.body}` : ""}\n`);
});
// Express passes a listen error, such as a port in use, to this callback rather than throwing it.
app.listen(port, (error) => {
	if (error) {
		const reason = error.code === "EADDRINUSE" ? `port ${port} is in use. Stop what is using it, or set PORT to another port.` : error.message;
		console.error(`Could not start the demo server: ${reason}`);
		process.exit(1);
	}
	console.log(`Config: ${JSON.stringify(config)}`);
	console.log(`Logging: ${log ? "on" : "off"}`);
	console.log(`Listening on http://localhost:${port}. Name a visitor with a Demo-Visitor header:`);
	console.log(`   curl -H 'Demo-Visitor: GPTBot' http://localhost:${port}/articles/42`);
	console.log(`Known visitors: ${Object.keys(visitors).join(", ")}\n`);
});
