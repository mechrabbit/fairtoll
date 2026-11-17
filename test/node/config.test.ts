import { describe, expect, test } from "vitest";
import { parseConfig, siteConfigErrors } from "../../src/core/index.js";

const wallet = "0x00000000000000000000000000000000000000AA";
const charging = { ai: "charge", price: "0.002", payTo: wallet, network: "base-sepolia" };

describe("parseConfig", () => {
	test("an empty config parses to observe-only", () => {
		expect(parseConfig({})).toEqual({ ok: true, config: { ai: "allow", rules: [] } });
	});

	test("an undefined or null ai, such as from an unset environment variable, takes the default", () => {
		expect(parseConfig({ ai: undefined })).toEqual({ ok: true, config: { ai: "allow", rules: [] } });
		expect(parseConfig({ ai: null })).toEqual({ ok: true, config: { ai: "allow", rules: [] } });
	});

	test("ai can block", () => {
		expect(parseConfig({ ai: "block" })).toEqual({ ok: true, config: { ai: "block", rules: [] } });
	});

	test("ai can charge, with a price, a wallet and a network", () => {
		expect(parseConfig(charging)).toEqual({ ok: true, config: { ai: "charge", charge: { price: "0.002", payTo: wallet, network: "base-sepolia" }, rules: [] } });
		expect(parseConfig({ ...charging, price: "12", network: "base" })).toMatchObject({ ok: true, config: { charge: { price: "12", network: "base" } } });
	});

	test("a wallet in one case has no checksum, so it is accepted", () => {
		expect(parseConfig({ ...charging, payTo: `0x${"ab".repeat(20)}` }).ok).toBe(true);
		expect(parseConfig({ ...charging, payTo: `0x${"AB".repeat(20)}` }).ok).toBe(true);
	});

	test("the charge fields can stay in the config when ai isn't charge, so switching is one change", () => {
		expect(parseConfig({ ...charging, ai: "block" })).toEqual({ ok: true, config: { ai: "block", rules: [] } });
	});

	test("rules each apply an ai to a path, and a rule that charges takes its own price or the top-level one", () => {
		const input = {
			price: "0.002",
			payTo: wallet,
			network: "base-sepolia",
			rules: [
				{ path: "/premium/*", ai: "charge", price: "0.01" },
				{ path: "/news/*", ai: "charge" },
				{ path: "/private/*", ai: "block" },
				{ path: "/premium/free/*", ai: "allow" },
			],
		};
		expect(parseConfig(input)).toEqual({
			ok: true,
			config: {
				ai: "allow",
				rules: [
					{ path: "/premium/*", ai: "charge", charge: { price: "0.01", payTo: wallet, network: "base-sepolia" } },
					{ path: "/news/*", ai: "charge", charge: { price: "0.002", payTo: wallet, network: "base-sepolia" } },
					{ path: "/private/*", ai: "block" },
					{ path: "/premium/free/*", ai: "allow" },
				],
			},
		});
	});

	test("a rule's path is kept in the canonical form it matches, and undefined or null rules are no rules", () => {
		expect(parseConfig({ rules: [{ path: "/Premium/%41/", ai: "block" }, { path: "//*", ai: "allow" }] })).toMatchObject({
			ok: true,
			config: { rules: [{ path: "/premium/a" }, { path: "/*" }] },
		});
		expect(parseConfig({ rules: null })).toEqual({ ok: true, config: { ai: "allow", rules: [] } });
	});

	test.each([
		["not an object", "{}", ["config"]],
		["null", null, ["config"]],
		["an array", [], ["config"]],
		["a Promise, such as a config loaded without await", Promise.resolve({ ai: "block" }), ["config"]],
		["a Map", new Map([["ai", "block"]]), ["config"]],
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
		["rules that aren't an array", { rules: { path: "/a", ai: "block" } }, ["rules"]],
		["a rule that isn't an object", { rules: ["/premium/*"] }, ["rules[0]"]],
		["a rule without a path or ai", { rules: [{}] }, ["rules[0].path", "rules[0].ai"]],
		["a rule with a field Fairtoll doesn't have", { rules: [{ path: "/a", ai: "block", payTo: wallet }] }, ["rules[0].payTo"]],
		["a relative rule path", { rules: [{ path: "premium/*", ai: "block" }] }, ["rules[0].path"]],
		["a wildcard that isn't a final /*", { rules: [{ path: "/premium*", ai: "block" }] }, ["rules[0].path"]],
		["a wildcard inside a path", { rules: [{ path: "/*/premium", ai: "block" }] }, ["rules[0].path"]],
		["a percent-encoded * that would decode to a wildcard", { rules: [{ path: "/premium/%2A", ai: "block" }] }, ["rules[0].path"]],
		["a rule ai Fairtoll doesn't have", { rules: [{ path: "/a", ai: "license" }] }, ["rules[0].ai"]],
		["a bad rule price", { rules: [{ path: "/a", ai: "block", price: "free" }] }, ["rules[0].price"]],
		["a rule that charges with no price at all", { payTo: wallet, network: "base-sepolia", rules: [{ path: "/a", ai: "charge" }] }, ["rules[0].price"]],
		["a rule that charges with no wallet or network", { rules: [{ path: "/a", ai: "charge", price: "0.01" }] }, ["payTo", "network"]],
		["two rules that charge with no wallet or network, which is reported once", { rules: [{ path: "/a", ai: "charge", price: "0.01" }, { path: "/b", ai: "charge", price: "0.01" }] }, ["payTo", "network"]],
		["rules that charge with no price, wallet or network, each rule in turn", { rules: [{ path: "/a", ai: "charge" }, { path: "/b", ai: "charge" }] }, ["rules[0].price", "payTo", "network", "rules[1].price"]],
		["charging with no wallet or network, and a rule that charges", { ai: "charge", price: "0.01", rules: [{ path: "/a", ai: "charge" }] }, ["payTo", "network"]],
		["two rules for the same paths", { rules: [{ path: "/a/*", ai: "block" }, { path: "/A/*", ai: "allow" }] }, ["rules[1].path"]],
		["an exact rule and its trailing-slash twin", { rules: [{ path: "/a", ai: "block" }, { path: "/a/", ai: "allow" }] }, ["rules[1].path"]],
	])("rejects %s, naming the field", (_, input, fields) => {
		const result = parseConfig(input);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.map((e) => e.field)).toEqual(fields);
	});

	test("every error is reported, not only the first", () => {
		const result = parseConfig({ license: 1, eventLog: 1, ai: "x" });
		expect(result.ok ? [] : result.errors.map((e) => e.field)).toEqual(["license", "eventLog", "ai"]);
	});
});

