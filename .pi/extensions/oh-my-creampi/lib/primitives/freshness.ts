import { createHash } from "node:crypto";

import { stableStringify } from "../util";

export function computeFreshnessHash(payload: unknown): string {
	const canonical = stableStringify(payload);
	return createHash("sha256").update(canonical).digest("hex");
}
