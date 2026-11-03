import { isAddress } from "viem/utils";
import { canonicalRulePath } from "./paths.js";

/**
 * What the publisher asks Fairtoll to do, as `parseConfig` returns it with every default filled in. The
 * publisher writes any object `parseConfig` accepts, such as `{}`, which only observes.
 *
 * `ai` decides what happens to AI requests on every path that no rule matches. Each rule decides it for the
 * paths it matches, such as `{ path: "/premium/*", ai: "charge", price: "0.01" }`. Removing a rule puts its
 * paths back on the top-level `ai`.
 *
 * Charging:
 * - A rule that charges uses its own `price`, or the top-level `price` if it has none.
 * - Every charge is paid to the top-level `payTo`, on the top-level `network`.
 *
 * Rule paths:
 * - A path is exact, such as "/pricing", or ends in "/*", such as "/premium/*", which covers /premium and
 *   everything under it. "/*" covers every path.
 * - Rules match the whole path, not the part under where the middleware is mounted.
 * - Two rules can't have the same path.
 *
 * Matching a request:
 * - A request's path is matched in canonical form, which ignores case, a trailing slash and percent-encoding,
 *   so a bot can't reach a rule's page by writing its path another way (see `canonicalPath`).
 * - When several rules match, the most specific wins: an exact path, then the wildcard with the longest prefix.
 *   So the order of the rules never matters, and "/premium/free/*" inside "/premium/*" works wherever it is
 *   written.
 * - When there are rules and anything blocks or charges, an AI request whose path has a ".." segment is
 *   blocked, because parts of an app resolve ".." differently (see `hasDotDotSegment`).
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
const payToMessage = "must be a wallet address other than the zero address: 0x and 40 hex digits, all in one case or with its EIP-55 checksum";
const rulePathMessage = 'must be a path starting with "/", with "*" only as a final "/*", such as "/premium/*"';
const priceMessage = 'must be a price in dollars above zero, with at most 6 decimals, written as a string such as "0.002"';

/**
 * The charge fields are checked whenever they're set, even when `ai` isn't "charge", so switching `ai`
 * between "block" and "charge" is a one-word change.
 */
export function parseConfig(input: unknown): ParseResult {
	if (!isPlainObject(input)) {
		return { ok: false, errors: [{ field: "config", message: "must be a plain object" }] };
	}

	const ai = readOptional(input, "ai", isAi, aiMessage);
	const price = readOptional(input, "price", isPrice, priceMessage);
	const payTo = readOptional(input, "payTo", isWalletAddress, payToMessage);
	const network = readOptional(input, "network", isNetwork, networkMessage);
	const { rules: ruleInputs, errors: ruleErrors } = parseRules(presentValue(input, "rules"));

	const errors = [
		...unknownFieldErrors(input, knownFields, ""),
		...errorsOf(ai, price, payTo, network),
		...ruleErrors,
		...missingChargeFieldErrors(input, ai.value, ruleInputs),
	];
	if (errors.length > 0) return { ok: false, errors };

	const topLevel = toPolicy(ai.value ?? "allow", price.value, payTo.value, network.value);
	const rules = ruleInputs.map((rule) => {
		const policy = toPolicy(rule.ai, rule.price ?? price.value, payTo.value, network.value);
		return { ...policy, path: rule.path };
	});
	return { ok: true, config: { ...topLevel, rules } };
}

/**
 * An error for each charge field that something charging needs and the config leaves out. Every check that
 * `toPolicy` relies on is here, so a config that passes them can always be turned into policies.
 * - When the top-level `ai` charges, it needs `price`, `payTo` and `network`.
 * - When a rule charges, it needs the top-level `payTo` and `network`, and a price of its own or a top-level one.
 */
function missingChargeFieldErrors(input: Record<string, unknown>, ai: Policy["ai"] | undefined, rules: readonly RuleInput[]): ConfigError[] {
	const errors: ConfigError[] = [];
	const chargingRules = rules.filter((rule) => rule.ai === "charge");
	if (ai === "charge") {
		for (const name of chargeFields) {
			if (isMissing(input, name)) errors.push({ field: name, message: 'is needed when ai is "charge"' });
		}
	} else if (chargingRules.length > 0) {
		for (const name of ["payTo", "network"]) {
			if (isMissing(input, name)) errors.push({ field: name, message: 'is needed when a rule\'s ai is "charge"' });
		}
	}
	for (const rule of chargingRules) {
		if (rule.price === undefined && isMissing(input, "price")) {
			errors.push({ field: `${rule.at}.price`, message: 'is needed when the rule\'s ai is "charge" and there is no top-level price' });
		}
	}
	return errors;
}

