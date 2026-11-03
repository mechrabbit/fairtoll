import { expect, test } from "vitest";
import { parseConfig, screen, type DecisionEvent } from "../../src/core/index.js";

test("screen runs in workerd", () => {
	const result = parseConfig({});
	if (!result.ok) throw new Error("the empty config is valid");
	const events: DecisionEvent[] = [];
	const action = screen(new Request("https://example.com/", { headers: { "user-agent": "GPTBot/1.2" } }), "GET", "/", result.config, (event) => void events.push(event));
	expect(events).toMatchObject([{ fairtoll: 1, path: "/", class: "unverifiedBot", action: "allow" }]);
	expect(action).toEqual({ kind: "allow" });
});
