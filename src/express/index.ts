import type { Request as ExpressRequest, RequestHandler } from "express";
import parseurl from "parseurl";
import { createGate, type Options } from "../core/index.js";

export type { Options };

/**
 * Express middleware that screens every request, answers a request the config blocks with a 403, charges a
 * request the config charges, and passes the rest on unchanged.
 * When charging, a payment settles before the app runs, so a bot pays for every request the charge covers, a 404,
 * an image or a form it posts included. Scope it to the paths that hold the content with rules, such as
 * `{ path: "/articles/*", ai: "charge" }`, and mount it at the root. Mounting it on a path instead, such as
 * `app.use("/articles", fairtoll(...))`, can be got around when a static file server serves the same files from
 * the root, because /x/..%2farticles/1 never reaches Fairtoll. Only a CORS preflight is free, so the app must
 * not answer one with the page.
 * An invalid config or option throws here, so a mistake shows at startup and not on a request.
 */
export function fairtoll(input: unknown, options: Options = {}): RequestHandler {
	const gate = createGate(input, options);
	if (gate.idle) return (_req, _res, next) => next();

	return (req, res, next) => {
		let request: Request;
		let path: string;
		try {
			request = toWebRequest(req);
			// The path Express routes by, from the parser Express itself uses. A Web Request's URL can't carry it,
			// because a URL resolves dot segments and backslashes: /articles/%2e%2e/admin would become /admin.
			path = parseurl.original(req)?.pathname ?? "";
		} catch (error) {
			console.error("fairtoll: could not read the request, so it was passed through unscreened:", error);
			next();
			return;
		}
		// Express catches anything this throws, because the promise is returned to it. The log needs no waiting
		// for, because a Node server keeps running after the response is sent.
		return gate.check(request, req.method, path).outcome.then((outcome) => {
			if (outcome.kind === "respond") {
				res.status(outcome.status).set(outcome.headers).send(outcome.body);
				return;
			}
			res.set(outcome.headers);
			next();
		});
	};
}

/**
 * A Web Request with the request's headers. It has no body, so the app still reads the body itself. Its URL
 * is fixed, because the Host header is client input and nothing reads the URL yet. The method is left
 * out for the same reason, and because a Web Request refuses methods such as TRACE that Express still serves.
 */
function toWebRequest(req: ExpressRequest): Request {
	const headers = new Headers();
	for (const [name, value] of Object.entries(req.headers)) {
		if (value === undefined) continue;
		for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
	}
	return new Request("http://localhost/", { headers });
}
