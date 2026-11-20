import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createGate, type DecisionEvent, type EventSink, type Options } from "../../src/core/index.js";
import { packageVersion } from "../../src/core/gate.js";
import { createPayer, startFacilitator } from "./facilitator.js";

const gptBot = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";
const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const wallet = { payTo: `0x${"a".repeat(40)}`, network: "base-sepolia" } as const;
const request = (userAgent: string, payment?: string) =>
	new Request("http://localhost/", { headers: { "user-agent": userAgent, ...(payment ? { "payment-signature": payment } : {}) } });

let facilitator: Awaited<ReturnType<typeof startFacilitator>>;
beforeAll(async () => {
	facilitator = await startFacilitator();
});
afterAll(() => facilitator.close());
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function collect() {
	const events: DecisionEvent[] = [];
	return { events, log: (event: DecisionEvent) => void events.push(event) };
}

/** Checks one request, and answers its outcome once its log has settled. */
async function check(config: unknown, options: Options, req: Request, path = "/articles/1") {
	const { outcome, logged } = createGate(config, options).check(req, "GET", path);
	await logged;
	return outcome;
}

describe("the event passed to log", () => {
	test("is one versioned event per AI request, naming the bot and the path it is given", async () => {
		const { events, log } = collect();
		await check({}, { log }, request(gptBot));
		expect(events).toEqual([
			{
				fairtoll: 1,
				time: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
				path: "/articles/1",
				class: "unverifiedBot",
				reason: "user-agent claims GPTBot",
				bot: "GPTBot",
				action: "allow",
			},
		]);
	});

	test("says when the config blocked the request", async () => {
		const { events, log } = collect();
		await check({ ai: "block" }, { log }, request(gptBot));
		expect(events).toEqual([expect.objectContaining({ action: "block" })]);
		expect(events[0]).not.toHaveProperty("payment");
	});

	test("isn't written for a human request", async () => {
		const { events, log } = collect();
		await check({ ai: "block" }, { log }, request(chrome));
		expect(events).toEqual([]);
	});

	test("for a charged request, carries the price, the network and what happened to the payment", async () => {
		const { events, log } = collect();
		const gate = createGate({ ...wallet, ai: "charge", price: "0.002" }, { log, facilitator: { url: facilitator.url } });
		const send = async (payment?: string) => {
			const { outcome, logged } = gate.check(request(gptBot, payment), "GET", "/articles/1");
			await logged;
			return outcome;
		};
		const unpaid = await send();
		const payment = await createPayer().sign((unpaid as { headers: Record<string, string> }).headers["PAYMENT-REQUIRED"]!);
		expect((await send(payment)).kind).toBe("pass");
		expect(await send(payment)).toMatchObject({ kind: "respond", status: 402 });
		expect(events.map((e) => [e.action, e.price, e.network, e.payment])).toEqual([
			["charge", "0.002", "base-sepolia", "none"],
			["charge", "0.002", "base-sepolia", "paid"],
			["charge", "0.002", "base-sepolia", "rejected"],
		]);
	});

	test("says the payment failed when charging failed and the page was served unpaid", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { events, log } = collect();
		// Nothing listens on port 9, so the facilitator can't be reached.
		const outcome = await check({ ...wallet, ai: "charge", price: "0.002" }, { log, facilitator: { url: "http://localhost:9" } }, request(gptBot));
		expect(outcome.kind).toBe("pass");
		expect(events).toEqual([expect.objectContaining({ action: "charge", payment: "failed" })]);
	});

	test("logged settles only once an async log has", async () => {
		let finish = () => {};
		const log = () => new Promise<void>((resolve) => (finish = resolve));
		let settled = false;
		void createGate({ ai: "block" }, { log }).check(request(gptBot), "GET", "/").logged.then(() => (settled = true));
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(settled).toBe(false);
		finish();
		await expect.poll(() => settled).toBe(true);
	});

	const boom = () => {
		throw new Error("boom");
	};

	test.each([
		["the log", boom],
		["an async log", () => Promise.reject(new Error("boom"))],
	])("if %s throws, the request is still blocked and the error reported", async (_name, log: EventSink) => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await check({ ai: "block" }, { log }, request(gptBot))).toMatchObject({ status: 403 });
		expect(error).toHaveBeenCalledOnce();
		expect(error.mock.calls[0]).toContainEqual(new Error("boom"));
	});

	test("if building the event throws, the request is still blocked and the error reported", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(Date.prototype, "toISOString").mockImplementation(boom);
		expect(await check({ ai: "block" }, { log: () => {} }, request(gptBot))).toMatchObject({ status: 403 });
		expect(error).toHaveBeenCalledOnce();
		expect(error.mock.calls[0]).toContainEqual(new Error("boom"));
	});
});

describe("site.events", () => {
	const site = { key: "site-key", url: "https://service.test/v1/config" };
	const eventsUrl = "https://service.test/v1/events";

	/** A stand-in for fairtoll.net that serves `config`, and answers each event post with `eventStatus`. */
	function stubService(config: unknown, eventStatus = 204) {
		const posts: { headers: Headers; event: DecisionEvent }[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init?: RequestInit) => {
				if (url === site.url) return Response.json(config);
				if (url === eventsUrl) {
					posts.push({ headers: new Headers(init?.headers), event: JSON.parse(String(init?.body)) });
					return new Response(null, { status: eventStatus });
				}
				throw new Error(`unexpected fetch of ${url}`);
			}),
		);
		return posts;
	}

	test("posts each event to the site's events URL, with the site key, as well as passing it to log", async () => {
		const posts = stubService({ ai: "block" });
		const { events, log } = collect();
		await check(wallet, { log, site: { ...site, events: true } }, request(gptBot));
		expect(posts).toHaveLength(1);
		expect(posts[0]?.event).toEqual(events[0]);
		expect(posts[0]?.event).toMatchObject({ bot: "GPTBot", action: "block", path: "/articles/1" });
		expect(posts[0]?.headers.get("authorization")).toBe("Bearer site-key");
		expect(posts[0]?.headers.get("content-type")).toBe("application/json");
		expect(posts[0]?.headers.get("fairtoll-version")).toBe(packageVersion);
	});

	test("posts without a log option", async () => {
		const posts = stubService({ ai: "block" });
		await check(wallet, { site: { ...site, events: true } }, request(gptBot));
		expect(posts.map((p) => p.event.action)).toEqual(["block"]);
	});

	test("is off unless set, so a site alone sends no events", async () => {
		const posts = stubService({ ai: "block" });
		await check(wallet, { log: () => {}, site }, request(gptBot));
		expect(posts).toEqual([]);
	});

	test("an event the service refuses is reported, and the request and the log are unaffected", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		stubService({ ai: "block" }, 500);
		const { events, log } = collect();
		expect(await check(wallet, { log, site: { ...site, events: true } }, request(gptBot))).toMatchObject({ status: 403 });
		expect(events).toHaveLength(1);
		expect(error).toHaveBeenCalledOnce();
		expect(error.mock.calls[0]?.[0]).toContain(`could not send an event to ${eventsUrl}`);
	});

	test("an events setting that isn't true or false throws at startup", () => {
		expect(() => createGate(wallet, { site: { ...site, events: "yes" as never } })).toThrow("site.events must be true or false");
	});
});
