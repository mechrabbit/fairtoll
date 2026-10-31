import { expect, test } from "vitest";
import { parseConfig } from "../../src/core/index.js";

test("the wallet checksum check runs in workerd", () => {
	const charging = { ai: "charge", price: "0.002", network: "base-sepolia" };
	expect(parseConfig({ ...charging, payTo: "0x000000000000000000000000000000000000dEaD" }).ok).toBe(true);
	expect(parseConfig({ ...charging, payTo: "0x000000000000000000000000000000000000dEAD" }).ok).toBe(false);
});
