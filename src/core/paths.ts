import type { Action, Rules } from "./config.js";

/**
 * A request path as rules match it. `key` is "/" and the segments joined by "/", which is how a rule's path
 * is keyed too. A path that is "unreadable" can't be matched against rules safely.
 */
export type ReadPath = { readonly kind: "read"; readonly key: string; readonly segments: readonly string[] } | { readonly kind: "unreadable" };

/** A rule's path: "exact" covers only its own path, and "under", written "/premium/*", covers its path and every path below it. */
export type Pattern = { readonly kind: "exact" | "under"; readonly key: string } | { readonly kind: "invalid"; readonly message: string };

const unreadable: ReadPath = { kind: "unreadable" };

/**
 * Reads a request path so that each way the app behind Fairtoll could read it falls under the same rules. The
 * path is decoded once, as express.static decodes it, and read ignoring case, as Express's router matches it.
 * "\" counts as "/", as on Windows, and empty and "." segments are left out. Fairtoll never resolves "..", so a
 * ".." segment, which an encoded "." or "/" can also make, makes a path unreadable, and so does a broken
 * %-escape.
 * A path without a leading "/", such as `*`, or `%2fpremium` from `GET http://host%2fpremium`, is read as if it
 * had one, as express.static reads it. `*` reads as "/*", which no rule's key can be.
 */
export function readPath(raw: string): ReadPath {
	const decoded = decode(raw);
	if (decoded === undefined) return unreadable;
	const parts = decoded.toLowerCase().split(/[\\/]/);
	if (parts.includes("..")) return unreadable;
	const segments = parts.filter((part) => part !== "" && part !== ".");
	return { kind: "read", key: pathKey(segments), segments };
}

/**
 * Reads a rule's path, ignoring case as `readPath` does. It is written decoded and starts with "/", and only its
 * whole last segment can be "*". Anything that would make a rule match other paths than it looks like, such as
 * "//", "%" or a trailing "/", is invalid.
 */
export function parsePattern(text: string): Pattern {
	if (!text.startsWith("/")) return invalid('must start with "/", such as "/premium/*"');
	if (text === "/") return { kind: "exact", key: "/" };
	if (text === "/*") return invalid("covers every path, so set the top-level ai instead");
	if (text.endsWith("/")) return invalid('must not end in "/": write "/premium" for that page, or "/premium/*" for it and every page below it');
	if (text.includes("%")) return invalid('must be written decoded, such as "/café" rather than "/caf%C3%A9"');
	if (text.includes("\\")) return invalid('must separate segments with "/", not "\\"');
	const under = text.endsWith("/*");
	const path = under ? text.slice(0, -2) : text;
	const segments = path.slice(1).toLowerCase().split("/");
	if (segments.includes("")) return invalid('must not have an empty segment, as in "//"');
	if (segments.includes(".") || segments.includes("..")) return invalid('must not have a "." or ".." segment');
	if (segments.some((segment) => segment.includes("*"))) return invalid('can use "*" only as its whole last segment, as in "/premium/*"');
	return { kind: under ? "under" : "exact", key: pathKey(segments) };
}

/**
 * The most specific rule that covers a path: its exact rule, or else the deepest `under` rule among the path
 * and the paths above it. No two rules can tie, because an exact key is unique and the `under` rules covering
 * one path all have different depths, so the order rules are written in never matters.
 */
export function ruleFor(rules: Rules, path: { readonly key: string; readonly segments: readonly string[] }): Action | undefined {
	const exact = rules.exact.get(path.key);
	if (exact !== undefined) return exact;
	for (let depth = path.segments.length; depth > 0; depth--) {
		const under = rules.under.get(pathKey(path.segments.slice(0, depth)));
		if (under !== undefined) return under;
	}
	return undefined;
}

/** The one place a key is spelled, so a rule's path and a request path can't be keyed differently. */
function pathKey(segments: readonly string[]): string {
	return `/${segments.join("/")}`;
}

function invalid(message: string): Pattern {
	return { kind: "invalid", message };
}

function decode(raw: string): string | undefined {
	try {
		return decodeURIComponent(raw);
	} catch {
		return undefined;
	}
}