/**
 * The policy for an `ai`. When `ai` is "charge", `parseConfig` has already reported any charge field that is
 * missing, so this only throws if those checks have a bug.
 */
function toPolicy(ai: Policy["ai"], price: string | undefined, payTo: string | undefined, network: Network | undefined): Policy {
	if (ai !== "charge") return { ai };
	if (price === undefined || payTo === undefined || network === undefined) {
		throw new Error("fairtoll: a charge is missing a field that parseConfig should have reported");
	}
	return { ai, charge: { price, payTo, network } };
}

/** A rule as written, once its fields are checked. */
interface RuleInput {
	/** Where the rule is in the config, such as "rules[0]", for errors. */
	readonly at: string;
	/** In canonical form. */
	readonly path: string;
	readonly ai: Policy["ai"];
	/** Undefined when the rule has no price of its own. */
	readonly price: string | undefined;
}

interface ParsedRules {
	readonly rules: RuleInput[];
	readonly errors: ConfigError[];
}

/**
 * The rules whose fields are valid, and an error for each problem in any rule. An undefined or null `rules` is
 * no rules. Whether a charging rule has the price, wallet and network it needs is checked in
 * `missingChargeFieldErrors`, with the top-level fields.
 */
function parseRules(value: unknown): ParsedRules {
	const rules: RuleInput[] = [];
	const errors: ConfigError[] = [];
	if (value === undefined) return { rules, errors };
	if (!Array.isArray(value)) {
		errors.push({ field: "rules", message: "must be an array of rules" });
		return { rules, errors };
	}

	// The canonical path of each rule so far, and the rule's index, to find two rules for the same paths.
	const seen = new Map<string, number>();
	value.forEach((item: unknown, index) => {
		const at = `rules[${index}]`;
		if (!isPlainObject(item)) {
			errors.push({ field: at, message: "must be a plain object" });
			return;
		}

		const path = readOptional(item, "path", isRulePath, rulePathMessage, `${at}.path`);
		const ai = readOptional(item, "ai", isAi, aiMessage, `${at}.ai`);
		const price = readOptional(item, "price", isPrice, priceMessage, `${at}.price`);
		errors.push(...unknownFieldErrors(item, ruleFields, `${at}.`), ...errorsOf(path, ai, price));
		for (const name of ["path", "ai"]) {
			if (isMissing(item, name)) errors.push({ field: `${at}.${name}`, message: "is needed in every rule" });
		}

		if (path.value === undefined) return;
		const canonical = canonicalRulePath(path.value);
		const earlier = seen.get(canonical);
		if (earlier === undefined) {
			seen.set(canonical, index);
		} else {
			errors.push({ field: `${at}.path`, message: `matches the same paths as rules[${earlier}]` });
		}
		if (ai.value === undefined) return;
		rules.push({ at, path: canonical, ai: ai.value, price: price.value });
	});
	return { rules, errors };
}

/** What reading one optional field found: its value if it's set and valid, and an error if it's set but invalid. */
interface FieldRead<T> {
	readonly value: T | undefined;
	readonly error: ConfigError | undefined;
}

/**
 * Reads an optional field and checks it with `valid`. A missing field (see `isMissing`) has no value and no
 * error. An invalid one has no value, and an error naming `errorField`, such as "rules[0].price".
 */
function readOptional<T>(
	input: Record<string, unknown>,
	name: string,
	valid: (value: unknown) => value is T,
	message: string,
	errorField = name,
): FieldRead<T> {
	const value = presentValue(input, name);
	if (value === undefined) return { value: undefined, error: undefined };
	if (valid(value)) return { value, error: undefined };
	return { value: undefined, error: { field: errorField, message } };
}

function errorsOf(...reads: readonly FieldRead<unknown>[]): ConfigError[] {
	return reads.flatMap((read) => (read.error === undefined ? [] : [read.error]));
}

/**
 * The field's own value, or undefined when it is missing. An undefined or null field, such as from an unset
 * environment variable, is the same as leaving it out.
 */
function presentValue(input: Record<string, unknown>, name: string): unknown {
	if (!Object.hasOwn(input, name)) return undefined;
	return input[name] ?? undefined;
}

function isMissing(input: Record<string, unknown>, name: string): boolean {
	return presentValue(input, name) === undefined;
}

function unknownFieldErrors(input: Record<string, unknown>, known: readonly string[], prefix: string): ConfigError[] {
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
