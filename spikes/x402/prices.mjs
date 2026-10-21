let drift = 0;

export function priceFor(pathname) {
  if (pathname.startsWith("/reports/")) return { amount: "50000", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", extra: { name: "USDC", version: "2" } };
  if (pathname.startsWith("/drifting/")) return `$0.00${++drift}`;
  return "$0.002";
}
