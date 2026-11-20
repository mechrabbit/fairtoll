import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createCharger, httpAdapter, startOnce, withDeadline, type ChargeOutcome } from "../../src/core/charge.js";
import type { Charge } from "../../src/core/config.js";
import { createPayer, startFacilitator } from "./facilitator.js";

const gptBot = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";
const wallet = "0x00000000000000000000000000000000000000aa";
const charging: Charge = { price: "0.002", payTo: wallet, network: "base-sepolia" };

let facilitator: Awaited<ReturnType<typeof startFacilitator>>;
beforeAll(async () => {
	facilitator = await startFacilitator();
});
afterAll(() => facilitator.close());
afterEach(() => {
	vi.restoreAllMocks();
	facilitator.settled.length = 0;
});

/** A charger on the stub facilitator, and a function that charges a bot's request with it. */
function charger(config: Charge = charging, url = facilitator.url) {
	const charge = createCharger(config, { url });
	return (init: { method?: string; payment?: string } = {}) =>
		charge(
			new Request("http://localhost/", { headers: { "user-agent": gptBot, ...(init.payment ? { "payment-signature": init.payment } : {}) } }),
			init.method ?? "GET",
			"/articles/1",
		);
}

/** The PAYMENT-SIGNATURE for the price in a 402. */
function pay(outcome: ChargeOutcome) {
	return createPayer().sign(outcome.headers["PAYMENT-REQUIRED"]!);
}

test("an unpaid request gets a 402 with the price, which a shared cache must not keep", async () => {
	const outcome = await charger()();
	expect(outcome).toMatchObject({ kind: "respond", status: 402, headers: { "Cache-Control": "no-store" }, payment: "none" });
	const [accepted] = createPayer().decode(outcome.headers["PAYMENT-REQUIRED"]!).accepts;
	expect(accepted).toMatchObject({ scheme: "exact", network: "eip155:84532", amount: "2000", payTo: wallet });
});

test("a paid request settles once, and its receipt is private", async () => {
	const charge = charger();
	const outcome = await charge({ payment: await pay(await charge()) });
	expect(outcome.kind).toBe("paid");
	expect(JSON.parse(atob(outcome.headers["PAYMENT-RESPONSE"]!))).toMatchObject({ success: true, transaction: "0xstub1" });
	expect(outcome.headers["Cache-Control"]).toBe("private");
	expect(facilitator.settled).toHaveLength(1);
});

test("a payment used twice is paid only once", async () => {
	const charge = charger();
	const payment = await pay(await charge());
	expect((await charge({ payment })).kind).toBe("paid");
	expect(await charge({ payment })).toMatchObject({ kind: "respond", status: 402, payment: "rejected" });
});

test("a payment for a lower price gets a 402 and nothing settles", async () => {
	const payment = await pay(await charger({ ...charging, price: "0.001" })());
	expect(await charger()({ payment })).toMatchObject({ kind: "respond", status: 402 });
	expect(facilitator.settled).toEqual([]);
});

test("a forged payment gets a 402", async () => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
	expect(await charger()({ payment: "not-a-payment" })).toMatchObject({ kind: "respond", status: 402, payment: "rejected" });
});

test("a HEAD request gets the price and is never charged, even with a payment", async () => {
	const charge = charger();
	const payment = await pay(await charge());
	expect(await charge({ method: "HEAD", payment })).toMatchObject({ kind: "respond", status: 402, payment: "none" });
	expect(facilitator.settled).toEqual([]);
});

describe("when the facilitator fails", () => {
	test("if it can't be reached at the start, the charge rejects", async () => {
		await expect(charger(charging, "http://localhost:1")()).rejects.toThrow();
	});

	test("one start is shared by every request, so after a failed start the facilitator is left alone until the cool-down ends", async () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
		const realFetch = globalThis.fetch;
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
		const charge = charger();
		await expect(charge()).rejects.toThrow();
		const afterFirst = fetchSpy.mock.calls.length;
		await expect(charge()).rejects.toThrow(/failed to start/);
		expect(fetchSpy.mock.calls.length).toBe(afterFirst);
		fetchSpy.mockImplementation(realFetch);
		now.mockReturnValue(1_000_000 + 30_000);
		expect(await charge()).toMatchObject({ kind: "respond", status: 402 });
	});

	test("if it can't be reached while settling, the charge rejects", async () => {
		const charge = charger();
		const payment = await pay(await charge());
		const realFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
			String(input).endsWith("/settle") ? Promise.reject(new TypeError("fetch failed")) : realFetch(input, init),
		);
		await expect(charge({ payment })).rejects.toThrow(/could not be reached/);
	});

	test("if it answers settling with an error status, the bot gets a 402", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const charge = charger();
		const payment = await pay(await charge());
		const realFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
			String(input).endsWith("/settle") ? Promise.resolve(new Response("Internal error", { status: 500 })) : realFetch(input, init),
		);
		expect(await charge({ payment })).toMatchObject({ kind: "respond", status: 402 });
	});
});

test('charging on "base" without a facilitator URL throws', () => {
	expect(() => createCharger({ ...charging, network: "base" })).toThrow(/needs a facilitator URL/);
});

describe("startOnce", () => {
	test("starts once and shares the start with every call", async () => {
		const initialize = vi.fn(() => Promise.resolve());
		const start = startOnce(initialize);
		await Promise.all([start(), start()]);
		await start();
		expect(initialize).toHaveBeenCalledOnce();
	});

	test("after a failed start it rejects without trying for 30 seconds, then tries again", async () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
		const down = new Error("down");
		const initialize = vi.fn((): Promise<void> => Promise.reject(down));
		const start = startOnce(initialize);
		await expect(start()).rejects.toBe(down);
		now.mockReturnValue(1_000_000 + 29_999);
		await expect(start()).rejects.toMatchObject({ cause: down });
		expect(initialize).toHaveBeenCalledOnce();
		initialize.mockImplementation(() => Promise.resolve());
		now.mockReturnValue(1_000_000 + 30_000);
		await expect(start()).resolves.toBeUndefined();
		expect(initialize).toHaveBeenCalledTimes(2);
	});
});

describe("withDeadline", () => {
	test("passes on a promise that settles in time", async () => {
		await expect(withDeadline(Promise.resolve("ok"), 1_000)).resolves.toBe("ok");
	});

	test("rejects once the deadline passes, so a facilitator that keeps retrying can't hold a request", async () => {
		vi.useFakeTimers();
		try {
			const late = withDeadline(new Promise(() => {}), 10_000);
			vi.advanceTimersByTime(10_000);
			await expect(late).rejects.toThrow(/within 10 seconds/);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("httpAdapter", () => {
	const request = new Request("http://localhost/", { headers: { "payment-signature": "paid", "user-agent": gptBot, accept: "text/html" } });

	test("passes the payment on, and names the resource by its path", () => {
		const adapter = httpAdapter(request, "GET", "/articles/1");
		expect(adapter.getHeader("PAYMENT-SIGNATURE")).toBe("paid");
		expect(adapter.getUrl()).toBe("/articles/1");
		expect(adapter.getUserAgent()).toBe(gptBot);
	});

	test("hides the payment on a HEAD request, and hides Accept so a bot never gets x402's paywall page", () => {
		const adapter = httpAdapter(request, "HEAD", "/articles/1");
		expect(adapter.getHeader("payment-signature")).toBeUndefined();
		expect(adapter.getAcceptHeader()).toBe("");
	});
});
