import { afterEach, describe, expect, test, vi } from "vitest";
import { classify, decide, observe, type DecisionEvent, type Steps } from "../../src/core/index.js";

const request = (userAgent?: string) =>
	new Request("https://example.com/articles/1?token=secret", userAgent ? { headers: { "user-agent": userAgent } } : {});

const gptBot = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";
const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

describe("classify", () => {
	test("an AI crawler's user-agent is an unverified bot, because a user-agent is only a claim", () => {
		expect(classify(request(gptBot))).toEqual({ class: "unverifiedBot", reason: "user-agent claims GPTBot" });
	});

	test("matching ignores case and needs the whole token", () => {
		expect(classify(request("claudebot/1.0")).class).toBe("unverifiedBot");
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

	function steps(overrides: Partial<Steps> = {}) {
		const events: DecisionEvent[] = [];
		return { events, steps: { classify, decide, log: (event: DecisionEvent) => void events.push(event), ...overrides } };
	}

	test("logs one versioned event per request, with the path but not the query string", async () => {
		const { events, steps: s } = steps();
		await observe(request(gptBot), s);
		expect(events).toEqual([
			{ v: 1, time: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), path: "/articles/1", class: "unverifiedBot", reason: "user-agent claims GPTBot", action: "allow" },
		]);
	});

	const boom = () => {
		throw new Error("boom");
	};

	test.each([
		["the classifier", { classify: boom }],
		["decide", { decide: boom }],
		["the sink", { log: boom }],
		["an async sink", { log: () => Promise.reject(new Error("boom")) }],
	])("if %s throws, observe resolves and reports the error", async (_name, overrides: Partial<Steps>) => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(observe(request(gptBot), steps(overrides).steps)).resolves.toBeUndefined();
		expect(error).toHaveBeenCalledOnce();
		expect(error.mock.calls[0]).toContainEqual(new Error("boom"));
	});
});
