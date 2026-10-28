/**
 * What the publisher asks Fairtoll to do, as `parseConfig` returns it with every default filled in. The
 * publisher writes any object `parseConfig` accepts, such as `{}`, which only observes.
 */
export interface Config {
	/**
	 * What happens to a request from an AI bot or agent. Blocking covers only requests that reach the site: a
	 * cache in front of it, such as a CDN, can answer a bot with a cached page without asking the site, so a
	 * site behind one should block AI bots in the cache too.
	 */
	readonly ai: "allow" | "block";
}

/** `field` names where the error is, such as "rules". */
export interface ConfigError {
	readonly field: string;
	readonly message: string;
}

export type ParseResult = { readonly ok: true; readonly config: Config } | { readonly ok: false; readonly errors: readonly ConfigError[] };

export function parseConfig(input: unknown): ParseResult {
	if (!isPlainObject(input)) {
		return { ok: false, errors: [{ field: "config", message: "must be a plain object" }] };
	}
	const errors = Object.keys(input)
		.filter((field) => field !== "ai")
		.map((field) => ({ field, message: "is not a known field" }));
	const ai = (Object.hasOwn(input, "ai") ? input.ai : undefined) ?? "allow";
	if (ai !== "allow" && ai !== "block") {
		return { ok: false, errors: [...errors, { field: "ai", message: 'must be "allow" or "block"' }] };
	}
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, config: { ai } };
}

/** Only a plain object's own keys are the config, so a Promise or Map can't parse as an empty config. */
function isPlainObject(input: unknown): input is Record<string, unknown> {
	if (typeof input !== "object" || input === null) return false;
	const proto: unknown = Object.getPrototypeOf(input);
	return proto === Object.prototype || proto === null;
}
