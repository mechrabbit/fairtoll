/**
 * The page a path names, the way a static file server or a case-insensitive router finds it: percent-decoded,
 * lowercased, with backslashes as slashes, empty and "." segments dropped, ".." segments resolved, and no
 * trailing slash. Rules match this form, so /%70remium/a, /PREMIUM/a, //premium/a and /free/../premium/a are
 * all under /premium/*, as express.static would serve them. A segment that isn't valid percent-encoding is
 * left as it is.
 */
export function canonicalPath(path: string): string {
	const segments: string[] = [];
	for (const segment of decodedSegments(path)) {
		if (segment === "..") segments.pop();
		else if (segment !== "" && segment !== ".") segments.push(segment);
	}
	return `/${segments.join("/")}`;
}

/**
 * The rule for a path, out of rules whose paths are already canonical (see `canonicalRulePath`). The most
 * specific match wins: a rule for the exact path, then the wildcard with the longest prefix. So the order of
 * the rules never matters, and no two rules can tie, because `parseConfig` rejects two with the same path.
 */
export function ruleFor<R extends { readonly path: string }>(rules: readonly R[], path: string): R | undefined {
	if (rules.length === 0) return undefined;
	const page = canonicalPath(path);
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

/**
 * Whether the path has a ".." segment, written as it is, percent-encoded, or after a backslash. Express routes
 * by the path as sent, but rules match it resolved, so /premium/a/../../free is under /premium for a handler
 * mounted there and under /free for the rules. No browser or crawler sends one, because clients resolve dot
 * segments before sending.
 */
export function climbsUp(path: string): boolean {
	return decodedSegments(path).includes("..");
}

function decodedSegments(path: string): string[] {
	return path.split("/").map(decodeSegment).join("/").replaceAll("\\", "/").toLowerCase().split("/");
}

function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}
