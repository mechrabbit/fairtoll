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

const charge = { price: "0.002", payTo: `0x${"a".repeat(40)}`, network: "base-sepolia" } as const;
const allowing: Config = { ai: "allow", rules: [] };
const blocking: Config = { ai: "block", rules: [] };
const charging: Config = { ai: "charge", charge, rules: [] };

describe("decide", () => {
	test("allows every class by default", () => {
		for (const cls of requestClasses) expect(decide(allowing, cls, false, "/articles/1")).toEqual({ kind: "allow" });
	});

	test("blocking AI blocks every class but human, preflights included", () => {
		expect(decide(blocking, "human", false, "/articles/1")).toEqual({ kind: "allow" });
		for (const cls of requestClasses.filter((c) => c !== "human")) expect(decide(blocking, cls, true, "/articles/1")).toEqual({ kind: "block" });
	});

	test("charging AI charges every class but human on every request but a CORS preflight", () => {
		expect(decide(charging, "human", false, "/articles/1")).toEqual({ kind: "allow" });
		for (const cls of requestClasses.filter((c) => c !== "human")) {
			expect(decide(charging, cls, false, "/articles/1")).toEqual({ kind: "charge", charge });
			expect(decide(charging, cls, true, "/articles/1")).toEqual({ kind: "allow" });
		}
	});

	test("allowsEverything is true only when AI is allowed on every path", () => {
		expect(allowsEverything(allowing)).toBe(true);
		expect(allowsEverything(blocking)).toBe(false);
		expect(allowsEverything(charging)).toBe(false);
		expect(allowsEverything({ ai: "allow", rules: [{ path: "/a/*", ai: "allow" }] })).toBe(true);
		expect(allowsEverything({ ai: "allow", rules: [{ path: "/a/*", ai: "block" }] })).toBe(false);
		expect(allowsEverything({ ai: "allow", rules: [{ path: "/a/*", ai: "charge", charge }] })).toBe(false);
	});

	test("a rule decides AI requests on its paths, and the top-level ai decides the rest", () => {
		const premium = { ...charge, price: "0.01" };
		const config: Config = {
			ai: "allow",
			rules: [
				{ path: "/premium/*", ai: "charge", charge: premium },
				{ path: "/private/*", ai: "block" },
			],
		};
		expect(decide(config, "unverifiedBot", false, "/premium/a")).toEqual({ kind: "charge", charge: premium });
		expect(decide(config, "unverifiedBot", false, "/private/a")).toEqual({ kind: "block" });
		expect(decide(config, "unverifiedBot", false, "/articles/1")).toEqual({ kind: "allow" });
		expect(decide(config, "unverifiedBot", true, "/premium/a")).toEqual({ kind: "allow" });
		expect(decide(config, "human", false, "/private/a")).toEqual({ kind: "allow" });
		expect(decide({ ...blocking, rules: [{ path: "/free/*", ai: "allow" }] }, "unverifiedBot", false, "/free/a")).toEqual({ kind: "allow" });
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
		expect(screen(request(gptBot), "GET", "/articles/1", allowing, log).action).toEqual({ kind: "allow" });
		expect(events).toEqual([
			{ fairtoll: 1, time: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), path: "/articles/1", class: "unverifiedBot", reason: "user-agent claims GPTBot", action: "allow" },
		]);
	});

	test("returns and logs a block when the config blocks the request", () => {
		const { events, log } = collect();
		expect(screen(request(gptBot), "GET", "/articles/1", blocking, log).action).toEqual({ kind: "block" });
		expect(events).toEqual([expect.objectContaining({ class: "unverifiedBot", action: "block" })]);
	});

	test("always allows /robots.txt, and logs it as allowed", () => {
		const { events, log } = collect();
		expect(screen(request(gptBot), "GET", "/robots.txt", blocking, log).action).toEqual({ kind: "allow" });
		expect(events).toEqual([expect.objectContaining({ path: "/robots.txt", action: "allow" })]);
		expect(screen(request(gptBot), "GET", "/robots.txt/x", blocking).action).toEqual({ kind: "block" });
		expect(screen(request(gptBot), "GET", "/blog/robots.txt", blocking).action).toEqual({ kind: "block" });
	});

	test("always lets /robots.txt through when charging, so RSL terms stay readable", () => {
		expect(screen(request(gptBot), "GET", "/robots.txt", charging).action).toEqual({ kind: "allow" });
		expect(screen(request(gptBot), "GET", "/articles/1", charging).action).toEqual({ kind: "charge", charge });
	});

	test("blocks an AI request whose path has a .. segment when there are rules and not every path is allowed", () => {
		const config: Config = { ai: "allow", rules: [{ path: "/premium/*", ai: "charge", charge }] };
		expect(decide(config, "unverifiedBot", false, "/premium/a/../../x")).toEqual({ kind: "block" });
		expect(decide(config, "unverifiedBot", true, "/premium/a/%2e%2e/%2e%2e/x")).toEqual({ kind: "block" });
		expect(decide(config, "unverifiedBot", false, "/docs/../premium/a")).toEqual({ kind: "block" });
		expect(decide(config, "unverifiedBot", false, "/x/../y")).toEqual({ kind: "block" });
		expect(decide(config, "human", false, "/premium/a/../../x")).toEqual({ kind: "allow" });
		// Without rules, or when every path is allowed, nothing changes, so observing never changes a response.
		expect(decide(blocking, "unverifiedBot", false, "/x/../y")).toEqual({ kind: "block" });
		expect(decide(allowing, "unverifiedBot", false, "/x/../y")).toEqual({ kind: "allow" });
		expect(decide({ ai: "allow", rules: [{ path: "/premium/*", ai: "allow" }] }, "unverifiedBot", false, "/premium/a/../b")).toEqual({ kind: "allow" });
	});

	test("lets /robots.txt through even when a rule blocks or charges every path", () => {
		const config: Config = { ai: "allow", rules: [{ path: "/*", ai: "block" }] };
		expect(screen(request(gptBot), "GET", "/robots.txt", config).action).toEqual({ kind: "allow" });
		expect(screen(request(gptBot), "GET", "/robots.txt", { ai: "allow", rules: [{ path: "/*", ai: "charge", charge }] }).action).toEqual({ kind: "allow" });
		expect(screen(request(gptBot), "GET", "/articles/1", config).action).toEqual({ kind: "block" });
	});

	test("when charging, lets a CORS preflight through and charges any other OPTIONS", () => {
		const preflight = new Request("https://example.com/", { headers: { "user-agent": gptBot, "access-control-request-method": "POST" } });
		expect(screen(preflight, "OPTIONS", "/articles/1", charging).action).toEqual({ kind: "allow" });
		expect(screen(request(gptBot), "OPTIONS", "/articles/1", charging).action).toEqual({ kind: "charge", charge });
	});

	test("blocks without a log", () => {
		expect(screen(request(gptBot), "GET", "/articles/1", blocking).action).toEqual({ kind: "block" });
	});

	test("logged settles only once an async log has", async () => {
		let finish = () => {};
		const log = () => new Promise<void>((resolve) => (finish = resolve));
		let settled = false;
		void screen(request(gptBot), "GET", "/articles/1", blocking, log).logged.then(() => (settled = true));
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(settled).toBe(false);
		finish();
		await expect.poll(() => settled).toBe(true);
	});

	test("a human request isn't logged", () => {
		const { events, log } = collect();
		expect(screen(request(chrome), "GET", "/articles/1", blocking, log).action).toEqual({ kind: "allow" });
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
		expect(screen(req, "GET", "/articles/1", blocking, () => {}).action).toEqual({ kind: "allow" });
		expect(error).toHaveBeenCalledOnce();
		expect(error.mock.calls[0]).toContainEqual(new Error("boom"));
	});

	test.each([
		["the sink", boom],
		["an async sink", () => Promise.reject(new Error("boom"))],
	])("if %s throws, the request is still blocked and the error reported", async (_name, log: EventSink) => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const { action, logged } = screen(request(gptBot), "GET", "/articles/1", blocking, log);
		expect(action).toEqual({ kind: "block" });
		await logged;
		expect(error).toHaveBeenCalledOnce();
		expect(error.mock.calls[0]).toContainEqual(new Error("boom"));
	});

	test("if building the log event throws, the request is still blocked and the error reported", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(Date.prototype, "toISOString").mockImplementation(boom);
		const { action, logged } = screen(request(gptBot), "GET", "/articles/1", blocking, () => {});
		expect(action).toEqual({ kind: "block" });
		await logged;
		expect(error).toHaveBeenCalledOnce();
		expect(error.mock.calls[0]).toContainEqual(new Error("boom"));
	});
});
