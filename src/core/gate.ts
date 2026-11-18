import { createCharger, type Charger, type FacilitatorConfig } from "./charge.js";
import { isPlainObject, parseConfig, withoutUnknownFields, type Charge } from "./config.js";
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
	/**
	 * Loads the config from the publisher's site on fairtoll.net, so prices and rules can change without a
	 * redeploy. The loaded config never sets `payTo` or `network`, which come from the config passed here, and it
	 * falls back to that config until a fetch succeeds. Without it nothing contacts fairtoll.net.
	 */
	readonly site?: Site;
}

export interface Site {
	/** The site's key from fairtoll.net. Keep it out of source control, such as in an environment variable. */
	readonly key: string;
	/** Where the config is fetched from. It defaults to fairtoll.net's, and is only for testing. */
	readonly url?: string;
}

/**
 * What the adapter does with a request. `respond` answers it with a 403 or a 402 instead of the page. `pass`
 * serves the page with `headers` added, which are empty unless the request paid.
 */
export type Outcome =
	| { readonly kind: "respond"; readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: string }
	| { readonly kind: "pass"; readonly headers: Readonly<Record<string, string>> };

/**
 * `outcome` never rejects. `logged` settles once the request's log has, along with any config fetch the request
 * started, and never rejects, so a runtime that can stop work once the response is sent can keep it alive with
 * `waitUntil`.
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
// Shared by every request passed on unpaid, so it is frozen: an adapter that wrote to it would change them all.
const pass: Outcome = Object.freeze({ kind: "pass", headers: Object.freeze({}) });

/**
 * What every adapter shares: screen a request, then answer a block with a 403, a charge with x402's 402 or the
 * paid page, and pass the rest on. It needs no runtime, so each adapter only turns its request into a Web
 * Request and the outcome into its response. It fails open: when charging fails, such as when the facilitator
 * can't be reached, the request is passed on unpaid.
 * An invalid config or option throws here, so the adapter can report a mistake before it serves a request.
 */
