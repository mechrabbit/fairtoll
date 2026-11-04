#!/usr/bin/env node
// The fairtoll command. `fairtoll testnet config.json` pays for one page the config charges, on Base Sepolia
// with test USDC, so a publisher sees a paid request succeed before charging real money. The paying wallet's
// private key comes from FAIRTOLL_TESTNET_KEY, so it never lands in shell history, and is never stored.
import { readFileSync } from "node:fs";
import { runTestnet } from "./testnet.js";

const usage = "Usage: FAIRTOLL_TESTNET_KEY=0x... npx fairtoll testnet config.json";
const [command, configPath, ...rest] = process.argv.slice(2);
if (command !== "testnet" || configPath === undefined || rest.length > 0) {
	console.error(usage);
	process.exit(1);
}
let input: unknown;
try {
	input = JSON.parse(readFileSync(configPath, "utf8"));
} catch (error) {
	console.error(`Could not read ${configPath} as JSON: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
const key = process.env.FAIRTOLL_TESTNET_KEY;
if (!key) {
	console.error(`Set FAIRTOLL_TESTNET_KEY to the private key of a testnet wallet that holds test USDC on Base Sepolia.\n${usage}`);
	process.exit(1);
}
process.exit((await runTestnet(input, key, (line) => console.log(line))) ? 0 : 1);
