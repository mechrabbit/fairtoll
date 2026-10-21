import tseslint from "typescript-eslint";

export default tseslint.config(
	{ ignores: ["dist/", "node_modules/"] },
	...tseslint.configs.recommended,
	{
		files: ["src/core/**/*.ts"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							regex: "^node:",
							message: "Core runs in Node and Workers. Use Web-standard APIs, or move this code to an adapter.",
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
					message: "Core runs in Node and Workers. Use Web-standard APIs, or move this code to an adapter.",
				})),
			],
		},
	},
);
