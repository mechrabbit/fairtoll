import { classify, type Classification } from "./classify.js";
import type { Charge, Config, Network } from "./config.js";
import { hasDotDotSegment, ruleFor } from "./paths.js";
import type { RequestClass } from "./types.js";

export type Action = { readonly kind: "allow" } | { readonly kind: "block" } | { readonly kind: "charge"; readonly charge: Charge };

const allow: Action = { kind: "allow" };

/**
 * What to do with an AI request: allow it, block it, or charge it the given price. A human request is always
 * allowed. The policy is the most specific rule that matches the path, or the top-level `ai` if none does.
 *
 * When charging, every request is charged except a CORS preflight, which is let through because a 402 there would break
 * every cross-origin request to the page. Many apps serve the page whatever the method, so a free POST or
 * other OPTIONS would be a way around the price. A bot can send a preflight's header too, so an app that
 * answers a preflight with the page still gives the page away.
 *
 * When the config has rules and doesn't allow every path, an AI request whose path has a ".." segment is
 * blocked, preflight or not, because the app could serve it as a page other than the one the rules matched
 * (see `hasDotDotSegment`). Browsers and crawlers resolve dot segments before sending, so a real visitor's path
 * almost never has one.
 */
export function decide(config: Config, cls: RequestClass, preflight: boolean, path: string): Action {
	if (cls === "human") return allow;

	// Only when there are rules, so a config without rules behaves as before, and only when something blocks or
	// charges, so an observe-only config never changes a response.
	const blocksDotDotPaths = config.rules.length > 0 && !allowsEverything(config);
	if (blocksDotDotPaths && hasDotDotSegment(path)) return { kind: "block" };

	// The path's most specific rule, or the top-level policy when no rule matches.
	const policy = ruleFor(config.rules, path) ?? config;
	if (policy.ai === "block") return { kind: "block" };
	if (policy.ai === "charge") return preflight ? allow : { kind: "charge", charge: policy.charge };
	return allow;
}

export function allowsEverything(config: Config): boolean {
	return config.ai === "allow" && config.rules.every((rule) => rule.ai === "allow");
}

/**
 * One line of the event log. `fairtoll` picks the line out of an app's other log lines, and is the
 * format version: it changes whenever the shape does, so `fairtoll report` can read older logs.
 */
export interface DecisionEvent {
	readonly fairtoll: 1;
	/** ISO 8601 time Fairtoll screened the request. */
	readonly time: string;
	/** The path the app routes the request by, without the query string. */
	readonly path: string;
	readonly class: RequestClass;
	readonly reason: string;
	/** The AI bot or agent the user-agent names, such as "GPTBot", when it names one. */
	readonly bot?: string;
	readonly action: Action["kind"];
	/** For a charged request, the price in dollars as the config wrote it, such as "0.002". */
	readonly price?: string;
	/** For a charged request, the network the price is in. On "base-sepolia" no real money moves. */
	readonly network?: Network;
	/** For a charged request, what happened to its payment (see `Payment`). */
	readonly payment?: Payment;
}

/**
 * What happened to a charged request's payment. "paid": it settled, and the page was served. "none": the
 * request sent no payment and got the 402 with the price. "rejected": it sent a payment that was refused, such
 * as a reused one, and got the 402. "failed": charging failed, such as when the facilitator couldn't be
 * reached, so the page was served unpaid.
 */
export type Payment = "paid" | "none" | "rejected" | "failed";

export type EventSink = (event: DecisionEvent) => void | Promise<void>;

/**
 * What `screen` decided, and how it classified the request. `classification` is missing when screening
 * failed, so there is nothing true to log.
 */
export interface Screened {
	readonly action: Action;
	readonly classification?: Classification;
}

/**
 * Classifies one request and decides what to do with it. It never throws: if a step fails, it reports the
 * error and allows the request, so the adapter serves the page as if Fairtoll weren't there.
 *
 * `method` and `path` are what the app routes the request by, with no query string in the path. The adapter
 * passes them, because a Web Request refuses some methods Express serves, and `request.url` resolves dot
 * segments and so can name a different page.
 */
export function screen(request: Request, method: string, path: string, config: Config): Screened {
	try {
		const classification = classify(request);
		// A browser's preflight always names the method it asks about, so an OPTIONS without one is charged.
		const preflight = method === "OPTIONS" && request.headers.has("access-control-request-method");
		// robots.txt is always served, so a blocked crawler can still read the site's rules. A 4xx there would
		// tell it the site has no rules at all.
		const action = path === "/robots.txt" ? allow : decide(config, classification.class, preflight, path);
		return { action, classification };
	} catch (error) {
		console.error("fairtoll: screening a request failed, so the request was passed through unscreened:", error);
		return { action: allow };
	}
}
