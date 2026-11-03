import express from "express";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import { buffer } from "node:stream/consumers";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { DecisionEvent } from "../../src/core/index.js";
import { fairtoll } from "../../src/express/index.js";

afterEach(() => {
	vi.restoreAllMocks();
});

/** A small site whose responses cover headers, a JSON body that the app parses itself, and a 404. */
function site(middleware?: express.RequestHandler) {
	const app = express();
	app.use((_req, res, next) => {
		// The Date header changes every second, so leave it out to compare responses byte for byte.
		res.sendDate = false;
		next();
	});
	if (middleware) app.use(middleware);
	app.get("/articles/:id", (req, res) => {
		res.set("Cache-Control", "max-age=60").send(`<h1>Article ${req.params.id}</h1><p>${req.get("user-agent")}</p>`);
	});
	app.post("/comments", express.json(), (req, res) => {
		res.status(201).json({ body: req.body, cookie: req.get("cookie") });
	});
	return app;
}

/** Sends a raw HTTP request and returns the raw response bytes. */
async function send(app: express.Express, raw: string): Promise<Buffer> {
	const server = app.listen(0);
	await new Promise((resolve) => server.once("listening", resolve));
	try {
		const socket = connect((server.address() as AddressInfo).port);
		socket.end(raw);
		return await buffer(socket);
	} finally {
		server.close();
	}
}

const get = (path: string, userAgent: string) => `GET ${path} HTTP/1.1\r\nHost: example.com\r\nUser-Agent: ${userAgent}\r\nConnection: close\r\n\r\n`;
const post = (body: string) =>
	[
		"POST /comments?token=secret-query HTTP/1.1",
		"Host: example.com",
		"User-Agent: GPTBot/1.2",
		"Cookie: session=secret-cookie",
		"Authorization: Bearer secret-auth",
		"Content-Type: application/json",
		`Content-Length: ${Buffer.byteLength(body)}`,
		"Connection: close",
		"",
		body,
	].join("\r\n");

const gptBot = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";
const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** A log option that collects the events it receives. */
function collect() {
	const events: DecisionEvent[] = [];
	return { events, log: (event: DecisionEvent) => void events.push(event) };
}

describe("fairtoll changes no response", () => {
	test.each([
		["a human page view", get("/articles/1", chrome)],
		["an AI crawler", get("/articles/2", gptBot)],
		["a 404", get("/missing", gptBot)],
		["a POST whose body the app parses", post('{"text":"secret-body"}')],
	])("%s is byte for byte the same", async (_name, raw) => {
		const without = await send(site(), raw);
		const withoutLog = await send(site(fairtoll({})), raw);
		const withLog = await send(site(fairtoll({}, collect())), raw);
		expect(without.toString()).toMatch(/^HTTP\/1\.1 (200|201|404) /);
		expect(withLog.toString()).toBe(without.toString());
		expect(withLog.equals(without)).toBe(true);
		expect(withoutLog.equals(without)).toBe(true);
	});
});

