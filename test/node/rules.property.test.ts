import { describe, expect, test } from "vitest";
import type { Config } from "../../src/core/index.js";
import { decide } from "../../src/core/screen.js";
import type { RequestClass } from "../../src/core/types.js";
import { parsed } from "./parsed.js";

// Each property runs over the same seeds every time, so a failure names its seed and reruns exactly.
const seeds = 1000;
const pathsPerSeed = 25;

type Rand = () => number;
type Kind = "allow" | "block" | "charge";
type RuleValue = { readonly ai: Kind; readonly price?: string };
type Entry = readonly [path: string, value: RuleValue];

interface Top {
	readonly ai: Kind;
	readonly price: string;
	readonly payTo: string;
	readonly network: string;
}

interface Probe {
	readonly path: string;
	readonly cls: RequestClass;
	readonly preflight: boolean;
}

/** mulberry32, a small seeded generator. */
function random(seed: number): Rand {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), state | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function pick<T>(rand: Rand, items: readonly T[]): T {
	const item = items[Math.floor(rand() * items.length)];
	if (item === undefined) throw new Error("pick needs a list with something in it");
	return item;
}

function randomCase(rand: Rand, text: string): string {
	return [...text].map((char) => (rand() < 0.5 ? char.toUpperCase() : char)).join("");
}

// Few names, so that rules overlap and nest often.
const names = ["a", "b", "premium", "x"];
const kinds: readonly Kind[] = ["allow", "block", "charge"];
const ruleValues: readonly RuleValue[] = [{ ai: "allow" }, { ai: "block" }, { ai: "charge" }, { ai: "charge", price: "0.01" }, { ai: "charge", price: "0.05" }];
const separators = ["/", "//", "\\", "%2f", "%5C"];
const oddPieces = ["", ".", "..", "%2e", "%2e%2e", ".%2E", "%61", "%zz"];

function randomTop(rand: Rand): Top {
	return { ai: pick(rand, kinds), price: "0.002", payTo: `0x${"a".repeat(40)}`, network: "base-sepolia" };
}

/** Up to six rules, none for the same path as another, in random case. */
function randomEntries(rand: Rand): Entry[] {
	const entries: Entry[] = [];
	const taken = new Set<string>();
	const count = Math.floor(rand() * 7);
	for (let i = 0; i < count; i++) {
		const depth = Math.floor(rand() * 4);
		const segments = Array.from({ length: depth }, () => randomCase(rand, pick(rand, names)));
		const under = depth > 0 && rand() < 0.5;
		const path = `/${segments.join("/")}${under ? "/*" : ""}`;
		if (taken.has(path.toLowerCase())) continue;
		taken.add(path.toLowerCase());
		entries.push([path, pick(rand, ruleValues)]);
	}
	return entries;
}

function randomPath(rand: Rand): string {
	if (rand() < 0.02) return "*";
	const count = Math.floor(rand() * 5);
	let path = "/";
	for (let i = 0; i < count; i++) {
		if (i > 0) path += pick(rand, separators);
		path += rand() < 0.7 ? randomCase(rand, pick(rand, names)) : pick(rand, oddPieces);
	}
	if (rand() < 0.2) path += "/";
	return path;
}

function randomProbes(rand: Rand): Probe[] {
	const probes: Probe[] = [];
	for (let i = 0; i < pathsPerSeed; i++) {
		const path = randomPath(rand);
		for (const cls of ["human", "unverifiedBot"] as const) {
			probes.push({ path, cls, preflight: false }, { path, cls, preflight: true });
		}
	}
	return probes;
}

function shuffled<T>(rand: Rand, items: readonly T[]): T[] {
	return items
		.map((item) => ({ item, key: rand() }))
		.sort((a, b) => a.key - b.key)
		.map(({ item }) => item);
}

function configOf(top: Top, entries: readonly Entry[]): Config {
	return parsed({ ...top, rules: Object.fromEntries(entries) });
}

