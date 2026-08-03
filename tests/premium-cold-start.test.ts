import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { isPremiumSnapshotActiveAt, parsePremiumSnapshot, readPremiumSnapshot, resolveCachedPremiumState, writePremiumSnapshot, type PremiumSnapshot } from "../lib/premiumSnapshot";
import { readWidgetAccessPolicy, resolveWidgetChallengeAccess, updateWidgetAccessPolicy } from "../lib/widgetConfig";
import { createWidgetModel } from "../lib/widgetModel";
import { isAccountSnapshotPremiumAt, parseAccountSnapshot, readAccountSnapshot, resolveAccountPremiumBootstrapState, writeAccountSnapshot } from "../lib/accountSnapshot";
import { clearWidgetSessionForExplicitSignOut, resolveWidgetAuthState } from "../lib/widgetSession";

const snapshot = (overrides: Partial<PremiumSnapshot> = {}): PremiumSnapshot => ({
  schemaVersion: 2, uid: "u1", revenueCatAppUserId: "u1", isPremiumActive: true,
  expirationDate: "2026-08-01T00:00:00.000Z", willRenew: true, managementURL: "https://example.test/manage",
  checkedAt: "2026-07-19T00:00:00.000Z", source: "customerInfo", entitlementIdentifier: "premium", isLifetime: false,
  ...overrides,
});

function memoryStore() {
  const values = new Map<string, string>();
  return { values, getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value); }, removeItem: async (key: string) => { values.delete(key); } };
}

const execFileAsync = promisify(execFile);

test("cold start accepts an unexpired UID-scoped snapshot without live auth", async () => {
  const store = memoryStore(); await writePremiumSnapshot(snapshot(), store);
  const restored = await readPremiumSnapshot("u1", store);
  assert.equal(isPremiumSnapshotActiveAt(restored!, "u1", Date.parse("2026-07-20T00:00:00Z")), true);
  assert.equal(resolveCachedPremiumState(restored, "u1", Date.parse("2026-07-20T00:00:00Z")), "premium");
});

test("missing snapshot checks Premium and is never interpreted as Free", () => {
  assert.equal(resolveCachedPremiumState(null, "u1"), "checkingPremium");
});

test("UID mismatch cannot inherit Premium", () => {
  assert.equal(isPremiumSnapshotActiveAt(snapshot(), "u2", Date.parse("2026-07-20T00:00:00Z")), false);
  assert.equal(parsePremiumSnapshot(snapshot(), "u2"), null);
});

test("expiration wins over willRenew while lifetime remains active", () => {
  assert.equal(isPremiumSnapshotActiveAt(snapshot(), "u1", Date.parse("2026-08-02T00:00:00Z")), false);
  assert.equal(isPremiumSnapshotActiveAt(snapshot({ expirationDate: null, isLifetime: true }), "u1", Date.parse("2036-01-01T00:00:00Z")), true);
  assert.equal(isPremiumSnapshotActiveAt(snapshot({ expirationDate: "2020-01-01T00:00:00Z", isLifetime: true }), "u1", Date.parse("2036-01-01T00:00:00Z")), true);
});

test("corrupt snapshot is unknown rather than confirmed Free", async () => {
  const store = memoryStore(); store.values.set("onemore_premium_snapshot:u1", "{broken");
  assert.equal(await readPremiumSnapshot("u1", store), null);
  assert.equal(resolveCachedPremiumState(await readPremiumSnapshot("u1", store), "u1"), "checkingPremium");
});

test("Premium expiration freezes every selected challenge except the first valid one", () => {
  const access = resolveWidgetChallengeAccess(["b", "c"], ["missing", "b", "c"], false, { uid: "u1", activeFreeChallengeId: "missing", updatedAtISO: "", version: 2 }, ["missing", "b", "c"]);
  assert.deepEqual(access, { orderedIds: ["b", "c"], activeId: "b", frozenIds: ["c"] });
});

test("renewed Premium restores all challenges in preserved order", () => {
  const policy = { uid: "u1", activeFreeChallengeId: "b", updatedAtISO: "", version: 2 as const };
  assert.deepEqual(resolveWidgetChallengeAccess(["a", "b", "c"], ["a", "b", "c"], true, policy).orderedIds, ["a", "b", "c"]);
});

test("all widget instances share one per-UID active Free challenge", async () => {
  const store = memoryStore();
  await updateWidgetAccessPolicy("u1", "b", store);
  const policy = await readWidgetAccessPolicy("u1", store);
  assert.equal(resolveWidgetChallengeAccess(["a", "b", "c"], ["a", "c"], false, policy).activeId, "b");
  assert.equal(resolveWidgetChallengeAccess(["a", "b", "c"], ["b", "c"], false, policy).activeId, "b");
});

