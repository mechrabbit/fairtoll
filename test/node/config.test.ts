import { describe, expect, test } from "vitest";
import { parseConfig } from "../../src/core/index.js";

describe("parseConfig", () => {
	test("an empty config parses to observe-only", () => {
		expect(parseConfig({})).toEqual({ ok: true, config: { ai: "allow" } });
	});

	test("an undefined or null ai, such as from an unset environment variable, takes the default", () => {
		expect(parseConfig({ ai: undefined })).toEqual({ ok: true, config: { ai: "allow" } });
		expect(parseConfig({ ai: null })).toEqual({ ok: true, config: { ai: "allow" } });
	});

	test("ai can block", () => {
		expect(parseConfig({ ai: "block" })).toEqual({ ok: true, config: { ai: "block" } });
	});

	test("the config keeps only the checked value, read once", () => {
		let reads = 0;
		const input = { [Symbol("extra")]: 1, get ai() { return reads++ === 0 ? "block" : "charge"; } };
		expect(parseConfig(input)).toEqual({ ok: true, config: { ai: "block" } });
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
		["an ai action other than allow or block", { ai: "charge" }, ["ai"]],
		["an ai that isn't a string", { ai: true }, ["ai"]],
	])("rejects %s, naming the field", (_, input, fields) => {
		const result = parseConfig(input);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.map((e) => e.field)).toEqual(fields);
	});

	test("every error is reported, not only the first", () => {
		const result = parseConfig({ rules: [], eventLog: 1 });
		expect(result.ok ? [] : result.errors.map((e) => e.field)).toEqual(["rules", "eventLog"]);
	});
});
