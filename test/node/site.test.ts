import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createGate } from "../../src/core/index.js";

const wallet = { payTo: `0x${"a".repeat(40)}`, network: "base-sepolia" } as const;
const site = { key: "site-key", url: "https://service.test/v1/config" };
const bot = () => new Request("https://example.com/", { headers: { "user-agent": "GPTBot/1.2" } });

/** What the stand-in service answers: a config to send as JSON, a status, or a thrown error. */
let answer: () => Response;
// Every other request is the charger asking the default facilitator what it supports.
const supported = { kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }], extensions: [], signers: {} };
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) =>
	url === site.url ? answer() : Response.json(supported),
);
const serves = (config: unknown) => () => Response.json(config);

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("fetch", fetchMock);
	vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	fetchMock.mockClear();
});

async function statusOf(gate: ReturnType<typeof createGate>): Promise<number | "pass"> {
	const { outcome, logged } = gate.check(bot(), "GET", "/");
	const result = await outcome;
	await logged;
	return result.kind === "respond" ? result.status : "pass";
}

test("the first request waits for the fetched config, sent with the site key", async () => {
	answer = serves({ ai: "block" });
	const gate = createGate(wallet, { site });
	expect(await statusOf(gate)).toBe(403);
	expect(fetchMock).toHaveBeenCalledOnce();
	const [url, init] = fetchMock.mock.calls[0] ?? [];
	expect(url).toBe(site.url);
	expect(new Headers(init?.headers).get("authorization")).toBe("Bearer site-key");
});

test("the fetched config charges to the wallet in the publisher's own config", async () => {
	answer = serves({ ai: "charge", price: "0.01" });
	const gate = createGate(wallet, { site });
	const { outcome } = gate.check(bot(), "GET", "/");
	const result = await outcome;
	expect(result).toMatchObject({ kind: "respond", status: 402 });
	const required = JSON.parse(atob((result as { headers: Record<string, string> }).headers["PAYMENT-REQUIRED"] ?? ""));
	expect(required.accepts[0]).toMatchObject({ payTo: wallet.payTo, amount: "10000" });
});

test("a fetched config that sets payTo or network is refused, and the local config is kept", async () => {
	answer = serves({ ai: "block", payTo: `0x${"b".repeat(40)}` });
	const gate = createGate({ ...wallet, ai: "block", rules: [{ path: "/free", ai: "allow" }] }, { site });
	expect(await statusOf(gate)).toBe(403);
	expect(console.error).toHaveBeenCalledWith(expect.stringContaining("could not load the config"), expect.objectContaining({ message: expect.stringContaining("payTo or network") }));
});

test("the config is fetched again after a minute, and a change applies without a restart", async () => {
	answer = serves({ ai: "block" });
	const gate = createGate(wallet, { site });
	expect(await statusOf(gate)).toBe(403);

	answer = serves({});
	expect(await statusOf(gate)).toBe(403);
	expect(fetchMock).toHaveBeenCalledOnce();

	vi.advanceTimersByTime(60_000);
	// The request that starts the fetch is served on the config already loaded, and the next one on the new one.
	expect(await statusOf(gate)).toBe(403);
	expect(await statusOf(gate)).toBe("pass");
	expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("when the service is down, pages load on the local config, then on the last config fetched", async () => {
	answer = () => {
		throw new TypeError("fetch failed");
	};
	const gate = createGate({ ...wallet, ai: "block" }, { site });
	expect(await statusOf(gate)).toBe(403);
	expect(console.error).toHaveBeenCalledOnce();

	vi.advanceTimersByTime(60_000);
	answer = serves({});
	await statusOf(gate);
	expect(await statusOf(gate)).toBe("pass");

	vi.advanceTimersByTime(60_000);
	answer = () => new Response("unavailable", { status: 503 });
	await statusOf(gate);
	expect(await statusOf(gate)).toBe("pass");
	expect(console.error).toHaveBeenCalledTimes(2);
});

test("an invalid fetched config keeps the last one", async () => {
	answer = serves({ ai: "block" });
	const gate = createGate(wallet, { site });
	expect(await statusOf(gate)).toBe(403);

	vi.advanceTimersByTime(60_000);
	answer = serves({ ai: "sometimes" });
	await statusOf(gate);
	expect(await statusOf(gate)).toBe(403);
	expect(console.error).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ message: expect.stringContaining('ai must be "allow"') }));
});

test("the first request waits at most a second, then uses the local config", async () => {
	fetchMock.mockImplementationOnce(() => new Promise(() => {}));
	const gate = createGate({ ...wallet, ai: "block" }, { site });
	const { outcome } = gate.check(new Request("https://example.com/"), "GET", "/");
	const pending = gate.check(bot(), "GET", "/").outcome;
	await vi.advanceTimersByTimeAsync(1_000);
	expect(await pending).toMatchObject({ kind: "respond", status: 403 });
	expect(await outcome).toMatchObject({ kind: "pass" });
	expect(fetchMock).toHaveBeenCalledOnce();
});

test("a request a second after the first fetch started doesn't wait for it", async () => {
	fetchMock.mockImplementationOnce(() => new Promise(() => {}));
	const gate = createGate({ ...wallet, ai: "block" }, { site });
	const first = gate.check(bot(), "GET", "/").outcome;
	await vi.advanceTimersByTimeAsync(1_000);
	expect(await first).toMatchObject({ kind: "respond", status: 403 });
	expect(await gate.check(bot(), "GET", "/").outcome).toMatchObject({ kind: "respond", status: 403 });
});

test("an invalid site option or local config throws at startup", () => {
	expect(() => createGate(wallet, { site: { key: "" } })).toThrow("site.key must be a non-empty string");
	expect(() => createGate(wallet, { site: { key: "k", url: "localhost:8080" } })).toThrow("site.url must be an http or https url");
	expect(() => createGate({ ai: "sometimes" }, { site })).toThrow("Invalid fairtoll config");
	expect(fetchMock).not.toHaveBeenCalled();
});
