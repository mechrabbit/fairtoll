import type { Request as ExpressRequest, RequestHandler } from "express";
import { classify, decide, observe, parseConfig, type EventSink } from "../core/index.js";

const origin = "http://localhost";

export interface Options {
	/**
	 * Receives each event, such as to send it to the app's own logger. Without it nothing is logged,
	 * because a path can carry a secret such as a reset token, so the publisher chooses where events go.
	 */
	readonly log?: EventSink;
}

/**
 * Express middleware that observes every request and passes it on unchanged.
 * An invalid config or option throws here, so a mistake shows at startup and not on a request.
 */
export function fairtoll(input: unknown, options: Options = {}): RequestHandler {
	const result = parseConfig(input);
	if (!result.ok) {
		throw new Error(`Invalid fairtoll config:\n${result.errors.map((e) => `  ${e.field} ${e.message}`).join("\n")}`);
	}
	if (options.log !== undefined && typeof options.log !== "function") {
		throw new Error("Invalid fairtoll options: log must be a function");
	}
	const { log } = options;
	// Observing has no other output yet, so with nothing to log there is nothing to run.
	if (log === undefined) return (_req, _res, next) => next();
	const steps = { classify, decide, log };

	// An async log finishes in the background, so it adds no wait before the app handles the request.
	// A synchronous log runs before the app does.
	return (req, _res, next) => {
		try {
			void observe(toWebRequest(req), steps);
		} catch (error) {
			console.error("fairtoll: could not read the request, so it was passed through unobserved:", error);
		}
		next();
	};
}

/**
 * A Web Request with the request's path and headers. It has no body, so the app still reads the body itself.
 * The origin is fixed, because the Host header is client input and nothing reads it yet. The method is left
 * out for the same reason, and because a Web Request refuses methods such as TRACE that Express still serves.
 */
function toWebRequest(req: ExpressRequest): Request {
	const headers = new Headers();
	for (const [name, value] of Object.entries(req.headers)) {
		if (value === undefined) continue;
		for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
	}
	// An absolute-form target such as http://host/articles/1 is routed by its path alone, so drop its origin.
	// Appending keeps a target such as //articles/1 a path, as Express routes it, rather than a host.
	const target = req.originalUrl.replace(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i, "");
	return new Request(`${origin}${target.startsWith("/") ? "" : "/"}${target}`, { headers });
}
