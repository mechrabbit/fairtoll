import { expect, test } from "vitest";
import { createGate } from "../../src/core/index.js";

test("the gate runs in workerd", async () => {
	const gate = createGate({ ai: "block" });
	const { outcome, logged } = gate.check(new Request("https://example.com/", { headers: { "user-agent": "GPTBot/1.2" } }), "GET", "/");
	expect(await outcome).toMatchObject({ kind: "respond", status: 403 });
	await logged;
});
