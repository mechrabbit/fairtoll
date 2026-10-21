import "vitest";

declare module "vitest" {
	interface TaskMeta {
		runtime?: string;
	}
}
