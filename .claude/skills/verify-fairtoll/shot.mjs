// Renders a run's curl.txt and server.log as terminal-style PNGs next to them, for a PR description.
// Usage: node shot.mjs <run-dir> [title]. Needs Playwright with Chromium, which require() must find. It is not
// a dependency, so require() is used for its NODE_PATH lookup, which a global install relies on and import ignores.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");

const [dir, title = ""] = process.argv.slice(2);
const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 200 } });
for (const [file, label] of [["curl.txt", "curl requests and responses"], ["server.log", "demo server output"]]) {
	const source = path.join(dir, file);
	if (!existsSync(source)) continue;
	const heading = escape(title ? `${title}: ${label}` : label);
	await page.setContent(`<body style="margin:0;background:#1e1e1e;color:#ddd;font:14px/1.35 monospace;padding:16px">
<div style="color:#6fd;font-weight:bold;margin-bottom:8px">${heading}</div><pre style="margin:0;white-space:pre-wrap">${escape(readFileSync(source, "utf8"))}</pre></body>`);
	const out = path.join(dir, file.replace(/\.\w+$/, ".png"));
	await page.screenshot({ path: out, fullPage: true });
	console.log(`shot: ${out}`);
}
await browser.close();
