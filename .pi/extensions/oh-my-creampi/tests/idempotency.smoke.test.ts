import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { IdempotencyLedger } from "../lib/primitives/idempotency";
import { makeTempDir } from "./helpers";

test("idempotency check returns non-duplicate for unknown key", async () => {
	const dir = makeTempDir();
	const ledger = new IdempotencyLedger({ dir, ttlSec: 60 });
	const check = await ledger.check("alpha");
	assert.equal(check.duplicate, false);
});

test("idempotency record then check blocks duplicate", async () => {
	const dir = makeTempDir();
	const ledger = new IdempotencyLedger({ dir, ttlSec: 60 });
	await ledger.record("alpha");
	const check = await ledger.check("alpha");
	assert.equal(check.duplicate, true);
});

test("idempotency expired entry no longer blocks", async () => {
	const dir = makeTempDir();
	let now = 1_000;
	const ledger = new IdempotencyLedger({ dir, ttlSec: 1, now: () => now });
	await ledger.record("alpha", 1);
	now = 3_000;
	const check = await ledger.check("alpha");
	assert.equal(check.duplicate, false);
});

test("idempotency checkAndRecord records first call", async () => {
	const dir = makeTempDir();
	const ledger = new IdempotencyLedger({ dir, ttlSec: 30 });
	const first = await ledger.checkAndRecord("same");
	assert.equal(first.duplicate, false);
	assert.ok(first.entry);
});

test("idempotency checkAndRecord blocks second call", async () => {
	const dir = makeTempDir();
	const ledger = new IdempotencyLedger({ dir, ttlSec: 30 });
	await ledger.checkAndRecord("same");
	const second = await ledger.checkAndRecord("same");
	assert.equal(second.duplicate, true);
});

test("idempotency purgeExpired removes stale files", async () => {
	const dir = makeTempDir();
	let now = 1000;
	const ledger = new IdempotencyLedger({ dir, ttlSec: 1, now: () => now });
	await ledger.record("a", 1);
	await ledger.record("b", 1);
	now = 5_000;
	const deleted = await ledger.purgeExpired();
	assert.equal(deleted, 2);
	const files = fs.readdirSync(path.resolve(dir));
	assert.equal(files.length, 0);
});
