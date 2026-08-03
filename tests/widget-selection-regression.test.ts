import assert from "node:assert/strict";
import test from "node:test";
import {
  readWidgetConfig,
  reconcileAllWidgetConfigs,
  resolveWidgetAddRequest,
  saveWidgetSelection,
} from "../lib/widgetConfig";
import { createWidgetModel } from "../lib/widgetModel";

class MemoryStore {
  values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
  async getAllKeys() { return [...this.values.keys()]; }
}

test("Free migration removes polluted historical policy IDs and does not lock a new challenge", async () => {
  const store = new MemoryStore();
  store.values.set("onemore_widget_config:u:10", JSON.stringify({
    widgetId: 10, uid: "u", mode: "automatic", orderedChallengeIds: ["active"],
    updatedAtISO: "2026-07-01T00:00:00.000Z", version: 1,
  }));
  store.values.set("onemore_widget_access:u", JSON.stringify({
    uid: "u", activeFreeChallengeId: "active",
    orderedChallengeIds: ["active", "deleted", "Veta"],
    updatedAtISO: "2026-07-02T00:00:00.000Z", version: 1,
  }));

  const repaired = await reconcileAllWidgetConfigs("u", ["active", "Veta"], false, [10], store);
  const config = repaired.configs.get(10)!;
  const access = repaired.accessByWidgetId.get(10)!;
  assert.deepEqual(config.orderedChallengeIds, ["active"]);
  assert.deepEqual(config.premiumSelectedChallengeIds, []);
  assert.equal(config.premiumSelectionRecorded, false);
  assert.deepEqual(access, { orderedIds: ["active"], activeId: "active", frozenIds: [] });

  const state: any = {
    challenges: [
      { id: "active", text: "Active", enabled: true },
      { id: "Veta", text: "Veta", enabled: true },
    ],
    history: [{ date: "2026-07-19", challengeId: "active", status: "completed" }],
    challengeStats: {},
  };
  const model = createWidgetModel(state, "cs", "2026-07-19", [], "u", false, access.orderedIds, access.frozenIds);
  assert.deepEqual(model.challenges.map((item) => item.id), ["active"]);
  assert.deepEqual({ completed: model.completed, total: model.total }, { completed: 1, total: 1 });
});

test("deleting a selected challenge prunes selection, order, Premium snapshot and every widget instance", async () => {
  const store = new MemoryStore();
  await saveWidgetSelection({ widgetId: 1, uid: "u", mode: "manual", orderedChallengeIds: ["a", "deleted"] }, ["a", "deleted", "c"], true, "a", store);
  await saveWidgetSelection({ widgetId: 2, uid: "u", mode: "manual", orderedChallengeIds: ["deleted", "c"] }, ["a", "deleted", "c"], true, "a", store);
  await reconcileAllWidgetConfigs("u", ["a", "deleted", "c"], false, [], store);

  const repaired = await reconcileAllWidgetConfigs("u", ["a", "c"], false, [], store);
  const first = repaired.configs.get(1)!;
  const second = repaired.configs.get(2)!;
  for (const config of [first, second]) {
    assert.equal(config.orderedChallengeIds.includes("deleted"), false);
    assert.equal(config.premiumSelectedChallengeIds.includes("deleted"), false);
  }
  assert.deepEqual(first.orderedChallengeIds, ["a"]);
  assert.deepEqual(second.orderedChallengeIds, ["a", "c"]);
  assert.deepEqual(repaired.accessByWidgetId.get(1)?.frozenIds, []);
  assert.deepEqual(repaired.accessByWidgetId.get(2)?.frozenIds, ["c"]);
  assert.deepEqual((await readWidgetConfig(1, "u", store))?.orderedChallengeIds, ["a"]);
  assert.deepEqual((await readWidgetConfig(2, "u", store))?.orderedChallengeIds, ["a", "c"]);
});

test("Free add request offers Premium without changing selection or persisted configuration", async () => {
  const store = new MemoryStore();
  await saveWidgetSelection({ widgetId: 3, uid: "u", mode: "manual", orderedChallengeIds: ["a"] }, ["a", "b"], false, "a", store);
  const before = await readWidgetConfig(3, "u", store);
  const result = resolveWidgetAddRequest(before!.orderedChallengeIds, "b", false);
  assert.deepEqual(result, { selectedIds: ["a"], requiresPremium: true });
  assert.deepEqual(await readWidgetConfig(3, "u", store), before);
});

test("expiration freezes only confirmed Premium selection and renewal restores only that selection", async () => {
  const store = new MemoryStore();
  await saveWidgetSelection({ widgetId: 4, uid: "u", mode: "automatic", orderedChallengeIds: ["a", "b"] }, ["a", "b"], true, "a", store);

  const expired = await reconcileAllWidgetConfigs("u", ["a", "b", "new-after-expiry"], false, [], store);
  assert.deepEqual(expired.configs.get(4)?.orderedChallengeIds, ["a", "b"]);
  assert.deepEqual(expired.accessByWidgetId.get(4)?.frozenIds, ["b"]);
  assert.equal(expired.configs.get(4)?.orderedChallengeIds.includes("new-after-expiry"), false);
  assert.equal(expired.configs.get(4)?.premiumSelectedChallengeIds.includes("new-after-expiry"), false);

  const renewed = await reconcileAllWidgetConfigs("u", ["a", "b", "new-after-expiry"], true, [], store);
  assert.deepEqual(renewed.configs.get(4)?.orderedChallengeIds, ["a", "b"]);
  assert.deepEqual(renewed.configs.get(4)?.premiumSelectedChallengeIds, ["a", "b"]);
  assert.deepEqual(renewed.accessByWidgetId.get(4)?.frozenIds, []);

  const stable = await reconcileAllWidgetConfigs("u", ["a", "b", "new-after-expiry"], true, [], store);
  assert.deepEqual(stable.configs.get(4)?.orderedChallengeIds, ["a", "b"]);
});

test("multiple widget instances retain separate proven snapshots while sharing one Free active challenge", async () => {
  const store = new MemoryStore();
  await saveWidgetSelection({ widgetId: 20, uid: "u", mode: "manual", orderedChallengeIds: ["a", "b"] }, ["a", "b", "c"], true, "a", store);
  await saveWidgetSelection({ widgetId: 21, uid: "u", mode: "manual", orderedChallengeIds: ["b", "c"] }, ["a", "b", "c"], true, "a", store);
  const expired = await reconcileAllWidgetConfigs("u", ["a", "b", "c"], false, [], store);

  assert.deepEqual(expired.configs.get(20)?.premiumSelectedChallengeIds, ["a", "b"]);
  assert.deepEqual(expired.configs.get(21)?.premiumSelectedChallengeIds, ["b", "c"]);
  assert.deepEqual(expired.accessByWidgetId.get(20), { orderedIds: ["a", "b"], activeId: "a", frozenIds: ["b"] });
  assert.deepEqual(expired.accessByWidgetId.get(21), { orderedIds: ["a", "b", "c"], activeId: "a", frozenIds: ["b", "c"] });
});
