import { isAddress } from "viem/utils";
import { parsePattern } from "./paths.js";

/**
 * What the publisher asks Fairtoll to do, as `parseConfig` returns it with every default filled in. The
 * publisher writes any object `parseConfig` accepts, such as `{}`, which only observes.
 */
export interface Config {
	/** What an AI request gets on a path no rule covers. */
	readonly ai: Action;
	readonly rules: Rules;
}

/**
 * What Fairtoll does with an AI request. A charge carries its price and wallet, so the adapter charges what
 * the rule that applied asks.
 */
export type Action = { readonly kind: "allow" } | { readonly kind: "block" } | { readonly kind: "charge"; readonly charge: Charge };

/**
 * The publisher's rules, keyed by path as `readPath` keys a request, such as "/premium". An `exact` rule covers
 * only its own path, and an `under` rule, written "/premium/*", covers its path and every path below it. They
 * are two maps so that a request whose last segment is a literal "*" can't match an `under` rule.
 */
export interface Rules {
	readonly exact: ReadonlyMap<string, Action>;
	readonly under: ReadonlyMap<string, Action>;
}

/** What an AI bot or agent pays for a page, and where the money goes. */
export interface Charge {
	/** Dollars, as the publisher wrote them, such as "0.002". It has at most 6 decimals, so x402 never rounds it. */
	readonly price: string;
	/** The publisher's wallet address, which the payment goes to directly. */
	readonly payTo: string;
	readonly network: Network;
}

/** The networks Fairtoll charges on, in USDC: Base, and its testnet Base Sepolia. */
export type Network = keyof typeof networks;

/** Each network's CAIP-2 name, as x402 knows it. */
export const networks = { base: "eip155:8453", "base-sepolia": "eip155:84532" } as const;

/** `field` names where the error is, such as "rules". */
export interface ConfigError {
	readonly field: string;
	readonly message: string;
}

export type ParseResult = { readonly ok: true; readonly config: Config } | { readonly ok: false; readonly errors: readonly ConfigError[] };

/** A rule as the publisher wrote it, checked, before the top-level price and wallet are joined to it. */
interface RuleEntry {
	readonly kind: "exact" | "under";
	readonly key: string;
	readonly ai: Action["kind"];
	readonly price: string | undefined;
}

const knownFields = ["ai", "price", "payTo", "network", "rules"];
const ruleFields = ["ai", "price"];

const isAi = isOneOf(["allow", "block", "charge"] as const);
const isNetwork = isOneOf(Object.keys(networks) as Network[]);
const aiMessage = 'must be "allow", "block" or "charge"';
const priceMessage = 'must be a price in dollars above zero, with at most 6 decimals, written as a string such as "0.002"';
const networkMessage = `must be one of ${Object.keys(networks).map((name) => `"${name}"`).join(", ")}`;

/**
 * The charge fields are checked whenever they're set, even when nothing charges, so switching `ai` or a rule
 * between "block" and "charge" is a one-word change. For the same reason, a rule that charges without a
 * price of its own charges the top-level price.
 */
export function parseConfig(input: unknown): ParseResult {
	if (!isPlainObject(input)) {
		return { ok: false, errors: [{ field: "config", message: "must be a plain object" }] };
	}
	const errors = unknownFields(input, knownFields, "");

	const ai = check(input, errors, "ai", isAi, aiMessage) ?? "allow";
	const price = check(input, errors, "price", isPrice, priceMessage);
	const payTo = check(input, errors, "payTo", isWalletAddress, "must be a wallet address other than the zero address: 0x and 40 hex digits, all in one case or with its EIP-55 checksum");
	const network = check(input, errors, "network", isNetwork, networkMessage);
	const rules = checkRules(input, errors);
	if (ai === "charge" && field(input, "price") === undefined) errors.push({ field: "price", message: 'is needed when ai is "charge"' });
	const charges = ai === "charge" || rules.some((rule) => rule.ai === "charge");
	for (const name of ["payTo", "network"]) {
		if (charges && field(input, name) === undefined) errors.push({ field: name, message: 'is needed when ai or a rule is "charge"' });
	}
	if (errors.length > 0) return { ok: false, errors };

	const toAction = (kind: Action["kind"], chargePrice: string | undefined): Action => {
		if (kind !== "charge") return { kind };
		// Never true, since a charge with a missing or invalid field has an error by now. It's here so the types narrow.
		if (chargePrice === undefined || payTo === undefined || network === undefined) throw new Error("a charge is missing its price, wallet or network");
		return { kind: "charge", charge: { price: chargePrice, payTo, network } };
	};
	const exact = new Map<string, Action>();
	const under = new Map<string, Action>();
	for (const rule of rules) {
		const action = toAction(rule.ai, rule.price ?? price);
		if (rule.kind === "exact") exact.set(rule.key, action);
		else under.set(rule.key, action);
	}
	return { ok: true, config: { ai: toAction(ai, price), rules: { exact, under } } };
}

