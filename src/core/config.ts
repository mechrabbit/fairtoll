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

const knownFields = ["ai", "price", "payTo", "network", "rules"];
const ruleFields = ["path", "ai", "price"];

const isAi = isOneOf(["allow", "block", "charge"] as const);
const isNetwork = isOneOf(Object.keys(networks) as Network[]);
const networkMessage = `must be one of ${Object.keys(networks).map((name) => `"${name}"`).join(", ")}`;
const aiMessage = 'must be "allow", "block" or "charge"';
const payToMessage = "must be a wallet address other than the zero address: 0x and 40 hex digits, all in one case or with its EIP-55 checksum";
const rulePathMessage = 'must be a path starting with "/", with "*" only as a final "/*", such as "/premium/*"';
const priceMessage = 'must be a price in dollars above zero, with at most 6 decimals, written as a string such as "0.002"';

/** A value that passed its checks, or the errors that say why it didn't. A failure always has an error. */
type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly ConfigError[] };

/**
 * Parsing has two steps. The first checks every field on its own and reports every error it finds. The second
 * runs only when every field is valid, and checks that whatever charges has the fields it needs, so a missing
 * charge field is reported only once the invalid fields are fixed.
 *
 * The charge fields are checked whenever they're set, even when `ai` isn't "charge", so switching `ai`
 * between "block" and "charge" is a one-word change.
 */
export function parseConfig(input: unknown): ParseResult {
	if (!isPlainObject(input)) {
		return { ok: false, errors: [{ field: "config", message: "must be a plain object" }] };
	}
	const fields = parseFields(input);
	if (!fields.ok) return fields;
	const config = toConfig(fields.value);
	return config.ok ? { ok: true, config: config.value } : config;
}

/** The config's fields, each valid on its own. Any of them can still be missing. */
interface Fields {
	readonly ai: Policy["ai"] | undefined;
	readonly price: string | undefined;
	readonly payTo: string | undefined;
	readonly network: Network | undefined;
	readonly rules: readonly RuleInput[];
}

function parseFields(input: Record<string, unknown>): Parsed<Fields> {
	const unknownFields = unknownFieldErrors(input, knownFields, "");
	const ai = readOptional(input, "ai", isAi, aiMessage);
	const price = readOptional(input, "price", isPrice, priceMessage);
	const payTo = readOptional(input, "payTo", isWalletAddress, payToMessage);
	const network = readOptional(input, "network", isNetwork, networkMessage);
	const rules = parseRules(presentValue(input, "rules"));

	if (unknownFields.length === 0 && ai.ok && price.ok && payTo.ok && network.ok && rules.ok) {
		return { ok: true, value: { ai: ai.value, price: price.value, payTo: payTo.value, network: network.value, rules: rules.value } };
	}
	return { ok: false, errors: [...unknownFields, ...errorsOf(ai, price, payTo, network, rules)] };
}

/**
 * The config, or an error for each charge field that something charging needs and the config leaves out.
 * - When the top-level `ai` charges, it needs `price`, `payTo` and `network`.
 * - When a rule charges, it needs the top-level `payTo` and `network`, and a price of its own or a top-level one.
 */
function toConfig({ ai = "allow", price, payTo, network, rules }: Fields): Parsed<Config> {
	const neededBy = ai === "charge" ? 'is needed when ai is "charge"' : 'is needed when a rule\'s ai is "charge"';
	const destination = destinationOf(payTo, network, neededBy);

	const topLevel = policyOf(ai, price, destination, { field: "price", message: 'is needed when ai is "charge"' });
	const rulePolicies = rules.map((rule): Parsed<Rule> => {
		const noPrice = { field: `${rule.at}.price`, message: 'is needed when the rule\'s ai is "charge" and there is no top-level price' };
		const policy = policyOf(rule.ai, rule.price ?? price, destination, noPrice);
		return policy.ok ? { ok: true, value: { ...policy.value, path: rule.path } } : policy;
	});

	if (topLevel.ok && allOk(rulePolicies)) {
		return { ok: true, value: { ...topLevel.value, rules: rulePolicies.map((rule) => rule.value) } };
	}
	// Every policy that charges carries the same payTo and network error objects from `destination`. The Set
	// compares them by identity, so each is listed once as long as they aren't copied.
	const errors = new Set([topLevel, ...rulePolicies].flatMap((policy) => (policy.ok ? [] : policy.errors)));
	return { ok: false, errors: [...errors] };
}

