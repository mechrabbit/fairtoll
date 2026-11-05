import { createCharger, type Charger, type FacilitatorConfig } from "./charge.js";
import { parseConfig, type Charge } from "./config.js";
import { allowsEverything, screen, type Action, type EventSink } from "./screen.js";

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

/**
 * What the adapter does with a request. `respond` answers it with a 403 or a 402 instead of the page. `pass`
 * serves the page with `headers` added, which are empty unless the request paid.
 */
export type Outcome =
	| { readonly kind: "respond"; readonly status: number; readonly headers: Record<string, string>; readonly body: string }
	| { readonly kind: "pass"; readonly headers: Record<string, string> };

/**
 * `outcome` never rejects. `logged` settles once the request's log has, and never rejects, so a runtime
 * that can stop work once the response is sent can keep it alive with `waitUntil`.
 */
export interface Checked {
	readonly outcome: Promise<Outcome>;
	readonly logged: Promise<void>;
}

export interface Gate {
	/** True when no request can be blocked, charged or logged, so the adapter can pass every request on unread. */
	readonly idle: boolean;
	/** `method` and `path` are what the app routes the request by, as `screen` takes them. */
	check(request: Request, method: string, path: string): Checked;
}

const blockedMessage = "This site does not allow AI bots or agents.\n";
const pass: Outcome = { kind: "pass", headers: {} };

/**
 * What every adapter shares: screen a request, then answer a block with a 403, a charge with x402's 402 or the
 * paid page, and pass the rest on. It needs no runtime, so each adapter only turns its request into a Web
 * Request and the outcome into its response. It fails open: when charging fails, such as when the facilitator
 * can't be reached, the request is passed on unpaid.
 * An invalid config or option throws here, so the adapter can report a mistake before it serves a request.
 */
export function createGate(input: unknown, options: Options = {}): Gate {
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
	// One charger for each distinct price, wallet and network, all made now. Every charge a request can get comes
	// from one of these policies, so a charge that can't work, such as on "base" without a facilitator, throws here
	// and not on a request.
	const chargerKey = (charge: Charge) => `${charge.price} ${charge.payTo} ${charge.network}`;
	const chargers = new Map<string, Charger>();
	for (const policy of [config, ...config.rules]) {
		if (policy.ai !== "charge") continue;
		const key = chargerKey(policy.charge);
		if (!chargers.has(key)) chargers.set(key, createCharger(policy.charge, facilitator));
	}

	// Never rejects: when charging fails, such as when the facilitator can't be reached, the request is passed on unpaid.
	async function outcomeFor(action: Action, request: Request, method: string, path: string): Promise<Outcome> {
		if (action.kind === "allow") return pass;
		if (action.kind === "block") {
			// The 403 depends on the user-agent, so a shared cache must not replay it to other visitors.
			const headers = { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" };
			return { kind: "respond", status: 403, headers, body: blockedMessage };
		}
		try {
			const charger = chargers.get(chargerKey(action.charge));
			// Can't happen, because every policy's charger was made above.
			if (charger === undefined) throw new Error("no charger was made at startup for this charge");
			const outcome = await charger(request, method, path);
			return outcome.kind === "paid" ? { kind: "pass", headers: outcome.headers } : outcome;
		} catch (error) {
			console.error("fairtoll: charging a request failed, so it was passed on without payment:", error);
			return pass;
		}
	}

	return {
		idle: log === undefined && allowsEverything(config),
		check(request, method, path) {
			const { action, logged } = screen(request, method, path, config, log);
			return { outcome: outcomeFor(action, request, method, path), logged };
		},
	};
}

/** `URL.canParse` alone accepts "localhost:8080", whose protocol is "localhost:", so the facilitator could never be reached. */
function isHttpUrl(url: unknown): boolean {
	return typeof url === "string" && URL.canParse(url) && ["http:", "https:"].includes(new URL(url).protocol);
}
