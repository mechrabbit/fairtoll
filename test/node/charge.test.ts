import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { DecisionEvent } from "../../src/core/index.js";
import { fairtoll, type Options } from "../../src/express/index.js";
import { createPayer, startFacilitator } from "./facilitator.js";

const gptBot = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";
const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const wallet = "0x00000000000000000000000000000000000000aa";
const charging = { ai: "charge", price: "0.002", payTo: wallet, network: "base-sepolia" };

let facilitator: Awaited<ReturnType<typeof startFacilitator>>;
beforeAll(async () => {
	facilitator = await startFacilitator();
});
afterAll(() => facilitator.close());
afterEach(() => {
	vi.restoreAllMocks();
	facilitator.settled.length = 0;
});

/** Serves a site behind Fairtoll, and returns a function that sends it a request. */
async function site(config: unknown, options: Options = { facilitator: { url: facilitator.url } }) {
	const app = express();
	app.use(fairtoll(config, options));
	app.get("/robots.txt", (_req, res) => res.type("text/plain").send("User-agent: *\nAllow: /\n"));
	app.post("/comments", express.text(), (req, res) => res.status(201).send(`Comment: ${req.body}\n`));
	app.all("/articles/:id", (req, res) => res.status(req.method === "POST" ? 201 : 200).send(`Article ${req.params.id}\n`));
	const server = app.listen(0);
	await new Promise((resolve) => server.once("listening", resolve));
	const port = (server.address() as AddressInfo).port;
	return {
		send: (path: string, init: { method?: string; userAgent?: string; payment?: string; body?: string; preflight?: boolean } = {}) =>
			fetch(`http://localhost:${port}${path}`, {
				method: init.method ?? "GET",
				headers: {
					"user-agent": init.userAgent ?? gptBot,
					...(init.payment ? { "payment-signature": init.payment } : {}),
					...(init.preflight ? { "access-control-request-method": "POST" } : {}),
					...(init.body ? { "content-type": "text/plain" } : {}),
				},
				...(init.body ? { body: init.body } : {}),
			}),
		close: () => server.close(),
	};
}

describe("charging AI", () => {
	test("an AI crawler without payment gets a 402 with the price, and the app never runs", async () => {
		const { send, close } = await site(charging);
		try {
			const response = await send("/articles/1");
			expect(response.status).toBe(402);
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(await response.text()).not.toMatch(/Article/);
			const [accepted] = createPayer().decode(response.headers.get("payment-required")!).accepts;
			expect(accepted).toMatchObject({ scheme: "exact", network: "eip155:84532", amount: "2000", payTo: wallet });
		} finally {
			close();
		}
	});

	test("a paid request settles once and then gets the page, with the transaction in PAYMENT-RESPONSE", async () => {
		const { send, close } = await site(charging);
		try {
			const quote = await send("/articles/1");
			const payment = await createPayer().sign(quote.headers.get("payment-required")!);
			const paid = await send("/articles/1", { payment });
			expect(paid.status).toBe(200);
			expect(await paid.text()).toBe("Article 1\n");
			expect(JSON.parse(atob(paid.headers.get("payment-response")!))).toMatchObject({ success: true, transaction: "0xstub1" });
			expect(facilitator.settled).toHaveLength(1);
		} finally {
			close();
		}
	});

	test("a payment used twice gets the page only once", async () => {
		const { send, close } = await site(charging);
		try {
			const payment = await createPayer().sign((await send("/articles/1")).headers.get("payment-required")!);
			expect((await send("/articles/1", { payment })).status).toBe(200);
			const reused = await send("/articles/1", { payment });
			expect(reused.status).toBe(402);
			expect(await reused.text()).not.toMatch(/Article/);
		} finally {
			close();
		}
	});

	test("a payment for a lower price gets a 402 and nothing settles", async () => {
		const cheap = await site({ ...charging, price: "0.001" });
		const { send, close } = await site(charging);
		try {
			const payment = await createPayer().sign((await cheap.send("/articles/1")).headers.get("payment-required")!);
			expect((await send("/articles/1", { payment })).status).toBe(402);
			expect(facilitator.settled).toEqual([]);
		} finally {
			cheap.close();
			close();
		}
	});

	test("a forged payment header gets a 402", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const { send, close } = await site(charging);
		try {
			expect((await send("/articles/1", { payment: "not-a-payment" })).status).toBe(402);
		} finally {
			close();
		}
	});

	test("a HEAD request gets the price and is never charged, even with a payment", async () => {
		const { send, close } = await site(charging);
		try {
			const payment = await createPayer().sign((await send("/articles/1")).headers.get("payment-required")!);
			const head = await send("/articles/1", { method: "HEAD", payment });
			expect(head.status).toBe(402);
			expect(head.headers.get("payment-required")).toBeTruthy();
			expect(facilitator.settled).toEqual([]);
		} finally {
			close();
		}
	});

	test.each([
		["a reader", "/articles/1", { userAgent: chrome }, 200],
		["an AI crawler's CORS preflight", "/articles/1", { method: "OPTIONS", preflight: true }, 200],
		["an AI crawler reading /robots.txt", "/robots.txt", {}, 200],
	])("lets %s through without charging", async (_name, path, init, status) => {
		const { send, close } = await site(charging);
		try {
			const response = await send(path, init);
			expect(response.status).toBe(status);
			expect(response.headers.get("payment-required")).toBeNull();
		} finally {
			close();
		}
	});

	test("a charged request is logged with action charge", async () => {
		const events: DecisionEvent[] = [];
		const { send, close } = await site(charging, { facilitator: { url: facilitator.url }, log: (event) => void events.push(event) });
		try {
			await send("/articles/1");
			expect(events).toEqual([expect.objectContaining({ path: "/articles/1", class: "unverifiedBot", action: "charge" })]);
		} finally {
			close();
		}
	});
});

