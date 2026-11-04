/** The four classes from CONTRIBUTING.md. Every request gets exactly one. */
export const requestClasses = ["human", "verifiedAiBuyer", "unverifiedBot", "payingAgent"] as const;
export type RequestClass = (typeof requestClasses)[number];
