import tseslint from "typescript-eslint";

export default tseslint.config(
	{ ignores: ["dist/", "node_modules/", "**/.next/"] },
	...tseslint.configs.recommended,
	{
		// Node built-ins and globals already fail core's own typecheck (src/core/tsconfig.json), but Express has types
		// installed, so an import of it would typecheck, and a triple-slash reference could bring Node's types or the DOM back.
		// Worker-only globals such as self and caches still typecheck, so core must not rely on them either.
		files: ["src/core/**/*.ts"],
		rules: {
			"@typescript-eslint/triple-slash-reference": ["error", { lib: "never", path: "never", types: "never" }],
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							regex: "^express($|/)",
							message: "Core must not depend on Express. Put Express code in src/express.",
						},
					],
				},
			],
		},
	},
);
