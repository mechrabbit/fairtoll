import { describe, expect, test } from "vitest";
import { parseConfig, parsePrice, type Config } from "../../src/core/index.js";

const wallet = "0x1111111111111111111111111111111111111111";
const allow = { kind: "allow" };
const block = { kind: "block" };
const charge = (microUsd: bigint) => ({ kind: "charge", price: { microUsd } });

function parsed(input: unknown): Config {
	const result = parseConfig(input);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.config;
}

function fields(input: unknown): string[] {
	const result = parseConfig(input);
	if (result.ok) throw new Error("expected errors");
	return result.errors.map((e) => e.field);
}

describe("the four rollout steps parse", () => {
	test("1. observe: an empty config has no rules, so every request is allowed", () => {
		expect(parsed({})).toEqual({ rules: [] });
	});

	test("2. block unverified bots", () => {
		expect(parsed({ rules: [{ path: "/*", actions: { unverifiedBot: "block" } }] })).toEqual({
			rules: [
				{ path: "/*", actions: { human: allow, verifiedAiBuyer: allow, unverifiedBot: block } },
			],
		});
	});

	test("3. charge on a few paths", () => {
		const config = parsed({
			payment: { payTo: wallet, network: "eip155:84532" },
			rules: [
				{
					path: "/articles/*",
					actions: { unverifiedBot: "block", verifiedAiBuyer: { charge: "0.002" } },
				},
				{ path: "/*", actions: { unverifiedBot: "block" } },
			],
		});
		expect(config.payment).toEqual({ payTo: wallet, network: "eip155:84532" });
		expect(config.rules[0]?.actions).toEqual({
			human: allow,
			verifiedAiBuyer: charge(2000n),
			unverifiedBot: block,
		});
		expect(config.rules[1]?.path).toBe("/*");
	});

	test("4. full policy", () => {
		const config = parsed({
			payment: { payTo: wallet, network: "eip155:8453" },
			rules: [
				{ path: "/about", actions: {} },
				{
					path: "/reports/*",
					actions: { human: { charge: "1.5" }, verifiedAiBuyer: { charge: "1.5" }, unverifiedBot: { charge: "5" } },
				},
				{
					path: "/*",
					actions: { verifiedAiBuyer: "requireLicense", unverifiedBot: { charge: "0.01" } },
				},
			],
		});
		expect(config.rules.map((r) => r.path)).toEqual(["/about", "/reports/*", "/*"]);
		expect(config.rules[1]?.actions.verifiedAiBuyer).toEqual(charge(1_500_000n));
		expect(config.rules[1]?.actions.unverifiedBot).toEqual(charge(5_000_000n));
		expect(config.rules[2]?.actions.verifiedAiBuyer).toEqual({ kind: "requireLicense" });
		expect(config.rules[2]?.actions.unverifiedBot).toEqual(charge(10_000n));
	});

	test("a wallet with no charging rule is valid, so charging turns off without losing it", () => {
		expect(parsed({ payment: { payTo: wallet, network: "eip155:84532" } }).rules).toEqual([]);
	});
});

describe("invalid configs are rejected with the failing field", () => {
	const paidRule = (actions: unknown) => ({
		payment: { payTo: wallet, network: "eip155:84532" },
		rules: [{ path: "/*", actions }],
	});

	test.each([
		["not an object", "rules", ["config"]],
		["a misspelled top-level field", { rule: [] }, ["rule"]],
		["rules that are not an array", { rules: {} }, ["rules"]],
		["actions set to null", { rules: [{ path: "/", actions: null }] }, ["rules[0].actions"]],
		["a path without a leading slash", { rules: [{ path: "articles" }] }, ["rules[0].path"]],
		["a * before the end of a path", { rules: [{ path: "/*/x" }] }, ["rules[0].path"]],
		["an unknown class", { rules: [{ path: "/", actions: { robot: "block" } }] }, ["rules[0].actions.robot"]],
		["an unknown action", { rules: [{ path: "/", actions: { human: "deny" } }] }, ["rules[0].actions.human"]],
		["charge without a price", paidRule({ verifiedAiBuyer: "charge" }), ["rules[0].actions.verifiedAiBuyer"]],
		["a price as a number", paidRule({ verifiedAiBuyer: { charge: 0.002 } }), ["rules[0].actions.verifiedAiBuyer.charge"]],
		["a price of zero", paidRule({ verifiedAiBuyer: { charge: "0" } }), ["rules[0].actions.verifiedAiBuyer.charge"]],
		["a negative price", paidRule({ verifiedAiBuyer: { charge: "-1" } }), ["rules[0].actions.verifiedAiBuyer.charge"]],
		[
			"a price below one micro-USD",
			paidRule({ verifiedAiBuyer: { charge: "0.0000004" } }),
			["rules[0].actions.verifiedAiBuyer.charge"],
		],
		["a charging rule with no payment", { rules: [{ path: "/", actions: { human: { charge: "1" } } }] }, ["payment"]],
		[
			"an action for paying agents, which always pay their own class's price",
			paidRule({ verifiedAiBuyer: { charge: "1" }, payingAgent: "allow" }),
			["rules[0].actions.payingAgent"],
		],
		["a wallet address that is not an address", { payment: { payTo: "me", network: "eip155:8453" } }, ["payment.payTo"]],
		["an unsupported network", { payment: { payTo: wallet, network: "solana" } }, ["payment.network"]],
		[
			"a private key in the config",
			{ payment: { payTo: wallet, network: "eip155:8453", privateKey: "0xabc" } },
			["payment.privateKey"],
		],
	])("%s", (_, input, expected) => {
		expect(fields(input)).toEqual(expected);
	});

	test("every error is reported, not only the first", () => {
		expect(fields({ rules: [{ path: "x", actions: { human: "deny" } }], extra: 1 })).toEqual([
			"extra",
			"rules[0].path",
			"rules[0].actions.human",
		]);
	});
});

describe("parsePrice", () => {
	test.each([
		["0.002", 2000n],
		["1", 1_000_000n],
		["12.345678", 12_345_678n],
		["0.000001", 1n],
	])("%s is %i micro-USD", (text, microUsd) => {
		expect(parsePrice(text)).toEqual({ microUsd });
	});

	test.each(["", "0", "0.000000", ".5", "1.", "01", "1e-3", "$1", "1.0000001", " 1"])("rejects %j", (text) => {
		expect(parsePrice(text)).toBeUndefined();
	});
});
