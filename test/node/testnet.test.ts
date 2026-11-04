import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createCharger } from "../../src/core/charge.js";
import { runTestnet, testnetAgent } from "../../src/cli/testnet.js";
import { startFacilitator } from "./facilitator.js";

const payTo = "0x00000000000000000000000000000000000000aa";
const charging = { ai: "charge", price: "0.002", payTo, network: "base-sepolia" };

let facilitator: Awaited<ReturnType<typeof startFacilitator>>;
beforeAll(async () => {
	facilitator = await startFacilitator();
});
afterAll(() => facilitator.close());
afterEach(() => {
	vi.restoreAllMocks();
	facilitator.settled.length = 0;
});

/** A testnet run of `config` on the stub facilitator, with a fresh wallet, and what it printed. */
async function run(config: unknown, key: string = generatePrivateKey(), url = facilitator.url) {
	const lines: string[] = [];
	const ok = await runTestnet(config, key, (line) => lines.push(line), url);
	return { ok, output: lines.join("\n") };
}

test("a paid request goes through every step, and settles once", async () => {
	const { ok, output } = await run(charging);
	expect(ok).toBe(true);
	expect(output.split("\n").filter((line) => line.startsWith("✓"))).toEqual([
		expect.stringMatching(/^✓ 402 received: \$0\.002 in USDC to 0x0+aa$/),
		expect.stringMatching(/^✓ payment sent: /),
		"✓ payment verified by the facilitator",
		expect.stringMatching(/^✓ settled in \d+\.\d seconds: https:\/\/sepolia\.basescan\.org\/tx\/0xstub1$/),
		"✓ page served: Fairtoll passed the paid request on to the site",
	]);
	expect(facilitator.settled).toHaveLength(1);
});

test("it pays for a path a rule charges, and skips one a more specific rule allows", async () => {
	const { ok, output } = await run({
		payTo,
		network: "base-sepolia",
		price: "0.01",
		rules: [
			{ path: "/premium", ai: "allow" },
			{ path: "/premium/*", ai: "charge" },
		],
	});
	expect(ok).toBe(true);
	expect(output).toContain("Paying for /premium/fairtoll-testnet on Base Sepolia");
});

test("it pays for an exact rule whose path has a percent sign", async () => {
	const { ok, output } = await run({ payTo, network: "base-sepolia", rules: [{ path: "/a%2520b", ai: "charge", price: "0.05" }] });
	expect(ok).toBe(true);
	expect(output).toContain("✓ 402 received: $0.05 in USDC");
});

describe("it can't move mainnet funds", () => {
	test('a config that charges on "base" is run on Base Sepolia', async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const { ok, output } = await run({ ...charging, network: "base" });
		expect(ok).toBe(true);
		expect(output).toContain('The config charges on "base". This run charges on "base-sepolia" instead.');
		const settle = fetchSpy.mock.calls.find(([url]) => String(url).endsWith("/settle"));
		expect(JSON.parse(String(settle![1]!.body)).paymentRequirements.network).toBe("eip155:84532");
	});

	test("the wallet refuses to sign a payment on Base mainnet", async () => {
		const mainnet = await startFacilitator("eip155:8453");
		try {
			const unpaid = await createCharger({ price: "0.002", payTo, network: "base" }, { url: mainnet.url })(new Request("http://localhost/"), "GET", "/");
			const agent = testnetAgent(privateKeyToAccount(generatePrivateKey()));
			const required = agent.getPaymentRequiredResponse((name) => (name === "PAYMENT-REQUIRED" ? unpaid.headers["PAYMENT-REQUIRED"]! : null));
			expect(required.accepts[0]!.network).toBe("eip155:8453");
			await expect(agent.createPaymentPayload(required)).rejects.toThrow();
		} finally {
			await mainnet.close();
		}
	});
});

describe("when a step fails, it names the step and the reason", () => {
	// x402 returns a rejection that comes with a 200, and throws one that comes with an error status.
	test.each([200, 400])("a wallet with no test USDC fails verification with a %i, says where to get some, and nothing settles", async (status) => {
		const realFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
			String(input).endsWith("/verify")
				? Promise.resolve(Response.json({ isValid: false, invalidReason: "insufficient_funds", payer: payTo }, { status }))
				: realFetch(input, init),
		);
		const { ok, output } = await run(charging);
		expect(ok).toBe(false);
		expect(output).toMatch(/✗ payment verified failed: the facilitator rejected the payment: insufficient_funds/);
		expect(output).toContain("https://faucet.circle.com");
		expect(facilitator.settled).toEqual([]);
	});

	test("a facilitator that can't be reached fails the first step", async () => {
		const { ok, output } = await run(charging, undefined, "http://localhost:1");
		expect(ok).toBe(false);
		expect(output).toMatch(/✗ 402 received failed: the facilitator could not be reached/);
	});

	test("a settlement the facilitator rejects fails the settled step with its reason, without the facilitator's error dump", async () => {
		// Shortened from what x402.org answered on a real run, which passes on viem's whole error.
		const errorMessage = [
			"Missing or invalid parameters.",
			"Double check you have provided the correct parameters.",
			"",
			"URL: https://sepolia.base.org",
			'Request body: {"method":"eth_sendRawTransaction","params":["0x02f9"]}',
			"Docs: https://viem.sh/docs/contract/writeContract",
			"Details: replacement transaction underpriced",
			"Version: viem@2.48.11",
		].join("\n");
		const realFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
			String(input).endsWith("/settle")
				? Promise.resolve(
						Response.json({ success: false, errorReason: "invalid_exact_evm_transaction_failed", errorMessage, transaction: "", network: "eip155:84532" }),
					)
				: realFetch(input, init),
		);
		const { ok, output } = await run(charging);
		expect(ok).toBe(false);
		expect(output.split("\n").at(-1)).toBe(
			"✗ settled failed: the facilitator did not settle the payment: invalid_exact_evm_transaction_failed: replacement transaction underpriced",
		);
	});
});

describe("it stops before paying", () => {
	test("on an invalid config", async () => {
		expect(await run({ ai: "charge" })).toMatchObject({ ok: false, output: expect.stringContaining("payTo is needed") });
	});

	test("on a config that charges nothing", async () => {
		expect(await run({})).toMatchObject({ ok: false, output: expect.stringContaining("charges no path") });
	});

	test.each(["not-a-key", `0x${"0".repeat(64)}`])("on a key that isn't a private key: %s", async (key) => {
		expect(await run(charging, key)).toMatchObject({ ok: false, output: expect.stringContaining("FAIRTOLL_TESTNET_KEY must be") });
	});
});
