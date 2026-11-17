// Serves a small site for sending real requests to with curl. It has one endpoint for each way a publisher
// can use Fairtoll, so the same request sent to each shows the difference: /open has no Fairtoll, /monitor
// has Fairtoll classifying requests and letting them through, /blocked has Fairtoll refusing AI bots
// and agents, /charged has Fairtoll charging them, /paths has rules that charge and block them only on
// some paths, and /site loads its config from a stand-in for fairtoll.net. A settings file holds the
// publisher's other setup, such as logging, for the endpoints that have Fairtoll. Each request prints a
// line, then any events passed to `log` and anything Fairtoll writes, as they happen.
// Usage: npm run demo:serve -- [settings.json], which defaults to demo/settings/default.json
import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fairtoll } from "../dist/express/index.js";
import { settle, supported } from "./facilitator.js";
import { visitors } from "./visitors.js";

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
// Rules match the whole path, so they name /paths. The top-level ai, from the settings, decides every other path.
const pathsConfig = {
	price: "0.002",
	payTo: "0x000000000000000000000000000000000000dEaD",
	network: "base-sepolia",
	...config,
	rules: [
		{ path: "/paths/premium/*", ai: "charge", price: "0.01" },
		{ path: "/paths/private/*", ai: "block" },
	],
};
// /charged and /paths settle through the stand-in facilitator below, on this same server, so its calls print here too.
const chargedOptions = { ...options, facilitator: { url: `http://localhost:${port}/facilitator` } };
// /site loads its config from the stand-in service below, on this same server, and keeps the wallet and network here.
const siteConfig = { payTo: "0x000000000000000000000000000000000000dEaD", network: "base-sepolia", ...config };
const site = { key: "demo-site-key", url: `http://localhost:${port}/service/v1/config` };
let blocked;
try {
	app.use("/monitor", fairtoll(config, options));
	blocked = fairtoll(blockedConfig, options);
	app.use("/blocked", blocked);
	app.use("/charged", fairtoll(chargedConfig, chargedOptions));
	app.use("/paths", fairtoll(pathsConfig, chargedOptions));
	app.use("/site", fairtoll(siteConfig, { ...chargedOptions, site }));
} catch (error) {
	console.error(`Could not set up Fairtoll: ${error.message}`);
	process.exit(1);
}

// The stand-in facilitator in demo/facilitator.js, on this same server.
app.get("/facilitator/supported", (_req, res) => res.json(supported));
app.post("/facilitator/settle", express.json(), (req, res) => res.json(settle(req.body)));

// A stand-in for the publisher's site on fairtoll.net. GET is what /site fetches. PUT sets the config, as the
// dashboard would, and DELETE takes the service down, so it answers 503 until the next PUT.
let serviceConfig = { ai: "charge", price: "0.002" };
app.get("/service/v1/config", (req, res) => {
	if (req.get("authorization") !== `Bearer ${site.key}`) return res.status(401).send("Unknown site key\n");
	if (serviceConfig === undefined) return res.status(503).send("The service is down\n");
	console.log(`   service sends ${JSON.stringify(serviceConfig)}`);
	res.json(serviceConfig);
});
app.put("/service/v1/config", express.json(), (req, res) => {
	serviceConfig = req.body;
	res.send(`The service will send ${JSON.stringify(serviceConfig)}\n`);
});
app.delete("/service/v1/config", (_req, res) => {
	serviceConfig = undefined;
	res.send("The service is down\n");
});

const endpoints = [
	"   /open     no Fairtoll",
	"   /monitor  Fairtoll classifies each request and lets it through",
	"   /blocked  Fairtoll answers AI bots and agents with a 403 and lets everyone else through",
	"   /charged  Fairtoll answers AI bots and agents with a 402 and a price until they pay, and lets everyone else through",
	"   /paths    Fairtoll charges AI bots and agents under /paths/premium/, blocks them under /paths/private/, and lets the rest through",
	"   /site     Fairtoll loads its config from the stand-in service at /service/v1/config, and fetches it again after a minute",
].join("\n");
// Each endpoint answers any request under it with its method, path, and body, so a changed response is easy to see.
app.use(["/open", "/monitor", "/blocked", "/charged", "/paths", "/site"], express.text({ type: "*/*" }), (req, res) => {
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
	console.log(`   /paths runs ${call(pathsConfig)}, settling through the same facilitator`);
	console.log(`   /site runs fairtoll(${JSON.stringify(siteConfig)}, { site: ${JSON.stringify(site)}${log ? ", log" : ""} }), settling through the same facilitator`);
	console.log(`Listening on http://localhost:${port}`);
	console.log(endpoints);
	console.log("Name a visitor with a Demo-Visitor header:");
	console.log(`   curl -H 'Demo-Visitor: GPTBot' http://localhost:${port}/monitor/articles/42`);
	console.log(`Known visitors: ${Object.keys(visitors).join(", ")}\n`);
});
