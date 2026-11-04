import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * An x402 facilitator over HTTP that settles a payment when it names the price and the wallet the request
 * asked for, and rejects one whose authorization nonce it has already settled. It finds every payment valid
 * to verify. It checks no signature and touches no chain, so it stands in for x402.org's in tests.
 */
export async function startFacilitator(network = "eip155:84532") {
	const settled: string[] = [];
	const app = express();
	app.use(express.json());
	app.get("/supported", (_req, res) => {
		res.json({ kinds: [{ x402Version: 2, scheme: "exact", network }], extensions: [], signers: {} });
	});
	// A testnet run asks the facilitator to verify before it pays. The stub finds every payment valid.
	app.post("/verify", (req, res) => {
		res.json({ isValid: true, payer: req.body.paymentPayload.payload.authorization.from });
	});
	app.post("/settle", (req, res) => {
		const { paymentPayload, paymentRequirements } = req.body;
		const { from, to, value, nonce } = paymentPayload.payload.authorization;
		const reject = (errorReason: string) => res.json({ success: false, errorReason, transaction: "", network, payer: from });
		if (to.toLowerCase() !== paymentRequirements.payTo.toLowerCase() || value !== paymentRequirements.amount) return reject("stub_mismatch");
		if (settled.includes(nonce)) return reject("stub_nonce_used");
		settled.push(nonce);
		res.json({ success: true, transaction: `0xstub${settled.length}`, network, payer: from });
	});
	const server: Server = app.listen(0);
	await new Promise((resolve) => server.once("listening", resolve));
	return {
		url: `http://localhost:${(server.address() as AddressInfo).port}`,
		settled,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

/** An agent with a fresh wallet, which signs a payment for the price a 402 asks. */
export function createPayer() {
	const account = privateKeyToAccount(generatePrivateKey());
	const client = new x402HTTPClient(new x402Client().register("eip155:*", new ExactEvmScheme(toClientEvmSigner(account))));
	return {
		/** The PAYMENT-SIGNATURE header for the PAYMENT-REQUIRED header of a 402. */
		async sign(paymentRequired: string): Promise<string> {
			const required = client.getPaymentRequiredResponse((name) => (name.toLowerCase() === "payment-required" ? paymentRequired : null));
			const header = client.encodePaymentSignatureHeader(await client.createPaymentPayload(required));
			return Object.values(header)[0]!;
		},
		decode: (paymentRequired: string) => client.getPaymentRequiredResponse((name) => (name.toLowerCase() === "payment-required" ? paymentRequired : null)),
	};
}
