import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { VerifyError } from "@x402/core/types";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { createCharger } from "../core/charge.js";
import { networks, parseConfig, type Charge, type Config } from "../core/config.js";
import { screen } from "../core/screen.js";

/** x402.org's facilitator, which settles only on testnets. */
export const testFacilitatorUrl = "https://x402.org/facilitator";

/** Base Sepolia, the only network a testnet run pays on. */
const testnet = networks["base-sepolia"];

/** The user-agent the paying agent sends, which Fairtoll classifies as an AI agent. */
const agentUserAgent = "Fairtoll-Testnet/1 (paying agent; compatible; ChatGPT-User/1.0)";

/** As long as the charger waits for the facilitator, rather than x402's default of 90 seconds. */
const verifyTimeoutMs = 10_000;

/**
 * Runs the publisher's config on Base Sepolia and pays for one charged page with the test wallet whose
 * private key is `key`, printing each step: 402 received, payment sent, payment verified, settled, page
 * served. It returns false at the first step that fails, after printing the step and the reason.
 *
 * It can't move mainnet funds whatever the config or key: the config's network is replaced with Base Sepolia,
 * and the wallet only signs for Base Sepolia, so a request for any other network is refused before signing.
 * The key is only held in memory for the run.
 *
 * `facilitatorUrl` is for tests. The CLI always uses x402.org's.
 */
export async function runTestnet(input: unknown, key: string, print: (line: string) => void, facilitatorUrl = testFacilitatorUrl): Promise<boolean> {
	const parsed = parseConfig(input);
	if (!parsed.ok) {
		print(`The config is invalid:\n${parsed.errors.map((e) => `  ${e.field} ${e.message}`).join("\n")}`);
		return false;
	}
	let account;
	try {
		// viem refuses anything that isn't 0x and 64 hex digits, or is out of range for a private key, such as all zeros.
		account = privateKeyToAccount(key as `0x${string}`);
	} catch {
		print("FAIRTOLL_TESTNET_KEY must be a testnet wallet's private key: 0x and 64 hex digits.");
		return false;
	}
	// The input parsed, so it is a plain object, and replacing its network can't make it invalid.
	const written = input as Record<string, unknown>;
	const config = parseConfig({ ...written, network: "base-sepolia" });
	if (!config.ok) throw new Error("a valid config became invalid on Base Sepolia");
	const target = chargedPath(config.config);
	if (target === undefined) {
		print('The config charges no path, so there is nothing to pay for. Set ai to "charge", or add a rule that charges.');
		return false;
	}

	const agent = testnetAgent(account);
	const charger = createCharger(target.charge, { url: facilitatorUrl });
	const request = (payment: Record<string, string> = {}) => new Request("http://localhost/", { headers: { "user-agent": agentUserAgent, ...payment } });

	print(`Paying for ${target.path} on Base Sepolia from ${account.address}, through ${facilitatorUrl}`);
	if (written.network !== undefined && written.network !== "base-sepolia") {
		print(`  The config charges on ${JSON.stringify(written.network)}. This run charges on "base-sepolia" instead.`);
	}

	// 402 received
	let unpaid;
	try {
		unpaid = await charger(request(), "GET", target.path);
	} catch (error) {
		return failed(print, "402 received", `the facilitator could not be reached: ${messageOf(error)}`);
	}
	if (unpaid.kind !== "respond" || unpaid.status !== 402) return failed(print, "402 received", "Fairtoll did not answer the unpaid request with a 402");
	const required = agent.getPaymentRequiredResponse(headerReader(unpaid.headers));
	const [offer] = required.accepts;
	if (offer === undefined) return failed(print, "402 received", "the 402 offers no way to pay");
	print(`✓ 402 received: $${target.charge.price} in USDC to ${offer.payTo}`);

	// payment sent
	let payload;
	try {
		payload = await agent.createPaymentPayload(required);
	} catch (error) {
		return failed(print, "payment sent", `the wallet could not sign the payment: ${messageOf(error)}`);
	}
	print(`✓ payment sent: signed a transfer of ${offer.amount} millionths of a USDC from ${account.address}`);

	// payment verified. Fairtoll's upfront flow only settles, so the agent asks the facilitator to verify first,
	// which names a problem such as an empty wallet before anything is sent to the chain.
	let rejection: string | undefined;
	try {
		const verified = await new HTTPFacilitatorClient({ url: facilitatorUrl, timeoutMs: verifyTimeoutMs }).verify(payload, payload.accepted);
		if (!verified.isValid) rejection = [verified.invalidReason, verified.invalidMessage].filter(Boolean).join(": ") || "no reason given";
	} catch (error) {
		// x402 throws a rejection that comes with an error status, rather than returning it.
		if (!(error instanceof VerifyError)) return failed(print, "payment verified", `the facilitator could not verify the payment: ${messageOf(error)}`);
		rejection = error.message;
	}
	if (rejection !== undefined) {
		const hint = /insufficient|balance|funds/i.test(rejection) ? `\n  The wallet ${account.address} has too little test USDC. Get test USDC for Base Sepolia at https://faucet.circle.com, then run this again.` : "";
		return failed(print, "payment verified", `the facilitator rejected the payment: ${rejection}${hint}`);
	}
	print("✓ payment verified by the facilitator");

	// settled, and page served
	const signature = agent.encodePaymentSignatureHeader(payload);
	const started = Date.now();
	let paid;
	try {
		paid = await charger(request(signature), "GET", target.path);
	} catch (error) {
		const check = `Check https://sepolia.basescan.org/address/${account.address} before running this again, because the payment may still settle.`;
		return failed(print, "settled", `the facilitator did not answer: ${messageOf(error)}\n  ${check}`);
	}
	const seconds = ((Date.now() - started) / 1000).toFixed(1);
	if (paid.kind !== "paid") return failed(print, "settled", `the facilitator did not settle the payment: ${rejectionOf(agent, paid.headers)}`);
	const settlement = agent.getPaymentSettleResponse(headerReader(paid.headers));
	print(`✓ settled in ${seconds} seconds: https://sepolia.basescan.org/tx/${settlement.transaction}`);
	print("✓ page served: Fairtoll passed the paid request on to the site");
	return true;
}

