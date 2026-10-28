import type { Request as ExpressRequest, RequestHandler } from "express";
import { observe, parseConfig, type EventSink } from "../core/index.js";

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

	return (req, _res, next) => {
		try {
			const path = routedPath(req);
			void observe(toWebRequest(req, path), path, log);
		} catch (error) {
			console.error("fairtoll: could not read the request, so it was passed through unobserved:", error);
		}
		next();
	};
}

/**
 * The path Express routes the request by: its target without the origin or the query string. It is read from
 * the raw target because a URL resolves dot segments and backslashes, so /articles/%2e%2e/admin would become
 * /admin, a page Express didn't serve.
 */
function routedPath(req: ExpressRequest): string {
	// An absolute-form target such as http://host/articles/1 is routed by its path alone, so drop its origin.
	const path = req.originalUrl.replace(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i, "").split(/[?#]/, 1)[0] ?? "";
	return path.startsWith("/") ? path : `/${path}`;
}

/**
 * A Web Request with the request's headers. It has no body, so the app still reads the body itself.
 * The origin is fixed, because the Host header is client input and nothing reads it yet. The method is left
 * out for the same reason, and because a Web Request refuses methods such as TRACE that Express still serves.
 */
function toWebRequest(req: ExpressRequest, path: string): Request {
	const headers = new Headers();
	for (const [name, value] of Object.entries(req.headers)) {
		if (value === undefined) continue;
		for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
	}
	// Appending keeps a path such as //articles/1 a path, as Express routes it, rather than a host.
	return new Request(`${origin}${path}`, { headers });
}
