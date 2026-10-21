import { ESLint } from "eslint";
import { describe, expect, test } from "vitest";

const eslint = new ESLint();

async function restrictedRules(code: string, filePath: string) {
	const [result] = await eslint.lintText(code, { filePath });
	return (result?.messages ?? [])
		.filter((m) => m.ruleId === "no-restricted-imports" || m.ruleId === "no-restricted-globals")
		.map((m) => m.message.split(".")[0]);
}

const nodeOnly = [
	'import { readFileSync } from "node:fs";',
	'import express from "express";',
	"export const used = [readFileSync, express, process, Buffer, require, __dirname, __filename];",
].join("\n");

describe("core stays runtime-neutral", { timeout: 30_000 }, () => {
	test("lint rejects node:* imports, express, and Node globals in src/core", async () => {
		expect(await restrictedRules(nodeOnly, "src/core/probe.ts")).toEqual([
			"'node:fs' import is restricted from being used by a pattern",
			"'express' import is restricted from being used by a pattern",
			"Unexpected use of 'process'",
			"Unexpected use of 'Buffer'",
			"Unexpected use of 'require'",
			"Unexpected use of '__dirname'",
			"Unexpected use of '__filename'",
		]);
	});

	test("lint allows the same code in an adapter", async () => {
		expect(await restrictedRules(nodeOnly, "src/express/probe.ts")).toEqual([]);
	});
});
