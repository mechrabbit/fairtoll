import assert from "node:assert/strict";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(generatePrivateKey());
const client = new x402HTTPClient(new x402Client().register("eip155:*", new ExactEvmScheme(toClientEvmSigner(account))));

async function pay(send, url) {
  const first = await send(new Request(url, { headers: { accept: "application/json" } }));
  assert.equal(first.status, 402, `${url} first request is 402`);
  const required = client.getPaymentRequiredResponse((name) => first.headers.get(name), await first.json());
  const payload = await client.createPaymentPayload(required);
  const second = await send(new Request(url, { headers: { accept: "application/json", ...client.encodePaymentSignatureHeader(payload) } }));
  return { quoted: required.accepts[0].amount, second };
}

export async function runScenarios(send) {
  const article = await pay(send, "https://site.test/articles/one");
  assert.equal(article.quoted, "2000", "$0.002 quotes 2000 atomic USDC");
  assert.equal(article.second.status, 200, "article paid retry is served");
  const receipt = client.getPaymentSettleResponse((name) => article.second.headers.get(name));
  assert.equal(receipt.transaction, "0xstub", "PAYMENT-RESPONSE carries the settlement receipt");
  assert.match(article.second.headers.get("cache-control"), /private/, "a paid response is never stored by shared caches");
  console.log("ok  /articles/one quoted", article.quoted, "and served after settle");

  const report = await pay(send, "https://site.test/reports/q3");
  assert.equal(report.quoted, "50000", "AssetAmount passes through unchanged");
  assert.equal(report.second.status, 200, "report paid retry is served");
  console.log("ok  /reports/q3 quoted", report.quoted, "from an AssetAmount");

  const drifting = await pay(send, "https://site.test/drifting/x");
  assert.equal(drifting.second.status, 402, "price change between 402 and retry rejects the payment");
  const retry = client.getPaymentRequiredResponse((name) => drifting.second.headers.get(name), await drifting.second.json());
  assert.equal(retry.error, "No matching payment requirements");
  console.log("ok  /drifting/x quoted", drifting.quoted, "then rejected with:", retry.error);

  const failing = await pay(send, "https://site.test/missing/page");
  assert.equal(failing.second.status, 404, "origin 404 is passed through");
  assert.equal(failing.second.headers.get("payment-response"), null, "no settlement when the origin fails");
  console.log("ok  /missing/page origin 404 passed through without settlement");
}
