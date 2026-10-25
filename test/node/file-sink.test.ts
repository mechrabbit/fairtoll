import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { DecisionEvent } from "../../src/core/index.js";
import { fileSink } from "../../src/node/file-sink.js";

const event = (path: string): DecisionEvent => ({
	v: 1,
	time: "2026-10-25T00:00:00.000Z",
	path,
	class: "human",
	reason: "no bot signals",
	action: "allow",
});

test("appends one JSON line per event, creating the file", async () => {
	const path = join(await mkdtemp(join(tmpdir(), "fairtoll-")), "events.jsonl");
	const log = fileSink(path);
	await Promise.all([log(event("/a")), log(event("/b"))]);

	const lines = (await readFile(path, "utf8")).split("\n");
	expect(lines.pop()).toBe("");
	expect(lines.map((line) => JSON.parse(line)).sort((a, b) => a.path.localeCompare(b.path))).toEqual([event("/a"), event("/b")]);
});

test("rejects when the file can't be written, so observe can report it", async () => {
	await expect(fileSink("/nonexistent-dir/events.jsonl")(event("/"))).rejects.toThrow(/ENOENT/);
});
