import { expect, test } from "vitest";
import { screen } from "../../src/core/index.js";

test("screen runs in workerd", () => {
	const { action, classification } = screen(new Request("https://example.com/", { headers: { "user-agent": "GPTBot/1.2" } }), "GET", "/", { ai: "allow", rules: [] });
	expect(classification).toMatchObject({ class: "unverifiedBot", bot: "GPTBot" });
	expect(action).toEqual({ kind: "allow" });
});
