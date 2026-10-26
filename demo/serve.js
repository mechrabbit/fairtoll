// Serves the demo site with the built Express adapter in front, for sending requests by hand with curl.
// Each request prints a line, then any events passed to `log` and anything Fairtoll writes, as they happen.
// Usage: npm run demo:serve -- [--log] [config.json]
import { readFileSync } from "node:fs";
import { fairtoll } from "../dist/express/index.js";
import { site, visitors } from "./site.js";

const args = process.argv.slice(2);
const log = args.includes("--log");
const configPath = args.find((arg) => arg !== "--log");
const config = configPath ? JSON.parse(readFileSync(configPath, "utf8")) : {};
const port = Number(process.env.PORT ?? 3000);

const middleware = fairtoll(config, log ? { log: (event) => console.log(`   logged ${JSON.stringify(event)}`) } : {});
const app = site((req, res, next) => {
	console.log(`${req.method} ${req.originalUrl}   user-agent: ${req.get("user-agent") ?? "none"}`);
	res.on("finish", () => console.log(`   response ${res.statusCode}`));
	middleware(req, res, next);
});
app.listen(port, () => {
	console.log(`Config: ${JSON.stringify(config)}`);
	console.log(`Logging: ${log ? "on" : "off"}`);
	console.log(`Listening on http://localhost:${port}. Try a known visitor:`);
	for (const [name, userAgent] of Object.entries(visitors)) {
		console.log(`   ${name}: curl -A '${userAgent}' http://localhost:${port}/articles/42`);
	}
	console.log("");
});
