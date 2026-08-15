import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createVersionGateController } from "../lib/updateStartupPolicy";
import type { VersionCheckDecision } from "../lib/versionCheck";

function harness(decisions: VersionCheckDecision[]) {
  let checks = 0;
  let cloudStarts = 0;
  let listeners = 0;
  let writes = 0;
  const observed: string[] = [];
  const controller = createVersionGateController({
    check: async () => decisions[Math.min(checks++, decisions.length - 1)],
    onDecision: (decision) => observed.push(decision.status),
    startCloudSync: () => {
      cloudStarts += 1;
      listeners += 1;
      writes += 1;
    },
  });
  return {
    controller,
    counts: () => ({ checks, cloudStarts, listeners, writes, observed }),
  };
}

test("verified starts all cloud access exactly once", async () => {
  const run = harness([{ status: "verified" }]);
  await run.controller.verify();
  await run.controller.verify();
  assert.deepEqual(run.counts(), {
    checks: 2, cloudStarts: 1, listeners: 1, writes: 1,
    observed: ["verified", "verified"],
  });
});

test("updateRequired creates no cloud listener or write", async () => {
  const run = harness([{
    status: "updateRequired",
    update: { level: "required", latestVersionName: "2.0.0" },
  }]);
  await run.controller.verify();
  assert.deepEqual(run.counts(), {
    checks: 1, cloudStarts: 0, listeners: 0, writes: 0,
    observed: ["updateRequired"],
  });
});

test("unverified permits offline UI but starts no cloud work", async () => {
  const run = harness([{ status: "unverified" }]);
  assert.equal((await run.controller.verify()).status, "unverified");
  assert.deepEqual(run.counts(), {
    checks: 1, cloudStarts: 0, listeners: 0, writes: 0,
    observed: ["unverified"],
  });
});

test("unverified retry verifies before starting cloud once", async () => {
  const run = harness([{ status: "unverified" }, { status: "verified" }]);
  await run.controller.verify();
  assert.equal(run.counts().cloudStarts, 0);
  await run.controller.verify();
  await run.controller.verify();
  assert.equal(run.counts().cloudStarts, 1);
  assert.equal(run.counts().listeners, 1);
  assert.equal(run.counts().writes, 1);
});

test("unverified retry may become updateRequired without cloud access", async () => {
  const run = harness([
    { status: "unverified" },
    { status: "updateRequired", update: { level: "required", latestVersionName: "2.0.0" } },
  ]);
  await run.controller.verify();
  await run.controller.verify();
  assert.equal(run.controller.currentStatus(), "updateRequired");
  assert.equal(run.counts().cloudStarts, 0);
});

test("concurrent foreground checks coalesce and never duplicate the listener", async () => {
  let resolve!: (decision: VersionCheckDecision) => void;
  let checks = 0;
  let starts = 0;
  const controller = createVersionGateController({
    check: () => {
      checks += 1;
      if (checks > 1) return Promise.resolve({ status: "verified" });
      return new Promise<VersionCheckDecision>((done) => { resolve = done; });
    },
    onDecision: () => undefined,
    startCloudSync: () => { starts += 1; },
  });
  const first = controller.verify();
  const second = controller.verify();
  resolve({ status: "verified" });
  await Promise.all([first, second]);
  await controller.verify().then(() => undefined);
  assert.equal(checks, 2);
  assert.equal(starts, 1);
});

test("required UpdateGate remains blocking while its scrollable card stays compact", () => {
  const source = readFileSync(join(process.cwd(), "lib/UpdateGate.tsx"), "utf8");
  assert.match(source, /maxWidth: 420/);
  assert.match(source, /alignSelf: "center"/);
  assert.match(source, /<ScrollView style=\{styles\.card\}/);
  assert.match(source, /onRequestClose=\{close\}/);
  assert.match(source, /if \(!required\) setUpdate\(null\)/);
  assert.doesNotMatch(source, /<Pressable style=\{styles\.backdrop\}/);
});
