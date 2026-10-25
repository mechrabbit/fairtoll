/** An empty config only observes. */
export interface Config {
	/** File the event log appends JSON lines to. */
	readonly eventLog?: string;
}

/** `field` names where the error is, such as "eventLog". */
export interface ConfigError {
	readonly field: string;
	readonly message: string;
}

export type ParseResult = { readonly ok: true; readonly config: Config } | { readonly ok: false; readonly errors: readonly ConfigError[] };

export function parseConfig(input: unknown): ParseResult {
	if (!isPlainObject(input)) {
		return { ok: false, errors: [{ field: "config", message: "must be a plain object" }] };
	}
	const errors: ConfigError[] = [];
	const { eventLog, ...rest } = input;
	for (const key of Object.keys(rest)) {
		errors.push({ field: key, message: "is not a known field" });
	}
	const validLog = typeof eventLog === "string" && eventLog !== "";
	if (eventLog !== undefined && !validLog) {
		errors.push({ field: "eventLog", message: "must be a non-empty file path" });
	}
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, config: validLog ? { eventLog } : {} };
}

/** Only a plain object's own keys are the config, so a Promise or Map can't parse as an empty config. */
function isPlainObject(input: unknown): input is Record<string, unknown> {
	if (typeof input !== "object" || input === null) return false;
	const proto: unknown = Object.getPrototypeOf(input);
	return proto === Object.prototype || proto === null;
}