function decision(config: Config, probe: Probe): string {
	const action = decide(config, probe.cls, probe.preflight, probe.path);
	return action.kind === "charge" ? `charge ${action.charge.price}` : action.kind;
}

/** A path's segments read with nothing but the platform's decoder, or why it has none. */
function naiveSegments(raw: string): string[] | "unreadable" | "no path" {
	if (raw === "*") return "no path";
	let decoded: string;
	try {
		decoded = decodeURIComponent(raw);
	} catch {
		return "unreadable";
	}
	const segments: string[] = [];
	for (const part of decoded.replaceAll("\\", "/").split("/")) {
		const segment = part.toLowerCase();
		if (segment === "..") return "unreadable";
		if (segment !== "" && segment !== ".") segments.push(segment);
	}
	return segments;
}

/** By trying every rule: the one written for exactly this path, or else the longest whose path this one starts with. */
function winner(entries: readonly Entry[], segments: readonly string[]): Entry | undefined {
	let best: Entry | undefined;
	let bestDepth = -1;
	for (const entry of entries) {
		const under = entry[0].endsWith("/*");
		const ruleSegments = (under ? entry[0].slice(0, -2) : entry[0]).toLowerCase().split("/").filter((s) => s !== "");
		const startsWith = ruleSegments.length <= segments.length && ruleSegments.every((s, i) => segments[i] === s);
		if (!under && startsWith && ruleSegments.length === segments.length) return entry;
		if (under && startsWith && ruleSegments.length > bestDepth) {
			best = entry;
			bestDepth = ruleSegments.length;
		}
	}
	return best;
}

function described(ai: Kind, price: string): string {
	return ai === "charge" ? `charge ${price}` : ai;
}

/** What decide should return, worked out from the config as written rather than as parsed. */
function expected(top: Top, entries: readonly Entry[], probe: Probe): string {
	if (probe.cls === "human") return "allow";
	const action = expectedAction(top, entries, probe.path);
	if (action.startsWith("charge") && probe.preflight) return "allow";
	return action;
}

function expectedAction(top: Top, entries: readonly Entry[], path: string): string {
	if (entries.length === 0) return described(top.ai, top.price);
	const segments = naiveSegments(path);
	if (segments === "unreadable") {
		const allAllow = top.ai === "allow" && entries.every(([, value]) => value.ai === "allow");
		return allAllow ? "allow" : "block";
	}
	const rule = segments === "no path" ? undefined : winner(entries, segments);
	if (rule === undefined) return described(top.ai, top.price);
	return described(rule[1].ai, rule[1].price ?? top.price);
}

/** decide as it was before rules existed, which a config without rules must still match. */
function beforeRules(top: Top, probe: Probe): string {
	if (probe.cls === "human" || top.ai === "allow") return "allow";
	if (top.ai === "block") return "block";
	return probe.preflight ? "allow" : `charge ${top.price}`;
}

/** Runs `check` for every seed, and returns up to five of the differences it finds, each with its seed. */
function failures(check: (rand: Rand) => string[]): string[] {
	const found: string[] = [];
	for (let seed = 1; seed <= seeds && found.length < 5; seed++) {
		for (const failure of check(random(seed))) found.push(`seed ${seed}: ${failure}`);
	}
	return found.slice(0, 5);
}

function differences(probes: readonly Probe[], actual: (probe: Probe) => string, wanted: (probe: Probe) => string, context: string): string[] {
	const found: string[] = [];
	for (const probe of probes) {
		const got = actual(probe);
		const want = wanted(probe);
		if (got !== want) found.push(`${probe.cls}${probe.preflight ? " preflight" : ""} ${probe.path} got ${got}, expected ${want}, ${context}`);
	}
	return found;
}

