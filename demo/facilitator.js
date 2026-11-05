// A stand-in for an x402 facilitator such as x402.org's, shared by both demo servers. It settles a payment that
// names the price and wallet the 402 asked for, and rejects a payment it has already settled. It checks no
// signature and moves no money.
const settledNonces = new Set();

/** The answer to GET /supported. */
export const supported = { kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }], extensions: [], signers: {} };

/** The answer to POST /settle, given its JSON body. */
export function settle({ paymentPayload, paymentRequirements }) {
	const { from, to, value, nonce } = paymentPayload.payload.authorization;
	const network = paymentRequirements.network;
	let errorReason;
	if (to.toLowerCase() !== paymentRequirements.payTo.toLowerCase() || value !== paymentRequirements.amount) errorReason = "wrong_price_or_wallet";
	else if (settledNonces.has(nonce)) errorReason = "payment_already_used";
	console.log(`   facilitator ${errorReason ? `rejects: ${errorReason}` : `settles ${value} from ${from}`}`);
	if (errorReason) return { success: false, errorReason, transaction: "", network, payer: from };
	settledNonces.add(nonce);
	return { success: true, transaction: `0xdemo${settledNonces.size}`, network, payer: from };
}
