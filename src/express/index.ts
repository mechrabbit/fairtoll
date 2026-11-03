import type { Request as ExpressRequest, RequestHandler } from "express";
import parseurl from "parseurl";
import { allowsEverything, chargesIn, createCharger, parseConfig, screen, type EventSink, type FacilitatorConfig } from "../core/index.js";

export interface Options {
	/**
	 * Receives each event, such as to send it to the app's own logger. Without it nothing is logged,
	 * because a path can carry a secret such as a reset token, so the publisher chooses where events go.
	 */
	readonly log?: EventSink;
	/**
	 * The x402 facilitator that settles payments, passed to x402's `HTTPFacilitatorClient`. It defaults to
	 * x402.org's, which only settles on testnets, so charging on "base" needs one with a `url`, such as
	 * Coinbase's from `createFacilitatorConfig` in `@coinbase/x402`.
	 */
	readonly facilitator?: FacilitatorConfig;
}

const blockedMessage = "This site does not allow AI bots or agents.\n";

/**
 * Express middleware that screens every request, answers a request the config blocks with a 403, charges a
 * request the config charges, and passes the rest on unchanged.
 * When charging, a payment settles before the app runs, so a bot pays for every request under the mount, a 404,
 * an image or a form it posts included. Mount it on the paths that hold the content, such as
 * `app.use("/articles", fairtoll(...))`. Only a CORS preflight is free, so the app must not answer one with
 * the page.
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
	const { config } = result;
	const { log, facilitator } = options;
	if (facilitator !== undefined && !isHttpUrl(typeof facilitator === "object" && facilitator !== null ? facilitator.url : undefined)) {
		throw new Error("Invalid fairtoll options: facilitator must be an object with an http or https url");
	}
	const chargers = new Map(chargesIn(config).map((charge) => [charge.price, createCharger(charge, facilitator)]));
	if (log === undefined && allowsEverything(config)) return (_req, _res, next) => next();

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
		const action = screen(request, req.method, path, config, log);
		if (action.kind === "block") {
			// The 403 depends on the user-agent, so a shared cache must not replay it to other visitors.
			res.status(403).set("Cache-Control", "no-store").type("text/plain").send(blockedMessage);
			return;
		}
		const charge = action.kind === "charge" ? chargers.get(action.charge.price) : undefined;
		if (charge) {
			// Express catches anything the outcome's handler throws, because the promise is returned to it.
			return charge(request, req.method, path).then(
				(outcome) => {
					if (outcome.kind === "respond") {
						res.status(outcome.status).set(outcome.headers).send(outcome.body);
						return;
					}
					res.set(outcome.headers);
					next();
				},
				(error: unknown) => {
					console.error("fairtoll: charging a request failed, so it was passed on without payment:", error);
					next();
				},
			);
		}
		next();
	};
}

/** `URL.canParse` alone accepts "localhost:8080", whose protocol is "localhost:", so the facilitator could never be reached. */
function isHttpUrl(url: unknown): boolean {
	return typeof url === "string" && URL.canParse(url) && ["http:", "https:"].includes(new URL(url).protocol);
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
