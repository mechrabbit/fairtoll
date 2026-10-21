import { expect, test } from "vitest";

test("core loads in Node", async () => {
	expect(process.versions.node).toBeDefined();
	await expect(import("../../src/core/index.js")).resolves.toBeDefined();
});
