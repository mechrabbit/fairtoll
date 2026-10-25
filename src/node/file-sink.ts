import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { EventSink } from "../core/index.js";

/** Enough to ride out a burst on a slow disk without holding more than a few hundred KB of lines. */
const maxWaiting = 1000;

/**
 * Appends each event to `path` as one JSON line, creating the file if needed. Writes run one
 * at a time, so a burst of requests holds one file handle and lines keep their arrival order.
 *
 * A failing write rejects, so observe reports it, but only the first in a run of failures: a
 * missing directory is reported once, not on every request. When `maxWaiting` writes are queued,
 * later events are dropped, and the first drop rejects, until the queue drains.
 */
export function fileSink(path: string): EventSink {
	const file = resolve(path);
	let previous: Promise<unknown> = Promise.resolve();
	let waiting = 0;
	let failing = false;
	let dropping = false;
	return (event) => {
		if (waiting >= maxWaiting) {
			if (dropping) return;
			dropping = true;
			return Promise.reject(new Error(`${maxWaiting} event log writes are waiting, so events are dropped until they finish`));
		}
		waiting++;
		const line = `${JSON.stringify(event)}\n`;
		const write = previous
			.then(() => appendFile(file, line))
			.then(
				() => {
					failing = false;
				},
				(error: unknown) => {
					if (failing) return;
					failing = true;
					throw error;
				},
			)
			.finally(() => {
				if (--waiting === 0) dropping = false;
			});
		previous = write.catch(() => undefined);
		return write;
	};
}
