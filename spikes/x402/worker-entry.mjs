import { createCharger } from "./charge.mjs";
import { origin } from "./origin.mjs";
import { priceFor } from "./prices.mjs";
import { createStubFacilitator } from "./stub-facilitator.mjs";

const network = "eip155:84532";
const charge = createCharger({ facilitator: createStubFacilitator(network), network, payTo: "0x000000000000000000000000000000000000dEaD" });

export default {
  fetch: (request) => charge(request, priceFor(new URL(request.url).pathname), () => origin(request)),
};
