import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { EventSink } from "../core/index.js";

/**
 * Appends each event to `path` as one JSON line, creating the file if needed. Writes run one
 * at a time, so a burst of requests holds one file handle and lines keep their arrival order.
 */
export function fileSink(path: string): EventSink {
	const file = resolve(path);
	let previous: Promise<unknown> = Promise.resolve();
	return (event) => {
		const line = `${JSON.stringify(event)}\n`;
		const write = previous.then(() => appendFile(file, line));
		previous = write.catch(() => undefined);
		return write;
	};
}
