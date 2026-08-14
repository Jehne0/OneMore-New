import assert from "node:assert/strict";
import test from "node:test";
import {
  commitPreparedNotificationChange,
  scheduleBatchWithRollback,
} from "../lib/notificationSaveFlow";
import {
  REMINDER_OPERATION_DATA_KEY,
  createReminderOperationJournal,
  readReminderCleanupQueue,
  readReminderOperationJournals,
  updateReminderOperationJournal,
  writeReminderOperationJournal,
  type NotificationJournalStore,
  type ReminderOperationPhase,
} from "../lib/notificationJournal";
import { recoverReminderNotificationOperations } from "../lib/reminderRecovery";
import {
  cancelScheduledChallengeReminderNotifications,
  cancelScheduledPersonalReminderNotifications,
  prepareChallengeReminders,
  type ReminderOperationRuntime,
} from "../lib/reminders";

function memoryStore(events: string[] = []): NotificationJournalStore {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { events.push(`store:${key}`); values.set(key, value); },
    removeItem: async (key) => { events.push(`remove:${key}`); values.delete(key); },
  } as NotificationJournalStore;
}

function notificationHarness(
  initial: { id: string; operationId?: string; data?: Record<string, unknown> }[],
  failCancellation = new Set<string>(),
  events: string[] = [],
) {
  const scheduled = new Map(initial.map((item) => [item.id, {
    identifier: item.id,
    content: { data: {
      ...(item.operationId ? { [REMINDER_OPERATION_DATA_KEY]: item.operationId } : {}),
      ...(item.data ?? {}),
    } },
  }]));
  const cancelled: string[] = [];
  return {
    scheduled,
    cancelled,
    Notifications: {
      getAllScheduledNotificationsAsync: async () => [...scheduled.values()],
      cancelScheduledNotificationAsync: async (id: string) => {
        events.push(`cancel:${id}`);
        cancelled.push(id);
        if (failCancellation.has(id)) throw new Error(`cannot-cancel-${id}`);
        scheduled.delete(id);
      },
    },
  };
}

function productionRuntime(options: {
  state?: any;
  notifications?: ReturnType<typeof notificationHarness>;
  store?: NotificationJournalStore;
  events?: string[];
  uidCurrent?: () => boolean;
}) {
  const events = options.events ?? [];
  const store = options.store ?? memoryStore(events);
  const notifications = options.notifications ?? notificationHarness([], new Set(), events);
  let state = options.state ?? {
    challenges: [{ id: "c1", text: "A", enabled: true, reminderEnabled: true }],
    history: [], challengeStats: {}, reminderNotifIds: {},
  };
  let sequence = 0;
  const Notifications = {
    ...notifications.Notifications,
    SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date" },
    AndroidNotificationPriority: { HIGH: "high" },
    scheduleNotificationAsync: async (request: any) => {
      const id = `new-${++sequence}`;
      events.push(`schedule:${id}`);
      notifications.scheduled.set(id, { identifier: id, content: request.content });
      return id;
    },
  } as any;
  const runtime: ReminderOperationRuntime = {
    uid: "u1",
    isUidCurrent: options.uidCurrent ?? (() => true),
    expoGo: false,
    platformOS: "ios",
    Notifications,
    store,
    getCachedState: () => state,
    loadState: async () => state,
    updateState: async (updater) => { state = updater(state); return state; },
    loadNotificationSettings: async () => ({
      challengeReminders: true, friendRequests: true, incomingChallenges: true,
      sharedChallenges: true, friendCompletedSharedChallenge: true,
    }),
    ensureSchedulingReady: async () => { events.push("ready"); return true; },
  };
  return { runtime, events, notifications, state: () => state };
}

async function journal(store: NotificationJournalStore, uid: string, challengeId = "c1") {
  const value = createReminderOperationJournal({
    uid, challengeId, enabled: true, originalIds: ["old-1"], now: new Date("2026-08-14T10:00:00.000Z"),
  });
  await writeReminderOperationJournal(value, store);
  return value;
}

