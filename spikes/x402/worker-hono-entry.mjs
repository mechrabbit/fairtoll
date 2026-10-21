import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

const network = "eip155:84532";
const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" })).register(network, new ExactEvmScheme());
const app = new Hono();
app.use(paymentMiddleware({ "GET /articles/*": { accepts: { scheme: "exact", network, payTo: "0x000000000000000000000000000000000000dEaD", price: "$0.002" } } }, server));
app.get("/articles/:id", (c) => c.text("article"));

export default app;
