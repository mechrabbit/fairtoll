import { expect, test } from "vitest";
import { readPath } from "../../src/core/paths.js";

test("reading a path runs in workerd", () => {
	expect(readPath("/Caf%C3%A9//Menu")).toEqual({ kind: "read", key: "/café/menu", segments: ["café", "menu"] });
	expect(readPath("/caf%C3%A9/%2e%2e/menu")).toEqual({ kind: "unreadable" });
});
