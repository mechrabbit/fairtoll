import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { runScenarios } from "./scenarios.mjs";

async function bundle(entry, compatibilityFlags) {
  const nodeCompat = compatibilityFlags.includes("nodejs_compat") ? { alias: { url: "node:url" }, external: ["node:*"] } : {};
  const out = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "browser", conditions: ["workerd", "worker", "browser"], logLevel: "silent", ...nodeCompat });
  return out.outputFiles[0].text;
}

async function start(entry, compatibilityFlags) {
  return new Miniflare({ modules: true, script: await bundle(entry, compatibilityFlags), compatibilityDate: "2026-08-01", compatibilityFlags });
}

const core = await start("worker-entry.mjs", []);
console.log("== core charger on workerd, no nodejs_compat");
await runScenarios((request) => core.dispatchFetch(request.url, { headers: request.headers }));
await core.dispose();

for (const flags of [[], ["nodejs_compat"]]) {
  console.log(`== @x402/hono middleware on workerd, flags=[${flags}]`);
  let mf;
  try {
    mf = await start("worker-hono-entry.mjs", flags);
    for (const attempt of [1, 2]) {
      const res = await mf.dispatchFetch("https://site.test/articles/one", { headers: { accept: "application/json" } });
      console.log(`request ${attempt} status`, res.status, "payment-required header:", res.headers.has("payment-required"));
    }
  } catch (error) {
    console.log("error", String(error).split("\n")[0]);
  } finally {
    await mf?.dispose();
  }
}
