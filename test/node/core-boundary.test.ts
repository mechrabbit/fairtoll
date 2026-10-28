import { ESLint } from "eslint";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const probe = resolve("src/core/probe.ts");
const config = ts.getParsedCommandLineOfConfigFile(resolve("src/core/tsconfig.json"), {}, {
	...ts.sys,
	onUnRecoverableConfigFileDiagnostic: (d) => {
		throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
	},
});
const options = config!.options;

/** The type errors `code` would have as a file in src/core, checked with core's own tsconfig. */
function typeErrors(code: string): string[] {
	const host = ts.createCompilerHost(options);
	const getSourceFile = host.getSourceFile;
	host.getSourceFile = (name, ...rest) => (name === probe ? ts.createSourceFile(name, code, ts.ScriptTarget.Latest) : getSourceFile(name, ...rest));
	const program = ts.createProgram([probe], options, host);
	return ts.getPreEmitDiagnostics(program, program.getSourceFile(probe)).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

describe("core stays runtime-neutral", { timeout: 30_000 }, () => {
	test.each([
		'import { readFileSync } from "node:fs"; export const used = readFileSync;',
		'import { createHash } from "crypto"; export const used = createHash;',
		"export const used = process;",
		"export const used = Buffer;",
		"export const used = require;",
		"export const used = __dirname;",
		"export const used = setImmediate;",
		"export const used = document;",
	])("core's typecheck rejects %s", (code) => {
		expect(typeErrors(code)).toEqual([expect.stringMatching(/^Cannot find (name|module)/)]);
	});

	test("core's tsconfig parses without errors", () => {
		expect(config!.errors).toEqual([]);
	});

	test("core's typecheck accepts the Web APIs core uses", () => {
		expect(typeErrors('export const used = new Request("https://example.com/").headers.get("user-agent"); console.error(used);')).toEqual([]);
	});

	test("lint rejects express and references to Node's types or the DOM in src/core, and allows them in an adapter", async () => {
		const eslint = new ESLint();
		const rules = async (filePath: string) => {
			const code = '/// <reference types="node" />\n/// <reference lib="dom" />\nimport express from "express";\nexport const used = express;\n';
			const [result] = await eslint.lintText(code, { filePath });
			return (result?.messages ?? []).map((m) => m.ruleId);
		};
		expect(await rules("src/core/probe.ts")).toEqual(["@typescript-eslint/triple-slash-reference", "@typescript-eslint/triple-slash-reference", "no-restricted-imports"]);
		expect(await rules("src/express/probe.ts")).toEqual([]);
	});
});
