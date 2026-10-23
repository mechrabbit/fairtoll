declare const brand: unique symbol;
type Brand<T, Name extends string> = T & { readonly [brand]: Name };

/** The four classes from the README. Every request gets exactly one. */
export const requestClasses = ["human", "verifiedAiBuyer", "unverifiedBot", "payingAgent"] as const;
export type RequestClass = (typeof requestClasses)[number];

/**
 * A price in micro-USD. USDC has six decimals on every supported network, so this is
 * also the atomic USDC amount. Only `parsePrice` makes one, so a float never becomes a price.
 */
export type Price = Brand<{ readonly microUsd: bigint }, "Price">;

/** A public EVM address that receives payments. It is the only payment field in the config. */
export type WalletAddress = Brand<string, "WalletAddress">;

/** CAIP-2 ids for Base mainnet and Base Sepolia, the networks the x402 spike checked. */
export const networks = ["eip155:8453", "eip155:84532"] as const;
export type Network = (typeof networks)[number];

export type Action =
	| { readonly kind: "allow" }
	| { readonly kind: "block" }
	| { readonly kind: "requireLicense" }
	| { readonly kind: "charge"; readonly price: Price };
export type ActionKind = Action["kind"];

/**
 * A path pattern: either an exact path such as "/about", or a prefix ending in "*"
 * such as "/articles/*". "/*" matches every path.
 */
export type PathPattern = Brand<string, "PathPattern">;

export interface PolicyRule {
	readonly path: PathPattern;
	/** Every class has an action. A class the config leaves out is allowed. */
	readonly actions: Readonly<Record<RequestClass, Action>>;
}

export interface PaymentConfig {
	readonly payTo: WalletAddress;
	readonly network: Network;
}

/**
 * The whole config. Rules are checked in order and the first match decides. A request
 * that matches no rule is allowed, so a config with no rules only observes.
 * `payment` is present whenever any rule charges.
 */
export interface Config {
	readonly rules: readonly PolicyRule[];
	readonly payment?: PaymentConfig;
}

export interface ClassifiedRequest {
	readonly request: Request;
	readonly class: RequestClass;
	/** Why the classifier chose the class, for the event log. */
	readonly reason: string;
}

export interface Decision {
	readonly action: Action;
	/** The rule that matched, or undefined when none did and the request is allowed. */
	readonly rule: PolicyRule | undefined;
}

export interface DecisionEvent {
	/** ISO 8601 time the request arrived. */
	readonly time: string;
	readonly method: string;
	readonly path: string;
	readonly class: RequestClass;
	readonly reason: string;
	readonly action: ActionKind;
	readonly price?: Price;
}

/**
 * Returns the price to charge. `configured` is the price from the matching rule, and the
 * default hook returns it unchanged. A hook must return the same price for the same request
 * from the 402 until the paid retry, or x402 rejects the retry.
 */
export type PricingHook = (request: ClassifiedRequest, configured: Price) => Price | Promise<Price>;

export type Classifier = (request: Request) => Promise<ClassifiedRequest>;

/**
 * What an action handler tells the pipeline. `respond` answers without the origin.
 * `forward` fetches the origin and passes its response through `finish`, which can
 * settle a payment or add headers before the response goes out.
 */
export type HandlerOutcome =
	| { readonly kind: "respond"; readonly response: Response }
	| { readonly kind: "forward"; readonly finish: (origin: Response) => Promise<Response> };

export type ActionHandler<A extends Action = Action> = (request: ClassifiedRequest, action: A) => Promise<HandlerOutcome>;

export type ActionHandlers = { readonly [K in ActionKind]: ActionHandler<Extract<Action, { kind: K }>> };

export type EventSink = (event: DecisionEvent) => void | Promise<void>;
