import {
	networks,
	requestClasses,
	type Action,
	type Config,
	type Network,
	type PathPattern,
	type PaymentConfig,
	type PolicyRule,
	type Price,
	type RequestClass,
	type WalletAddress,
} from "./types.js";

/** `field` names where the error is, such as "rules[0].actions.payingAgent". */
export interface ConfigError {
	readonly field: string;
	readonly message: string;
}

export type ParseResult = { readonly ok: true; readonly config: Config } | { readonly ok: false; readonly errors: readonly ConfigError[] };

const priceFormat = /^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/;

/**
 * Parses a decimal USD string such as "0.002" into a price. Returns undefined for anything
 * that is not a positive amount with at most six decimal places, so no price rounds to zero.
 */
export function parsePrice(text: string): Price | undefined {
	const match = priceFormat.exec(text);
	if (!match) return undefined;
	const whole = match[1] ?? "0";
	const fraction = (match[2] ?? ".").slice(1).padEnd(6, "0");
	const microUsd = BigInt(whole) * 1_000_000n + BigInt(fraction);
	return microUsd > 0n ? ({ microUsd } as Price) : undefined;
}

export function parseConfig(input: unknown): ParseResult {
	const errors: ConfigError[] = [];
	const fail = (field: string, message: string) => {
		errors.push({ field, message });
	};

	if (!isObject(input)) {
		return { ok: false, errors: [{ field: "config", message: "must be an object" }] };
	}
	rejectUnknownKeys(input, ["rules", "payment"], "", fail);

	const payment = input.payment === undefined ? undefined : parsePayment(input.payment, fail);

	const rules: PolicyRule[] = [];
	if (input.rules !== undefined) {
		if (!Array.isArray(input.rules)) {
			fail("rules", "must be an array");
		} else {
			input.rules.forEach((rule: unknown, i) => {
				const parsed = parseRule(rule, `rules[${i}]`, fail);
				if (parsed) rules.push(parsed);
			});
		}
	}

	const charges = rules.some((rule) => Object.values(rule.actions).some((action) => action.kind === "charge"));
	if (charges && input.payment === undefined) {
		fail("payment", "is required when any rule charges");
	}

	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, config: payment ? { rules, payment } : { rules } };
}

type Fail = (field: string, message: string) => void;

function parsePayment(input: unknown, fail: Fail): PaymentConfig | undefined {
	if (!isObject(input)) {
		fail("payment", "must be an object");
		return undefined;
	}
	rejectUnknownKeys(input, ["payTo", "network"], "payment.", fail);

	const { payTo, network } = input;
	let ok = true;
	if (typeof payTo !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
		fail("payment.payTo", "must be a public wallet address: 0x followed by 40 hex digits");
		ok = false;
	}
	if (typeof network !== "string" || !(networks as readonly string[]).includes(network)) {
		fail("payment.network", `must be one of ${networks.join(", ")}`);
		ok = false;
	}
	return ok ? { payTo: payTo as WalletAddress, network: network as Network } : undefined;
}

function parseRule(input: unknown, field: string, fail: Fail): PolicyRule | undefined {
	if (!isObject(input)) {
		fail(field, "must be an object");
		return undefined;
	}
	rejectUnknownKeys(input, ["path", "actions"], `${field}.`, fail);

	const { path } = input;
	const pathOk = typeof path === "string" && /^\/[^*]*\*?$/.test(path);
	if (!pathOk) {
		fail(`${field}.path`, 'must start with "/" and may end in "*" to match a prefix, such as "/articles/*"');
	}

	const actionsInput = input.actions ?? {};
	if (!isObject(actionsInput)) {
		fail(`${field}.actions`, "must be an object");
		return undefined;
	}
	rejectUnknownKeys(actionsInput, requestClasses, `${field}.actions.`, fail);

	const actions = {} as Record<RequestClass, Action>;
	let actionsOk = true;
	for (const cls of requestClasses) {
		const action = parseAction(actionsInput[cls], `${field}.actions.${cls}`, fail);
		if (action) actions[cls] = action;
		else actionsOk = false;
	}
	if (!pathOk || !actionsOk) return undefined;

	// A paid retry arrives as a paying agent, and x402 only accepts it at the price the
	// 402 quoted. So when a rule charges anyone, paying agents must be charged the same price.
	// Without this, a forged payment header would get the page free.
	const prices = new Set(Object.values(actions).flatMap((a) => (a.kind === "charge" ? [a.price.microUsd] : [])));
	if (prices.size > 0 && actions.payingAgent.kind !== "charge") {
		fail(`${field}.actions.payingAgent`, "must charge when any class in the rule charges");
	} else if (prices.size > 1) {
		fail(`${field}.actions`, "every class that charges must charge the same price");
	}

	return { path: path as PathPattern, actions };
}

function parseAction(input: unknown, field: string, fail: Fail): Action | undefined {
	if (input === undefined || input === "allow") return { kind: "allow" };
	if (input === "block") return { kind: "block" };
	if (input === "requireLicense") return { kind: "requireLicense" };
	if (isObject(input) && Object.keys(input).length === 1 && "charge" in input) {
		const price = typeof input.charge === "string" ? parsePrice(input.charge) : undefined;
		if (price) return { kind: "charge", price };
		fail(`${field}.charge`, 'must be a positive USD amount with at most six decimals, written as a string such as "0.002"');
		return undefined;
	}
	fail(field, 'must be "allow", "block", "requireLicense", or { charge: "<price in USD>" }');
	return undefined;
}

function rejectUnknownKeys(input: Record<string, unknown>, known: readonly string[], prefix: string, fail: Fail) {
	for (const key of Object.keys(input)) {
		if (!known.includes(key)) fail(`${prefix}${key}`, "is not a known field");
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
