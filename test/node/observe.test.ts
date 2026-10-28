import { afterEach, describe, expect, test, vi } from "vitest";
import { classify, observe, type DecisionEvent, type EventSink } from "../../src/core/index.js";

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

describe("observe", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function collect() {
		const events: DecisionEvent[] = [];
		return { events, log: (event: DecisionEvent) => void events.push(event) };
	}

	test("logs one versioned event per request, with the path it is given", async () => {
		const { events, log } = collect();
		await observe(request(gptBot), "/articles/1", log);
		expect(events).toEqual([
			{ fairtoll: 1, time: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), path: "/articles/1", class: "unverifiedBot", reason: "user-agent claims GPTBot", action: "allow" },
		]);
	});

	test("a human request isn't logged", async () => {
		const { events, log } = collect();
		await observe(request(chrome), "/articles/1", log);
		expect(events).toEqual([]);
	});

	const boom = () => {
		throw new Error("boom");
	};

	test("if the classifier throws, observe resolves and reports the error", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const req = request(gptBot);
		// The classifier reads the user-agent, so a header that can't be read makes it throw.
		vi.spyOn(Headers.prototype, "get").mockImplementation(boom);
		await expect(observe(req, "/articles/1", () => {})).resolves.toBeUndefined();
		expect(error).toHaveBeenCalledOnce();
		expect(error.mock.calls[0]).toContainEqual(new Error("boom"));
	});

	test.each([
		["the sink", boom],
		["an async sink", () => Promise.reject(new Error("boom"))],
	])("if %s throws, observe resolves and reports the error", async (_name, log: EventSink) => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(observe(request(gptBot), "/articles/1", log)).resolves.toBeUndefined();
		expect(error).toHaveBeenCalledOnce();
		expect(error.mock.calls[0]).toContainEqual(new Error("boom"));
	});
});
