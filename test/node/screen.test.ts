import { afterEach, describe, expect, test, vi } from "vitest";
import { classify, type Config } from "../../src/core/index.js";
import { allowsEverything, decide, screen, type DecisionEvent, type EventSink } from "../../src/core/screen.js";
import { requestClasses } from "../../src/core/types.js";

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

const allowing: Config = { ai: "allow" };
const blocking: Config = { ai: "block" };
const charging: Config = { ai: "charge", charge: { price: "0.002", payTo: `0x${"a".repeat(40)}`, network: "base-sepolia" } };

describe("decide", () => {
	test("allows every class by default", () => {
		for (const cls of requestClasses) expect(decide(allowing, cls, "GET")).toEqual({ kind: "allow" });
	});

	test("blocking AI blocks every class but human, whatever the method", () => {
		expect(decide(blocking, "human", "GET")).toEqual({ kind: "allow" });
		for (const cls of requestClasses.filter((c) => c !== "human")) expect(decide(blocking, cls, "POST")).toEqual({ kind: "block" });
	});

	test("charging AI charges every class but human on every method but OPTIONS", () => {
		expect(decide(charging, "human", "GET")).toEqual({ kind: "allow" });
		for (const cls of requestClasses.filter((c) => c !== "human")) {
			expect(decide(charging, cls, "GET")).toEqual({ kind: "charge" });
			expect(decide(charging, cls, "HEAD")).toEqual({ kind: "charge" });
			expect(decide(charging, cls, "POST")).toEqual({ kind: "charge" });
			expect(decide(charging, cls, "OPTIONS")).toEqual({ kind: "allow" });
		}
	});

	test("allowsEverything is true only when AI is allowed", () => {
		expect(allowsEverything(allowing)).toBe(true);
		expect(allowsEverything(blocking)).toBe(false);
		expect(allowsEverything(charging)).toBe(false);
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

	test("always lets /robots.txt through when charging, so RSL terms stay readable", () => {
		expect(screen(request(gptBot), "GET", "/robots.txt", charging)).toEqual({ kind: "allow" });
		expect(screen(request(gptBot), "GET", "/articles/1", charging)).toEqual({ kind: "charge" });
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
