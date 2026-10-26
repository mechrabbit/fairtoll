import { describe, expect, test } from "vitest";
import { parseConfig } from "../../src/core/index.js";

describe("parseConfig", () => {
	test("an empty config parses to observe-only", () => {
		expect(parseConfig({})).toEqual({ ok: true, config: {} });
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
