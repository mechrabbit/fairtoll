import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
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

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "fairtoll-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

test("appends one JSON line per event in arrival order, creating the file", async () => {
	const path = join(dir, "events.jsonl");
	const log = fileSink(path);
	await Promise.all([log(event("/a")), log(event("/b")), log(event("/c"))]);

	const lines = (await readFile(path, "utf8")).split("\n");
	expect(lines.pop()).toBe("");
	expect(lines.map((line) => JSON.parse(line))).toEqual([event("/a"), event("/b"), event("/c")]);
});

test("keeps what the file already holds", async () => {
	const path = join(dir, "events.jsonl");
	await fileSink(path)(event("/a"));
	await fileSink(path)(event("/b"));

	expect(await readFile(path, "utf8")).toBe(`${JSON.stringify(event("/a"))}\n${JSON.stringify(event("/b"))}\n`);
});

test("rejects on the first failed write, so observe can report it, and keeps writing later events", async () => {
	const path = join(dir, "missing-dir", "events.jsonl");
	const log = fileSink(path);
	await expect(log(event("/a"))).rejects.toThrow(/ENOENT/);

	await mkdir(join(dir, "missing-dir"));
	await log(event("/b"));
	expect(await readFile(path, "utf8")).toBe(`${JSON.stringify(event("/b"))}\n`);
});

test("reports a run of failed writes once, and again after a write succeeds", async () => {
	const path = join(dir, "missing-dir", "events.jsonl");
	const log = fileSink(path);
	const results = await Promise.allSettled([log(event("/a")), log(event("/b")), log(event("/c"))]);
	expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);

	await mkdir(join(dir, "missing-dir"));
	await log(event("/d"));
	await rm(join(dir, "missing-dir"), { recursive: true });
	await expect(log(event("/e"))).rejects.toThrow(/ENOENT/);
});

test("drops events once 1000 writes are waiting, reporting the first drop, until the queue drains", async () => {
	const path = join(dir, "events.jsonl");
	const log = fileSink(path);
	const queued = Array.from({ length: 1000 }, (_, i) => log(event(`/${i}`)));
	const dropped = log(event("/dropped"));
	expect(log(event("/also-dropped"))).toBeUndefined();
	await expect(dropped).rejects.toThrow(/dropped/);
	await Promise.all(queued);

	await log(event("/after"));
	const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
	expect(lines).toHaveLength(1001);
	expect(lines[1000]).toBe(JSON.stringify(event("/after")));
});