test("Free user can atomically change the one active widget challenge", async () => {
  const store = memoryStore(); await updateWidgetAccessPolicy("u1", "a", store);
  await updateWidgetAccessPolicy("u1", "b", store);
  assert.equal((await readWidgetAccessPolicy("u1", store))?.activeFreeChallengeId, "b");
});

test("frozen model rows retain data but expose a lock", () => {
  const state: any = { challenges: [{ id: "a", text: "A", enabled: true }, { id: "b", text: "B", enabled: true }], history: [{ date: "2026-07-20", challengeId: "a", status: "completed" }], challengeStats: { a: { currentStreak: 4 }, b: { currentStreak: 9 } } };
  const model = createWidgetModel(state, "en", "2026-07-20", [], "u1", false, ["a", "b"], ["b"]);
  assert.equal(model.challenges[0].lockedByPremiumExpiration, undefined);
  assert.equal(model.challenges[1].lockedByPremiumExpiration, true);
  assert.equal(model.challenges[1].streak, 9);
  assert.deepEqual({ completed: model.completed, total: model.total }, { completed: 1, total: 1 });
});

test("cold process restores UID from durable storage without Firebase or an existing RN singleton", async () => {
  const directory = await mkdtemp(join(tmpdir(), "onemore-cold-process-"));
  const storageFile = join(directory, "storage.json");
  const account = {
    schemaVersion: 1, activeUid: "u1", displayNameFallback: "Cold User", premiumState: "premium",
    expirationDate: "2026-08-01T00:00:00.000Z", lifetime: false, willRenew: true,
    managementURL: "https://example.test/manage", checkedAt: "2026-07-19T00:00:00.000Z", stateRevision: 7,
  };
  await writeFile(storageFile, JSON.stringify({
    onemore_widget_active_uid: "u1",
    "onemore_account_snapshot:u1": JSON.stringify(account),
  }));
  try {
    const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "tests/fixtures/cold-process-reader.ts", storageFile], { cwd: process.cwd() });
    assert.deepEqual(JSON.parse(stdout), {
      uid: "u1", accountUid: "u1", displayNameFallback: "Cold User", premiumState: "premium",
      managementURL: "https://example.test/manage",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("native-compatible account snapshot bootstraps Premium with no Firebase runtime", async () => {
  const store = memoryStore();
  await writeAccountSnapshot({ activeUid: "u1", displayNameFallback: "User", premiumState: "premium", expirationDate: "2026-08-01T00:00:00.000Z", lifetime: false, willRenew: true, managementURL: "https://example.test/manage", checkedAt: "2026-07-19T00:00:00Z" }, store);
  const restored = await readAccountSnapshot("u1", store);
  assert.equal(isAccountSnapshotPremiumAt(restored!, Date.parse("2026-07-20T00:00:00Z")), true);
  assert.equal(parseAccountSnapshot(restored, "other"), null);
});

test("missing account Premium remains checking while expired Premium is definitively Free", () => {
  assert.equal(resolveAccountPremiumBootstrapState(null), "checking");
  const expired = parseAccountSnapshot({
    schemaVersion: 1, activeUid: "u1", displayNameFallback: "OneMore user", premiumState: "premium",
    expirationDate: "2026-07-18T00:00:00.000Z", lifetime: false, willRenew: false,
    managementURL: null, checkedAt: "2026-07-18T00:00:00.000Z", stateRevision: 1,
  }, "u1");
  assert.ok(expired);
  assert.equal(resolveAccountPremiumBootstrapState(expired, Date.parse("2026-07-19T00:00:00.000Z")), "free");
});

test("temporary Firebase null with cached account never becomes signed out", async () => {
  assert.deepEqual(await resolveWidgetAuthState({ activeUid: "u1", hasCachedAccount: true, waitForAuthReady: async () => {}, getAuthenticatedUid: () => null, persistActiveUid: async () => {} }), { kind: "cachedAuthenticated", uid: "u1" });
  assert.deepEqual(await resolveWidgetAuthState({ activeUid: "u1", hasCachedAccount: true, waitForAuthReady: async () => { throw new Error("slow"); }, getAuthenticatedUid: () => null, persistActiveUid: async () => {} }), { kind: "errorWithValidCache", uid: "u1" });
});

test("confirmed explicit sign-out clears both durable UID and its account snapshot", async () => {
  const store = memoryStore();
  store.values.set("onemore_widget_active_uid", "u1");
  await writeAccountSnapshot({
    activeUid: "u1", displayNameFallback: "User", premiumState: "free", expirationDate: null,
    lifetime: false, willRenew: null, managementURL: null, checkedAt: "2026-07-19T00:00:00.000Z",
  }, store);
  await clearWidgetSessionForExplicitSignOut(store);
  assert.equal(store.values.has("onemore_widget_active_uid"), false);
  assert.equal(await readAccountSnapshot("u1", store), null);
});
