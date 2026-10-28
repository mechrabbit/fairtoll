import tseslint from "typescript-eslint";

export default tseslint.config(
	{ ignores: ["dist/", "node_modules/"] },
	...tseslint.configs.recommended,
	{
		// Node built-ins and globals already fail core's own typecheck (src/core/tsconfig.json), but Express has types
		// installed, so an import of it would typecheck.
		files: ["src/core/**/*.ts"],
		rules: {
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
