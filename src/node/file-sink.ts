import { appendFile } from "node:fs/promises";
import type { EventSink } from "../core/index.js";

/** Appends each event to `path` as one JSON line, creating the file if needed. */
export function fileSink(path: string): EventSink {
	return (event) => appendFile(path, `${JSON.stringify(event)}\n`);
}
