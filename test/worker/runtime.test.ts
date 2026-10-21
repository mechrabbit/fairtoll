import { expect, test } from "vitest";

test("core loads in workerd", async ({ task }) => {
	task.meta.runtime = navigator.userAgent;
	expect(navigator.userAgent).toBe("Cloudflare-Workers");
	await expect(import("../../src/core/index.js")).resolves.toBeDefined();
});
