import { ESLint } from "eslint";
import { describe, expect, test } from "vitest";

const eslint = new ESLint();

async function restrictedRules(code: string, filePath: string) {
	const [result] = await eslint.lintText(code, { filePath });
	return (result?.messages ?? [])
		.map((m) => m.ruleId)
		.filter((id) => id === "no-restricted-imports" || id === "no-restricted-globals");
}

const nodeOnly = [
	'import { readFileSync } from "node:fs";',
	'import express from "express";',
	"export const used = [readFileSync, express, process, Buffer, require, __dirname, __filename];",
].join("\n");

describe("core stays runtime-neutral", { timeout: 30_000 }, () => {
	test("lint rejects node:* imports, express, and Node globals in src/core", async () => {
		expect(await restrictedRules(nodeOnly, "src/core/probe.ts")).toEqual([
			"no-restricted-imports", // node:fs
			"no-restricted-imports", // express
			"no-restricted-globals", // process
			"no-restricted-globals", // Buffer
			"no-restricted-globals", // require
			"no-restricted-globals", // __dirname
			"no-restricted-globals", // __filename
		]);
	});

	test("lint allows the same code in an adapter", async () => {
		expect(await restrictedRules(nodeOnly, "src/express/probe.ts")).toEqual([]);
	});
});
