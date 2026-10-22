import assert from "node:assert/strict";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { SettleError } from "@x402/core/types";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createCharger } from "./charge.mjs";
import { createStubFacilitator } from "./stub-facilitator.mjs";

const network = "eip155:84532";
const client = new x402HTTPClient(new x402Client().register("eip155:*", new ExactEvmScheme(toClientEvmSigner(privateKeyToAccount(generatePrivateKey())))));

function nonceTrackingFacilitator(rejectWith) {
  const stub = createStubFacilitator(network);
  const used = new Set();
  return {
    ...stub,
    async settle(paymentPayload, paymentRequirements) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const { nonce, from } = paymentPayload.payload.authorization;
      if (used.has(nonce)) {
        const failure = { success: false, errorReason: "invalid_exact_evm_nonce_already_used", transaction: "", network, payer: from };
        if (rejectWith === "throw") throw new SettleError(400, failure);
        return failure;
      }
      used.add(nonce);
      return stub.settle(paymentPayload, paymentRequirements);
    },
  };
}

for (const rejectWith of ["result", "throw"]) {
  let originFetches = 0;
  const charge = createCharger({ facilitator: nonceTrackingFacilitator(rejectWith), network, payTo: "0x000000000000000000000000000000000000dEaD" });
  const send = (request) =>
    charge(request, "$0.002", () => {
      originFetches++;
      return new Response("secret article body");
    });

  const url = "https://site.test/articles/one";
  const first = await send(new Request(url, { headers: { accept: "application/json" } }));
  const required = client.getPaymentRequiredResponse((name) => first.headers.get(name), await first.json());
  const headers = { accept: "application/json", ...client.encodePaymentSignatureHeader(await client.createPaymentPayload(required)) };

  const results = await Promise.allSettled([send(new Request(url, { headers })), send(new Request(url, { headers }))]);
  const outcomes = await Promise.all(
    results.map(async (r) => (r.status === "fulfilled" ? { status: r.value.status, body: await r.value.text() } : { rejected: String(r.reason).slice(0, 80) })),
  );
  console.log(`facilitator rejects duplicate via ${rejectWith}:`, JSON.stringify(outcomes), "origin fetches:", originFetches);
  assert.equal(outcomes.filter((o) => o.body === "secret article body").length, 1, "content is served exactly once for one payment");
}