async function schedulingFailure(failAt: number) {
  const cancelled: string[] = [];
  let call = 0;
  await assert.rejects(() => scheduleBatchWithRollback({
    items: ["08:00", "12:00", "18:00"],
    schedule: async () => {
      const index = call++;
      if (index === failAt) throw new Error(`schedule-${index}`);
      return `new-${index}`;
    },
    cancel: async (id) => { cancelled.push(id); },
  }), new RegExp(`schedule-${failAt}`));
  return cancelled;
}

test("failure of the first notification leaves no new ID to roll back", async () => {
  assert.deepEqual(await schedulingFailure(0), []);
});

test("failure of a middle notification rolls back every earlier new ID", async () => {
  assert.deepEqual(await schedulingFailure(1), ["new-0"]);
});

test("failure of the last notification rolls back every earlier new ID", async () => {
  assert.deepEqual(await schedulingFailure(2), ["new-0", "new-1"]);
});

test("persist failure rolls back the new set and does not finalize the old set", async () => {
  const events: string[] = [];
  await assert.rejects(() => commitPreparedNotificationChange({
    persist: async () => { events.push("persist"); throw new Error("disk-full"); },
    restore: async () => { events.push("restore-original-state"); },
    rollback: async () => { events.push("rollback-new"); },
    finalize: async () => { events.push("cancel-old"); },
  }), /disk-full/);
  assert.deepEqual(events, ["persist", "restore-original-state", "rollback-new"]);
});

test("successful persist finalizes the old set only after the new state is durable", async () => {
  const events: string[] = [];
  await commitPreparedNotificationChange({
    persist: async () => { events.push("persist-new-state"); },
    rollback: async () => { events.push("rollback-new"); },
    finalize: async () => { events.push("cancel-old"); },
  });
  assert.deepEqual(events, ["persist-new-state", "cancel-old"]);
});

test("production recovery finds and removes an orphan by operation ID after a scheduling crash", async () => {
  const store = memoryStore();
  const operation = await journal(store, "u1");
  await updateReminderOperationJournal("u1", operation.operationId, (current) => ({
    ...current, phase: "scheduling", newIds: ["new-known"],
  }), store);
  const notifications = notificationHarness([
    { id: "old-1" },
    { id: "new-known", operationId: operation.operationId },
    { id: "new-orphan", operationId: operation.operationId },
  ]);
  await recoverReminderNotificationOperations({
    uid: "u1", store, Notifications: notifications.Notifications,
    isUidCurrent: () => true,
    loadCanonicalState: async () => ({ challenges: [{ id: "c1", text: "A", reminderEnabled: true }], reminderNotifIds: { c1: ["old-1"] } } as any),
  });
  assert.deepEqual([...notifications.scheduled.keys()], ["old-1"]);
  assert.equal((await readReminderOperationJournals("u1", store)).length, 0);
  assert.equal((await readReminderCleanupQueue("u1", store)).length, 0);
});

test("persisted operation keeps failed old-ID cleanup durable and completes on next bounded pass", async () => {
  const store = memoryStore();
  const operation = await journal(store, "u1");
  await updateReminderOperationJournal("u1", operation.operationId, (current) => ({
    ...current, phase: "scheduled", newIds: ["new-1"],
  }), store);
  const failures = new Set(["old-1"]);
  const notifications = notificationHarness([{ id: "old-1" }, { id: "new-1", operationId: operation.operationId }], failures);
  const runtime = {
    uid: "u1", store, Notifications: notifications.Notifications,
    isUidCurrent: () => true,
    loadCanonicalState: async () => ({ challenges: [{ id: "c1", text: "A", reminderEnabled: true }], reminderNotifIds: { c1: ["new-1"] } } as any),
  };
  await recoverReminderNotificationOperations(runtime);
  assert.equal((await readReminderCleanupQueue("u1", store)).length, 1);
  assert.equal((await readReminderOperationJournals("u1", store)).length, 1);
  assert.ok(notifications.scheduled.has("old-1"));
  failures.clear();
  await recoverReminderNotificationOperations(runtime);
  assert.deepEqual([...notifications.scheduled.keys()], ["new-1"]);
  assert.equal((await readReminderCleanupQueue("u1", store)).length, 0);
  assert.equal((await readReminderOperationJournals("u1", store)).length, 0);
});

