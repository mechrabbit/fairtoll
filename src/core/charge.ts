import {
	FacilitatorResponseError,
	HTTPFacilitatorClient,
	x402HTTPResourceServer,
	x402ResourceServer,
	type FacilitatorClient,
	type FacilitatorConfig,
	type HTTPAdapter,
	type HTTPRequestContext,
	type HTTPResponseInstructions,
} from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { networks, type Charge } from "./config.js";

export type { FacilitatorConfig };

/**
 * What the adapter does with a request it charges. `respond` is a 402 with the price, for a request that
 * hasn't paid or whose payment the facilitator rejected. `paid` means the payment has settled, so the
 * adapter adds the headers, which carry the transaction, and serves the page.
 */
export type ChargeOutcome =
	| { readonly kind: "respond"; readonly status: number; readonly headers: Record<string, string>; readonly body: string }
	| { readonly kind: "paid"; readonly headers: Record<string, string> };

/**
 * Charges a request through x402. It rejects only when the facilitator can't be reached, so the adapter can
 * serve the page for free rather than break the site. A payment the facilitator rejects comes back as a
 * 402, so a reused or forged payment never gets the page.
 *
 * `method` and `path` are what the app routes the request by, as `screen` takes them.
 */
export type Charger = (request: Request, method: string, path: string) => Promise<ChargeOutcome>;

/** Long enough for a Base transaction to land, short enough that a stuck facilitator doesn't hold the page for long. */
const facilitatorTimeoutMs = 10_000;

/** How long after a failed start the facilitator is left alone, so an outage doesn't hold every bot's page for the timeout. */
const retryStartAfterMs = 30_000;

/**
 * Makes the charger for a config. It asks the facilitator what it supports on the first charged request,
 * not here, because a Worker can't make requests at startup. `facilitator` defaults to x402.org's, which
 * only settles on testnets, so charging on "base" throws without a facilitator URL.
 */
export function createCharger(charge: Charge, facilitator: FacilitatorConfig = {}): Charger {
	if (charge.network === "base" && !facilitator.url) {
		throw new Error('charging on "base" needs a facilitator URL, because the default facilitator only settles on testnets');
	}
	const client = reportingUnreachable(new HTTPFacilitatorClient({ timeoutMs: facilitatorTimeoutMs, ...facilitator }));
	const server = new x402HTTPResourceServer(new x402ResourceServer(client).register(networks[charge.network], new ExactEvmScheme()), {
		// Fairtoll has already decided this request is charged, so x402's own route table charges every path.
		"*": {
			accepts: {
				scheme: "exact",
				network: networks[charge.network],
				payTo: charge.payTo,
				price: charge.price,
				// Settle before the page is served, so no byte of it leaves unpaid and the response needn't be held back.
				extra: { paymentFlow: "upfront" },
			},
		},
	});
	let ready: Promise<void> | undefined;
	let failedAt = -Infinity;
	let lastStartError: unknown;

	return async (request, method, path) => {
		// A failed start is tried again after a while, so a facilitator that comes back is used again.
		if (Date.now() - failedAt < retryStartAfterMs) {
			throw new Error(`the facilitator failed to start less than ${retryStartAfterMs / 1000} seconds ago`, { cause: lastStartError });
		}
		ready ??= server.initialize().catch((error: unknown) => {
			ready = undefined;
			failedAt = Date.now();
			lastStartError = error;
			throw error;
		});
		await ready;
		// No payment is read from a HEAD request, so it gets the price and is never charged for an empty body.
		const payment = method === "HEAD" ? undefined : (request.headers.get("payment-signature") ?? undefined);
		const adapter: HTTPAdapter = {
			getHeader: (name) => (name.toLowerCase() === "payment-signature" ? payment : (request.headers.get(name) ?? undefined)),
			getMethod: () => method,
			getPath: () => path,
			// The 402 names the resource by its path, because the Host header is client input.
			getUrl: () => path,
			// x402 answers a browser with its paywall page, which loads a wallet UI. A bot has no use for it.
			getAcceptHeader: () => "",
			getUserAgent: () => request.headers.get("user-agent") ?? "",
		};
		const context: HTTPRequestContext = { adapter, path, method };
		const result = await server.processHTTPRequest(context);
		if (result.type === "payment-error") return respond(result.response);
		if (result.type === "no-payment-required") throw new Error("x402 found no route for a charged request");
		// The upfront flow has settled by now, and a rejected settle came back above as a payment-error.
		if (!result.beforeHandlerSettlement) throw new Error("x402 verified a payment without settling it");
		// The receipt names the payer, so x402 marks it private, and a shared cache doesn't replay it to other visitors.
		return { kind: "paid", headers: server.createCompletedSettlementHeaders(result.beforeHandlerSettlement) };
	};
}

function respond(response: HTTPResponseInstructions): ChargeOutcome {
	const body = typeof response.body === "string" ? response.body : JSON.stringify(response.body ?? {});
	// The 402 depends on the request's payment, so a shared cache must not replay it to other visitors.
	return { kind: "respond", status: response.status, headers: { ...response.headers, "Cache-Control": "no-store" }, body };
}

/**
 * x402 turns any facilitator error into a 402 except a `FacilitatorResponseError`, which it throws, and which
 * covers a timeout and a 200 whose body isn't a valid answer. Fetch rejects with a `TypeError` when it can't
 * connect, so that becomes one too. A facilitator that answers with an error status still gets the bot a
 * 402, because a payment crafted to make the facilitator fail must not get the page for free.
 *
 * Only `settle` needs this: the upfront flow never calls `verify`, and Fairtoll serves the page for free
 * whenever starting, which calls `getSupported`, fails.
 */
function reportingUnreachable(client: FacilitatorClient): FacilitatorClient {
	const reached = async <T>(call: () => Promise<T>): Promise<T> => {
		try {
			return await call();
		} catch (error) {
			if (error instanceof TypeError) throw new FacilitatorResponseError(`Facilitator could not be reached: ${error.message}`);
			throw error;
		}
	};
	return {
		verify: (payload, requirements) => client.verify(payload, requirements),
		settle: (payload, requirements) => reached(() => client.settle(payload, requirements)),
		getSupported: () => client.getSupported(),
	};
}
