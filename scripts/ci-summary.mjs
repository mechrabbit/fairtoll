import { appendFileSync, readFileSync } from "node:fs";

const [reportPath, summaryPath] = process.argv.slice(2);
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const icon = { passed: "✅", failed: "❌" };

const rows = report.testResults.flatMap((file) =>
	file.assertionResults.map((t) => {
		const name = file.name.slice(file.name.indexOf("test/"));
		const runtime = t.meta?.runtime ? `\`${t.meta.runtime}\`` : "";
		return `| ${icon[t.status] ?? t.status} | \`${name}\` | ${t.fullName} | ${runtime} | ${Math.round(t.duration ?? 0)} ms |`;
	}),
);

appendFileSync(
	summaryPath,
	[
		`## Tests: ${report.numPassedTests} passed, ${report.numFailedTests} failed`,
		"",
		"| | File | Test | Observed runtime | Time |",
		"|---|---|---|---|---|",
		...rows,
		"",
	].join("\n"),
);
