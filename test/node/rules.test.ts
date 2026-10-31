import { describe, expect, test } from "vitest";
import { parseConfig, type Config } from "../../src/core/index.js";
import { canonicalPath, ruleFor } from "../../src/core/paths.js";
import { decide } from "../../src/core/screen.js";

const wallet = `0x${"a".repeat(40)}`;

function parsed(input: object): Config {
	const result = parseConfig(input);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.config;
}

describe("canonicalPath", () => {
	test.each([
		["/premium/a", "/premium/a"],
		["/", "/"],
		["", "/"],
		["/premium/", "/premium"],
		["/PREMIUM/A", "/premium/a"],
		["/%70remium/a", "/premium/a"],
		["/premium%2Fa", "/premium/a"],
		["//premium///a", "/premium/a"],
		["/./premium/./a", "/premium/a"],
		["/free/../premium/a", "/premium/a"],
		["/free/%2e%2e/premium/a", "/premium/a"],
		["/../../premium/a", "/premium/a"],
		["/premium\\a", "/premium/a"],
		["/caf%C3%A9/a", "/café/a"],
		["/premium/%zz", "/premium/%zz"],
	])("%s names the page %s", (path, page) => {
		expect(canonicalPath(path)).toBe(page);
	});
});

describe("ruleFor", () => {
	const rules = parsed({
		payTo: wallet,
		network: "base-sepolia",
		rules: [
			{ path: "/premium/*", ai: "charge", price: "0.01" },
			{ path: "/premium/free/*", ai: "allow" },
			{ path: "/premium/free/locked", ai: "block" },
			{ path: "/about", ai: "block" },
		],
	}).rules;
	const matched = (path: string) => ruleFor(rules, path)?.path;

	test("a wildcard covers its prefix and everything under it, and nothing that only starts with the same letters", () => {
		expect(matched("/premium")).toBe("/premium/*");
		expect(matched("/premium/")).toBe("/premium/*");
		expect(matched("/premium/a/b/c")).toBe("/premium/*");
		expect(matched("/premiumx")).toBeUndefined();
		expect(matched("/other")).toBeUndefined();
	});

	test("an exact path covers only itself, with or without a trailing slash", () => {
		expect(matched("/about")).toBe("/about");
		expect(matched("/about/")).toBe("/about");
		expect(matched("/about/team")).toBeUndefined();
	});

	test("the most specific rule wins: an exact path, then the longest wildcard", () => {
		expect(matched("/premium/free/a")).toBe("/premium/free/*");
		expect(matched("/premium/free")).toBe("/premium/free/*");
		expect(matched("/premium/free/locked")).toBe("/premium/free/locked");
		expect(matched("/premium/freebie")).toBe("/premium/*");
	});

	test("a path a static server or a case-insensitive router reads as a rule's page matches that rule", () => {
		for (const path of ["/PREMIUM/a", "/%70remium/a", "//premium/a", "/premium/free/../a", "/premium/free/%2e%2e/a", "/free/../premium/a"]) {
			expect(matched(path)).toBe("/premium/*");
		}
		expect(matched("/About/./")).toBe("/about");
	});

	test("/* covers every path, and loses to any other rule", () => {
		const all = parsed({ rules: [{ path: "/*", ai: "block" }, { path: "/open/*", ai: "allow" }] }).rules;
		expect(ruleFor(all, "/")?.path).toBe("/*");
		expect(ruleFor(all, "/a/b")?.path).toBe("/*");
		expect(ruleFor(all, "/open/a")?.path).toBe("/open/*");
	});
});

/**
 * Generated configs and paths. A small seeded generator, so a failure names a seed that reproduces it, over
 * few enough segments that rules overlap often.
 */