/** A paying agent whose wallet only signs for Base Sepolia, so it refuses a 402 on any other network. */
export function testnetAgent(account: ReturnType<typeof privateKeyToAccount>): x402HTTPClient {
	return new x402HTTPClient(new x402Client().register(testnet, new ExactEvmScheme(toClientEvmSigner(account))));
}

/**
 * A path the config charges an AI agent for, and the charge. Each policy that charges gives one path to try:
 * a page under the top level, a rule's exact path, or a page under a rule's wildcard. The first that a
 * request would really be charged on wins, so a more specific rule that allows or blocks a path is respected.
 */
function chargedPath(config: Config): { path: string; charge: Charge } | undefined {
	const candidates = [config, ...config.rules].flatMap((policy) => {
		if (policy.ai !== "charge") return [];
		if (!("path" in policy)) return ["/fairtoll-testnet"];
		// A rule's path is stored decoded, and screen decodes the path it is given, so it is encoded once to match.
		return [encodeURI(policy.path.endsWith("/*") ? `${policy.path.slice(0, -1)}fairtoll-testnet` : policy.path)];
	});
	const request = new Request("http://localhost/", { headers: { "user-agent": agentUserAgent } });
	for (const path of candidates) {
		const action = screen(request, "GET", path, config);
		if (action.kind === "charge") return { path, charge: action.charge };
	}
	return undefined;
}

/** Why a paid request got a 402: the settlement's error, or the 402's own. */
function rejectionOf(agent: x402HTTPClient, headers: Record<string, string>): string {
	try {
		const settlement = agent.getPaymentSettleResponse(headerReader(headers));
		return [settlement.errorReason, settlement.errorMessage].filter(Boolean).join(": ") || "no reason given";
	} catch {
		return agent.getPaymentRequiredResponse(headerReader(headers)).error ?? "no reason given";
	}
}

function failed(print: (line: string) => void, step: string, reason: string): false {
	print(`✗ ${step} failed: ${reason}`);
	return false;
}

/** Reads a charge outcome's headers by name, whatever their case. */
function headerReader(headers: Record<string, string>): (name: string) => string | null {
	const read = new Headers(headers);
	return (name) => read.get(name);
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
