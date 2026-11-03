import { parseConfig, type Config } from "../../src/core/index.js";

/** The config `parseConfig` makes from `input`, which the test means to be valid. */
export function parsed(input: unknown): Config {
	const result = parseConfig(input);
	if (!result.ok) throw new Error(`the test's config is invalid: ${JSON.stringify(result.errors)}`);
	return result.config;
}
