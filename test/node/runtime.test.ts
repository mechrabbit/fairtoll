import { expect, test } from "vitest";

test("core loads in Node", async ({ task }) => {
	task.meta.runtime = navigator.userAgent;
	expect(navigator.userAgent).toMatch(/^Node\.js\//);
	await expect(import("../../src/core/index.js")).resolves.toBeDefined();
});
