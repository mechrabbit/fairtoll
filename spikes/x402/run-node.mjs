import assert from "node:assert/strict";
import { createCharger } from "./charge.mjs";
import { origin } from "./origin.mjs";
import { priceFor } from "./prices.mjs";
import { runScenarios } from "./scenarios.mjs";
import { createStubFacilitator } from "./stub-facilitator.mjs";

const network = "eip155:84532";
const facilitator = createStubFacilitator(network);
const charge = createCharger({ facilitator, network, payTo: "0x000000000000000000000000000000000000dEaD" });

await runScenarios((request) => charge(request, priceFor(new URL(request.url).pathname), () => origin(request)));

const ops = facilitator.calls.map((c) => c.op);
assert.equal(ops.filter((op) => op === "supported").length, 1, "getSupported runs once, lazily");
assert.equal(ops.filter((op) => op === "settle").length, 2, "only the two served requests settle");
console.log("ok  facilitator calls:", ops.join(" "));
