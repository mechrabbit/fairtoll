import { expect, test } from "vitest";
import { observe, type DecisionEvent } from "../../src/core/index.js";

test("observe runs in workerd", async () => {
	const events: DecisionEvent[] = [];
	await observe(new Request("https://example.com/", { headers: { "user-agent": "GPTBot/1.2" } }), (event) => void events.push(event));
	expect(events).toMatchObject([{ fairtoll: 1, path: "/", class: "unverifiedBot", action: "allow" }]);
});
