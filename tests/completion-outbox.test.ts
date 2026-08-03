import assert from "node:assert/strict";
import test from "node:test";
import {
  completeChallengeWithRepository,
  readCompletionOutbox,
  type CompletionRepository,
} from "../lib/challengeCompletion";
import {
  cacheSharedChallenges,
  completeSharedChallengeForUid,
  readSharedCache,
  readSharedOutbox,
  replaySharedCompletionOutbox,
  type SharedCompletionMutation,
} from "../lib/sharedCompletion";
import { defaultState, type AppState } from "../lib/storage";
import { updateStatsOnSkipped } from "../lib/storage";
import { createWidgetModel } from "../lib/widgetModel";
import { createWidgetRenderModel } from "../lib/widgetRenderModel";
import type { SharedChallenge } from "../lib/sharedChallenges";
import { shouldUploadLocalState } from "../lib/cloudMergePolicy";
import { drainPendingWidgetCompletions, handleWidgetCompletion, readPendingWidgetCompletions, type WidgetCompletionDependencies } from "../lib/widgetCompletionAction";

class MemoryStore {
  values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
}

function personalState(count = 1): AppState {
  return { ...defaultState, challenges: Array.from({ length: count }, (_, i) => ({
    id: String(i + 1), text: `Challenge ${i + 1}`, enabled: true, period: "daily" as const,
  })), history: [], archivedChallenges: [], everCompletedKeys: [], challengeStats: {} };
}

function personalRepository(store = new MemoryStore(), initial = personalState()) {
  let state = initial;
  const repository: CompletionRepository = {
    store,
    async load() { return state; },
    async save(next) { state = next; },
  };
  return { repository, get state() { return state; } };
}

function shared(overrides: Partial<SharedChallenge> = {}): SharedChallenge {
  return { id: "shared-1", title: "Together", createdBy: "u1", memberUids: ["u1", "u2"],
    targetPerDay: 1, period: "daily", customDays: [], enabled: true, status: "active",
    acceptedBy: ["u1", "u2"], pendingInviteUids: [], leftBy: [], ...overrides };
}

test("personal completion persists state and durable outbox while offline", async () => {
  const store = new MemoryStore();
  const repo = personalRepository(store);
  const result = await completeChallengeWithRepository("u1", "1", "2026-07-17", repo.repository);
  assert.equal(result.status, "completed");
  assert.equal(repo.state.history.length, 1);
  assert.equal((await readCompletionOutbox("u1", store)).length, 1);
});

test("canonical currentStreak 1 completion is saved before final widget snapshot renders 2", async () => {
  const store = new MemoryStore();
  const initial: AppState = {
    ...personalState(),
    challengeStats: { "1": { completedCount: 1, skippedCount: 0, currentStreak: 1, bestStreak: 1, skipCredits: 0, lastCompletedDay: "2026-07-16", lastStreakDay: "2026-07-16" } },
    history: [{ date: "2026-07-16", time: "09:00", atISO: "2026-07-16T09:00:00.000Z", challengeId: "1", challengeText: "Challenge 1", status: "completed" }],
  };
  let persisted = initial;
  const events: string[] = [];
  const repository: CompletionRepository = {
    store,
    async load() { events.push("load"); return persisted; },
    async save(next) { persisted = next; events.push(`save:${next.challengeStats?.["1"]?.currentStreak}`); },
  };
  const result = await completeChallengeWithRepository("u1", "1", "2026-07-17", repository);
  assert.equal(result.state.challengeStats?.["1"]?.currentStreak, 2);
  const reloaded = await repository.load("u1");
  const widget = createWidgetModel(reloaded, "en", "2026-07-17", [], "u1", true, ["1"]);
  const snapshot = createWidgetRenderModel(widget.challenges, "en", 300, 110, "2026-07-17").rows[0].snapshot;
  events.push(`snapshot:${snapshot.currentStreak}`);
  assert.deepEqual(events, ["load", "save:2", "load", "snapshot:2"]);
  assert.equal(snapshot.todayCompleted, true);
  assert.equal(snapshot.currentStreak, 2);
});

test("widget completion refresh observes persisted streak instead of pre-completion state", async () => {
  const store = new MemoryStore();
  const initial: AppState = {
    ...personalState(),
    challengeStats: { "1": { completedCount: 1, skippedCount: 0, currentStreak: 1, bestStreak: 1, skipCredits: 0, lastCompletedDay: "2026-07-16", lastStreakDay: "2026-07-16" } },
  };
  const repo = personalRepository(store, initial);
  let renderedStreak = -1;
  const dependencies: WidgetCompletionDependencies = {
    store,
    authenticatedUid: () => "u1",
    complete: (uid, challengeId, date) => completeChallengeWithRepository(uid, challengeId, date, repo.repository),
    async sync() {},
    async refresh() {
      const model = createWidgetModel(repo.state, "cs", "2026-07-17", [], "u1", true, ["1"]);
      renderedStreak = createWidgetRenderModel(model.challenges, "cs", 300, 110).rows[0].snapshot.currentStreak;
    },
  };
  await handleWidgetCompletion("u1", "1", "2026-07-17", dependencies);
  assert.equal(repo.state.challengeStats?.["1"]?.currentStreak, 2);
  assert.equal(renderedStreak, 2);
});

