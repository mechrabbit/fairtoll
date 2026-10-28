import { classify } from "./classify.js";
import type { Config } from "./config.js";
import type { RequestClass } from "./types.js";

export type Action = { readonly kind: "allow" } | { readonly kind: "block" } | { readonly kind: "charge" };

const allow: Action = { kind: "allow" };

/**
 * Only GET and HEAD are charged, and a HEAD only ever gets the price. OPTIONS is let through, because a 402
 * there would break every cross-origin request to the page. Any other method is blocked, because many apps
 * serve the page whatever the method, and a payment settled before a POST runs would pay for a form.
 */
export function decide(config: Config, cls: RequestClass, method: string): Action {
	if (cls === "human" || config.ai === "allow") return allow;
	if (config.ai === "block") return { kind: "block" };
	if (method === "GET" || method === "HEAD") return { kind: "charge" };
	return method === "OPTIONS" ? allow : { kind: "block" };
}

export function allowsEverything(config: Config): boolean {
	return config.ai === "allow";
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
		// robots.txt is always served, so a blocked crawler can still read the site's rules. A 4xx there would
		// tell it the site has no rules at all.
		const action = path === "/robots.txt" ? allow : decide(config, cls, method);
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
