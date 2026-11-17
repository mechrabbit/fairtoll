import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { classify, parseConfig } from "../../src/core/index.js";
import { aiAgents } from "../../src/core/classify.js";
import { screen } from "../../src/core/screen.js";

// The cases in spec/ are shared with the WordPress plugin, whose PHPUnit tests run the same files, so the
// two versions can't drift apart without one of them failing.
const spec = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../spec/${name}`, import.meta.url), "utf8"));

interface ConfigCase {
	name: string;
	config: unknown;
	errors: { field: string; message: string }[];
}

interface ScreenGroup {
	config: unknown;
	requests: { name: string; method: string; path: string; userAgent: string | null; preflight: boolean; class: string; reason: string; action: string }[];
}

test("the AI agent list is the one in spec/agents.json", () => {
	expect(aiAgents).toEqual(spec("agents.json"));
});

describe("config cases", () => {
	test.each(spec("config-cases.json") as ConfigCase[])("$name", ({ config, errors }) => {
		const result = parseConfig(config);
		expect(result.ok ? [] : result.errors).toEqual(errors);
	});
});

describe("screen cases", () => {
	const cases = (spec("screen-cases.json") as ScreenGroup[]).flatMap(({ config, requests }) => requests.map((request) => ({ config, ...request })));
	test.each(cases)("$name", ({ config, method, path, userAgent, preflight, ...expected }) => {
		const parsed = parseConfig(config);
		if (!parsed.ok) throw new Error(`invalid config: ${JSON.stringify(parsed.errors)}`);
		const headers = new Headers();
		if (userAgent !== null) headers.set("user-agent", userAgent);
		if (preflight) headers.set("access-control-request-method", "GET");
		const request = new Request("http://localhost/", { headers });
		const { class: cls, reason } = classify(request);
		const { action } = screen(request, method, path, parsed.config);
		expect({ class: cls, reason, action: action.kind }).toEqual({ class: expected.class, reason: expected.reason, action: expected.action });
	});
});
