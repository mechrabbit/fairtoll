// The Next.js demo's one proxy. Next allows one per app, so it sends each endpoint's requests to that endpoint's
// Fairtoll, the way a site with its own proxy calls Fairtoll's first. Logging is on, so each AI request prints
// the event Fairtoll logged. Each request prints a line, then the event, then what Fairtoll answered.
import { NextRequest, NextResponse } from "next/server.js";
import { fairtoll } from "../../dist/next/index.js";
import { visitors } from "../visitors.js";

const options = { log: (event) => console.log(`   logged ${JSON.stringify(event)}`) };
const charging = { ai: "charge", price: "0.002", payTo: "0x000000000000000000000000000000000000dEaD", network: "base-sepolia" };
// /charged settles through the stand-in facilitator in app/facilitator, on this same server.
const facilitator = { url: `http://localhost:${process.env.PORT ?? 3000}/facilitator` };
const endpoints = {
	"/monitor": fairtoll({}, options),
	"/blocked": fairtoll({ ai: "block" }, options),
	"/charged": fairtoll(charging, { ...options, facilitator }),
};

export async function proxy(request, event) {
	// A Demo-Visitor header, such as `Demo-Visitor: GPTBot`, becomes that visitor's user-agent in the request
	// Fairtoll sees, without the header itself. The page still gets the original headers. Any capitalisation of
	// the name works.
	const named = request.headers.get("demo-visitor");
	if (named !== null) {
		const visitor = Object.keys(visitors).find((name) => name.toLowerCase() === named.toLowerCase());
		if (visitor === undefined) {
			return new Response(`Unknown Demo-Visitor "${named}". Known visitors: ${Object.keys(visitors).join(", ")}\n`, { status: 400 });
		}
		const headers = new Headers(request.headers);
		headers.set("user-agent", visitors[visitor]);
		headers.delete("demo-visitor");
		request = new NextRequest(request, { headers });
	}
	const { pathname } = request.nextUrl;
	console.log(`${request.method} ${pathname}   user-agent: ${request.headers.get("user-agent") ?? "none"}`);
	const endpoint = Object.keys(endpoints).find((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
	const response = endpoint ? await endpoints[endpoint](request, event) : NextResponse.next();
	// NextResponse.next() marks a response that carries on to the page.
	console.log(response.headers.has("x-middleware-next") ? "   passed on to the page" : `   response ${response.status}`);
	return response;
}

export const config = { matcher: ["/open/:path*", "/monitor/:path*", "/blocked/:path*", "/charged/:path*"] };
