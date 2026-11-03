import { afterEach, describe, expect, test, vi } from "vitest";
import { classify, type Config } from "../../src/core/index.js";
import { allowsEverything, decide, screen, type DecisionEvent, type EventSink } from "../../src/core/screen.js";
import { requestClasses } from "../../src/core/types.js";
import { parsed } from "./parsed.js";

const request = (userAgent?: string) =>
	new Request("https://example.com/articles/1?token=secret", userAgent ? { headers: { "user-agent": userAgent } } : {});

const gptBot = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";
const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

describe("classify", () => {
	test("an AI crawler's user-agent is an unverified bot, because a user-agent is only a claim", () => {
		expect(classify(request(gptBot))).toEqual({ class: "unverifiedBot", reason: "user-agent claims GPTBot" });
	});

	test("matching ignores case and needs the whole token", () => {
		expect(classify(request("claudebot/1.0"))).toEqual({ class: "unverifiedBot", reason: "user-agent claims ClaudeBot" });
		expect(classify(request("NotGPTBotty/1.0")).class).toBe("human");
	});

	test("a request with no bot signals is human", () => {
		expect(classify(request(chrome))).toEqual({ class: "human", reason: "no bot signals" });
		expect(classify(request())).toEqual({ class: "human", reason: "no bot signals" });
	});
});

const wallet = `0x${"a".repeat(40)}`;
const walletFields = { payTo: wallet, network: "base-sepolia" };
const allowing = parsed({});
const blocking = parsed({ ai: "block" });
const charging = parsed({ ...walletFields, ai: "charge", price: "0.002" });
const allow = { kind: "allow" };
const block = { kind: "block" };
const chargeOf = (price: string) => ({ kind: "charge", charge: { price, payTo: wallet, network: "base-sepolia" } });
const charge = chargeOf("0.002");

describe("decide", () => {
	test("allows every class by default", () => {
		for (const cls of requestClasses) expect(decide(allowing, cls, false, "/articles/1")).toEqual(allow);
	});

	test("blocking AI blocks every class but human, preflights included", () => {
		expect(decide(blocking, "human", false, "/articles/1")).toEqual(allow);
		for (const cls of requestClasses.filter((c) => c !== "human")) expect(decide(blocking, cls, true, "/articles/1")).toEqual(block);
	});

	test("charging AI charges every class but human on every request but a CORS preflight", () => {
		expect(decide(charging, "human", false, "/articles/1")).toEqual(allow);
		for (const cls of requestClasses.filter((c) => c !== "human")) {
			expect(decide(charging, cls, false, "/articles/1")).toEqual(charge);
			expect(decide(charging, cls, true, "/articles/1")).toEqual(allow);
		}
	});

	test("allowsEverything is true only when ai and every rule allow", () => {
		expect(allowsEverything(allowing)).toBe(true);
		expect(allowsEverything(blocking)).toBe(false);
		expect(allowsEverything(charging)).toBe(false);
		expect(allowsEverything(parsed({ rules: { "/premium/*": { ai: "allow" } } }))).toBe(true);
		expect(allowsEverything(parsed({ rules: { "/premium/*": { ai: "block" } } }))).toBe(false);
		expect(allowsEverything(parsed({ ...walletFields, price: "0.002", rules: { "/premium": { ai: "charge" } } }))).toBe(false);
		expect(allowsEverything(parsed({ ai: "block", rules: { "/press/*": { ai: "allow" } } }))).toBe(false);
	});
});

