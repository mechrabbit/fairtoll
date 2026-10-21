import { withPrivateCacheControl, x402HTTPResourceServer, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

class FetchRequestAdapter {
  constructor(request, price) {
    this.request = request;
    this.url = new URL(request.url);
    this.price = price;
  }
  getHeader(name) {
    return this.request.headers.get(name) ?? undefined;
  }
  getMethod() {
    return this.request.method;
  }
  getPath() {
    return this.url.pathname;
  }
  getUrl() {
    return this.request.url;
  }
  getAcceptHeader() {
    return this.request.headers.get("accept") ?? "";
  }
  getUserAgent() {
    return this.request.headers.get("user-agent") ?? "";
  }
}

export function createCharger({ facilitator, network, payTo }) {
  const resourceServer = new x402ResourceServer(facilitator).register(network, new ExactEvmScheme());
  const httpServer = new x402HTTPResourceServer(resourceServer, {
    "*": {
      accepts: { scheme: "exact", network, payTo, price: (ctx) => ctx.adapter.price },
      customPaywallHtml: "<!doctype html><p>Payment required</p>",
    },
  });
  let ready;

  return async function charge(request, price, serve) {
    ready ??= httpServer.initialize().catch((error) => {
      ready = undefined;
      throw error;
    });
    await ready;

    const adapter = new FetchRequestAdapter(request, price);
    const context = { adapter, path: adapter.getPath(), method: adapter.getMethod() };
    const result = await httpServer.processHTTPRequest(context);

    if (result.type === "payment-error") {
      const { status, headers, body, isHtml } = result.response;
      return new Response(isHtml ? body : JSON.stringify(body ?? {}), { status, headers });
    }
    if (result.type !== "payment-verified") {
      throw new Error(`unexpected result ${result.type}`);
    }

    const origin = await serve();
    if (origin.status >= 400) {
      await result.cancellationDispatcher.cancel({ reason: "handler_failed", responseStatus: origin.status });
      return origin;
    }
    const settled = await httpServer.processSettlement(result.paymentPayload, result.paymentRequirements);
    if (!settled.success) {
      const { status, headers, body } = settled.response;
      return new Response(JSON.stringify(body ?? {}), { status, headers });
    }
    const response = new Response(origin.body, origin);
    for (const [key, value] of Object.entries(settled.headers)) response.headers.set(key, value);
    response.headers.set("cache-control", withPrivateCacheControl(response.headers.get("cache-control")));
    return response;
  };
}
