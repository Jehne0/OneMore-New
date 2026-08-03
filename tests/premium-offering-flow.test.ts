import assert from "node:assert/strict";
import test from "node:test";
import { PremiumOfferingFlow } from "../lib/premiumOfferingFlow";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("first request fails and latest request succeeds without popup", async () => {
  const flow = new PremiumOfferingFlow<string>(); flow.beginOpen();
  const old = deferred<string[]>();
  const first = flow.load(() => old.promise, 0);
  const second = flow.load(async () => ["monthly"], 0);
  old.reject(new Error("early auth"));
  assert.equal((await first).status, "stale");
  assert.deepEqual(await second, { status: "ready", packages: ["monthly"], showError: false, requestId: 3 });
});

test("older delayed failure cannot replace a newer successful package", async () => {
  const flow = new PremiumOfferingFlow<string>(); flow.beginOpen();
  const old = deferred<string[]>();
  const first = flow.load(() => old.promise, 0);
  const latest = await flow.load(async () => ["monthly"], 0);
  old.reject(new Error("late failure"));
  assert.equal((await first).status, "stale");
  assert.deepEqual(flow.currentPackages(), ["monthly"]);
  assert.equal(latest.showError, false);
});

test("valid cache survives failed refresh without popup", async () => {
  const flow = new PremiumOfferingFlow<string>(); flow.beginOpen(["monthly"]);
  const result = await flow.load(async () => { throw new Error("offline"); }, 0);
  assert.equal(result.status, "cached");
  assert.equal(result.showError, false);
});

test("missing cache and failed request show one popup per opening", async () => {
  const flow = new PremiumOfferingFlow<string>(); flow.beginOpen();
  const first = await flow.load(async () => { throw new Error("offline"); }, 0);
  const second = await flow.load(async () => { throw new Error("offline"); }, 0);
  assert.equal(first.showError, true);
  assert.equal(second.showError, false);
});

test("reopening Premium clears the old per-open error", async () => {
  const flow = new PremiumOfferingFlow<string>(); flow.beginOpen();
  assert.equal((await flow.load(async () => [], 0)).showError, true);
  flow.beginOpen();
  assert.equal((await flow.load(async () => [], 0)).showError, true);
});

test("widget configuration opening can wait through auth failure and retry offering", async () => {
  const flow = new PremiumOfferingFlow<string>(); flow.beginOpen();
  let attempts = 0;
  const result = await flow.load(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("REVENUECAT_FIREBASE_UID_REQUIRED");
    return ["monthly"];
  }, 1);
  assert.equal(result.status, "ready");
  assert.equal(result.showError, false);
  assert.equal(attempts, 2);
});

test("upgrade uses the exact PurchasesPackage object displayed by the paywall", async () => {
  const flow = new PremiumOfferingFlow<{ identifier: string }>(); flow.beginOpen();
  const displayed = { identifier: "monthly" };
  await flow.load(async () => [displayed], 0);
  const selectedForPurchase = flow.currentPackages()[0];
  assert.equal(selectedForPurchase, displayed);
});