test("notification recovery never processes another UID journal", async () => {
  const store = memoryStore();
  const u1 = await journal(store, "u1", "c1");
  const u2 = await journal(store, "u2", "c2");
  const notifications = notificationHarness([
    { id: "u1-orphan", operationId: u1.operationId },
    { id: "u2-orphan", operationId: u2.operationId },
  ]);
  await recoverReminderNotificationOperations({
    uid: "u1", store, Notifications: notifications.Notifications,
    isUidCurrent: () => true,
    loadCanonicalState: async () => ({ challenges: [], reminderNotifIds: {} } as any),
  });
  assert.deepEqual([...notifications.scheduled.keys()], ["u2-orphan"]);
  assert.equal((await readReminderOperationJournals("u1", store)).length, 0);
  assert.equal((await readReminderOperationJournals("u2", store)).length, 1);
});

test("disabling reminders uses the persisted operation path and removes only the old canonical set", async () => {
  const store = memoryStore();
  const operation = createReminderOperationJournal({
    uid: "u1", challengeId: "c1", enabled: false, originalIds: ["old-1"], now: new Date("2026-08-14T10:00:00.000Z"),
  });
  await writeReminderOperationJournal({ ...operation, phase: "scheduled" }, store);
  const notifications = notificationHarness([{ id: "old-1" }]);
  await recoverReminderNotificationOperations({
    uid: "u1", store, Notifications: notifications.Notifications,
    isUidCurrent: () => true,
    loadCanonicalState: async () => ({ challenges: [{ id: "c1", text: "A", reminderEnabled: false }], reminderNotifIds: {} } as any),
  });
  assert.equal(notifications.scheduled.size, 0);
  assert.equal((await readReminderOperationJournals("u1", store)).length, 0);
});

test("crash after journal prepare but before first schedule leaves the original set canonical", async () => {
  const store = memoryStore();
  await journal(store, "u1");
  const notifications = notificationHarness([{ id: "old-1" }]);
  await recoverReminderNotificationOperations({
    uid: "u1", store, Notifications: notifications.Notifications,
    isUidCurrent: () => true,
    loadCanonicalState: async () => ({ challenges: [{ id: "c1", text: "A", reminderEnabled: true }], reminderNotifIds: { c1: ["old-1"] } } as any),
  });
  assert.deepEqual([...notifications.scheduled.keys()], ["old-1"]);
  assert.equal((await readReminderOperationJournals("u1", store)).length, 0);
});

test("crash after cleanup completion but before journal deletion is idempotent", async () => {
  const store = memoryStore();
  const operation = await journal(store, "u1");
  await updateReminderOperationJournal("u1", operation.operationId, (current) => ({
    ...current, phase: "cleaningOld", newIds: ["new-1"],
  }), store);
  const notifications = notificationHarness([{ id: "new-1", operationId: operation.operationId }]);
  await recoverReminderNotificationOperations({
    uid: "u1", store, Notifications: notifications.Notifications,
    isUidCurrent: () => true,
    loadCanonicalState: async () => ({ challenges: [{ id: "c1", text: "A", reminderEnabled: true }], reminderNotifIds: { c1: ["new-1"] } } as any),
  });
  assert.deepEqual([...notifications.scheduled.keys()], ["new-1"]);
  assert.equal((await readReminderCleanupQueue("u1", store)).length, 0);
  assert.equal((await readReminderOperationJournals("u1", store)).length, 0);
});

