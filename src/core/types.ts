declare const brand: unique symbol;
type Brand<T, Name extends string> = T & { readonly [brand]: Name };

/** Who sent a request, before counting any payment it carries. Policy rules set an action for each. */
export const payerClasses = ["human", "verifiedAiBuyer", "unverifiedBot"] as const;
export type PayerClass = (typeof payerClasses)[number];

/** The four classes from the README. Every request gets exactly one. */
export const requestClasses = [...payerClasses, "payingAgent"] as const;
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

/**
 * A rule sets no action for paying agents. A paid request is the retry after a 402, and x402
 * accepts it only at the price the 402 quoted. So a paying agent gets its payer's action, and
 * a charge is checked at the payer's price. Any other action for paying agents would either
 * let a forged payment header through free or reject every real payment.
 */
export interface PolicyRule {
	readonly path: PathPattern;
	/** Every payer class has an action. A class the config leaves out is allowed. */
	readonly actions: Readonly<Record<PayerClass, Action>>;
}

export interface PaymentConfig {
	readonly payTo: WalletAddress;
	readonly network: Network;
}

/**
 * The whole config. A request that matches no rule is allowed, so a config with no rules
 * only observes. Which rule wins when several match is the policy engine's choice.
 * `payment` is present whenever any rule charges.
 */
export interface Config {
	readonly rules: readonly PolicyRule[];
	readonly payment?: PaymentConfig;
}

interface ClassifiedBase {
	readonly request: Request;
	/** Why the classifier chose the class, for the event log. */
	readonly reason: string;
	/** The bot the request claims or proves to be, such as "GPTBot", when the classifier knows it. */
	readonly agent?: string;
}

/** A paying agent carries a payment. Its `payer` is the class it would have without one. */
export type ClassifiedRequest =
	| (ClassifiedBase & { readonly class: PayerClass })
	| (ClassifiedBase & { readonly class: "payingAgent"; readonly payer: PayerClass });

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
	/** Set for a paying agent: the class whose action priced it. */
	readonly payer?: PayerClass;
	readonly agent?: string;
	readonly reason: string;
	/** The path of the rule that matched, absent when none did. */
	readonly rule?: PathPattern;
	readonly action: ActionKind;
	readonly price?: Price;
	/** Set when a stage failed or timed out and the request passed through. */
	readonly error?: string;
}

/**
 * Returns the price to charge, or undefined to charge `configured`, the price from the
 * matching rule. The default hook returns `configured`. A hook can price by `agent`, but it must return the same
 * price for the 402 and for the paid retry, or x402 rejects the retry. For a paying agent,
 * price it as its `payer` class.
 */
export type PricingHook = (request: ClassifiedRequest, configured: Price) => Price | undefined | Promise<Price | undefined>;

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