test("missed active non-Easy day renders canonical zero while rest day preserves streak", () => {
  const base: AppState = {
    ...personalState(),
    challenges: [{ ...personalState().challenges[0], period: "custom", customDays: [4] }],
    challengeStats: { "1": { completedCount: 2, skippedCount: 0, currentStreak: 2, bestStreak: 2, skipCredits: 0 } },
  };
  const restModel = createWidgetModel(base, "en", "2026-07-18", [], "u1", true, ["1"]);
  assert.equal(restModel.challenges[0].streak, 2);
  assert.equal(restModel.challenges[0].dayState, "restDay");
  const missed: AppState = { ...base, challengeStats: updateStatsOnSkipped(base, "1", "2026-07-17") };
  assert.equal(missed.challengeStats?.["1"]?.currentStreak, 0);
  assert.equal(createWidgetModel(missed, "en", "2026-07-18", [], "u1", true, ["1"]).challenges[0].streak, 0);
});

test("personal rapid double click creates one history and one mutation", async () => {
  const store = new MemoryStore();
  const repo = personalRepository(store);
  await Promise.all([
    completeChallengeWithRepository("u1", "1", "2026-07-17", repo.repository),
    completeChallengeWithRepository("u1", "1", "2026-07-17", repo.repository),
  ]);
  assert.equal(repo.state.history.length, 1);
  assert.equal((await readCompletionOutbox("u1", store)).length, 1);
});

test("existing Free user can complete a challenge beyond the creation limit", async () => {
  const store = new MemoryStore();
  const repo = personalRepository(store, personalState(4));
  assert.equal((await completeChallengeWithRepository("u1", "4", "2026-07-17", repo.repository)).status, "completed");
});

test("shared offline completion survives restart and replays once", async () => {
  const store = new MemoryStore();
  await cacheSharedChallenges("u1", [shared()], store);
  assert.equal(await completeSharedChallengeForUid("u1", "shared-1", "2026-07-17", store), "completed");
  assert.equal((await readSharedOutbox("u1", store)).length, 1);
  let remoteCalls = 0;
  const replay = await replaySharedCompletionOutbox("u1", async () => { remoteCalls += 1; return 1; }, store);
  assert.deepEqual(replay, { confirmed: 1, rejected: 0, pending: 0 });
  assert.equal(remoteCalls, 1);
  assert.equal((await readSharedCache("u1", store))[0].completedByDate["2026-07-17"], 1);
});

test("replaying an already confirmed mutation cannot trigger a second notification", async () => {
  const store = new MemoryStore();
  await cacheSharedChallenges("u1", [shared()], store);
  await completeSharedChallengeForUid("u1", "shared-1", "2026-07-17", store);
  const seen = new Set<string>();
  let notificationTransitions = 0;
  const remote = async (mutation: SharedCompletionMutation) => {
    if (!seen.has(mutation.mutationId)) { seen.add(mutation.mutationId); notificationTransitions += 1; }
    return 1;
  };
  const mutation = (await readSharedOutbox("u1", store))[0];
  await replaySharedCompletionOutbox("u1", remote, store);
  await store.setItem("onemore_shared_widget_outbox_u1", JSON.stringify([mutation]));
  await replaySharedCompletionOutbox("u1", remote, store);
  assert.equal(notificationTransitions, 1);
});

test("transient shared failure remains pending, permanent membership failure is removed", async () => {
  const store = new MemoryStore();
  await cacheSharedChallenges("u1", [shared()], store);
  await completeSharedChallengeForUid("u1", "shared-1", "2026-07-17", store);
  assert.equal((await replaySharedCompletionOutbox("u1", async () => { throw new Error("network"); }, store)).pending, 1);
  const permanent = await replaySharedCompletionOutbox("u1", async () => { throw new Error("shared/not-member"); }, store);
  assert.equal(permanent.rejected, 1);
  assert.equal(permanent.pending, 0);
});

for (const [name, challenge] of [
  ["left", shared({ leftBy: ["u1"] })],
  ["deactivated", shared({ enabled: false })],
  ["archived", shared({ status: "declined" })],
] as const) {
  test(`shared ${name} challenge cannot be queued`, async () => {
    const store = new MemoryStore();
    await cacheSharedChallenges("u1", [challenge], store);
    assert.equal(await completeSharedChallengeForUid("u1", challenge.id, "2026-07-17", store), "invalid");
  });
}

