// Signs an x402 payment the way a paying agent does, for the price in a 402's PAYMENT-REQUIRED header, and
// prints the PAYMENT-SIGNATURE header to send back. What it pays goes to stderr. The wallet is new each run and holds nothing, which the
// demo's stand-in facilitator doesn't check.
// Usage: node demo/pay.js <PAYMENT-REQUIRED header value>
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const [paymentRequired] = process.argv.slice(2);
if (!paymentRequired) {
	console.error("Usage: node demo/pay.js <PAYMENT-REQUIRED header value>");
	process.exit(1);
}
const account = privateKeyToAccount(generatePrivateKey());
const client = new x402HTTPClient(new x402Client().register("eip155:*", new ExactEvmScheme(toClientEvmSigner(account))));
const required = client.getPaymentRequiredResponse((name) => (name.toLowerCase() === "payment-required" ? paymentRequired : null));
const [{ amount, network, payTo }] = required.accepts;
console.error(`Paying ${amount} millionths of a USDC to ${payTo} on ${network}, from ${account.address}`);
console.log(Object.values(client.encodePaymentSignatureHeader(await client.createPaymentPayload(required)))[0]);
