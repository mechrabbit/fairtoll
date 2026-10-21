import { ExactEvmScheme } from "@x402/evm/exact/server";

const scheme = new ExactEvmScheme();
for (const price of ["$0.002", "0.002", "$0.0000004", 0.1 + 0.2, "$1e-3"]) {
  try {
    const { amount } = await scheme.parsePrice(price, "eip155:84532");
    console.log(JSON.stringify(price), "->", amount);
  } catch (error) {
    console.log(JSON.stringify(price), "-> throws", error.message);
  }
}
