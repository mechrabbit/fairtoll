import { readFileSync } from "node:fs";

export const readConfig = (path: string) => readFileSync(path, "utf8");