test("production prepareChallengeReminders persists journal before first schedule", async () => {
  const events: string[] = [];
  const run = productionRuntime({ events });
  const prepared = await prepareChallengeReminders(
    "c1", "A", ["08:00"], true,
    { period: "daily", enabled: true, isActiveOnDate: () => true },
    run.runtime,
  );
  const scheduleIndex = events.findIndex((event) => event.startsWith("schedule:"));
  const journalIndex = events.findIndex((event) => event.includes("notification_journal"));
  assert.ok(journalIndex >= 0 && journalIndex < scheduleIndex, events.join(","));
  await prepared.rollback();
});

test("public challenge cancellation persists every journal before first cancel", async () => {
  const events: string[] = [];
  const notifications = notificationHarness([{
    id: "old-1",
    data: { oneMoreReminderKey: "c1", oneMoreReminderKind: "challenge" },
  }], new Set(), events);
  const run = productionRuntime({
    events,
    notifications,
    state: {
      challenges: [{ id: "c1", text: "A", reminderEnabled: true }],
      history: [], challengeStats: {}, reminderNotifIds: { c1: ["old-1"] },
    },
  });
  await cancelScheduledChallengeReminderNotifications(run.runtime);
  const cancelIndex = events.findIndex((event) => event === "cancel:old-1");
  const journalIndex = events.findIndex((event) => event.includes("notification_journal"));
  assert.ok(journalIndex >= 0 && journalIndex < cancelIndex, events.join(","));
});

test("public personal cancellation never cancels a shared reminder", async () => {
  const events: string[] = [];
  const notifications = notificationHarness([
    { id: "personal", data: { oneMoreReminderKey: "c1", oneMoreReminderKind: "challenge" } },
    { id: "shared", data: { oneMoreReminderKey: "shared_c2", oneMoreReminderKind: "shared" } },
  ], new Set(), events);
  const run = productionRuntime({
    events,
    notifications,
    state: {
      challenges: [{ id: "c1", text: "A", reminderEnabled: true }],
      history: [], challengeStats: {},
      reminderNotifIds: { c1: ["personal"], shared_c2: ["shared"] },
    },
  });
  await cancelScheduledPersonalReminderNotifications(run.runtime);
  assert.equal(notifications.scheduled.has("personal"), false);
  assert.equal(notifications.scheduled.has("shared"), true);
});

test("all six durable recovery phases converge idempotently", async () => {
  const phases: ReminderOperationPhase[] = [
    "prepared", "scheduling", "scheduled", "persisted", "cleaningOld", "rollingBack",
  ];
  for (const phase of phases) {
    const store = memoryStore();
    const operation = await journal(store, "u1");
    await updateReminderOperationJournal("u1", operation.operationId, (current) => ({
      ...current, phase, newIds: ["new-1"],
    }), store);
    const notifications = notificationHarness([
      { id: "old-1" },
      { id: "new-1", operationId: operation.operationId },
    ]);
    const persisted = phase === "persisted" || phase === "cleaningOld";
    const runtime = {
      uid: "u1", store, Notifications: notifications.Notifications,
      isUidCurrent: () => true,
      loadCanonicalState: async () => ({
        challenges: [{ id: "c1", text: "A", reminderEnabled: true }],
        reminderNotifIds: { c1: [persisted ? "new-1" : "old-1"] },
      } as any),
    };
    await recoverReminderNotificationOperations(runtime);
    await recoverReminderNotificationOperations(runtime);
    assert.deepEqual([...notifications.scheduled.keys()], [persisted ? "new-1" : "old-1"], phase);
    assert.equal((await readReminderOperationJournals("u1", store)).length, 0, phase);
  }
});

test("UID switch during getAll leaves journal and notifications untouched", async () => {
  const store = memoryStore();
  const operation = await journal(store, "u1");
  let current = true;
  let cancels = 0;
  const scheduled = [{
    identifier: "new-1",
    content: { data: { [REMINDER_OPERATION_DATA_KEY]: operation.operationId } },
  }];
  await recoverReminderNotificationOperations({
    uid: "u1", store,
    isUidCurrent: () => current,
    Notifications: {
      getAllScheduledNotificationsAsync: async () => { current = false; return scheduled; },
      cancelScheduledNotificationAsync: async () => { cancels += 1; },
    },
    loadCanonicalState: async () => ({ challenges: [], reminderNotifIds: {} } as any),
  });
  assert.equal(cancels, 0);
  assert.equal((await readReminderOperationJournals("u1", store)).length, 1);
});

