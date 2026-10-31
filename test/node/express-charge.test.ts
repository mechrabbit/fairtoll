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
const scopedOnBase = { price: "0.002", payTo: wallet, network: "base" };

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
	app.options("/articles/:id", (_req, res) => res.set("Access-Control-Allow-Methods", "GET, POST").sendStatus(204));
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

	test("a paid request gets the page, with the transaction in PAYMENT-RESPONSE and marked private", async () => {
		const { send, close } = await site(charging);
		try {
			const quote = await send("/articles/1");
			const payment = await createPayer().sign(quote.headers.get("payment-required")!);
			const paid = await send("/articles/1", { payment });
			expect(paid.status).toBe(200);
			expect(await paid.text()).toBe("Article 1\n");
			expect(JSON.parse(atob(paid.headers.get("payment-response")!))).toMatchObject({ success: true, transaction: "0xstub1" });
			expect(paid.headers.get("cache-control")).toBe("private");
			expect(facilitator.settled).toHaveLength(1);
		} finally {
			close();
		}
	});

	test.each([
		["a reader", "/articles/1", { userAgent: chrome }, 200],
		["an AI crawler's CORS preflight", "/articles/1", { method: "OPTIONS", preflight: true }, 204],
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

	test("if it rejects a payment, the app never runs", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const { send, close } = await site(charging);
		try {
			const rejected = await send("/articles/1", { payment: "not-a-payment" });
			expect(rejected.status).toBe(402);
			expect(await rejected.text()).not.toMatch(/Article/);
		} finally {
			close();
		}
	});
});

describe("charging and blocking on some paths", () => {
	const scoped = {
		price: "0.002",
		payTo: wallet,
		network: "base-sepolia",
		rules: [
			{ path: "/articles/*", ai: "charge", price: "0.01" },
			{ path: "/articles/9", ai: "charge" },
			{ path: "/comments", ai: "block" },
		],
	};

	test("each rule charges its own price, and a paid request on it gets the page", async () => {
		const { send, close } = await site(scoped);
		try {
			const quote = await send("/articles/1");
			expect(quote.status).toBe(402);
			expect(createPayer().decode(quote.headers.get("payment-required")!).accepts[0]).toMatchObject({ amount: "10000", payTo: wallet });
			const other = await send("/articles/9");
			expect(createPayer().decode(other.headers.get("payment-required")!).accepts[0]).toMatchObject({ amount: "2000" });
			const paid = await send("/articles/1", { payment: await createPayer().sign(quote.headers.get("payment-required")!) });
			expect(paid.status).toBe(200);
			expect(await paid.text()).toBe("Article 1\n");
		} finally {
			close();
		}
	});

	test.each([
		["allow", 404],
		["block", 403],
	])("a rule blocks its path, and with ai %s a path no rule matches gets %i", async (ai, status) => {
		const { send, close } = await site({ ...scoped, ai });
		try {
			expect((await send("/comments", { method: "POST", body: "hi" })).status).toBe(403);
			expect((await send("/other")).status).toBe(status);
		} finally {
			close();
		}
	});

	test("a reader and an AI crawler's CORS preflight on a charged path aren't charged", async () => {
		const { send, close } = await site(scoped);
		try {
			expect((await send("/articles/1", { userAgent: chrome })).status).toBe(200);
			expect((await send("/articles/1", { method: "OPTIONS", preflight: true })).status).toBe(204);
		} finally {
			close();
		}
	});

	test("a rule matches the page a request names, however its path is written", async () => {
		const { send, close } = await site(scoped);
		try {
			for (const path of ["/ARTICLES/1", "/%61rticles/1", "//articles/1"]) {
				expect((await send(path)).status, path).toBe(402);
			}
			// The app routes these under /articles, while resolving them would put them under /other.
			for (const path of ["/articles/1/..%2f..%2fother", "/articles/1%2f..%2f..%2fother"]) {
				expect((await send(path)).status, path).toBe(403);
			}
		} finally {
			close();
		}
	});
});

describe("setting up charging", () => {
	test('charging on "base" without a facilitator throws at startup', () => {
		expect(() => fairtoll({ ...charging, network: "base" })).toThrow(/needs a facilitator URL/);
		expect(() => fairtoll({ ...scopedOnBase, rules: [{ path: "/a/*", ai: "charge" }] })).toThrow(/needs a facilitator URL/);
	});

	test.each([
		["a string", "https://facilitator.example"],
		["an object without a url", {}],
		["an empty url", { url: "" }],
		["a url without a scheme", { url: "facilitator.example" }],
		["a host and port without a scheme", { url: "localhost:8080" }],
	])("a facilitator given as %s throws at startup", (_name, facilitator) => {
		expect(() => fairtoll(charging, { facilitator: facilitator as never })).toThrow(/facilitator must be an object with an http or https url/);
	});

	test("an invalid charge config throws at startup, naming the field", () => {
		expect(() => fairtoll({ ...charging, price: "0.0000001" })).toThrow(/price/);
	});
});
