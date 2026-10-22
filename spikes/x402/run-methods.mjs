import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createCharger } from "./charge.mjs";
import { createStubFacilitator } from "./stub-facilitator.mjs";

const network = "eip155:84532";
const facilitator = createStubFacilitator(network);
const charge = createCharger({ facilitator, network, payTo: "0x000000000000000000000000000000000000dEaD" });
const client = new x402HTTPClient(new x402Client().register("eip155:*", new ExactEvmScheme(toClientEvmSigner(privateKeyToAccount(generatePrivateKey())))));
const origin = (request) => new Response(request.method === "HEAD" ? null : `body for ${request.method}`, { headers: { "content-length": "20" } });

for (const method of ["HEAD", "OPTIONS", "POST"]) {
  const url = "https://site.test/articles/one";
  const init = { method, headers: { accept: "application/json" }, ...(method === "POST" && { body: JSON.stringify({ q: 1 }) }) };
  const first = await charge(new Request(url, init), "$0.002", () => origin(new Request(url, init)));
  let line = `${method}: unpaid ${first.status}`;
  if (first.status === 402) {
    const body = method === "HEAD" ? {} : await first.json();
    const required = client.getPaymentRequiredResponse((name) => first.headers.get(name), body);
    const paidInit = { ...init, headers: { ...init.headers, ...client.encodePaymentSignatureHeader(await client.createPaymentPayload(required)) } };
    const settlesBefore = facilitator.calls.filter((c) => c.op === "settle").length;
    const paid = await charge(new Request(url, paidInit), "$0.002", () => origin(new Request(url, paidInit)));
    const settled = facilitator.calls.filter((c) => c.op === "settle").length > settlesBefore;
    line += `, paid ${paid.status}, settled=${settled}, body=${JSON.stringify(await paid.text())}`;
  }
  console.log(line);
}