test.each(["POST", "PUT", "DELETE", "PATCH", "OPTIONS"])("an AI crawler's %s is charged too, so a page served for any method isn't free", async (method) => {
	const { send, close } = await site(charging);
	try {
		const response = await send("/articles/1", { method });
		expect(response.status).toBe(402);
		expect(await response.text()).not.toMatch(/Article/);
	} finally {
		close();
	}
});

test("a paid POST reaches the app with its body", async () => {
	const { send, close } = await site(charging);
	try {
		const unpaid = await send("/comments", { method: "POST", body: "hello" });
		expect(unpaid.status).toBe(402);
		const payment = await createPayer().sign(unpaid.headers.get("payment-required")!);
		const paid = await send("/comments", { method: "POST", body: "hello", payment });
		expect(paid.status).toBe(201);
		expect(await paid.text()).toBe("Comment: hello\n");
		expect(facilitator.settled).toHaveLength(1);
	} finally {
		close();
	}
});

test("a paid page is marked private, so a shared cache doesn't replay the payer's receipt", async () => {
	const { send, close } = await site(charging);
	try {
		const payment = await createPayer().sign((await send("/articles/1")).headers.get("payment-required")!);
		expect((await send("/articles/1", { payment })).headers.get("cache-control")).toBe("private");
	} finally {
		close();
	}
});

describe("when the facilitator fails", () => {
	test("if it can't be reached, the request reaches the app and the error is reported", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const { send, close } = await site(charging, { facilitator: { url: "http://localhost:1" } });
		try {
			const response = await send("/articles/1");
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("Article 1\n");
			expect(error).toHaveBeenCalledWith(expect.stringMatching(/passed on without payment/), expect.anything());
			expect((await send("/comments", { method: "POST", body: "hello" })).status).toBe(201);
		} finally {
			close();
		}
	});

	test("after a failed start it is left alone for 30 seconds, then used again once it's back", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
		const realFetch = globalThis.fetch;
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
			String(input).startsWith(facilitator.url) ? Promise.reject(new TypeError("fetch failed")) : realFetch(input, init),
		);
		const { send, close } = await site(charging);
		const facilitatorCalls = () => fetchSpy.mock.calls.filter(([input]) => String(input).startsWith(facilitator.url)).length;
		try {
			expect((await send("/articles/1")).status).toBe(200);
			const afterFirst = facilitatorCalls();
			expect((await send("/articles/1")).status).toBe(200);
			expect(facilitatorCalls()).toBe(afterFirst);
			fetchSpy.mockImplementation(realFetch);
			now.mockReturnValue(1_000_000 + 30_000);
			expect((await send("/articles/1")).status).toBe(402);
		} finally {
			close();
		}
	});

	test("if it can't be reached while settling, the page is served", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const { send, close } = await site(charging);
		try {
			const payment = await createPayer().sign((await send("/articles/1")).headers.get("payment-required")!);
			const fetchOnce = globalThis.fetch;
			vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
				String(input).endsWith("/settle") ? Promise.reject(new TypeError("fetch failed")) : fetchOnce(input, init),
			);
			const response = await send("/articles/1", { payment });
			expect(response.status).toBe(200);
			expect(error).toHaveBeenCalledOnce();
		} finally {
			close();
		}
	});

	test("if it answers settling with an error status, the bot gets a 402, not the page", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { send, close } = await site(charging);
		try {
			const payment = await createPayer().sign((await send("/articles/1")).headers.get("payment-required")!);
			const fetchOnce = globalThis.fetch;
			vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
				String(input).endsWith("/settle") ? Promise.resolve(new Response("Internal error", { status: 500 })) : fetchOnce(input, init),
			);
			expect((await send("/articles/1", { payment })).status).toBe(402);
		} finally {
			close();
		}
	});
});

describe("setting up charging", () => {
	test('charging on "base" without a facilitator throws at startup', () => {
		expect(() => fairtoll({ ...charging, network: "base" })).toThrow(/needs a facilitator URL/);
	});

	test.each([
		["a string", "https://facilitator.example"],
		["an object without a url", {}],
		["an empty url", { url: "" }],
		["a url without a scheme", { url: "facilitator.example" }],
	])("a facilitator given as %s throws at startup", (_name, facilitator) => {
		expect(() => fairtoll(charging, { facilitator: facilitator as never })).toThrow(/facilitator must be an object with a url/);
	});

	test("an invalid charge config throws at startup, naming the field", () => {
		expect(() => fairtoll({ ...charging, price: "0.0000001" })).toThrow(/price/);
	});
});
