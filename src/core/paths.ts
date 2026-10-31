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

/**
 * The rule for a path with its ".." segments left in place, as Express's router reads it, so /premium/a/../../x
 * is under /premium/*. Unlike the router, it decodes the path, so %2f and %5c split segments, and ignores case.
 * That can put a path under a rule the router wouldn't route it to, but never out of one it would.
 */
export function ruleAsSent<R extends { readonly path: string }>(rules: readonly R[], path: string): R | undefined {
	return rules.length === 0 ? undefined : matchRule(rules, `/${segments(path).join("/")}`);
}

function matchRule<R extends { readonly path: string }>(rules: readonly R[], page: string): R | undefined {
	let best: R | undefined;
	for (const rule of rules) {
		if (!rule.path.endsWith("/*")) {
			if (rule.path === page) return rule;
			continue;
		}
		// "/premium/*" covers /premium and everything under it, and "/*" covers every path.
		const prefix = rule.path.slice(0, -2);
		if ((page === prefix || page.startsWith(`${prefix}/`)) && (best === undefined || prefix.length > best.path.length - 2)) best = rule;
	}
	return best;
}

/** A rule's path as `ruleFor` matches it: an exact path, or one ending in "/*", in canonical form. */
export function canonicalRulePath(path: string): string {
	if (!path.endsWith("/*")) return canonicalPath(path);
	const prefix = canonicalPath(path.slice(0, -2));
	return prefix === "/" ? "/*" : `${prefix}/*`;
}

/** Whether the path has a ".." segment, written as it is, percent-encoded, or after a backslash. */
export function climbsUp(path: string): boolean {
	return segments(path).includes("..");
}

/** The path's segments, decoded and lowercased, with backslashes as slashes, and without empty or "." segments. */
function segments(path: string): string[] {
	const decoded = path.split("/").map(decodeSegment).join("/").replaceAll("\\", "/").toLowerCase();
	return decoded.split("/").filter((segment) => segment !== "" && segment !== ".");
}

function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}
