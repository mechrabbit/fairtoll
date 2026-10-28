import { expect, test } from "vitest";
import { screen, type DecisionEvent } from "../../src/core/index.js";

test("screen runs in workerd", () => {
	const events: DecisionEvent[] = [];
	const action = screen(new Request("https://example.com/", { headers: { "user-agent": "GPTBot/1.2" } }), "/", { ai: "allow" }, (event) => void events.push(event));
	expect(events).toMatchObject([{ fairtoll: 1, path: "/", class: "unverifiedBot", action: "allow" }]);
	expect(action).toEqual({ kind: "allow" });
});
