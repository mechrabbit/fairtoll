import { afterEach, describe, expect, test, vi } from "vitest";
import { allowsEverything, classify, decide, screen, type Config, type DecisionEvent, type EventSink } from "../../src/core/index.js";
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

describe("decide", () => {
	test("allows every class by default", () => {
		for (const cls of requestClasses) expect(decide(allowing, cls)).toEqual({ kind: "allow" });
	});

	test("blocking AI blocks every class but human", () => {
		expect(decide(blocking, "human")).toEqual({ kind: "allow" });
		for (const cls of requestClasses.filter((c) => c !== "human")) expect(decide(blocking, cls)).toEqual({ kind: "block" });
	});

	test("allowsEverything is true only when no class is blocked", () => {
		expect(allowsEverything(allowing)).toBe(true);
		expect(allowsEverything(blocking)).toBe(false);
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
		expect(screen(request(gptBot), "/articles/1", allowing, log)).toEqual({ kind: "allow" });
		expect(events).toEqual([
			{ fairtoll: 1, time: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), path: "/articles/1", class: "unverifiedBot", reason: "user-agent claims GPTBot", action: "allow" },
		]);
	});

	test("returns and logs a block when the config blocks the request", () => {
		const { events, log } = collect();
		expect(screen(request(gptBot), "/articles/1", blocking, log)).toEqual({ kind: "block" });
		expect(events).toEqual([expect.objectContaining({ class: "unverifiedBot", action: "block" })]);
	});

	test("blocks without a log", () => {
		expect(screen(request(gptBot), "/articles/1", blocking)).toEqual({ kind: "block" });
	});

	test("a human request isn't logged", () => {
		const { events, log } = collect();
		expect(screen(request(chrome), "/articles/1", blocking, log)).toEqual({ kind: "allow" });
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
		expect(screen(req, "/articles/1", blocking, () => {})).toEqual({ kind: "allow" });
		expect(error).toHaveBeenCalledOnce();
		expect(error.mock.calls[0]).toContainEqual(new Error("boom"));
	});

	test.each([
		["the sink", boom],
		["an async sink", () => Promise.reject(new Error("boom"))],
	])("if %s throws, the request is still blocked and the error reported", async (_name, log: EventSink) => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(screen(request(gptBot), "/articles/1", blocking, log)).toEqual({ kind: "block" });
		await expect.poll(() => error.mock.calls.length).toBe(1);
		expect(error.mock.calls[0]).toContainEqual(new Error("boom"));
	});

	test("if building the log event throws, the request is still blocked and the error reported", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(Date.prototype, "toISOString").mockImplementation(boom);
		expect(screen(request(gptBot), "/articles/1", blocking, () => {})).toEqual({ kind: "block" });
		await expect.poll(() => error.mock.calls.length).toBe(1);
		expect(error.mock.calls[0]).toContainEqual(new Error("boom"));
	});
});
