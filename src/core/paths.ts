/**
 * The page a path names, the way a static file server or a case-insensitive router finds it: percent-decoded,
 * lowercased, with backslashes as slashes, empty and "." segments dropped, ".." segments resolved, and no
 * trailing slash. Rules match this form, so /%70remium/a, /PREMIUM/a, //premium/a and /free/../premium/a are
 * all under /premium/*, as express.static would serve them. A segment that isn't valid percent-encoding is
 * left as it is.
 */
export function canonicalPath(path: string): string {
	const resolved: string[] = [];
	for (const segment of segments(path)) {
		if (segment === "..") resolved.pop();
		else resolved.push(segment);
	}
	return `/${resolved.join("/")}`;
}

/**
 * The rule for a path, out of rules whose paths are already canonical (see `canonicalRulePath`). The most
 * specific match wins: a rule for the exact path, then the wildcard with the longest prefix. So the order of
 * the rules never matters, and no two rules can tie, because `parseConfig` rejects two with the same path.
 */
export function ruleFor<R extends { readonly path: string }>(rules: readonly R[], path: string): R | undefined {
	return rules.length === 0 ? undefined : matchRule(rules, canonicalPath(path));
}

function matchRule<R extends { readonly path: string }>(rules: readonly R[], page: string): R | undefined {
	// An exact rule is the most specific match there can be.
	const exact = rules.find((rule) => rule.path === page);
	if (exact !== undefined) return exact;

	// Otherwise, of the wildcards that cover the page, the one with the longest prefix.
	let best: R | undefined;
	let bestPrefixLength = -1;
	for (const rule of rules) {
		if (!rule.path.endsWith("/*")) continue;
		// "/premium/*" has the prefix "/premium", and "/*" has the prefix "", which covers every page.
		const prefix = rule.path.slice(0, -2);
		const covers = page === prefix || page.startsWith(`${prefix}/`);
		if (covers && prefix.length > bestPrefixLength) {
			best = rule;
			bestPrefixLength = prefix.length;
		}
	}
	return best;
}

/** A rule's path as `ruleFor` matches it: an exact path, or one ending in "/*", in canonical form. */
export function canonicalRulePath(path: string): string {
	if (!path.endsWith("/*")) return canonicalPath(path);
	const prefix = canonicalPath(path.slice(0, -2));
	return prefix === "/" ? "/*" : `${prefix}/*`;
}

/**
 * Whether the path has a ".." segment, written as it is, percent-encoded, or after a backslash. Each part of an
 * app can resolve one differently: Express's router not at all, a static file server from the root, and a proxy
 * or `new URL` from where its handler is mounted. So such a path can name a different page for each.
 */
export function climbsUp(path: string): boolean {
	return segments(path).includes("..");
}

/** The path's segments, decoded and lowercased, with backslashes as slashes, and without empty or "." segments. */
function segments(path: string): string[] {
	// Decoded one segment at a time, so a segment that isn't valid percent-encoding doesn't stop the rest decoding.
	// A decoded %2f or %5c then splits its segment in two, as it does for a static file server.
	const decoded = path.split("/").map(decodeSegment).join("/");
	const withSlashes = decoded.replaceAll("\\", "/").toLowerCase();
	return withSlashes.split("/").filter((segment) => segment !== "" && segment !== ".");
}

function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}