describe("rules, over generated configs", () => {
	test("decide agrees with trying every rule against a naively read path", () => {
		const found = failures((rand) => {
			const top = randomTop(rand);
			const entries = randomEntries(rand);
			const config = configOf(top, entries);
			const context = `ai ${top.ai}, rules ${JSON.stringify(entries)}`;
			return differences(randomProbes(rand), (probe) => decision(config, probe), (probe) => expected(top, entries, probe), context);
		});
		expect(found).toEqual([]);
	});

	test("removing a rule restores every decision to what it was before the rule was added", () => {
		const found = failures((rand) => {
			const top = randomTop(rand);
			const before = randomEntries(rand);
			const added = randomEntries(rand).find(([path]) => before.every(([other]) => other.toLowerCase() !== path.toLowerCase()));
			if (added === undefined) return [];
			const at = Math.floor(rand() * (before.length + 1));
			const withRule = [...before.slice(0, at), added, ...before.slice(at)];
			const removed = withRule.filter((entry) => entry !== added);
			const original = configOf(top, before);
			const restored = configOf(top, removed);
			const context = `ai ${top.ai}, rules ${JSON.stringify(before)}, removing ${JSON.stringify(added)}`;
			return differences(randomProbes(rand), (probe) => decision(restored, probe), (probe) => decision(original, probe), context);
		});
		expect(found).toEqual([]);
	});

	test("adding a rule changes decisions only on readable paths it is the most specific rule for", () => {
		const found = failures((rand) => {
			const top = randomTop(rand);
			const before = randomEntries(rand);
			const added = randomEntries(rand).find(([path]) => before.every(([other]) => other.toLowerCase() !== path.toLowerCase()));
			if (added === undefined) return [];
			const after = [...before, added];
			const original = configOf(top, before);
			const withRule = configOf(top, after);
			const context = `ai ${top.ai}, rules ${JSON.stringify(before)}, adding ${JSON.stringify(added)}`;
			const readable = randomProbes(rand).filter((probe) => naiveSegments(probe.path) !== "unreadable");
			const wanted = (probe: Probe) => {
				const segments = naiveSegments(probe.path);
				const wins = Array.isArray(segments) && winner(after, segments) === added;
				return wins ? decision(withRule, probe) : decision(original, probe);
			};
			return differences(readable, (probe) => decision(withRule, probe), wanted, context);
		});
		expect(found).toEqual([]);
	});

	test("the order rules are written in changes no decision", () => {
		const found = failures((rand) => {
			const top = randomTop(rand);
			const entries = randomEntries(rand);
			const reordered = shuffled(rand, entries);
			const original = configOf(top, entries);
			const shuffledConfig = configOf(top, reordered);
			const context = `ai ${top.ai}, rules ${JSON.stringify(entries)}, reordered ${JSON.stringify(reordered)}`;
			return differences(randomProbes(rand), (probe) => decision(shuffledConfig, probe), (probe) => decision(original, probe), context);
		});
		expect(found).toEqual([]);
	});

	test("a config without rules decides as decide did before rules existed, on every path", () => {
		const found = failures((rand) => {
			const top = randomTop(rand);
			const noRules = pick(rand, [{}, { rules: undefined }, { rules: null }, { rules: {} }]);
			const config = parsed({ ...top, ...noRules });
			const context = `ai ${top.ai}, ${JSON.stringify(noRules)}`;
			return differences(randomProbes(rand), (probe) => decision(config, probe), (probe) => beforeRules(top, probe), context);
		});
		expect(found).toEqual([]);
	});

	test("a config where ai and every rule allow allows every request, .. and broken escapes included", () => {
		const found = failures((rand) => {
			const top: Top = { ...randomTop(rand), ai: "allow" };
			const entries = randomEntries(rand).map(([path]): Entry => [path, { ai: "allow" }]);
			const config = configOf(top, entries);
			const context = `rules ${JSON.stringify(entries)}`;
			return differences(randomProbes(rand), (probe) => decision(config, probe), () => "allow", context);
		});
		expect(found).toEqual([]);
	});
});
