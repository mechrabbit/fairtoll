import { classify } from "./classify.js";
import type { Charge, Config } from "./config.js";
import { climbsUp, ruleFor } from "./paths.js";
import type { RequestClass } from "./types.js";

export type Action = { readonly kind: "allow" } | { readonly kind: "block" } | { readonly kind: "charge"; readonly charge: Charge };

const allow: Action = { kind: "allow" };

/**
 * Every request is charged except a CORS preflight, which is let through because a 402 there would break
 * every cross-origin request to the page. Many apps serve the page whatever the method, so a free POST or
 * other OPTIONS would be a way around the price. A bot can send a preflight's header too, so an app that
 * answers a preflight with the page still gives the page away.
 *
 * When the config has rules, an AI request whose path has a ".." segment is blocked, preflight or not, because
 * the rules and the app could read it as different pages (see `climbsUp`).
 */
export function decide(config: Config, cls: RequestClass, preflight: boolean, path: string): Action {
	if (cls === "human") return allow;
	// Such a path could name a page under one rule for the app and another for the rules, so it gets neither.
	if (config.rules.length > 0 && climbsUp(path)) return { kind: "block" };
	// The path's most specific rule, or the top-level policy when no rule matches.
	const policy = ruleFor(config.rules, path) ?? config;
	if (policy.ai !== "charge") return policy.ai === "block" ? { kind: "block" } : allow;
	return preflight ? allow : { kind: "charge", charge: policy.charge };
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
	readonly action: Action["kind"];
}

export type EventSink = (event: DecisionEvent) => void | Promise<void>;

/**
 * Classifies one request, decides what to do with it, and logs the decision. A human request isn't
 * logged, because that would add a line to the app's logs for every page view. An async log isn't
 * awaited, so it adds no wait before the request is handled. It never throws: if a step fails, it
 * reports the error and allows the request, so the adapter serves the page as if Fairtoll weren't there.
 *
 * `method` and `path` are what the app routes the request by, with no query string in the path. The adapter
 * passes them, because a Web Request refuses some methods Express serves, and `request.url` resolves dot
 * segments and so can name a different page.
 */
export function screen(request: Request, method: string, path: string, config: Config, log?: EventSink): Action {
	try {
		const { class: cls, reason } = classify(request);
		// A browser's preflight always names the method it asks about, so an OPTIONS without one is charged.
		const preflight = method === "OPTIONS" && request.headers.has("access-control-request-method");
		// robots.txt is always served, so a blocked crawler can still read the site's rules. A 4xx there would
		// tell it the site has no rules at all.
		const action = path === "/robots.txt" ? allow : decide(config, cls, preflight, path);
		if (cls !== "human" && log) {
			// The async wrapper turns anything in logging that throws into a rejection, so logging can't change the action.
			void (async () => {
				await log({ fairtoll: 1, time: new Date().toISOString(), path, class: cls, reason, action: action.kind });
			})().catch((error: unknown) => {
				console.error("fairtoll: logging a request failed, so its event was lost:", error);
			});
		}
		return action;
	} catch (error) {
		console.error("fairtoll: screening a request failed, so the request was passed through unscreened:", error);
		return allow;
	}
}
