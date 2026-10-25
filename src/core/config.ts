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
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return { ok: false, errors: [{ field: "config", message: "must be an object" }] };
	}
	const errors: ConfigError[] = [];
	const { eventLog, ...unknown } = input as Record<string, unknown>;
	for (const key of Object.keys(unknown)) {
		errors.push({ field: key, message: "is not a known field" });
	}
	const validLog = typeof eventLog === "string" && eventLog !== "";
	if (eventLog !== undefined && !validLog) {
		errors.push({ field: "eventLog", message: "must be a non-empty file path" });
	}
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, config: validLog ? { eventLog } : {} };
}