export function createGate(input: unknown, options: Options = {}): Gate {
	const { site, ...rest } = options;
	if (site !== undefined) return createSiteGate(input, site, (config) => createGate(config, rest));
	const result = parseConfig(input);
	if (!result.ok) {
		throw new Error(`Invalid fairtoll config:\n${result.errors.map((e) => `  ${e.field} ${e.message}`).join("\n")}`);
	}
	if (options.log !== undefined && typeof options.log !== "function") {
		throw new Error("Invalid fairtoll options: log must be a function");
	}
	const { config } = result;
	const { log, facilitator } = options;
	const facilitatorUrl: unknown = typeof facilitator === "object" && facilitator !== null ? facilitator.url : undefined;
	if (facilitator !== undefined && !isHttpUrl(facilitatorUrl)) {
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

const defaultSiteUrl = "https://fairtoll.net/v1/config";
/**
 * This package's version, sent with each config fetch, so the dashboard can say when a feature needs an update and
 * can tell when no site uses an old URL any more. A test keeps it the same as package.json's.
 */
export const packageVersion = "0.2.0";
/** How long a loaded config is used before a request fetches it again. A failed fetch waits as long. */
const refreshAfterMs = 60_000;
/** How long requests wait for the first fetch, so a fresh process doesn't serve free pages while it runs. */
const firstFetchWaitMs = 1_000;
const fetchTimeoutMs = 5_000;

/**
 * A gate whose config comes from the site on fairtoll.net. The fetched config sets `ai`, `price` and `rules`, and
 * `payTo` and `network` always come from `input`, so the service can change prices but never where money goes.
 * - Until a fetch succeeds, `input` is the config, so it doubles as the fallback.
 * - Requests wait for the first fetch, until `firstFetchWaitMs` after it started, so a slow fetch delays only
 *   the requests in that window, and none by more than `firstFetchWaitMs`.
 * - After that no request waits. One that finds the config older than `refreshAfterMs` starts a fetch in the
 *   background, and it and every request until the fetch ends use the config already loaded.
 * - A fetched field this version doesn't know is ignored with a warning, so fairtoll.net can add fields, unless the
 *   config lists it in `requires` (see `withoutUnknownFields`).
 * - A fetch that fails, or brings a config `build` refuses, prints the error and keeps the last config.
 * `build` makes the gate for one config, and throws on an invalid one.
 */
function createSiteGate(input: unknown, site: Site, build: (config: unknown) => Gate): Gate {
	const { key, url } = siteOptions(site);
	// Throws on an invalid input, so it's a plain object after this line.
	let gate = build(input);
	const local = input as Record<string, unknown>;
	const wallet = { payTo: local.payTo, network: local.network };

	let loadedBody: string | undefined;
	let fetching: Promise<void> | undefined;
	let fetchStartedAt = 0;
	// Counts fetches, so one that was abandoned and ends late can be told apart from the current one.
	let fetchCount = 0;
	let nextFetchAt = 0;
	let firstFetchEnded = false;
	let firstWaitEndsAt: number | undefined;

	async function load(fetchNumber: number): Promise<void> {
		const response = await fetch(url, { headers: { Authorization: `Bearer ${key}`, "Fairtoll-Version": packageVersion }, signal: AbortSignal.timeout(fetchTimeoutMs) });
		if (!response.ok) throw new Error(`${url} answered ${response.status}`);
		const body = await response.text();
		// A fetch that was abandoned and ends late must not put back an older config.
		if (fetchNumber !== fetchCount) return;
		// The same config again keeps the gate, and its chargers' started facilitators.
		if (body === loadedBody) return;
		const fetched: unknown = JSON.parse(body);
		if (!isPlainObject(fetched)) throw new Error("the fetched config is not a JSON object");
		if (Object.hasOwn(fetched, "payTo") || Object.hasOwn(fetched, "network")) {
			throw new Error("the fetched config sets payTo or network, which only the config in your code can set");
		}
		// The fields this version knows are checked as strictly as a config in code.
		const { config, ignored } = withoutUnknownFields(fetched);
		gate = build({ ...config, ...wallet });
		loadedBody = body;
		if (ignored.length > 0) console.warn(`fairtoll: the config from ${url} has fields this version doesn't know, which were ignored: ${ignored.join(", ")}`);
	}

	/**
	 * The fetch in progress, starting one if the config is due. It never rejects. A fetch that has run for twice its
	 * timeout is treated as abandoned, because a runtime that stops a request's work, such as a Worker after the
	 * response, can leave its promise unsettled forever, and that would stop every later refresh.
	 */
	function refresh(): Promise<void> {
		const abandoned = fetching !== undefined && Date.now() - fetchStartedAt > 2 * fetchTimeoutMs;
		if ((fetching === undefined || abandoned) && Date.now() >= nextFetchAt) {
			fetchStartedAt = Date.now();
			const current: Promise<void> = load(++fetchCount)
				.catch((error: unknown) => console.error(`fairtoll: could not load the config from ${url}, so the last one is kept:`, error))
				.finally(() => {
					// An abandoned fetch that ends late leaves the schedule to the fetch that replaced it.
					if (fetching !== current) return;
					fetching = undefined;
					firstFetchEnded = true;
					nextFetchAt = Date.now() + refreshAfterMs;
				});
			fetching = current;
		}
		return fetching ?? Promise.resolve();
	}

	return {
		idle: false,
		check(request, method, path) {
			const fetched = refresh();
			firstWaitEndsAt ??= Date.now() + firstFetchWaitMs;
			const wait = firstFetchEnded ? 0 : firstWaitEndsAt - Date.now();
			const ready = wait > 0 ? Promise.race([fetched, delay(wait)]) : Promise.resolve();
			const checked = ready.then(() => gate.check(request, method, path));
			return {
				outcome: checked.then((c) => c.outcome),
				logged: Promise.all([checked.then((c) => c.logged), fetched]).then(() => undefined),
			};
		},
	};
}

/** The site's key and url, or a throw saying which is wrong. */
function siteOptions(site: unknown): { key: string; url: string } {
	if (typeof site !== "object" || site === null) throw new Error("Invalid fairtoll options: site must be an object with a key");
	const { key, url: given } = site as Record<string, unknown>;
	const url = given ?? defaultSiteUrl;
	// Printable ASCII only, so a key with a stray newline, such as from a secrets file, fails here and not on every fetch.
	if (typeof key !== "string" || !/^[\x21-\x7e]+$/.test(key)) {
		throw new Error("Invalid fairtoll options: site.key must be a non-empty string of printable characters with no spaces");
	}
	// The key travels with every fetch, so plain http is only for a service on this machine, such as the demo's.
	if (!isHttpUrl(url) || (new URL(url).protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname))) {
		throw new Error("Invalid fairtoll options: site.url must be an https url, or http on localhost");
	}
	return { key, url };
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `URL.canParse` alone accepts "localhost:8080", whose protocol is "localhost:", so the facilitator could never be reached. */
function isHttpUrl(url: unknown): url is string {
	return typeof url === "string" && URL.canParse(url) && ["http:", "https:"].includes(new URL(url).protocol);
}
