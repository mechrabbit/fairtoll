import express from "express";
import { mkdtemp, readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fairtoll } from "../../src/express/index.js";

let dir: string;
let originalCwd: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "fairtoll-"));
	originalCwd = process.cwd();
	process.chdir(dir);
});
afterEach(() => {
	process.chdir(originalCwd);
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
		const chunks: Buffer[] = [];
		for await (const chunk of socket) chunks.push(chunk as Buffer);
		return Buffer.concat(chunks);
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

/** The events in the log, once the background write has finished. */
async function events(path: string) {
	const text = await vi.waitFor(async () => {
		const text = await readFile(path, "utf8");
		if (!text.endsWith("\n")) throw new Error("the write hasn't finished");
		return text;
	});
	return text
		.trimEnd()
		.split("\n")
		.map((line) => JSON.parse(line));
}

describe("fairtoll({}) changes no response", () => {
	test.each([
		["a human page view", get("/articles/1", chrome)],
		["an AI crawler", get("/articles/2", gptBot)],
		["a 404", get("/missing", gptBot)],
		["a POST whose body the app parses", post('{"text":"secret-body"}')],
	])("%s is byte for byte the same", async (_name, raw) => {
		const without = await send(site(), raw);
		const withFairtoll = await send(site(fairtoll({})), raw);
		expect(without.toString()).toMatch(/^HTTP\/1\.1 (200|201|404) /);
		expect(withFairtoll.toString()).toBe(without.toString());
		expect(withFairtoll.equals(without)).toBe(true);
	});

	test("it logs to fairtoll-events.jsonl in the working directory", async () => {
		await send(site(fairtoll({})), get("/articles/1", chrome));
		expect(await events(join(dir, "fairtoll-events.jsonl"))).toHaveLength(1);
	});
});

describe("the event log", () => {
	test("an AI crawler writes one line with the version, time, path, class, reason, and action", async () => {
		const log = join(dir, "events.jsonl");
		await send(site(fairtoll({ eventLog: log })), get("/articles/2?ref=feed", gptBot));
		expect(await events(log)).toEqual([
			{ v: 1, time: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), path: "/articles/2", class: "unverifiedBot", reason: "user-agent claims GPTBot", action: "allow" },
		]);
	});

	test("a request with no bot signals is logged as human the same way", async () => {
		const log = join(dir, "events.jsonl");
		await send(site(fairtoll({ eventLog: log })), get("/articles/1", chrome));
		expect(await events(log)).toEqual([
			{ v: 1, time: expect.any(String), path: "/articles/1", class: "human", reason: "no bot signals", action: "allow" },
		]);
	});

	test("never contains the body, cookies, authorization, or query string", async () => {
		const log = join(dir, "events.jsonl");
		await send(site(fairtoll({ eventLog: log })), post('{"text":"secret-body"}'));
		const [event] = await events(log);
		expect(event.path).toBe("/comments");
		expect(JSON.stringify(event)).not.toMatch(/secret/);
	});
});

describe("requests a Web Request can't describe as sent are still logged", () => {
	const raw = (requestLine: string, host: string) => `${requestLine}\r\nHost: ${host}\r\nUser-Agent: ${gptBot}\r\nConnection: close\r\n\r\n`;

	test.each([
		["a Host that isn't a valid URL host", raw("GET /articles/1 HTTP/1.1", "a b"), "/articles/1"],
		["an empty Host", raw("GET /articles/1 HTTP/1.1", ""), "/articles/1"],
		["a TRACE request", raw("TRACE /articles/1 HTTP/1.1", "example.com"), "/articles/1"],
		["a path that starts with //", raw("GET //articles/1 HTTP/1.1", "example.com"), "//articles/1"],
	])("%s", async (_name, request, path) => {
		const log = join(dir, "events.jsonl");
		const without = await send(site(), request);
		const withFairtoll = await send(site(fairtoll({ eventLog: log })), request);
		expect(without.toString()).toMatch(/^HTTP\/1\.1 \d{3} /);
		expect(withFairtoll.equals(without)).toBe(true);
		expect(await events(log)).toEqual([expect.objectContaining({ path, class: "unverifiedBot" })]);
	});
});

test("if the request can't be read, the page still serves normally and the error is reported", async () => {
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	const raw = `GET http://example.com:99999/articles/1 HTTP/1.1\r\nHost: example.com\r\nUser-Agent: ${gptBot}\r\nConnection: close\r\n\r\n`;
	const without = await send(site(), raw);
	const withFairtoll = await send(site(fairtoll({})), raw);
	expect(without.toString()).toMatch(/^HTTP\/1\.1 200 /);
	expect(withFairtoll.equals(without)).toBe(true);
	expect(error).toHaveBeenCalledWith(expect.stringMatching(/could not read the request/), expect.any(TypeError));
});

test("if the sink throws, the page still serves normally and the error is reported", async () => {
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	const raw = get("/articles/1", gptBot);
	const without = await send(site(), raw);
	const withFairtoll = await send(site(fairtoll({ eventLog: join(dir, "missing-dir", "events.jsonl") })), raw);
	expect(withFairtoll.equals(without)).toBe(true);
	await expect.poll(() => error.mock.calls.length).toBe(1);
});

test("an invalid config throws at startup, naming the field", () => {
	expect(() => fairtoll({ evntLog: "x" })).toThrow(/evntLog/);
});