describe("siteConfigErrors", () => {
	test("a config every install applies as written has none", () => {
		expect(siteConfigErrors({})).toEqual([]);
		expect(siteConfigErrors({ ai: "charge", price: "0.002", requires: ["rules.price"], rules: [{ path: "/free/*", ai: "allow" }] })).toEqual([]);
		expect(siteConfigErrors({ ai: "allow", price: null, rules: null })).toEqual([]);
	});

	test("a field an install would ignore is a mistake, so a typo is caught", () => {
		expect(siteConfigErrors({ ai: "block", prise: "0.01", rules: [{ path: "/a", ai: "allow", note: "x" }] })).toEqual([
			{ field: "prise", message: "is not a known field" },
			{ field: "rules[0].note", message: "is not a known field" },
		]);
	});

	test("the wallet can only be set in the publisher's code", () => {
		expect(siteConfigErrors({ ai: "block", payTo: `0x${"b".repeat(40)}`, network: "base" })).toEqual([
			{ field: "payTo", message: "can only be set in the publisher's own code" },
			{ field: "network", message: "can only be set in the publisher's own code" },
		]);
	});

	test("requires may only name fields this version knows", () => {
		expect(siteConfigErrors({ requires: ["rules.schedule"] })).toEqual([{ field: "requires", message: 'must be a list of fields this version knows, such as "rules.price"' }]);
		expect(siteConfigErrors({ requires: "ai" })).toHaveLength(1);
	});

	test("everything parseConfig refuses is refused, such as two rules for the same paths", () => {
		expect(siteConfigErrors({ ai: "charge" })).toEqual([{ field: "price", message: 'is needed when ai is "charge"' }]);
		expect(siteConfigErrors({ rules: [{ path: "/a", ai: "block" }, { path: "/A/", ai: "allow" }] })).toEqual([
			{ field: "rules[1].path", message: "matches the same paths as rules[0]" },
		]);
		expect(siteConfigErrors([])).toEqual([{ field: "config", message: "must be a plain object" }]);
	});
});