/** Where every charge's money goes: the top-level `payTo`, on the top-level `network`. */
interface Destination {
	readonly payTo: string;
	readonly network: Network;
}

/** The destination, or an error with `message` for each of `payTo` and `network` that is missing. */
function destinationOf(payTo: string | undefined, network: Network | undefined, message: string): Parsed<Destination> {
	if (payTo !== undefined && network !== undefined) return { ok: true, value: { payTo, network } };
	const errors: ConfigError[] = [];
	if (payTo === undefined) errors.push({ field: "payTo", message });
	if (network === undefined) errors.push({ field: "network", message });
	return { ok: false, errors };
}

/**
 * The policy for an `ai`. A policy that charges fails with `noPrice` when it has no price, and with the
 * destination's errors when the destination is incomplete.
 */
function policyOf(ai: Policy["ai"], price: string | undefined, destination: Parsed<Destination>, noPrice: ConfigError): Parsed<Policy> {
	if (ai !== "charge") return { ok: true, value: { ai } };
	if (price !== undefined && destination.ok) return { ok: true, value: { ai, charge: { price, ...destination.value } } };
	const errors: ConfigError[] = [];
	if (price === undefined) errors.push(noPrice);
	if (!destination.ok) errors.push(...destination.errors);
	return { ok: false, errors };
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

/**
 * The rules, or an error for each problem in any rule. An undefined or null `rules` is no rules. Whether a
 * charging rule has the price, wallet and network it needs is checked in `toConfig`, with the top-level fields.
 */
function parseRules(value: unknown): Parsed<RuleInput[]> {
	if (value === undefined) return { ok: true, value: [] };
	if (!Array.isArray(value)) return { ok: false, errors: [{ field: "rules", message: "must be an array of rules" }] };

	const rules: RuleInput[] = [];
	const errors: ConfigError[] = [];
	// The canonical path of each rule so far, and the rule's index, to find two rules for the same paths.
	const seen = new Map<string, number>();
	value.forEach((item: unknown, index) => {
		const at = `rules[${index}]`;
		if (!isPlainObject(item)) {
			errors.push({ field: at, message: "must be a plain object" });
			return;
		}

		const path = readRuleField(item, "path", isRulePath, rulePathMessage, at);
		const ai = readRuleField(item, "ai", isAi, aiMessage, at);
		const price = readOptional(item, "price", isPrice, priceMessage, `${at}.price`);
		errors.push(...unknownFieldErrors(item, ruleFields, `${at}.`), ...errorsOf(path, ai, price));

		if (!path.ok) return;
		const canonical = canonicalRulePath(path.value);
		const earlier = seen.get(canonical);
		if (earlier === undefined) {
			seen.set(canonical, index);
		} else {
			errors.push({ field: `${at}.path`, message: `matches the same paths as rules[${earlier}]` });
		}
		if (ai.ok && price.ok) rules.push({ at, path: canonical, ai: ai.value, price: price.value });
	});
	return errors.length === 0 ? { ok: true, value: rules } : { ok: false, errors };
}

/**
 * A copy of a config from fairtoll.net with only the fields this version knows, at the top level and in each rule,
 * and the names of the fields left out, such as "rules[0].note". So a field a newer version adds there doesn't make
 * older versions refuse the whole config. The known fields are left for `parseConfig` to check, and a `rules` or rule
 * that isn't an array or a plain object is left as it is for `parseConfig` to refuse.
 *
 * Some fields aren't safe to ignore, such as one that limits when a rule charges. The config names those in
 * `requires`, as a top-level field such as "schedule" or a rule field such as "rules.schedule", and this throws if
 * any is one this version doesn't know, so the caller keeps its last config rather than apply only part of this one.
 */
export function withoutUnknownFields(input: Record<string, unknown>): { readonly config: Record<string, unknown>; readonly ignored: readonly string[] } {
	// A null requires is no requires, as with every other field (see `presentValue`).
	const { requires: given, ...rest } = input;
	const requires = given ?? [];
	if (!Array.isArray(requires) || !requires.every((name) => typeof name === "string")) {
		throw new Error("the fetched config's requires must be a list of field names");
	}
	const known = [...knownFields, ...ruleFields.map((name) => `rules.${name}`)];
	const unsupported = requires.filter((name) => !known.includes(name));
	if (unsupported.length > 0) {
		throw new Error(`the fetched config needs ${unsupported.join(", ")}, which this version of Fairtoll doesn't support, so update Fairtoll`);
	}
	const ignored: string[] = [];
	const keep = (object: Record<string, unknown>, fields: readonly string[], prefix: string) => {
		ignored.push(...unknownFieldErrors(object, fields, prefix).map((error) => error.field));
		return Object.fromEntries(Object.entries(object).filter(([name]) => fields.includes(name)));
	};
	const config = keep(rest, knownFields, "");
	if (Array.isArray(config.rules)) {
		config.rules = config.rules.map((rule: unknown, index) => (isPlainObject(rule) ? keep(rule, ruleFields, `rules[${index}].`) : rule));
	}
	return { config, ignored };
}

/**
 * The mistakes in a config meant for the publisher's site on fairtoll.net, for the service to check before it saves
 * one: everything `parseConfig` refuses, a `payTo` or `network`, which a fetched config can't set, a `requires`
 * naming a field this version doesn't know, and any field an install would ignore, so a typo such as "prise" is
 * caught here rather than ignored. An empty list means every install of this version applies the config as written,
 * as long as its own code sets the wallet and network that any charge needs.
 */
export function siteConfigErrors(input: unknown): ConfigError[] {
	if (!isPlainObject(input)) return [{ field: "config", message: "must be a plain object" }];
	const wallet = ["payTo", "network"]
		.filter((name) => Object.hasOwn(input, name))
		.map((field) => ({ field, message: "can only be set in the publisher's own code" }));
	let known: ReturnType<typeof withoutUnknownFields>;
	try {
		known = withoutUnknownFields(input);
	} catch {
		return [...wallet, { field: "requires", message: "must be a list of fields this version knows, such as \"rules.price\"" }];
	}
	const ignored = known.ignored.map((field) => ({ field, message: "is not a known field" }));
	// A placeholder wallet in place of the publisher's own, so a charge is checked as it will be with theirs.
	const result = parseConfig({ ...known.config, payTo: `0x${"1".repeat(40)}`, network: "base-sepolia" });
	return [...wallet, ...ignored, ...(result.ok ? [] : result.errors)];
}

/**
 * Reads an optional field and checks it with `valid`. A missing field (see `presentValue`) is undefined. An
 * invalid one is an error naming `errorField`, such as "rules[0].price".
 */
function readOptional<T>(
	input: Record<string, unknown>,
	name: string,
	valid: (value: unknown) => value is T,
	message: string,
	errorField = name,
): Parsed<T | undefined> {
	const value = presentValue(input, name);
	if (value === undefined) return { ok: true, value: undefined };
	if (valid(value)) return { ok: true, value };
	return { ok: false, errors: [{ field: errorField, message }] };
}

/** Reads a field every rule needs, such as "path", from the rule at `at`. A missing one is an error. */
function readRuleField<T>(rule: Record<string, unknown>, name: string, valid: (value: unknown) => value is T, message: string, at: string): Parsed<T> {
	const value = presentValue(rule, name);
	if (value === undefined) return { ok: false, errors: [{ field: `${at}.${name}`, message: "is needed in every rule" }] };
	if (valid(value)) return { ok: true, value };
	return { ok: false, errors: [{ field: `${at}.${name}`, message }] };
}

function errorsOf(...results: readonly Parsed<unknown>[]): ConfigError[] {
	return results.flatMap((result) => (result.ok ? [] : result.errors));
}

function allOk<T>(results: readonly Parsed<T>[]): results is { readonly ok: true; readonly value: T }[] {
	return results.every((result) => result.ok);
}

/**
 * The field's own value, or undefined when it is missing. An undefined or null field, such as from an unset
 * environment variable, is the same as leaving it out.
 */
function presentValue(input: Record<string, unknown>, name: string): unknown {
	if (!Object.hasOwn(input, name)) return undefined;
	return input[name] ?? undefined;
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
	if (typeof value !== "string" || /%2a/i.test(value)) return false;
	const exact = /^\/[^*]*$/; // "/about", with no "*"
	const wildcard = /^\/([^*]*\/)?\*$/; // "/*" or "/premium/*", with no other "*"
	return exact.test(value) || wildcard.test(value);
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
export function isPlainObject(input: unknown): input is Record<string, unknown> {
	if (typeof input !== "object" || input === null) return false;
	const proto: unknown = Object.getPrototypeOf(input);
	return proto === Object.prototype || proto === null;
}