function generator(seed: number) {
	let state = seed;
	const next = () => {
		state = (state * 1103515245 + 12345) % 2 ** 31;
		return state / 2 ** 31;
	};
	const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
	const segments = ["a", "b", "premium", "free"];
	const segmentPath = () => `/${Array.from({ length: Math.floor(next() * 4) }, () => pick(segments)).join("/")}`;
	const rulePath = () => {
		const base = segmentPath();
		if (next() < 0.5) return base;
		return base === "/" ? "/*" : `${base}/*`;
	};
	const rule = () => {
		const ai = pick(["allow", "block", "charge"] as const);
		return { path: rulePath(), ai, ...(ai === "charge" && next() < 0.5 ? { price: pick(["0.01", "0.5"]) } : {}) };
	};
	const rules = () => {
		const unique = new Map<string, ReturnType<typeof rule>>();
		for (let i = Math.floor(next() * 5); i > 0; i--) {
			const r = rule();
			// Two rules can't have the same path.
			if (!unique.has(r.path)) unique.set(r.path, r);
		}
		return [...unique.values()];
	};
	const input = (ruleList: readonly object[]) => ({ ai: pick(["allow", "block", "charge"]), price: "0.002", payTo: wallet, network: "base-sepolia", rules: ruleList });
	// Paths as requests send them, with the case, encoding and dot segments a bot could vary.
	const requestPath = () => {
		let path = segmentPath();
		if (next() < 0.2) path = path.toUpperCase();
		if (next() < 0.2) path = path.replace("p", "%70");
		if (next() < 0.2) path = `${path}/`;
		if (next() < 0.2) path = `/b/..${path}`;
		return path;
	};
	return { next, rules, input, requestPath, rule };
}

describe("rules over generated configs", () => {
	const seeds = Array.from({ length: 300 }, (_, i) => i + 1);
	const decisions = (config: Config, paths: readonly string[]) =>
		paths.map((path) => [decide(config, "unverifiedBot", false, path), decide(config, "unverifiedBot", true, path), decide(config, "human", false, path)]);

	test("removing a rule restores every decision, and the rule changed only the paths it matches", () => {
		for (const seed of seeds) {
			const gen = generator(seed);
			const before = gen.rules();
			const base = gen.input(before);
			const added = gen.rule();
			if (before.some((r) => r.path === added.path)) continue;
			const at = Math.floor(gen.next() * (before.length + 1));
			const withRule = { ...base, rules: [...before.slice(0, at), added, ...before.slice(at)] };
			const removed = { ...withRule, rules: withRule.rules.filter((r) => r !== added) };
			const paths = Array.from({ length: 30 }, gen.requestPath);

			expect(decisions(parsed(removed), paths), `seed ${seed}`).toEqual(decisions(parsed(base), paths));
			const addedRule = parsed({ rules: [added], payTo: wallet, network: "base-sepolia", price: "0.002" }).rules;
			const unmatched = paths.filter((path) => ruleFor(addedRule, path) === undefined);
			expect(decisions(parsed(withRule), unmatched), `seed ${seed}`).toEqual(decisions(parsed(base), unmatched));
		}
	});

	test("the order of the rules never changes a decision", () => {
		for (const seed of seeds) {
			const gen = generator(seed);
			const rules = gen.rules();
			const input = gen.input(rules);
			const paths = Array.from({ length: 30 }, gen.requestPath);
			expect(decisions(parsed({ ...input, rules: [...rules].reverse() }), paths), `seed ${seed}`).toEqual(decisions(parsed(input), paths));
		}
	});

	test("a config with no rules decides every path as the top-level ai alone", () => {
		for (const seed of seeds) {
			const gen = generator(seed);
			const input = gen.input([]);
			const paths = Array.from({ length: 30 }, gen.requestPath);
			expect(decisions(parsed(input), paths), `seed ${seed}`).toEqual(decisions(parsed({ ...input, rules: undefined }), paths));
			expect(new Set(decisions(parsed(input), paths).map((d) => JSON.stringify(d))).size, `seed ${seed}`).toBe(1);
		}
	});
});
