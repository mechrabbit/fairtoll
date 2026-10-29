import { expect, test, vi } from "vitest";
import { createCharger, parseConfig } from "../../src/core/index.js";

test("charging runs in workerd, answering an unpaid request with a 402", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }], extensions: [], signers: {} }));
	const charge = createCharger({ price: "0.002", payTo: `0x${"a".repeat(40)}`, network: "base-sepolia" });
	const outcome = await charge(new Request("https://example.com/", { headers: { "user-agent": "GPTBot/1.2" } }), "GET", "/articles/1");
	expect(outcome).toMatchObject({ kind: "respond", status: 402, headers: { "PAYMENT-REQUIRED": expect.any(String) } });
	expect(fetch).toHaveBeenCalledWith("https://x402.org/facilitator/supported", expect.anything());
});

test("the wallet checksum check runs in workerd", () => {
	const charging = { ai: "charge", price: "0.002", network: "base-sepolia" };
	expect(parseConfig({ ...charging, payTo: "0x000000000000000000000000000000000000dEaD" }).ok).toBe(true);
	expect(parseConfig({ ...charging, payTo: "0x000000000000000000000000000000000000dEAD" }).ok).toBe(false);
});