describe("decide with rules", () => {
	const bot = (config: Config, path: string) => decide(config, "unverifiedBot", false, path);
	const premium = parsed({ ...walletFields, price: "0.002", rules: { "/premium/*": { ai: "charge", price: "0.01" }, "/archive/*": { ai: "charge" } } });

	test("a rule ending in /* covers its path and every path below it, and ai covers every other path", () => {
		expect(bot(premium, "/premium")).toEqual(chargeOf("0.01"));
		expect(bot(premium, "/premium/42")).toEqual(chargeOf("0.01"));
		expect(bot(premium, "/premium/a/b")).toEqual(chargeOf("0.01"));
		expect(bot(premium, "/premiums")).toEqual(allow);
		expect(bot(premium, "/articles/premium")).toEqual(allow);
		expect(bot(premium, "/")).toEqual(allow);
	});

	test("a charging rule without a price of its own charges the top-level price", () => {
		expect(bot(premium, "/archive/2019")).toEqual(chargeOf("0.002"));
	});

	test("a rule without /* covers only its own path", () => {
		const about = parsed({ rules: { "/about": { ai: "block" } } });
		expect(bot(about, "/about")).toEqual(block);
		expect(bot(about, "/about/")).toEqual(block);
		expect(bot(about, "/about/team")).toEqual(allow);
		expect(bot(about, "/")).toEqual(allow);
	});

	const overlapping = { "/premium/*": { ai: "charge" }, "/premium/free": { ai: "allow" }, "/premium/drafts/*": { ai: "block" } };
	test.each([
		["in one order", overlapping],
		["in the reverse order", Object.fromEntries(Object.entries(overlapping).reverse())],
	])("the most specific rule wins, with the rules written %s", (_name, rules) => {
		const config = parsed({ ...walletFields, price: "0.002", rules });
		expect(bot(config, "/premium/42")).toEqual(charge);
		expect(bot(config, "/premium/free")).toEqual(allow);
		expect(bot(config, "/premium/free/42")).toEqual(charge);
		expect(bot(config, "/premium/drafts")).toEqual(block);
		expect(bot(config, "/premium/drafts/1")).toEqual(block);
	});

	test.each(["/Premium/42", "/premium//42", "//premium/42/", "/premium/./42", "/%70remium/42", "/premium%2F42", "/premium\\42"])(
		"a rule covers %s, which the app could read as /premium/42",
		(path) => {
			expect(bot(premium, path)).toEqual(chargeOf("0.01"));
		},
	);

	const unreadable = ["/premium/../x", "/x/%2e%2e/premium/1", "/x/.%2E/premium/1", "/x%2f..%2fpremium/1", "/x/%5c../premium/1", "/x\\..\\premium/1", "/%zz"];

	test.each(unreadable)("an AI request for %s is blocked while anything blocks or charges, and a reader's is not", (path) => {
		expect(bot(premium, path)).toEqual(block);
		expect(decide(premium, "human", false, path)).toEqual(allow);
	});

	test("a path with a .. segment is allowed while ai and every rule allow", () => {
		const config = parsed({ rules: { "/premium/*": { ai: "allow" } } });
		for (const path of unreadable) expect(bot(config, path)).toEqual(allow);
	});

	test("without rules, a path with a .. segment gets what ai says, as any other path does", () => {
		for (const path of unreadable) expect(bot(charging, path)).toEqual(charge);
	});

	test("the target of OPTIONS * gets what ai says, since it names no path", () => {
		const config = parsed({ rules: { "/": { ai: "block" } } });
		expect(bot(config, "/")).toEqual(block);
		expect(bot(config, "*")).toEqual(allow);
	});

	test("a CORS preflight is let through where a rule charges, and blocked where a rule blocks", () => {
		const config = parsed({ ...walletFields, price: "0.002", rules: { "/premium/*": { ai: "charge" }, "/drafts/*": { ai: "block" } } });
		expect(decide(config, "unverifiedBot", true, "/premium/1")).toEqual(allow);
		expect(decide(config, "unverifiedBot", true, "/drafts/1")).toEqual(block);
	});
});

