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

	const ai = field("ai") ?? "allow";
	if (ai !== "allow" && ai !== "block" && ai !== "charge") fail("ai", 'must be "allow", "block" or "charge"');

	const price = field("price");
	if (price !== undefined && !(typeof price === "string" && /^\d+(\.\d{1,6})?$/.test(price) && /[1-9]/.test(price))) {
		fail("price", 'must be a price in dollars above zero, with at most 6 decimals, written as a string such as "0.002"');
	}
	const payTo = field("payTo");
	if (payTo !== undefined && !(typeof payTo === "string" && /^0x[0-9a-fA-F]{40}$/.test(payTo))) {
		fail("payTo", "must be a wallet address: 0x and 40 hex digits");
	}
	const network = field("network");
	if (network !== undefined && !(typeof network === "string" && Object.hasOwn(networks, network))) {
		fail("network", `must be one of ${Object.keys(networks).map((name) => `"${name}"`).join(", ")}`);
	}
	if (ai === "charge") {
		for (const [name, value] of Object.entries({ price, payTo, network })) {
			if (value === undefined) fail(name, 'is needed when ai is "charge"');
		}
	}

	if (errors.length > 0) return { ok: false, errors };
	if (ai === "charge") return { ok: true, config: { ai, charge: { price, payTo, network } as Charge } };
	return { ok: true, config: { ai: ai as "allow" | "block" } };
}

/** Only a plain object's own keys are the config, so a Promise or Map can't parse as an empty config. */
function isPlainObject(input: unknown): input is Record<string, unknown> {
	if (typeof input !== "object" || input === null) return false;
	const proto: unknown = Object.getPrototypeOf(input);
	return proto === Object.prototype || proto === null;
}
