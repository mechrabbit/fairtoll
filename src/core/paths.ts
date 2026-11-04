/**
 * The path in canonical form, which is how a static file server or a case-insensitive router reads it:
 * - percent-decoded once, so %70 becomes p but %2570 becomes %70;
 * - lowercased, with backslashes as slashes;
 * - with empty and "." segments dropped, ".." segments resolved, and no trailing slash.
 *
 * Rules match this form, so /%70remium/a, /PREMIUM/a, //premium/a and /free/../premium/a are all under
 * /premium/*, as express.static would serve them. A segment that isn't valid percent-encoding is left as it is.
 */
export function canonicalPath(path: string): string {
	const resolved: string[] = [];
	for (const segment of decodedSegments(path)) {
		if (segment === "..") resolved.pop();
		else resolved.push(segment);
	}
	return `/${resolved.join("/")}`;
}

/**
 * The most specific rule that matches the path, or undefined if none does. The rules' paths must already be
 * canonical (see `canonicalRulePath`). The `Config` type describes how rules match.
 */
export function ruleFor<R extends { readonly path: string }>(rules: readonly R[], path: string): R | undefined {
	return rules.length === 0 ? undefined : mostSpecificRule(rules, canonicalPath(path));
}

/** The rule for a path that is already in canonical form. */
function mostSpecificRule<R extends { readonly path: string }>(rules: readonly R[], canonical: string): R | undefined {
	// An exact rule is the most specific match there can be.
	const exact = rules.find((rule) => rule.path === canonical);
	if (exact !== undefined) return exact;

	// Otherwise, of the wildcards that cover the path, the one with the longest prefix.
	let best: R | undefined;
	let bestPrefixLength = -1;
	for (const rule of rules) {
		if (!rule.path.endsWith("/*")) continue;
		// "/premium/*" has the prefix "/premium", and "/*" has the prefix "", which covers every path.
		const prefix = rule.path.slice(0, -2);
		const covers = canonical === prefix || canonical.startsWith(`${prefix}/`);
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
export function hasDotDotSegment(path: string): boolean {
	return decodedSegments(path).includes("..");
}

/** The path's segments, decoded and lowercased, with backslashes as slashes, and without empty or "." segments. */
function decodedSegments(path: string): string[] {
	// Decoded once, one segment at a time, so a segment that isn't valid percent-encoding doesn't stop the rest
	// decoding.
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
