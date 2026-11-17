import { expect, test, vi } from "vitest";
import { createGate } from "../../src/core/index.js";

test("the gate runs in workerd", async () => {
	const gate = createGate({ ai: "block" });
	const { outcome, logged } = gate.check(new Request("https://example.com/", { headers: { "user-agent": "GPTBot/1.2" } }), "GET", "/");
	expect(await outcome).toMatchObject({ kind: "respond", status: 403 });
	await logged;
});

test("a gate with a site fetches its config in workerd", async () => {
	vi.stubGlobal("fetch", async () => Response.json({ ai: "block" }));
	try {
		const gate = createGate({}, { site: { key: "site-key", url: "https://service.test/v1/config" } });
		// Two requests at once share the one fetch.
		const bot = () => new Request("https://example.com/", { headers: { "user-agent": "GPTBot/1.2" } });
		const checks = [gate.check(bot(), "GET", "/"), gate.check(bot(), "GET", "/")];
		for (const { outcome, logged } of checks) {
			expect(await outcome).toMatchObject({ kind: "respond", status: 403 });
			await logged;
		}
	} finally {
		vi.unstubAllGlobals();
	}
});
