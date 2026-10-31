import { isAddress } from "viem/utils";
import { canonicalRulePath } from "./paths.js";

/**
 * What the publisher asks Fairtoll to do, as `parseConfig` returns it with every default filled in. The
 * publisher writes any object `parseConfig` accepts, such as `{}`, which only observes.
 *
 * `ai` applies to every path no rule matches. A rule applies its own `ai` to AI requests under its path, such as
 * `{ path: "/premium/*", ai: "charge", price: "0.01" }`. A rule that charges without a price charges the top-level
 * price, and every charge goes to the top-level `payTo` on the top-level `network`. Removing a rule puts its paths
 * back on the top-level `ai`.
 *
 * A rule's path is either exact, such as "/pricing", or ends in "/*", such as "/premium/*", which covers /premium
 * and everything under it. "/*" covers every path. Paths match the page the request names, ignoring case, a
 * trailing slash and percent-encoding, so a bot can't reach a rule's page under a path that doesn't match it.
 * When there are rules and they or `ai` block or charge, an AI request whose path has a ".." segment is
 * blocked, because parts of an app resolve ".." differently and could serve a page the rules didn't match.
 * When more than one rule matches, the most specific wins: the exact path, then the longest wildcard. That way
 * the order of the rules never matters, and a rule for a section, such as "/premium/free/*" inside
 * "/premium/*", works wherever it is written. Two rules can't have the same path. Rules match the whole path, not the part under where the
 * middleware is mounted.
 */
export type Config = Policy & { readonly rules: readonly Rule[] };

/** What happens to AI requests: let through, refused, or charged. */
export type Policy = { readonly ai: "allow" | "block" } | { readonly ai: "charge"; readonly charge: Charge };

/** A policy for the paths that `path` matches. `path` is in canonical form, which is lowercase. */
export type Rule = Policy & { readonly path: string };

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

const chargeFields = ["price", "payTo", "network"];
const knownFields = ["ai", ...chargeFields, "rules"];
const ruleFields = ["path", "ai", "price"];

const isAi = isOneOf(["allow", "block", "charge"] as const);
const isNetwork = isOneOf(Object.keys(networks) as Network[]);
const networkMessage = `must be one of ${Object.keys(networks).map((name) => `"${name}"`).join(", ")}`;
const aiMessage = 'must be "allow", "block" or "charge"';
const priceMessage = 'must be a price in dollars above zero, with at most 6 decimals, written as a string such as "0.002"';

/**
 * The charge fields are checked whenever they're set, even when `ai` isn't "charge", so switching `ai`
 * between "block" and "charge" is a one-word change.
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
	const rules = parseRules(field(input, "rules"), errors, field(input, "price") !== undefined);
	if (ai === "charge") {
		for (const name of chargeFields) {
			if (field(input, name) === undefined) errors.push({ field: name, message: 'is needed when ai is "charge"' });
		}
	} else if (rules.some((rule) => rule.ai === "charge")) {
		for (const name of ["payTo", "network"]) {
			if (field(input, name) === undefined) errors.push({ field: name, message: 'is needed when a rule\'s ai is "charge"' });
		}
	}

	if (errors.length > 0) return { ok: false, errors };
	// Every charge field a policy uses is set by now, since a missing or invalid one has an error.
	const policy = (ai: Policy["ai"], rulePrice: string | undefined): Policy =>
		ai === "charge" ? { ai, charge: { price: (rulePrice ?? price)!, payTo: payTo!, network: network! } } : { ai };
	return { ok: true, config: { ...policy(ai, undefined), rules: rules.map((rule) => ({ ...policy(rule.ai, rule.price), path: rule.path })) } };
}

/** A rule as written, once its fields are checked. */
interface RuleInput {
	readonly path: string;
	readonly ai: Policy["ai"];
	readonly price?: string;
}

/** The rules that parse, with an error added for each problem. An undefined or null `rules` is no rules. */
function parseRules(value: unknown, errors: ConfigError[], hasTopPrice: boolean): RuleInput[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		errors.push({ field: "rules", message: "must be an array of rules" });
		return [];
	}
	const seen = new Map<string, number>();
	return value.flatMap((item: unknown, index): RuleInput[] => {
		const at = `rules[${index}]`;
		if (!isPlainObject(item)) {
			errors.push({ field: at, message: "must be a plain object" });
			return [];
		}
		errors.push(...unknownFields(item, ruleFields, `${at}.`));
		const written = check(item, errors, "path", isRulePath, 'must be a path starting with "/", with "*" only as a final "/*", such as "/premium/*"', at);
		const ai = check(item, errors, "ai", isAi, aiMessage, at);
		const price = check(item, errors, "price", isPrice, priceMessage, at);
		for (const name of ["path", "ai"]) {
			if (field(item, name) === undefined) errors.push({ field: `${at}.${name}`, message: "is needed in every rule" });
		}
		if (ai === "charge" && field(item, "price") === undefined && !hasTopPrice) {
			errors.push({ field: `${at}.price`, message: 'is needed when the rule\'s ai is "charge" and there is no top-level price' });
		}
		const path = written === undefined ? undefined : canonicalRulePath(written);
		const same = path === undefined ? undefined : seen.get(path);
		if (same !== undefined) errors.push({ field: `${at}.path`, message: `matches the same paths as rules[${same}]` });
		else if (path !== undefined) seen.set(path, index);
		if (path === undefined || ai === undefined) return [];
		return [{ path, ai, ...(price === undefined ? {} : { price }) }];
	});
}

/** An undefined or null field, such as from an unset environment variable, is the same as leaving it out. */
function field(input: Record<string, unknown>, name: string): unknown {
	return (Object.hasOwn(input, name) ? input[name] : undefined) ?? undefined;
}

/**
 * The field's value if it's set and passes `valid`. Otherwise undefined, with an error added if it was set.
 * `at` names the object the field is in, such as "rules[0]", for the error.
 */
function check<T>(input: Record<string, unknown>, errors: ConfigError[], name: string, valid: (value: unknown) => value is T, message: string, at?: string): T | undefined {
	const value = field(input, name);
	if (value === undefined || valid(value)) return value;
	errors.push({ field: at === undefined ? name : `${at}.${name}`, message });
	return undefined;
}

function unknownFields(input: Record<string, unknown>, known: readonly string[], prefix: string): ConfigError[] {
	return Object.keys(input)
		.filter((name) => !known.includes(name))
		.map((name) => ({ field: `${prefix}${name}`, message: "is not a known field" }));
}

/**
 * An exact path, or one ending in "/*". A "*" anywhere else would suggest matching Fairtoll doesn't do. A "%2A"
 * is refused too, because it decodes to a "*" and would turn an exact path into a wildcard.
 */
function isRulePath(value: unknown): value is string {
	return typeof value === "string" && /^\/[^*]*$|^\/([^*]*\/)?\*$/.test(value) && !/%2a/i.test(value);
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
