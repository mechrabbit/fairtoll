import type { Request as ExpressRequest, RequestHandler } from "express";
import { classify, decide, observe, parseConfig } from "../core/index.js";
import { fileSink } from "../node/file-sink.js";

const defaultEventLog = "fairtoll-events.jsonl";
const origin = "http://localhost";

/**
 * Express middleware that observes every request and passes it on unchanged.
 * An invalid config throws here, so a mistake shows at startup and not on a request.
 */
export function fairtoll(input: unknown): RequestHandler {
	const result = parseConfig(input);
	if (!result.ok) {
		throw new Error(`Invalid fairtoll config:\n${result.errors.map((e) => `  ${e.field} ${e.message}`).join("\n")}`);
	}
	const steps = { classify, decide, log: fileSink(result.config.eventLog ?? defaultEventLog) };

	// Logging finishes in the background, so observing adds no wait before the app handles the request.
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
		for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(name, item);
	}
	// Appending keeps a target such as //articles/1 a path, as Express routes it, rather than a host.
	const url = req.originalUrl.startsWith("/") ? `${origin}${req.originalUrl}` : new URL(req.originalUrl, origin);
	return new Request(url, { headers });
}
