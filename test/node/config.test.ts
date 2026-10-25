import { describe, expect, test } from "vitest";
import { parseConfig } from "../../src/core/index.js";

describe("parseConfig", () => {
	test("an empty config parses to observe-only", () => {
		expect(parseConfig({})).toEqual({ ok: true, config: {} });
	});

	test("eventLog sets the event log file", () => {
		expect(parseConfig({ eventLog: "fairtoll.jsonl" })).toEqual({ ok: true, config: { eventLog: "fairtoll.jsonl" } });
	});

	test.each([
		["not an object", "{}", ["config"]],
		["null", null, ["config"]],
		["an array", [], ["config"]],
		["a misspelled field", { eventlog: "x.jsonl" }, ["eventlog"]],
		["a private key", { privateKey: "0xabc" }, ["privateKey"]],
		["an eventLog that is not a string", { eventLog: 1 }, ["eventLog"]],
		["an empty eventLog", { eventLog: "" }, ["eventLog"]],
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