test("deleted shared challenge disappears from refreshed cache", async () => {
  const store = new MemoryStore();
  await cacheSharedChallenges("u1", [shared()], store);
  await cacheSharedChallenges("u1", [], store);
  assert.equal((await readSharedCache("u1", store)).length, 0);
});

test("outboxes and cache are isolated across account switch/logout", async () => {
  const store = new MemoryStore();
  await cacheSharedChallenges("u1", [shared()], store);
  await completeSharedChallengeForUid("u1", "shared-1", "2026-07-17", store);
  assert.equal((await readSharedOutbox("u2", store)).length, 0);
  assert.equal((await readSharedCache("u2", store)).length, 0);
});

test("custom active days use the supplied local date across midnight", async () => {
  const store = new MemoryStore();
  const fridayOnly = shared({ period: "custom", customDays: [4] });
  await cacheSharedChallenges("u1", [fridayOnly], store);
  assert.equal(await completeSharedChallengeForUid("u1", fridayOnly.id, "2026-07-17", store), "completed");
  assert.equal(await completeSharedChallengeForUid("u1", fridayOnly.id, "2026-07-18", store), "invalid");
});

test("pending or newer local state is protected from an older cloud snapshot", () => {
  assert.equal(shouldUploadLocalState("2026-07-17T12:00:00.000Z", "2026-07-17T11:00:00.000Z", 0), true);
  assert.equal(shouldUploadLocalState("2026-07-17T10:00:00.000Z", "2026-07-17T11:00:00.000Z", 1), true);
  assert.equal(shouldUploadLocalState("2026-07-17T10:00:00.000Z", "2026-07-17T11:00:00.000Z", 0), false);
});

function widgetDependencies(store: MemoryStore, repo: ReturnType<typeof personalRepository>, authUid: () => string | null) {
  let syncs = 0;
  let refreshes = 0;
  const dependencies: WidgetCompletionDependencies = {
    store,
    authenticatedUid: authUid,
    complete: (uid, challengeId, date) => completeChallengeWithRepository(uid, challengeId, date, repo.repository),
    async sync() { syncs += 1; },
    async refresh() { refreshes += 1; },
  };
  return { dependencies, get syncs() { return syncs; }, get refreshes() { return refreshes; } };
}

for (const lifecycle of ["open app", "background app"] as const) {
  test(`signed-in widget click completes through canonical logic with ${lifecycle}`, async () => {
    const store = new MemoryStore();
    const repo = personalRepository(store);
    const harness = widgetDependencies(store, repo, () => "u1");
    assert.deepEqual(await handleWidgetCompletion("u1", "1", "2026-07-17", harness.dependencies), { completed: 1, pending: 0 });
    assert.equal(repo.state.history.length, 1);
    assert.equal(harness.syncs, 1);
    assert.equal(harness.refreshes, 1);
  });
}

test("terminated app keeps widget click pending until auth bootstrap finishes", async () => {
  const store = new MemoryStore();
  const repo = personalRepository(store);
  let uid: string | null = null;
  const harness = widgetDependencies(store, repo, () => uid);
  assert.deepEqual(await handleWidgetCompletion("u1", "1", "2026-07-17", harness.dependencies), { completed: 0, pending: 1 });
  assert.equal(repo.state.history.length, 0);
  uid = "u1";
  assert.deepEqual(await drainPendingWidgetCompletions("u1", harness.dependencies), { completed: 1, pending: 0 });
  assert.equal(repo.state.history.length, 1);
});

test("headless widget uses persisted active UID for immediate local completion before Firebase JS restores", async () => {
  const store = new MemoryStore();
  const repo = personalRepository(store);
  // This mirrors widgetService: SharedPreferences active UID authorizes only the
  // UID-scoped local mutation; cloud sync remains conditional on Firebase JS.
  const persistedWidgetUid = "u1";
  const harness = widgetDependencies(store, repo, () => persistedWidgetUid);
  assert.deepEqual(await handleWidgetCompletion(persistedWidgetUid, "1", "2026-07-17", harness.dependencies), { completed: 1, pending: 0 });
  assert.equal(repo.state.history.length, 1);
  assert.equal((await readPendingWidgetCompletions(store)).length, 0);
});

test("double Today click and already-completed delivery are idempotent", async () => {
  const store = new MemoryStore();
  const repo = personalRepository(store);
  const harness = widgetDependencies(store, repo, () => "u1");
  await Promise.all([
    handleWidgetCompletion("u1", "1", "2026-07-17", harness.dependencies),
    handleWidgetCompletion("u1", "1", "2026-07-17", harness.dependencies),
  ]);
  assert.equal(repo.state.history.length, 1);
  assert.equal((await readPendingWidgetCompletions(store)).length, 0);
  await handleWidgetCompletion("u1", "1", "2026-07-17", harness.dependencies);
  assert.equal(repo.state.history.length, 1);
});
