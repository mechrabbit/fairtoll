import { classify } from "./classify.js";
import type { Config } from "./config.js";
import { requestClasses, type RequestClass } from "./types.js";

export type Action = { readonly kind: "allow" } | { readonly kind: "block" };

const allow: Action = { kind: "allow" };

export function decide(config: Config, cls: RequestClass): Action {
	return cls !== "human" && config.ai === "block" ? { kind: "block" } : allow;
}

export function allowsEverything(config: Config): boolean {
	return requestClasses.every((cls) => decide(config, cls).kind === "allow");
}

/**
 * One line of the event log. `fairtoll` picks the line out of an app's other log lines, and is the
 * format version: it changes whenever the shape does, so `fairtoll report` can read older logs.
 */
export interface DecisionEvent {
	readonly fairtoll: 1;
	/** ISO 8601 time the request arrived. */
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
 * logged, because that would add a line to the app's logs for every page view. Logging finishes in the
 * background, so it adds no wait before the request is handled. It never throws: if a step fails, it
 * reports the error and allows the request, so the adapter serves the page as if Fairtoll weren't there.
 *
 * `path` is the path the app routes the request by, without the query string. The adapter passes it,
 * because `request.url` resolves dot segments and so can name a different page.
 */
export function screen(request: Request, path: string, config: Config, log?: EventSink): Action {
	try {
		const { class: cls, reason } = classify(request);
		const action = decide(config, cls);
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