describe("blocking AI", () => {
	const blocking = { ai: "block" };

	test.each([
		["a GET", get("/articles/2", gptBot)],
		["a POST, whose body the app never sees", post('{"text":"secret-body"}')],
		["a path the app doesn't serve", get("/missing", gptBot)],
	])("answers an AI crawler's %s with a 403 before the app sees it", async (_name, raw) => {
		// The site answers these with 200, 201 or 404, so a 403 with Fairtoll's body means the app never ran.
		const response = (await send(site(fairtoll(blocking)), raw)).toString();
		expect(response).toMatch(/^HTTP\/1\.1 403 Forbidden\r\n/);
		expect(response).toMatch(/\r\nContent-Type: text\/plain; charset=utf-8\r\n/);
		expect(response).toMatch(/\r\nCache-Control: no-store\r\n/);
		expect(response).toMatch(/\r\n\r\nThis site does not allow AI bots or agents\.\n$/);
	});

	test.each([
		["a human page view", get("/articles/1", chrome)],
		["Googlebot, which is not an AI crawler", get("/articles/1", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")],
	])("leaves %s byte for byte the same", async (_name, raw) => {
		const without = await send(site(), raw);
		const withBlocking = await send(site(fairtoll(blocking)), raw);
		expect(without.toString()).toMatch(/^HTTP\/1\.1 200 /);
		expect(withBlocking.equals(without)).toBe(true);
	});

	test("charging leaves a human page view byte for byte the same", async () => {
		const charging = { ai: "charge", price: "0.002", payTo: `0x${"a".repeat(40)}`, network: "base-sepolia" };
		const raw = get("/articles/1", chrome);
		expect((await send(site(fairtoll(charging)), raw)).equals(await send(site(), raw))).toBe(true);
	});

	test("lets an AI crawler read /robots.txt", async () => {
		const app = express();
		app.use(fairtoll(blocking));
		app.get("/robots.txt", (_req, res) => res.type("text/plain").send("User-agent: GPTBot\nDisallow: /\n"));
		const response = (await send(app, get("/robots.txt?x=1", gptBot))).toString();
		expect(response).toMatch(/^HTTP\/1\.1 200 OK\r\n/);
		expect(response).toMatch(/\r\n\r\nUser-agent: GPTBot\nDisallow: \/\n$/);
	});

	test("a blocked request is logged with action block", async () => {
		const { events, log } = collect();
		await send(site(fairtoll(blocking, { log })), get("/articles/2", gptBot));
		expect(events).toEqual([expect.objectContaining({ path: "/articles/2", class: "unverifiedBot", action: "block" })]);
	});

	test("if the request can't be read, the page serves normally instead of being blocked", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const raw = get("/articles/1", gptBot);
		const without = await send(site(), raw);
		vi.spyOn(Headers.prototype, "append").mockImplementation(() => {
			throw new TypeError("unreadable header");
		});
		const withBlocking = await send(site(fairtoll(blocking)), raw);
		expect(withBlocking.equals(without)).toBe(true);
	});
});

describe("rules", () => {
	const dotPaths = [
		"/articles/../premium/1",
		"/articles/%2e%2e/premium/1",
		"/articles/.%2E/premium/1",
		"/articles%2f..%2fpremium/1",
		"/articles/%5c../premium/1",
		"/articles\\..\\premium/1",
		"/%zz",
	];

	test("a block rule answers an AI crawler with a 403 only on the paths it covers", async () => {
		const blockComments = fairtoll({ rules: { "/comments": { ai: "block" } } });
		const blocked = (await send(site(blockComments), post('{"text":"secret-body"}'))).toString();
		expect(blocked).toMatch(/^HTTP\/1\.1 403 Forbidden\r\n/);
		expect(blocked).not.toMatch(/secret-body/);
		const raw = get("/articles/2", gptBot);
		expect((await send(site(blockComments), raw)).equals(await send(site(), raw))).toBe(true);
	});

	test.each([
		["a human page view", get("/articles/1", chrome)],
		["an AI crawler", get("/articles/2", gptBot)],
		["a POST whose body the app parses", post('{"text":"secret-body"}')],
		...dotPaths.map((path) => [`an AI crawler on ${path}`, get(path, gptBot)]),
	])("%s is byte for byte the same when every rule allows, with or without a log", async (_name, raw) => {
		const allowing = { rules: { "/articles/*": { ai: "allow" }, "/comments": { ai: "allow" } } };
		const without = await send(site(), raw);
		expect((await send(site(fairtoll(allowing)), raw)).equals(without)).toBe(true);
		expect((await send(site(fairtoll(allowing, collect())), raw)).equals(without)).toBe(true);
	});

	test.each(dotPaths)("answers an AI crawler on %s with a 403 while a rule blocks, and leaves a reader's response the same", async (path) => {
		const blockPremium = fairtoll({ rules: { "/premium/*": { ai: "block" } } });
		expect((await send(site(blockPremium), get(path, gptBot))).toString()).toMatch(/^HTTP\/1\.1 403 Forbidden\r\n/);
		const reader = get(path, chrome);
		expect((await send(site(blockPremium), reader)).equals(await send(site(), reader))).toBe(true);
	});

	test("rules name paths from the site's root, even when Fairtoll is mounted on a path", async () => {
		const mounted = (rules: object) => {
			const app = express();
			app.use("/site", fairtoll({ rules }));
			app.get("/site/:section/:id", (req, res) => res.send(`${req.params.section} ${req.params.id}\n`));
			return app;
		};
		const fromRoot = mounted({ "/site/premium/*": { ai: "block" } });
		expect((await send(fromRoot, get("/site/premium/1", gptBot))).toString()).toMatch(/^HTTP\/1\.1 403 /);
		expect((await send(fromRoot, get("/site/articles/1", gptBot))).toString()).toMatch(/^HTTP\/1\.1 200 /);
		const fromMount = mounted({ "/premium/*": { ai: "block" } });
		expect((await send(fromMount, get("/site/premium/1", gptBot))).toString()).toMatch(/^HTTP\/1\.1 200 /);
	});
});

describe("the log option", () => {
	test("without it, nothing is logged anywhere", async () => {
		const stdout = vi.spyOn(process.stdout, "write");
		const stderr = vi.spyOn(process.stderr, "write");
		const consoleLog = vi.spyOn(console, "log");
		await send(site(fairtoll({})), get("/articles/2", gptBot));
		expect([stdout, stderr, consoleLog].map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);
	});

	test("receives one event per AI request, and none for a human", async () => {
		const { events, log } = collect();
		await send(site(fairtoll({}, { log })), get("/articles/1", chrome));
		await send(site(fairtoll({}, { log })), get("/articles/2?ref=feed", gptBot));
		expect(events).toEqual([
			{
				fairtoll: 1,
				time: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
				path: "/articles/2",
				class: "unverifiedBot",
				reason: "user-agent claims GPTBot",
				action: "allow",
			},
		]);
	});

	test("events never contain the body, cookies, authorization, or query string", async () => {
		const { events, log } = collect();
		await send(site(fairtoll({}, { log })), post('{"text":"secret-body"}'));
		expect(events).toEqual([expect.objectContaining({ path: "/comments" })]);
		expect(JSON.stringify(events)).not.toMatch(/secret/);
	});

	test("a log that isn't a function throws at startup", () => {
		expect(() => fairtoll({}, { log: {} as never })).toThrow(/log must be a function/);
	});
});

describe("requests a Web Request can't describe as sent are still logged", () => {
	const raw = (requestLine: string, host: string) => `${requestLine}\r\nHost: ${host}\r\nUser-Agent: ${gptBot}\r\nConnection: close\r\n\r\n`;

	test.each([
		["a Host that isn't a valid URL host", raw("GET /articles/1 HTTP/1.1", "a b"), "/articles/1"],
		["an empty Host", raw("GET /articles/1 HTTP/1.1", ""), "/articles/1"],
		["a TRACE request", raw("TRACE /articles/1 HTTP/1.1", "example.com"), "/articles/1"],
		["a path that starts with //", raw("GET //articles/1 HTTP/1.1", "example.com"), "//articles/1"],
		["an absolute-form target with an invalid port", raw("GET http://example.com:99999/articles/1 HTTP/1.1", "example.com"), "/articles/1"],
		["an absolute-form target whose path starts with //", raw("GET http://example.com//articles/1 HTTP/1.1", "example.com"), "//articles/1"],
		["a path with encoded dot segments", raw("GET /articles/%2e%2e/admin HTTP/1.1", "example.com"), "/articles/%2e%2e/admin"],
		["a path with dot segments", raw("GET /articles/../admin HTTP/1.1", "example.com"), "/articles/../admin"],
		["a path with a backslash", raw("GET /articles\\1 HTTP/1.1", "example.com"), "/articles\\1"],
		["a target with a fragment", raw("GET /articles/1#top HTTP/1.1", "example.com"), "/articles/1"],
		["a target with a fragment and a backslash, which Express rewrites", raw("GET /articles\\1#top HTTP/1.1", "example.com"), "/articles/1"],
		["an asterisk-form target", raw("OPTIONS * HTTP/1.1", "example.com"), "*"],
	])("%s", async (_name, request, path) => {
		const { events, log } = collect();
		const without = await send(site(), request);
		const withFairtoll = await send(site(fairtoll({}, { log })), request);
		expect(without.toString()).toMatch(/^HTTP\/1\.1 \d{3} /);
		expect(withFairtoll.equals(without)).toBe(true);
		expect(events).toEqual([expect.objectContaining({ path, class: "unverifiedBot" })]);
	});
});

test("if the request can't be read, the page still serves normally and the error is reported", async () => {
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	const raw = get("/articles/1", gptBot);
	const without = await send(site(), raw);
	vi.spyOn(Headers.prototype, "append").mockImplementation(() => {
		throw new TypeError("unreadable header");
	});
	const withFairtoll = await send(site(fairtoll({}, collect())), raw);
	expect(without.toString()).toMatch(/^HTTP\/1\.1 200 /);
	expect(withFairtoll.equals(without)).toBe(true);
	expect(error).toHaveBeenCalledWith(expect.stringMatching(/could not read the request/), expect.any(TypeError));
});

test("if the log throws, the page still serves normally and the error is reported", async () => {
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	const raw = get("/articles/1", gptBot);
	const without = await send(site(), raw);
	const log = () => {
		throw new Error("logger down");
	};
	const withFairtoll = await send(site(fairtoll({}, { log })), raw);
	expect(withFairtoll.equals(without)).toBe(true);
	await expect.poll(() => error.mock.calls.length).toBe(1);
});

test("an invalid config throws at startup, naming the field", () => {
	expect(() => fairtoll({ eventLog: "x.jsonl" })).toThrow(/eventLog/);
});
