import { createCharger, type Charger, type FacilitatorConfig } from "./charge.js";
import { isPlainObject, parseConfig, withoutUnknownFields, type Charge } from "./config.js";
import { allowsEverything, screen, type Action, type DecisionEvent, type EventSink, type Payment } from "./screen.js";

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
	/**
	 * Sends fairtoll.net each event that `log` would get, so the dashboard can show the site's AI traffic and what it
	 * earned. It is off unless set to true, because an event carries the path, which can hold a secret such as a reset
	 * token. Each event is posted on its own to `events` next to `url`, such as https://fairtoll.net/v1/events, and
	 * an event that can't be sent is reported and dropped, never retried, along with every event for 30 seconds after it.
	 */
	readonly events?: boolean;
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
const nothingLogged = Promise.resolve();

/**
 * What every adapter shares: screen a request, then answer a block with a 403, a charge with x402's 402 or the
 * paid page, and pass the rest on. It needs no runtime, so each adapter only turns its request into a Web
 * Request and the outcome into its response. It fails open: when charging fails, such as when the facilitator
 * can't be reached, the request is passed on unpaid.
 * An invalid config or option throws here, so the adapter can report a mistake before it serves a request.
 */
export function createGate(input: unknown, options: Options = {}): Gate {
	// Checked before `site`, which wraps the log in one that also sends events.
	if (options.log !== undefined && typeof options.log !== "function") {
		throw new Error("Invalid fairtoll options: log must be a function");
	}
	const { site, ...rest } = options;
	if (site !== undefined) return createSiteGate(input, site, rest);
	const result = parseConfig(input);
	if (!result.ok) {
		throw new Error(`Invalid fairtoll config:\n${result.errors.map((e) => `  ${e.field} ${e.message}`).join("\n")}`);
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

	/**
	 * The outcome, and for a charged request what happened to its payment. Never rejects: when charging fails, such
	 * as when the facilitator can't be reached, the request is passed on unpaid.
	 */
	async function outcomeFor(action: Action, request: Request, method: string, path: string): Promise<{ outcome: Outcome; payment?: Payment }> {
		if (action.kind === "allow") return { outcome: pass };
		if (action.kind === "block") {
			// The 403 depends on the user-agent, so a shared cache must not replay it to other visitors.
			const headers = { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" };
			return { outcome: { kind: "respond", status: 403, headers, body: blockedMessage } };
		}
		try {
			const charger = chargers.get(chargerKey(action.charge));
			// Can't happen, because every policy's charger was made above.
			if (charger === undefined) throw new Error("no charger was made at startup for this charge");
			const charged = await charger(request, method, path);
			if (charged.kind === "paid") return { outcome: { kind: "pass", headers: charged.headers }, payment: "paid" };
			const { payment, ...outcome } = charged;
			return { outcome, payment };
		} catch (error) {
			console.error("fairtoll: charging a request failed, so it was passed on without payment:", error);
			return { outcome: pass, payment: "failed" };
		}
	}

	return {
		idle: log === undefined && allowsEverything(config),
		check(request, method, path) {
			const screenedAt = Date.now();
			const { action, classification } = screen(request, method, path, config);
			const decided = outcomeFor(action, request, method, path);
			const outcome = decided.then((d) => d.outcome);
			// A human request isn't logged, because that would add a line to the app's logs for every page view.
			if (log === undefined || classification === undefined || classification.class === "human") return { outcome, logged: nothingLogged };
			// Logged once the outcome is known, so a charged request's event says whether it paid. Anything in logging
			// that throws becomes a rejection here, and is reported, so logging can't change the outcome.
			const logged = decided
				.then(async ({ payment }) => {
					const event: DecisionEvent = {
						fairtoll: 1,
						time: new Date(screenedAt).toISOString(),
						path,
						class: classification.class,
						reason: classification.reason,
						...(classification.bot !== undefined && { bot: classification.bot }),
						action: action.kind,
						...(action.kind === "charge" && { price: action.charge.price, network: action.charge.network, payment }),
					};
					await log(event);
				})
				.catch((error: unknown) => {
					console.error("fairtoll: logging a request failed, so its event was lost:", error);
				});
			return { outcome, logged };
		},
	};
}

const defaultSiteUrl = "https://fairtoll.net/v1/config";
/**
 * This package's version, sent with each config fetch, so the dashboard can say when a feature needs an update and
 * can tell when no site uses an old URL any more. A test keeps it the same as package.json's.
 */
export const packageVersion = "0.1.0";
/** How long a loaded config is used before a request fetches it again. A failed fetch waits as long. */
const refreshAfterMs = 60_000;
/** How long requests wait for the first fetch, so a fresh process doesn't serve free pages while it runs. */
const firstFetchWaitMs = 1_000;
const fetchTimeoutMs = 5_000;
/** How long events are dropped after one fails to send. */
const pauseAfterFailureMs = 30_000;

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
 * - A fetch that fails, or brings a config the gate refuses, prints the error and keeps the last config.
 * - With `events`, each event goes to fairtoll.net as well as to `log`, if there is one.
 */
function createSiteGate(input: unknown, site: Site, options: Omit<Options, "site">): Gate {
	const { key, url, events } = siteOptions(site);
	const gateOptions = events ? { ...options, log: sendingEvents(new URL("events", url).href, key, options.log) } : options;
	const build = (config: unknown) => createGate(config, gateOptions);
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

/**
 * A log that posts each event to `url` and passes it to `log`, if there is one. A failed post is reported here, so
 * an error that reaches the gate is always `log`'s own.
 */
function sendingEvents(url: string, key: string, log: EventSink | undefined): EventSink {
	async function send(event: DecisionEvent): Promise<void> {
		const response = await fetch(url, {
			method: "POST",
			headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Fairtoll-Version": packageVersion },
			body: JSON.stringify(event),
			signal: AbortSignal.timeout(fetchTimeoutMs),
		});
		// Nothing reads the answer, so its body is cancelled to free the connection.
		await response.body?.cancel();
		if (!response.ok) throw new Error(`${url} answered ${response.status}`);
	}
	// After a failed post, events are dropped for `pauseAfterFailureMs`, so an outage at fairtoll.net doesn't hold a
	// post open for every bot request, or print an error for each. Posts already in flight that fail print nothing.
	let pausedUntil = 0;
	const report = (error: unknown) => {
		if (Date.now() < pausedUntil) return;
		pausedUntil = Date.now() + pauseAfterFailureMs;
		console.error(`fairtoll: could not send an event to ${url}, so events are dropped for the next ${pauseAfterFailureMs / 1000} seconds:`, error);
	};
	return async (event) => {
		const sent = Date.now() < pausedUntil ? undefined : send(event).catch(report);
		try {
			await log?.(event);
		} finally {
			await sent;
		}
	};
}

/** The site's key, url and events, or a throw saying which is wrong. */
function siteOptions(site: unknown): { key: string; url: string; events: boolean } {
	if (typeof site !== "object" || site === null) throw new Error("Invalid fairtoll options: site must be an object with a key");
	const { key, url: given, events = false } = site as Record<string, unknown>;
	const url = given ?? defaultSiteUrl;
	// Printable ASCII only, so a key with a stray newline, such as from a secrets file, fails here and not on every fetch.
	if (typeof key !== "string" || !/^[\x21-\x7e]+$/.test(key)) {
		throw new Error("Invalid fairtoll options: site.key must be a non-empty string of printable characters with no spaces");
	}
	// The key travels with every fetch, so plain http is only for a service on this machine, such as the demo's.
	if (!isHttpUrl(url) || (new URL(url).protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname))) {
		throw new Error("Invalid fairtoll options: site.url must be an https url, or http on localhost");
	}
	if (typeof events !== "boolean") throw new Error("Invalid fairtoll options: site.events must be true or false");
	return { key, url, events };
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `URL.canParse` alone accepts "localhost:8080", whose protocol is "localhost:", so the facilitator could never be reached. */
function isHttpUrl(url: unknown): url is string {
	return typeof url === "string" && URL.canParse(url) && ["http:", "https:"].includes(new URL(url).protocol);
}
