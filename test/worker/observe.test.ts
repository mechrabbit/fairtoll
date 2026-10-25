import { expect, test } from "vitest";
import { classify, decide, observe, type DecisionEvent } from "../../src/core/index.js";

test("observe runs in workerd", async () => {
	const events: DecisionEvent[] = [];
	await observe(new Request("https://example.com/", { headers: { "user-agent": "GPTBot/1.2" } }), {
		classify,
		decide,
		log: (event) => void events.push(event),
	});
	expect(events).toMatchObject([{ v: 1, path: "/", class: "unverifiedBot", action: "allow" }]);
});