describe("screen", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function collect() {
		const events: DecisionEvent[] = [];
		return { events, log: (event: DecisionEvent) => void events.push(event) };
	}

	test("logs one versioned event per request, with the path it is given", () => {
		const { events, log } = collect();
		expect(screen(request(gptBot), "GET", "/articles/1", allowing, log)).toEqual({ kind: "allow" });
		expect(events).toEqual([
			{ fairtoll: 1, time: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), path: "/articles/1", class: "unverifiedBot", reason: "user-agent claims GPTBot", action: "allow" },
		]);
	});

	test("returns and logs a block when the config blocks the request", () => {
		const { events, log } = collect();
		expect(screen(request(gptBot), "GET", "/articles/1", blocking, log)).toEqual({ kind: "block" });
		expect(events).toEqual([expect.objectContaining({ class: "unverifiedBot", action: "block" })]);
	});

	test("always allows /robots.txt, and logs it as allowed", () => {
		const { events, log } = collect();
		expect(screen(request(gptBot), "GET", "/robots.txt", blocking, log)).toEqual({ kind: "allow" });
		expect(events).toEqual([expect.objectContaining({ path: "/robots.txt", action: "allow" })]);
		expect(screen(request(gptBot), "GET", "/robots.txt/x", blocking)).toEqual({ kind: "block" });
		expect(screen(request(gptBot), "GET", "/blog/robots.txt", blocking)).toEqual({ kind: "block" });
	});

	test("always lets /robots.txt through, even where a rule blocks it", () => {
		const config = parsed({ rules: { "/robots.txt": { ai: "block" } } });
		expect(screen(request(gptBot), "GET", "/robots.txt", config)).toEqual(allow);
	});

	test("always lets /robots.txt through when charging, so RSL terms stay readable", () => {
		expect(screen(request(gptBot), "GET", "/robots.txt", charging)).toEqual({ kind: "allow" });
		expect(screen(request(gptBot), "GET", "/articles/1", charging)).toEqual(charge);
	});

	test("when charging, lets a CORS preflight through and charges any other OPTIONS", () => {
		const preflight = new Request("https://example.com/", { headers: { "user-agent": gptBot, "access-control-request-method": "POST" } });
		expect(screen(preflight, "OPTIONS", "/articles/1", charging)).toEqual({ kind: "allow" });
		expect(screen(request(gptBot), "OPTIONS", "/articles/1", charging)).toEqual(charge);
	});

	test("blocks without a log", () => {
		expect(screen(request(gptBot), "GET", "/articles/1", blocking)).toEqual({ kind: "block" });
	});

	test("a human request isn't logged", () => {
		const { events, log } = collect();
		expect(screen(request(chrome), "GET", "/articles/1", blocking, log)).toEqual({ kind: "allow" });
		expect(events).toEqual([]);
	});

	const boom = () => {
		throw new Error("boom");
	};

	test("if the classifier throws, screen reports the error and allows the request", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const req = request(gptBot);
		// The classifier reads the user-agent, so a header that can't be read makes it throw.
		vi.spyOn(Headers.prototype, "get").mockImplementation(boom);
		expect(screen(req, "GET", "/articles/1", blocking, () => {})).toEqual({ kind: "allow" });
		expect(error).toHaveBeenCalledOnce();
		expect(error.mock.calls[0]).toContainEqual(new Error("boom"));
	});

	test.each([
		["the sink", boom],
		["an async sink", () => Promise.reject(new Error("boom"))],
	])("if %s throws, the request is still blocked and the error reported", async (_name, log: EventSink) => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(screen(request(gptBot), "GET", "/articles/1", blocking, log)).toEqual({ kind: "block" });
		await expect.poll(() => error.mock.calls.length).toBe(1);
		expect(error.mock.calls[0]).toContainEqual(new Error("boom"));
	});

	test("if building the log event throws, the request is still blocked and the error reported", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(Date.prototype, "toISOString").mockImplementation(boom);
		expect(screen(request(gptBot), "GET", "/articles/1", blocking, () => {})).toEqual({ kind: "block" });
		await expect.poll(() => error.mock.calls.length).toBe(1);
		expect(error.mock.calls[0]).toContainEqual(new Error("boom"));
	});
});
