import { classify } from "./classify.js";
import { actionsIn, type Action, type Config } from "./config.js";
import { readPath, ruleFor } from "./paths.js";
import type { RequestClass } from "./types.js";

const allow: Action = { kind: "allow" };
const block: Action = { kind: "block" };

/**
 * A request a charge covers is charged unless it's a CORS preflight, which is let through because a 402 there
 * would break every cross-origin request to the page. Many apps serve the page whatever the method, so a free
 * POST or other OPTIONS would be a way around the price. A bot can send a preflight's header too, so an app
 * that answers a preflight with the page still gives the page away.
 */
export function decide(config: Config, cls: RequestClass, preflight: boolean, path: string): Action {
	if (cls === "human") return allow;
	const action = actionAt(config, path);
	if (action.kind === "charge" && preflight) return allow;
	return action;
}

/**
 * What an AI request gets at `path`. Without rules the path isn't read, so `ai` alone decides. A path that
 * can't be read safely, such as one with a ".." segment, is blocked while anything blocks or charges, because
 * the app could read it as a path some rule covers. While everything allows, it is allowed, so turning on
 * logging never changes a response.
 */
function actionAt(config: Config, path: string): Action {
	if (config.rules.exact.size === 0 && config.rules.under.size === 0) return config.ai;
	const read = readPath(path);
	if (read.kind === "unreadable") return allowsEverything(config) ? allow : block;
	return ruleFor(config.rules, read.key) ?? config.ai;
}

export function allowsEverything(config: Config): boolean {
	return actionsIn(config).every((action) => action.kind === "allow");
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
