/** The four classes from the README. Every request gets exactly one. */
export const requestClasses = ["human", "verifiedAiBuyer", "unverifiedBot", "payingAgent"] as const;
export type RequestClass = (typeof requestClasses)[number];
