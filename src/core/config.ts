import { isAddress } from "viem";

/**
 * What the publisher asks Fairtoll to do, as `parseConfig` returns it with every default filled in. The
 * publisher writes any object `parseConfig` accepts, such as `{}`, which only observes.
 */
export type Config = { readonly ai: "allow" | "block" } | { readonly ai: "charge"; readonly charge: Charge };

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

const knownFields = ["ai", "price", "payTo", "network"];

/**
 * The charge fields are checked whenever they're set, even when `ai` isn't "charge", so switching `ai`
 * between "block" and "charge" is a one-word change.
 */
export function parseConfig(input: unknown): ParseResult {
	if (!isPlainObject(input)) {
		return { ok: false, errors: [{ field: "config", message: "must be a plain object" }] };
	}
	// An undefined or null field, such as from an unset environment variable, is the same as leaving it out.
	const field = (name: string) => (Object.hasOwn(input, name) ? input[name] : undefined) ?? undefined;
	const errors: ConfigError[] = Object.keys(input)
		.filter((name) => !knownFields.includes(name))
		.map((name) => ({ field: name, message: "is not a known field" }));
	const fail = (name: string, message: string) => void errors.push({ field: name, message });

	/** The field's value if it's set and passes `valid`. Otherwise undefined, with an error if it was set. */
	const check = <T>(name: string, valid: (value: unknown) => value is T, message: string): T | undefined => {
		const value = field(name);
		if (value === undefined || valid(value)) return value;
		fail(name, message);
		return undefined;
	};

	const ai = check("ai", isOneOf(["allow", "block", "charge"] as const), 'must be "allow", "block" or "charge"') ?? "allow";
	const price = check("price", isPrice, 'must be a price in dollars above zero, with at most 6 decimals, written as a string such as "0.002"');
	const payTo = check("payTo", isWalletAddress, "must be a wallet address: 0x and 40 hex digits, all in one case or with its EIP-55 checksum");
	const network = check("network", isOneOf(Object.keys(networks) as Network[]), `must be one of ${Object.keys(networks).map((name) => `"${name}"`).join(", ")}`);
	if (ai === "charge") {
		for (const name of ["price", "payTo", "network"]) {
			if (field(name) === undefined) fail(name, 'is needed when ai is "charge"');
		}
	}

	if (errors.length > 0) return { ok: false, errors };
	if (ai !== "charge") return { ok: true, config: { ai } };
	// Never true, since a missing or invalid field has an error by now. It's here so the types narrow.
	if (price === undefined || payTo === undefined || network === undefined) return { ok: false, errors };
	return { ok: true, config: { ai, charge: { price, payTo, network } } };
}

function isOneOf<T extends string>(values: readonly T[]) {
	return (value: unknown): value is T => typeof value === "string" && (values as readonly string[]).includes(value);
}

function isPrice(value: unknown): value is string {
	return typeof value === "string" && /^\d+(\.\d{1,6})?$/.test(value) && /[1-9]/.test(value);
}

/**
 * An address in one case has no checksum. A mixed-case one carries an EIP-55 checksum, so a typo that would
 * send payments to the wrong wallet is caught.
 */
function isWalletAddress(value: unknown): value is string {
	return typeof value === "string" && (/^0x([0-9a-f]{40}|[0-9A-F]{40})$/.test(value) || isAddress(value, { strict: true }));
}

/** Only a plain object's own keys are the config, so a Promise or Map can't parse as an empty config. */
function isPlainObject(input: unknown): input is Record<string, unknown> {
	if (typeof input !== "object" || input === null) return false;
	const proto: unknown = Object.getPrototypeOf(input);
	return proto === Object.prototype || proto === null;
}
