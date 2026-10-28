import { builtinModules } from "node:module";
import tseslint from "typescript-eslint";

const runtimeNeutral = "Core runs in Node and Workers. Use Web-standard APIs, or move this code to an adapter.";

export default tseslint.config(
	{ ignores: ["dist/", "node_modules/"] },
	...tseslint.configs.recommended,
	{
		files: ["src/core/**/*.ts"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					// A built-in such as "fs" can be imported without the node: prefix.
					paths: builtinModules.map((name) => ({ name, message: runtimeNeutral })),
					patterns: [
						{
							regex: "^node:",
							message: runtimeNeutral,
						},
						{
							regex: "^express($|/)",
							message: "Core must not depend on Express. Put Express code in src/express.",
						},
					],
				},
			],
			"no-restricted-globals": [
				"error",
				...["process", "Buffer", "require", "__dirname", "__filename"].map((name) => ({
					name,
					message: runtimeNeutral,
				})),
			],
		},
	},
);
