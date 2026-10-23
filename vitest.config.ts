import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "node",
					include: ["test/node/**/*.test.ts"],
					environment: "node",
				},
			},
			{
				plugins: [
					cloudflareTest({
						miniflare: {
							compatibilityDate: "2026-10-01",
						},
					}),
				],
				test: {
					name: "worker",
					include: ["test/worker/**/*.test.ts"],
				},
			},
		],
	},
});
