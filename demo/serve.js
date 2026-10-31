// Serves a small site for sending real requests to with curl. It has one endpoint for each way a publisher
// can use Fairtoll, so the same request sent to each shows the difference: /open has no Fairtoll, /monitor
// has Fairtoll classifying requests and letting them through, and /blocked has Fairtoll refusing AI bots
// and agents. A settings file holds the publisher's other setup, such as logging, for the endpoints that
// have Fairtoll. Each request prints a line, then any events passed to `log` and anything Fairtoll writes,
// as they happen.
// Usage: npm run demo:serve -- [settings.json], which defaults to demo/settings/default.json
import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

// Settings are { description, config?, log? }. `config` is passed to fairtoll() unchanged, and defaults to
// {}. `log: true` turns on its `log` option.
const [settingsPath = fileURLToPath(new URL("settings/default.json", import.meta.url))] = process.argv.slice(2);
const { description, config = {}, log } = JSON.parse(readFileSync(settingsPath, "utf8"));
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
const options = log ? { log: (event) => console.log(`   logged ${JSON.stringify(event)}`) } : {};
const blockedConfig = { ...config, ai: "block" };
const chargedConfig = { price: "0.002", payTo: "0x000000000000000000000000000000000000dEaD", network: "base-sepolia", ...config, ai: "charge" };
// /charged settles through the stand-in facilitator below, on this same server, so its calls print here too.
const chargedOptions = { ...options, facilitator: { url: `http://localhost:${port}/facilitator` } };
let blocked;
try {
	app.use("/monitor", fairtoll(config, options));
	blocked = fairtoll(blockedConfig, options);
	app.use("/blocked", blocked);
	app.use("/charged", fairtoll(chargedConfig, chargedOptions));
} catch (error) {
	console.error(`Could not set up Fairtoll: ${error.message}`);
	process.exit(1);
}

// A stand-in for an x402 facilitator such as x402.org's. It settles a payment that names the price and wallet
// the 402 asked for, and rejects a payment it has already settled. It checks no signature and moves no money.
const settledNonces = new Set();
app.get("/facilitator/supported", (_req, res) => {
	res.json({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }], extensions: [], signers: {} });
});
app.post("/facilitator/settle", express.json(), (req, res) => {
	const { paymentPayload, paymentRequirements } = req.body;
	const { from, to, value, nonce } = paymentPayload.payload.authorization;
	const network = paymentRequirements.network;
	let errorReason;
	if (to.toLowerCase() !== paymentRequirements.payTo.toLowerCase() || value !== paymentRequirements.amount) errorReason = "wrong_price_or_wallet";
	else if (settledNonces.has(nonce)) errorReason = "payment_already_used";
	console.log(`   facilitator ${errorReason ? `rejects: ${errorReason}` : `settles ${value} from ${from}`}`);
	if (errorReason) return res.json({ success: false, errorReason, transaction: "", network, payer: from });
	settledNonces.add(nonce);
	res.json({ success: true, transaction: `0xdemo${settledNonces.size}`, network, payer: from });
});

const endpoints = [
	"   /open     no Fairtoll",
	"   /monitor  Fairtoll classifies each request and lets it through",
	"   /blocked  Fairtoll answers AI bots and agents with a 403 and lets everyone else through",
	"   /charged  Fairtoll answers AI bots and agents with a 402 and a price until they pay, and lets everyone else through",
].join("\n");
// Each endpoint answers any request under it with its method, path, and body, so a changed response is easy to see.
app.use(["/open", "/monitor", "/blocked", "/charged"], express.text({ type: "*/*" }), (req, res) => {
	res.send(`${req.method} ${req.originalUrl.split("?")[0]}${typeof req.body === "string" && req.body ? `\n${req.body}` : ""}\n`);
});
// The site's crawler rules, behind the /blocked setup, which always lets /robots.txt through.
app.get("/robots.txt", blocked, (_req, res) => {
	res.type("text/plain").send("User-agent: GPTBot\nDisallow: /\n");
});
app.use((_req, res) => {
	res.status(404).send(`Send requests under one of the endpoints:\n${endpoints}\n`);
});
// Express passes a listen error, such as a port in use, to this callback rather than throwing it.
app.listen(port, (error) => {
	if (error) {
		const reason = error.code === "EADDRINUSE" ? `port ${port} is in use. Stop what is using it, or set PORT to another port.` : error.message;
		console.error(`Could not start the demo server: ${reason}`);
		process.exit(1);
	}
	console.log(`Settings: ${settingsPath}`);
	console.log(`   ${description}`);
	const call = (cfg) => `fairtoll(${JSON.stringify(cfg)}${log ? ", { log }" : ""})`;
	console.log(`   /monitor runs ${call(config)}`);
	console.log(`   /blocked runs ${call(blockedConfig)}`);
	console.log(`   /charged runs ${call(chargedConfig)}, settling through the stand-in facilitator at /facilitator`);
	console.log(`Listening on http://localhost:${port}`);
	console.log(endpoints);
	console.log("Name a visitor with a Demo-Visitor header:");
	console.log(`   curl -H 'Demo-Visitor: GPTBot' http://localhost:${port}/monitor/articles/42`);
	console.log(`Known visitors: ${Object.keys(visitors).join(", ")}\n`);
});
