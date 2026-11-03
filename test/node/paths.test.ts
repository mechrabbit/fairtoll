import { describe, expect, test } from "vitest";
import { parsePattern, readPath } from "../../src/core/paths.js";

describe("readPath", () => {
	test("keys a path by its segments, decoded and in lower case", () => {
		expect(readPath("/Premium//42/")).toEqual({ kind: "read", key: "/premium/42", segments: ["premium", "42"] });
		expect(readPath("/")).toEqual({ kind: "read", key: "/", segments: [] });
	});

	test.each([
		["a path as written", "/premium/42", "/premium/42"],
		["capitals, which Express's router ignores", "/PREMIUM/42", "/premium/42"],
		["empty segments", "//premium//42", "/premium/42"],
		["a trailing /", "/premium/42/", "/premium/42"],
		['a "." segment', "/premium/./42", "/premium/42"],
		["an encoded letter", "/%70remium/42", "/premium/42"],
		["an encoded /", "/premium%2F42", "/premium/42"],
		["a \\", "/premium\\42", "/premium/42"],
		["an encoded \\", "/premium%5c42", "/premium/42"],
		["an encoded non-ASCII letter", "/caf%C3%A9", "/café"],
		["a double-encoded .., decoded once as static decodes it", "/%252e%252e/x", "/%2e%2e/x"],
		["three dots, which is a name", "/premium/...", "/premium/..."],
		["the target of OPTIONS *, which no rule's key matches", "*", ""],
	])("reads %s", (_name, raw, key) => {
		expect(readPath(raw)).toMatchObject({ kind: "read", key });
	});

	test.each([
		["a .. segment", "/premium/../x"],
		["a last .. segment", "/premium/.."],
		["an encoded ..", "/premium/%2e%2e/x"],
		["an encoded .. in capitals", "/premium/%2E%2E/x"],
		["a half-encoded ..", "/premium/.%2E/x"],
		["a .. made by an encoded /", "/premium/..%2fx"],
		["a .. between encoded slashes", "/premium%2f..%2fx"],
		["a .. made by \\", "/premium\\..\\x"],
		["a .. made by an encoded \\", "/premium/%5c..%5cx"],
		["a broken escape", "/%zz"],
		["a cut-off escape", "/caf%C3%A"],
	])("finds %s unreadable", (_name, raw) => {
		expect(readPath(raw)).toEqual({ kind: "unreadable" });
	});
});

describe("parsePattern", () => {
	test.each([
		["/", { kind: "exact", key: "/" }],
		["/premium", { kind: "exact", key: "/premium" }],
		["/premium/*", { kind: "under", key: "/premium" }],
		["/Premium/Free-Sample", { kind: "exact", key: "/premium/free-sample" }],
		["/café/*", { kind: "under", key: "/café" }],
	])("reads %s", (text, pattern) => {
		expect(parsePattern(text)).toEqual(pattern);
	});

	test("keys a rule's path as readPath keys a request for it", () => {
		expect(parsePattern("/Café/Menu")).toMatchObject({ key: "/café/menu" });
		expect(readPath("/caf%C3%A9/MENU")).toMatchObject({ key: "/café/menu" });
	});

	test.each([
		["an empty path", ""],
		["a path without a leading /", "premium/*"],
		["every path, which is what ai is for", "/*"],
		["a trailing /, which could mean the page or what is below it", "/premium/"],
		["an empty segment", "/premium//x"],
		["an empty segment before *", "//*"],
		['a "." segment', "/premium/./x"],
		['a ".." segment', "/premium/../x"],
		["an encoded path", "/caf%C3%A9"],
		["a \\", "/premium\\x"],
		["* inside a segment", "/premium*"],
		["* before the last segment", "/*/premium"],
		["**", "/premium/**"],
		["two *", "/premium/*/*"],
	])("rejects %s", (_name, text) => {
		expect(parsePattern(text)).toMatchObject({ kind: "invalid", message: expect.any(String) });
	});
});
