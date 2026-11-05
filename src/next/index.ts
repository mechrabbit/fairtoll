import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server.js";
import { createGate, type Gate, type Options } from "../core/index.js";

export type { Options };

/**
 * A Next.js 16 proxy (`proxy.ts`) that screens every request, answers a request
 * the config blocks with a 403, charges a request the config charges, and passes the rest on unchanged:
 *
 *     export const proxy = fairtoll(settings, { facilitator: { url: process.env.FACILITATOR_URL } });
 *
 * Rules match `request.nextUrl.pathname`, the path after `basePath`, which is what Next routes by. Rewrites in
 * `next.config` run after the proxy, so a rewrite from a free path to a charged page gives the page away: rules
 * cover the public paths, and no rewrite may point a free path at charged content. A static export has no proxy,
 * so Fairtoll can't run there. When charging, a payment settles before the page runs, so a bot pays for every
 * request the charge covers, as with Express. Only a CORS preflight is free.
 * An invalid config or option is reported when the proxy loads, and every request is then passed through
 * unscreened. It doesn't throw as the Express adapter does, because `next build` doesn't load the proxy, so a
 * throw would only show in production, as a 500 on every request.
 */
export function fairtoll(input: unknown, options: Options = {}): (request: NextRequest, event: NextFetchEvent) => Promise<Response> {
	let gate: Gate;
	try {
		gate = createGate(input, options);
	} catch (error) {
		console.error("fairtoll: every request will be passed through unscreened, because:", error);
		return async () => NextResponse.next();
	}
	if (gate.idle) return async () => NextResponse.next();
	return async (request, event) => {
		try {
			const { outcome, logged } = gate.check(request, request.method, request.nextUrl.pathname);
			// Vercel can stop the function once the response is sent, so the log is kept alive until it's written.
			event.waitUntil(logged);
			const result = await outcome;
			if (result.kind === "respond") return new Response(result.body, { status: result.status, headers: result.headers });
			return NextResponse.next({ headers: result.headers });
		} catch (error) {
			console.error("fairtoll: could not screen the request, so it was passed through unscreened:", error);
			return NextResponse.next();
		}
	};
}
