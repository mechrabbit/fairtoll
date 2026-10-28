import { classify } from "./classify.js";
import type { RequestClass } from "./types.js";

/**
 * One line of the event log. `fairtoll` picks the line out of an app's other log lines, and is the
 * format version: it changes whenever the shape does, so `fairtoll report` can read older logs.
 */
export interface DecisionEvent {
	readonly fairtoll: 1;
	/** ISO 8601 time the request arrived. */
	readonly time: string;
	/** The URL path, without the query string. */
	readonly path: string;
	readonly class: RequestClass;
	readonly reason: string;
	/** With no rules to match yet, every request is allowed. */
	readonly action: "allow";
}

export type EventSink = (event: DecisionEvent) => void | Promise<void>;

/**
 * Classifies and logs one request. A human request isn't logged, because that would add a line to the
 * app's logs for every page view. It never throws: if a step fails, it reports the error and returns,
 * so the adapter serves the page as if Fairtoll weren't there.
 */
export async function observe(request: Request, log: EventSink): Promise<void> {
	try {
		const time = new Date().toISOString();
		const { class: cls, reason } = classify(request);
		if (cls === "human") return;
		await log({ fairtoll: 1, time, path: new URL(request.url).pathname, class: cls, reason, action: "allow" });
	} catch (error) {
		console.error("fairtoll: observing a request failed, so the request was passed through unobserved:", error);
	}
}
