import { isAddress } from "viem/utils";

/**
 * What the publisher asks Fairtoll to do, as `parseConfig` returns it with every default filled in. The
 * publisher writes any object `parseConfig` accepts, such as `{}`, which only observes.
 */
export interface Config {
	readonly ai: Action;
}

/** What Fairtoll does with an AI request. A charge carries its price and wallet, so the adapter charges what the config asks. */
export type Action = { readonly kind: "allow" } | { readonly kind: "block" } | { readonly kind: "charge"; readonly charge: Charge };

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
const knownFields = ["ai", ...chargeFields];

const isAi = isOneOf(["allow", "block", "charge"] as const);
const isNetwork = isOneOf(Object.keys(networks) as Network[]);
const networkMessage = `must be one of ${Object.keys(networks).map((name) => `"${name}"`).join(", ")}`;

/**
 * The charge fields are checked whenever they're set, even when `ai` isn't "charge", so switching `ai`
 * between "block" and "charge" is a one-word change.
 */
export function parseConfig(input: unknown): ParseResult {
	if (!isPlainObject(input)) {
		return { ok: false, errors: [{ field: "config", message: "must be a plain object" }] };
	}
	const errors: ConfigError[] = Object.keys(input)
		.filter((name) => !knownFields.includes(name))
		.map((name) => ({ field: name, message: "is not a known field" }));

	const ai = check(input, errors, "ai", isAi, 'must be "allow", "block" or "charge"') ?? "allow";
	const price = check(input, errors, "price", isPrice, 'must be a price in dollars above zero, with at most 6 decimals, written as a string such as "0.002"');
	const payTo = check(input, errors, "payTo", isWalletAddress, "must be a wallet address other than the zero address: 0x and 40 hex digits, all in one case or with its EIP-55 checksum");
	const network = check(input, errors, "network", isNetwork, networkMessage);
	if (ai === "charge") {
		for (const name of chargeFields) {
			if (field(input, name) === undefined) errors.push({ field: name, message: 'is needed when ai is "charge"' });
		}
	}

	if (errors.length > 0) return { ok: false, errors };
	if (ai !== "charge") return { ok: true, config: { ai: { kind: ai } } };
	// Never true, since a missing or invalid field has an error by now. It's here so the types narrow.
	if (price === undefined || payTo === undefined || network === undefined) return { ok: false, errors };
	return { ok: true, config: { ai: { kind: "charge", charge: { price, payTo, network } } } };
}

/** Each charge the config makes, one for each price, so an adapter can make a charger for each at startup. */
export function chargesIn(config: Config): Charge[] {
	return config.ai.kind === "charge" ? [config.ai.charge] : [];
}

/** An undefined or null field, such as from an unset environment variable, is the same as leaving it out. */
function field(input: Record<string, unknown>, name: string): unknown {
	return (Object.hasOwn(input, name) ? input[name] : undefined) ?? undefined;
}

/** The field's value if it's set and passes `valid`. Otherwise undefined, with an error added if it was set. */
function check<T>(input: Record<string, unknown>, errors: ConfigError[], name: string, valid: (value: unknown) => value is T, message: string): T | undefined {
	const value = field(input, name);
	if (value === undefined || valid(value)) return value;
	errors.push({ field: name, message });
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
