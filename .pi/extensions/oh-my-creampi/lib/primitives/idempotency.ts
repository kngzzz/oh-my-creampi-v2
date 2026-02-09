import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { ensureDir } from "../util";

export type IdempotencyEntry = {
	key: string;
	createdAt: number;
	expiresAt: number;
};

export type IdempotencyCheck = {
	duplicate: boolean;
	entry?: IdempotencyEntry;
};

export class IdempotencyLedger {
	private readonly dir: string;
	private readonly ttlSec: number;
	private readonly now: () => number;

	constructor(options: { dir: string; ttlSec: number; now?: () => number }) {
		this.dir = options.dir;
		this.ttlSec = Math.max(1, Math.floor(options.ttlSec));
		this.now = options.now ?? (() => Date.now());
	}

	private filePathForKey(key: string): string {
		const digest = createHash("sha256").update(key).digest("hex");
		return path.join(this.dir, `${digest}.json`);
	}

	private async read(key: string): Promise<IdempotencyEntry | undefined> {
		await ensureDir(this.dir);
		const filePath = this.filePathForKey(key);
		try {
			const raw = await fs.promises.readFile(filePath, "utf8");
			const parsed = JSON.parse(raw) as Partial<IdempotencyEntry>;
			if (
				typeof parsed.key !== "string" ||
				typeof parsed.createdAt !== "number" ||
				typeof parsed.expiresAt !== "number"
			) {
				return undefined;
			}
			return {
				key: parsed.key,
				createdAt: parsed.createdAt,
				expiresAt: parsed.expiresAt,
			};
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT") return undefined;
			throw error;
		}
	}

	async check(key: string): Promise<IdempotencyCheck> {
		const normalized = key.trim();
		if (!normalized) return { duplicate: false };

		const entry = await this.read(normalized);
		if (!entry) return { duplicate: false };
		if (entry.expiresAt <= this.now()) return { duplicate: false, entry };
		return { duplicate: true, entry };
	}

	async record(key: string, ttlSec = this.ttlSec): Promise<IdempotencyEntry> {
		const normalized = key.trim();
		if (!normalized) {
			throw new Error("idempotency key is required");
		}
		const ttl = Math.max(1, Math.floor(ttlSec));
		const createdAt = this.now();
		const entry: IdempotencyEntry = {
			key: normalized,
			createdAt,
			expiresAt: createdAt + ttl * 1000,
		};
		await ensureDir(this.dir);
		const filePath = this.filePathForKey(normalized);
		await fs.promises.writeFile(filePath, JSON.stringify(entry, null, 2), "utf8");
		return entry;
	}

	async checkAndRecord(key: string, ttlSec = this.ttlSec): Promise<IdempotencyCheck> {
		const existing = await this.check(key);
		if (existing.duplicate) return existing;
		const entry = await this.record(key, ttlSec);
		return { duplicate: false, entry };
	}

	async purgeExpired(): Promise<number> {
		await ensureDir(this.dir);
		const now = this.now();
		const files = await fs.promises.readdir(this.dir);
		let deleted = 0;
		for (const file of files) {
			if (!file.endsWith(".json")) continue;
			const filePath = path.join(this.dir, file);
			try {
				const raw = await fs.promises.readFile(filePath, "utf8");
				const parsed = JSON.parse(raw) as Partial<IdempotencyEntry>;
				if (typeof parsed.expiresAt !== "number" || parsed.expiresAt > now) continue;
				await fs.promises.rm(filePath, { force: true });
				deleted += 1;
			} catch {
				continue;
			}
		}
		return deleted;
	}
}