/**
 * The rules in `input`, with an error added for each mistake. A null rule, such as from an unset environment
 * variable, is no rule. Two rules for the same path are a mistake, not one overriding the other, so the order
 * rules are written in never matters.
 */
function checkRules(input: Record<string, unknown>, errors: ConfigError[]): RuleEntry[] {
	const rules = field(input, "rules");
	if (rules === undefined) return [];
	if (!isPlainObject(rules)) {
		errors.push({ field: "rules", message: 'must be an object whose keys are paths, such as { "/premium/*": { "ai": "charge" } }' });
		return [];
	}
	const entries: RuleEntry[] = [];
	const seen = new Map<string, string>();
	for (const path of Object.keys(rules)) {
		const value = field(rules, path);
		if (value === undefined) continue;
		const at = `rules[${JSON.stringify(path)}]`;
		const pattern = parsePattern(path);
		if (pattern.kind === "invalid") {
			errors.push({ field: at, message: pattern.message });
			continue;
		}
		const id = `${pattern.kind} ${pattern.key}`;
		const same = seen.get(id);
		if (same !== undefined) {
			errors.push({ field: at, message: `is the same path as ${same}` });
			continue;
		}
		seen.set(id, at);
		if (!isPlainObject(value)) {
			errors.push({ field: at, message: 'must be an object such as { "ai": "block" }' });
			continue;
		}
		errors.push(...unknownFields(value, ruleFields, `${at}.`));
		const ai = check(value, errors, "ai", isAi, aiMessage, `${at}.`);
		if (field(value, "ai") === undefined) errors.push({ field: `${at}.ai`, message: "is needed" });
		const price = check(value, errors, "price", isPrice, priceMessage, `${at}.`);
		if (ai === "charge" && field(value, "price") === undefined && field(input, "price") === undefined) {
			errors.push({ field: `${at}.price`, message: "is needed when the rule charges and there is no top-level price" });
		}
		if (ai !== undefined) entries.push({ kind: pattern.kind, key: pattern.key, ai, price });
	}
	return entries;
}

/** The top-level action and every rule's. */
export function actionsIn(config: Config): Action[] {
	return [config.ai, ...config.rules.exact.values(), ...config.rules.under.values()];
}

/** Each charge the config makes, one for each price, so an adapter can make a charger for each at startup. */
export function chargesIn(config: Config): Charge[] {
	const byPrice = new Map<string, Charge>();
	for (const action of actionsIn(config)) {
		if (action.kind === "charge") byPrice.set(action.charge.price, action.charge);
	}
	return [...byPrice.values()];
}

/** An error for each field of `input` that isn't `known`, named after `prefix`, such as `rules["/premium/*"].`. */
function unknownFields(input: Record<string, unknown>, known: readonly string[], prefix: string): ConfigError[] {
	return Object.keys(input)
		.filter((name) => !known.includes(name))
		.map((name) => ({ field: `${prefix}${name}`, message: "is not a known field" }));
}

/** An undefined or null field, such as from an unset environment variable, is the same as leaving it out. */
function field(input: Record<string, unknown>, name: string): unknown {
	return (Object.hasOwn(input, name) ? input[name] : undefined) ?? undefined;
}

/**
 * The field's value if it's set and passes `valid`. Otherwise undefined, with an error added if it was set,
 * named after `prefix` as in `unknownFields`.
 */
function check<T>(input: Record<string, unknown>, errors: ConfigError[], name: string, valid: (value: unknown) => value is T, message: string, prefix = ""): T | undefined {
	const value = field(input, name);
	if (value === undefined || valid(value)) return value;
	errors.push({ field: `${prefix}${name}`, message });
	return undefined;
}

function isOneOf<T extends string>(values: readonly T[]) {
	return (value: unknown): value is T => typeof value === "string" && (values as readonly string[]).includes(value);
}

function isPrice(value: unknown): value is string {
	return typeof value === "string" && /^\d+(\.\d{1,6})?$/.test(value) && /[1-9]/.test(value);
}

/**
 * An address in one case has no checksum. A mixed-case one carries an EIP-55 checksum, so a typo that would
 * send payments to the wrong wallet is caught. The zero address is a placeholder no payment can reach.
 */
function isWalletAddress(value: unknown): value is string {
	if (typeof value !== "string" || /^0x0{40}$/.test(value)) return false;
	return /^0x([0-9a-f]{40}|[0-9A-F]{40})$/.test(value) || isAddress(value, { strict: true });
}

/** Only a plain object's own keys are the config, so a Promise or Map can't parse as an empty config. */
function isPlainObject(input: unknown): input is Record<string, unknown> {
	if (typeof input !== "object" || input === null) return false;
	const proto: unknown = Object.getPrototypeOf(input);
	return proto === Object.prototype || proto === null;
}
