import { NextRequest, type NextFetchEvent } from "next/server.js";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { DecisionEvent } from "../../src/core/index.js";
import { answered, fairtoll } from "../../src/next/index.js";
import { createPayer, startFacilitator } from "./facilitator.js";

const gptBot = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";
const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const charging = { ai: "charge", price: "0.002", payTo: "0x00000000000000000000000000000000000000aa", network: "base-sepolia" };

let facilitator: Awaited<ReturnType<typeof startFacilitator>>;
beforeAll(async () => {
	facilitator = await startFacilitator();
});
afterAll(() => facilitator.close());
afterEach(() => {
	vi.restoreAllMocks();
});

/** Runs a proxy on one request, and returns its response and what it handed to `waitUntil`. */
async function send(proxy: ReturnType<typeof fairtoll>, path: string, headers: Record<string, string> = {}) {
	const waited: Promise<unknown>[] = [];
	const event = { waitUntil: (promise: Promise<unknown>) => void waited.push(promise) } as unknown as NextFetchEvent;
	const response = await proxy(new NextRequest(`http://example.com${path}`, { headers: { "user-agent": gptBot, ...headers } }), event);
	return { response, waited };
}

/** NextResponse.next() marks a response that carries on to the page with this header. */
const passedOn = (response: Response) => response.headers.get("x-middleware-next") === "1";

test("a reader is passed on to the page", async () => {
	const { response } = await send(fairtoll({ ai: "block" }), "/articles/1", { "user-agent": chrome });
	expect(passedOn(response)).toBe(true);
	expect(answered(response)).toBe(false);
});

test("a blocked AI crawler gets a 403 that a shared cache won't replay", async () => {
	const { response } = await send(fairtoll({ ai: "block" }), "/articles/1");
	expect(passedOn(response)).toBe(false);
	expect(answered(response)).toBe(true);
	expect(response.status).toBe(403);
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(await response.text()).toBe("This site does not allow AI bots or agents.\n");
});

test("without the event, a blocked AI crawler is still blocked", async () => {
	const response = await fairtoll({ ai: "block" }, { log: () => {} })(new NextRequest("http://example.com/articles/1", { headers: { "user-agent": gptBot } }));
	expect(response.status).toBe(403);
});

test("rules match the path Next routes by", async () => {
	const proxy = fairtoll({ ai: "allow", rules: [{ path: "/private/*", ai: "block" }] });
	expect((await send(proxy, "/private/1")).response.status).toBe(403);
	expect(passedOn((await send(proxy, "/public/1")).response)).toBe(true);
});

test("the log is handed to waitUntil, so it is written after the response is sent", async () => {
	const events: DecisionEvent[] = [];
	let finish = () => {};
	const log = (event: DecisionEvent) =>
		new Promise<void>((resolve) => {
			finish = () => {
				events.push(event);
				resolve();
			};
		});
	const { response, waited } = await send(fairtoll({}, { log }), "/articles/1");
	expect(passedOn(response)).toBe(true);
	expect(waited).toHaveLength(1);
	expect(events).toEqual([]);
	finish();
	await waited[0];
	expect(events).toEqual([expect.objectContaining({ path: "/articles/1", action: "allow" })]);
});

describe("charging", () => {
	test("an unpaid AI crawler gets a 402 with the price, and a paid one is passed on with the receipt", async () => {
		const proxy = fairtoll(charging, { facilitator: { url: facilitator.url } });
		const quote = (await send(proxy, "/articles/1")).response;
		expect(quote.status).toBe(402);
		expect(answered(quote)).toBe(true);
		expect(quote.headers.get("cache-control")).toBe("no-store");
		const payment = await createPayer().sign(quote.headers.get("payment-required")!);
		const paid = (await send(proxy, "/articles/1", { "payment-signature": payment })).response;
		expect(passedOn(paid)).toBe(true);
		expect(answered(paid)).toBe(false);
		expect(JSON.parse(atob(paid.headers.get("payment-response")!))).toMatchObject({ success: true });
		expect(paid.headers.get("cache-control")).toBe("private");
	});

	test("if the facilitator can't be reached, the request is passed on and the error reported", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const { response } = await send(fairtoll(charging, { facilitator: { url: "http://localhost:1" } }), "/articles/1");
		expect(passedOn(response)).toBe(true);
		expect(answered(response)).toBe(false);
		expect(error).toHaveBeenCalledWith(expect.stringMatching(/passed on without payment/), expect.anything());
	});
});

test("an invalid config is reported when the proxy loads, and every request is then passed on", async () => {
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	const proxy = fairtoll({ ai: "nope" });
	expect(error).toHaveBeenCalledWith(expect.stringMatching(/blocking and charging are off/), expect.objectContaining({ message: expect.stringMatching(/ai must be/) }));
	const { response } = await send(proxy, "/articles/1");
	expect(passedOn(response)).toBe(true);
	expect(answered(response)).toBe(false);
});

test("answered() is false for a 403 that Fairtoll didn't make", () => {
	expect(answered(new Response("Forbidden", { status: 403 }))).toBe(false);
});