test("UID switch during cancelAndVerify stops the pass and preserves durable queue", async () => {
  const store = memoryStore();
  const operation = await journal(store, "u1");
  await updateReminderOperationJournal("u1", operation.operationId, (value) => ({
    ...value, phase: "scheduling", newIds: ["new-1", "new-2"],
  }), store);
  let current = true;
  const cancelled: string[] = [];
  const notifications = notificationHarness([
    { id: "new-1", operationId: operation.operationId },
    { id: "new-2", operationId: operation.operationId },
  ]);
  notifications.Notifications.cancelScheduledNotificationAsync = async (id: string) => {
    cancelled.push(id);
    current = false;
  };
  await recoverReminderNotificationOperations({
    uid: "u1", store, Notifications: notifications.Notifications,
    isUidCurrent: () => current,
    loadCanonicalState: async () => ({ challenges: [], reminderNotifIds: {} } as any),
  });
  assert.deepEqual(cancelled, ["new-1"]);
  assert.equal((await readReminderOperationJournals("u1", store)).length, 1);
  assert.equal((await readReminderCleanupQueue("u1", store)).length, 1);
});

test("UID switch before journal or cleanup mutation preserves both durable records", async () => {
  const store = memoryStore();
  const operation = await journal(store, "u1");
  let current = true;
  const notifications = notificationHarness([{ id: "new-1", operationId: operation.operationId }]);
  await recoverReminderNotificationOperations({
    uid: "u1", store, Notifications: notifications.Notifications,
    isUidCurrent: () => current,
    loadCanonicalState: async () => {
      current = false;
      return { challenges: [], reminderNotifIds: {} } as any;
    },
  });
  assert.equal((await readReminderOperationJournals("u1", store)).length, 1);
  assert.equal((await readReminderCleanupQueue("u1", store)).length, 0);
});

test("UID switch while cleanup storage is awaited blocks the cleanup queue write", async () => {
  const baseStore = memoryStore();
  const operation = await journal(baseStore, "u1");
  let current = true;
  let cleanupReads = 0;
  const store: NotificationJournalStore = {
    getItem: async (key) => {
      const value = await baseStore.getItem(key);
      if (key.includes("notification_cleanup")) {
        cleanupReads += 1;
        if (cleanupReads === 2) current = false;
      }
      return value;
    },
    setItem: (key, value) => baseStore.setItem(key, value),
    removeItem: (key) => baseStore.removeItem(key),
  };
  const notifications = notificationHarness([{ id: "new-1", operationId: operation.operationId }]);
  await recoverReminderNotificationOperations({
    uid: "u1", store, Notifications: notifications.Notifications,
    isUidCurrent: () => current,
    loadCanonicalState: async () => ({ challenges: [], reminderNotifIds: {} } as any),
  });
  assert.equal((await readReminderOperationJournals("u1", baseStore)).length, 1);
  assert.equal((await readReminderCleanupQueue("u1", baseStore)).length, 0);
});

test("two fast production prepares for one UID are serialized through finalize", async () => {
  const events: string[] = [];
  const run = productionRuntime({ events });
  const first = await prepareChallengeReminders(
    "c1", "A", ["08:00"], true,
    { period: "daily", enabled: true, isActiveOnDate: () => true }, run.runtime,
  );
  let secondResolved = false;
  const secondPromise = prepareChallengeReminders(
    "c1", "A", ["09:00"], true,
    { period: "daily", enabled: true, isActiveOnDate: () => true }, run.runtime,
  ).then((value) => { secondResolved = true; return value; });
  await Promise.resolve();
  assert.equal(secondResolved, false);
  await first.finalize();
  const second = await secondPromise;
  assert.equal(secondResolved, true);
  await second.rollback();
});
