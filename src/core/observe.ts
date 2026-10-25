import type { Classification } from "./classify.js";
import type { RequestClass } from "./types.js";

export type Action = { readonly kind: "allow" };

/** With no rules to match, every request is allowed. */
export function decide(): Action {
	return { kind: "allow" };
}

/** One line of the event log. `v` changes whenever the shape does, so `fairtoll report` can read older logs. */
export interface DecisionEvent {
	readonly v: 1;
	/** ISO 8601 time the request arrived. */
	readonly time: string;
	/** The URL path, without the query string. */
	readonly path: string;
	readonly class: RequestClass;
	readonly reason: string;
	readonly action: Action["kind"];
}

export type EventSink = (event: DecisionEvent) => void | Promise<void>;

export interface Steps {
	readonly classify: (request: Request) => Classification;
	readonly decide: () => Action;
	readonly log: EventSink;
}

/**
 * Classifies, decides, and logs one request. It never throws: if a step fails, it reports
 * the error and returns, so the adapter serves the page as if Fairtoll weren't there.
 */
export async function observe(request: Request, steps: Steps): Promise<void> {
	try {
		const time = new Date().toISOString();
		const { class: cls, reason } = steps.classify(request);
		const action = steps.decide();
		await steps.log({ v: 1, time, path: new URL(request.url).pathname, class: cls, reason, action: action.kind });
	} catch (error) {
		console.error("fairtoll: observing a request failed, so the request was passed through unobserved:", error);
	}
}
