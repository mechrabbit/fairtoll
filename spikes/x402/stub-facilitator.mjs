export function createStubFacilitator(network) {
  const calls = [];
  return {
    calls,
    async getSupported() {
      calls.push({ op: "supported" });
      return { kinds: [{ x402Version: 2, scheme: "exact", network }], extensions: [], signers: {} };
    },
    async verify(paymentPayload, paymentRequirements) {
      calls.push({ op: "verify", amount: paymentRequirements.amount, payTo: paymentRequirements.payTo });
      const auth = paymentPayload.payload.authorization;
      const ok = auth.to.toLowerCase() === paymentRequirements.payTo.toLowerCase() && auth.value === paymentRequirements.amount;
      return { isValid: ok, invalidReason: ok ? undefined : "stub_mismatch", payer: auth.from };
    },
    async settle(paymentPayload, paymentRequirements) {
      calls.push({ op: "settle", amount: paymentRequirements.amount });
      return { success: true, transaction: "0xstub", network: paymentRequirements.network, payer: paymentPayload.payload.authorization.from };
    },
  };
}
