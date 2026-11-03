import { describe, expect, test } from "vitest";
import { parseConfig } from "../../src/core/index.js";

const wallet = "0x00000000000000000000000000000000000000AA";
const charging = { ai: "charge", price: "0.002", payTo: wallet, network: "base-sepolia" };
const noRules = { exact: new Map(), under: new Map() };

describe("parseConfig", () => {
	test("an empty config parses to observe-only", () => {
		expect(parseConfig({})).toEqual({ ok: true, config: { ai: { kind: "allow" }, rules: noRules } });
	});

	test("an undefined or null ai, such as from an unset environment variable, takes the default", () => {
		expect(parseConfig({ ai: undefined })).toEqual({ ok: true, config: { ai: { kind: "allow" }, rules: noRules } });
		expect(parseConfig({ ai: null })).toEqual({ ok: true, config: { ai: { kind: "allow" }, rules: noRules } });
	});

	test("ai can block", () => {
		expect(parseConfig({ ai: "block" })).toEqual({ ok: true, config: { ai: { kind: "block" }, rules: noRules } });
	});

	test("ai can charge, with a price, a wallet and a network", () => {
		expect(parseConfig(charging)).toEqual({ ok: true, config: { ai: { kind: "charge", charge: { price: "0.002", payTo: wallet, network: "base-sepolia" } }, rules: noRules } });
		expect(parseConfig({ ...charging, price: "12", network: "base" })).toMatchObject({ ok: true, config: { ai: { charge: { price: "12", network: "base" } } } });
	});

	test("a wallet in one case has no checksum, so it is accepted", () => {
		expect(parseConfig({ ...charging, payTo: `0x${"ab".repeat(20)}` }).ok).toBe(true);
		expect(parseConfig({ ...charging, payTo: `0x${"AB".repeat(20)}` }).ok).toBe(true);
	});

	test("the charge fields can stay in the config when ai isn't charge, so switching is one change", () => {
		expect(parseConfig({ ...charging, ai: "block" })).toEqual({ ok: true, config: { ai: { kind: "block" }, rules: noRules } });
	});

	test("rules that are undefined, null or empty are no rules, and so is a null rule", () => {
		for (const rules of [undefined, null, {}, { "/premium/*": null }]) {
			expect(parseConfig({ rules })).toEqual(parseConfig({}));
		}
	});

	test("rules are keyed by their path in lower case, and a charging rule without a price takes the top-level one", () => {
		const rules = { "/Premium/*": { ai: "charge", price: "0.01" }, "/archive/*": { ai: "charge" }, "/drafts": { ai: "block" } };
		const charge = (price: string) => ({ kind: "charge", charge: { price, payTo: wallet, network: "base-sepolia" } });
		expect(parseConfig({ ...charging, ai: "allow", rules })).toEqual({
			ok: true,
			config: {
				ai: { kind: "allow" },
				rules: {
					exact: new Map([["/drafts", { kind: "block" }]]),
					under: new Map([
						["/premium", charge("0.01")],
						["/archive", charge("0.002")],
					]),
				},
			},
		});
	});

	test("a rule for the same path as another names the other", () => {
		const result = parseConfig({ rules: { "/Drafts/*": { ai: "block" }, "/drafts/*": { ai: "allow" } } });
		expect(result).toEqual({ ok: false, errors: [{ field: 'rules["/drafts/*"]', message: expect.stringContaining('rules["/Drafts/*"]') }] });
	});

	test.each([
		["not an object", "{}", ["config"]],
		["null", null, ["config"]],
		["an array", [], ["config"]],
		["a Promise, such as a config loaded without await", Promise.resolve({ rules: [] }), ["config"]],
		["a Map", new Map([["rules", []]]), ["config"]],
		["an object that inherits its fields", Object.create({ privateKey: "0xabc" }) as object, ["config"]],
		["the eventLog field that has been removed", { eventLog: "x.jsonl" }, ["eventLog"]],
		["a private key", { privateKey: "0xabc" }, ["privateKey"]],
		["an ai action Fairtoll doesn't have", { ai: "license" }, ["ai"]],
		["charging without a price, wallet or network", { ai: "charge" }, ["price", "payTo", "network"]],
		["a price as a number, which can't hold an exact amount", { ...charging, price: 0.002 }, ["price"]],
		["a price with more than 6 decimals, which x402 would round down", { ...charging, price: "0.0000001" }, ["price"]],
		["a zero price", { ...charging, price: "0.000" }, ["price"]],
		["a negative price", { ...charging, price: "-1" }, ["price"]],
		["a price with a dollar sign", { ...charging, price: "$0.002" }, ["price"]],
		["a wallet that isn't an address", { ...charging, payTo: "my-wallet.eth" }, ["payTo"]],
		["the zero address, a placeholder that can't be paid", { ...charging, payTo: `0x${"0".repeat(40)}` }, ["payTo"]],
		["a mixed-case wallet whose checksum is wrong, as a typo makes it", { ...charging, payTo: "0x00000000000000000000000000000000000000aA" }, ["payTo"]],
		["a network Fairtoll doesn't charge on", { ...charging, network: "solana" }, ["network"]],
		["a network inside an array, which would pass as a key", { ...charging, network: ["base"] }, ["network"]],
		["a bad price even when not charging", { ai: "block", price: "free" }, ["price"]],
		["an ai that isn't a string", { ai: true }, ["ai"]],
		["rules that aren't an object", { rules: [] }, ["rules"]],
		["a rule path that isn't one", { rules: { "/premium/": { ai: "block" } } }, ['rules["/premium/"]']],
		["a rule that isn't an object", { rules: { "/drafts/*": "block" } }, ['rules["/drafts/*"]']],
		["a rule without ai", { rules: { "/drafts/*": {} } }, ['rules["/drafts/*"].ai']],
		["a rule ai Fairtoll doesn't have", { rules: { "/drafts/*": { ai: "license" } } }, ['rules["/drafts/*"].ai']],
		["a wallet in a rule, which is only set at the top level", { ...charging, rules: { "/premium/*": { ai: "charge", payTo: wallet } } }, ['rules["/premium/*"].payTo']],
		["a bad rule price even when the rule doesn't charge", { rules: { "/drafts/*": { ai: "block", price: "free" } } }, ['rules["/drafts/*"].price']],
		["a charging rule with no price of its own or at the top level", { payTo: wallet, network: "base-sepolia", rules: { "/premium/*": { ai: "charge" } } }, ['rules["/premium/*"].price']],
		["a charging rule without a wallet or network", { price: "0.002", rules: { "/premium/*": { ai: "charge" } } }, ["payTo", "network"]],
	])("rejects %s, naming the field", (_, input, fields) => {
		const result = parseConfig(input);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.map((e) => e.field)).toEqual(fields);
	});

	test("every error is reported, not only the first", () => {
		const result = parseConfig({ rules: [], eventLog: 1 });
		expect(result.ok ? [] : result.errors.map((e) => e.field)).toEqual(["eventLog", "rules"]);
	});
});
