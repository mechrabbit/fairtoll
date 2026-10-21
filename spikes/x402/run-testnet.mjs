import assert from "node:assert/strict";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createCharger } from "./charge.mjs";
import { origin } from "./origin.mjs";

const facilitator = new HTTPFacilitatorClient({ url: "https://x402.org/facilitator", timeoutMs: 10_000 });
const charge = createCharger({ facilitator, network: "eip155:84532", payTo: "0x000000000000000000000000000000000000dEaD" });
const send = (request) => charge(request, "$0.001", () => origin(request));

const payer = privateKeyToAccount(generatePrivateKey());
const client = new x402HTTPClient(new x402Client().register("eip155:*", new ExactEvmScheme(toClientEvmSigner(payer))));

const url = "https://site.test/articles/testnet";
const first = await send(new Request(url, { headers: { accept: "application/json" } }));
assert.equal(first.status, 402);
const required = client.getPaymentRequiredResponse((name) => first.headers.get(name), await first.json());
console.log("402 accepts", JSON.stringify(required.accepts[0]));

const payload = await client.createPaymentPayload(required);
const second = await send(new Request(url, { headers: { accept: "application/json", ...client.encodePaymentSignatureHeader(payload) } }));
const rejected = client.getPaymentRequiredResponse((name) => second.headers.get(name), await second.json());
assert.equal(second.status, 402, "unfunded payer is rejected by the live facilitator");
console.log("live facilitator verify rejected unfunded payer", payer.address, "with:", rejected.error);
