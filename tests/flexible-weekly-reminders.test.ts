import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  REMINDER_OPERATION_DATA_KEY,
  createReminderOperationJournal,
  readReminderCleanupQueue,
  readReminderOperationJournals,
  updateReminderOperationJournal,
  writeReminderOperationJournal,
  type NotificationJournalStore,
} from "../lib/notificationJournal";
import { recoverReminderNotificationOperations } from "../lib/reminderRecovery";
import {
  isFlexibleReminderRowSelectionValid,
  normalizeReminderDays,
  plannedReminderDates,
  prepareChallengeReminders,
  reminderScheduleForChallenge,
  setRemindersPremiumEnabled,
  type ReminderOperationRuntime,
} from "../lib/reminders";
import {
  hasDuplicateFlexibleReminderWeekday,
  migrateFlexibleWeeklyReminderRows,
  normalizeFlexibleWeeklyReminderRows,
} from "../lib/flexibleReminderRows";
import { scheduleFlexibleWeeklySettings } from "../lib/flexibleWeekly";

process.env.TZ = "Europe/Prague";

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function flexibleChallenge(overrides: Record<string, unknown> = {}) {
  return {
    id: "flex-1",
    text: "Run",
    enabled: true,
    period: "flexibleWeekly" as const,
    flexibleWeeklyTarget: 3,
    flexibleWeeklyStartDay: 0,
    flexibleWeeklyFirstPeriodStart: "2026-04-06",
    reminderEnabled: true,
    reminderTimes: ["18:00"],
    reminderDays: [3],
    flexibleReminderRows: undefined,
    ...overrides,
  };
}

function memoryStore(): NotificationJournalStore {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async (key) => { values.delete(key); },
  };
}

function runtimeHarness(initialState: any, oldIds: string[] = [], platformOS = "android") {
  const store = memoryStore();
  let state = initialState;
  let sequence = 0;
  const cancelled: string[] = [];
  const requests: any[] = [];
  const scheduled = new Map(oldIds.map((id) => [id, {
    identifier: id,
    content: { data: { oneMoreReminderKey: "flex-1", oneMoreReminderKind: "challenge" } },
  }]));
  const Notifications = {
    SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", WEEKLY: "weekly" },
    AndroidNotificationPriority: { HIGH: "high" },
    getAllScheduledNotificationsAsync: async () => [...scheduled.values()],
    scheduleNotificationAsync: async (request: any) => {
      const id = `new-${++sequence}`;
      requests.push(request);
      scheduled.set(id, { identifier: id, content: request.content });
      return id;
    },
    cancelScheduledNotificationAsync: async (id: string) => {
      cancelled.push(id);
      scheduled.delete(id);
    },
  } as any;
  const runtime: ReminderOperationRuntime = {
    uid: "u-flex",
    isUidCurrent: () => true,
    expoGo: false,
    platformOS,
    Notifications,
    store,
    getCachedState: () => state,
    loadState: async () => state,
    updateState: async (updater) => { state = updater(state); return state; },
    loadNotificationSettings: async () => ({
      challengeReminders: true,
      friendRequests: true,
      incomingChallenges: true,
      sharedChallenges: true,
      friendCompletedSharedChallenge: true,
    }),
    ensureSchedulingReady: async () => true,
  };
  return { runtime, store, requests, scheduled, cancelled, state: () => state };
}

test("one selected notification day produces only that weekday", () => {
  const schedule = reminderScheduleForChallenge(flexibleChallenge({ reminderDays: [3] }) as any);
  const plan = plannedReminderDates(schedule, ["18:00"], new Date(2026, 3, 6, 12), 8);
  assert.deepEqual(plan.map(dateKey), ["2026-04-09"]);
  assert.equal(plan[0].getHours(), 18);
});

test("multiple selected notification days share one time", () => {
  const schedule = reminderScheduleForChallenge(flexibleChallenge({ reminderDays: [1, 3, 6] }) as any);
  const plan = plannedReminderDates(schedule, ["18:00"], new Date(2026, 3, 6, 12), 8);
  assert.deepEqual(plan.map(dateKey), ["2026-04-07", "2026-04-09", "2026-04-12"]);
  assert.ok(plan.every((date) => date.getHours() === 18 && date.getMinutes() === 0));
});

test("canonical Thursday 18:00 and Saturday 09:30 rows keep their paired local times", () => {
  const rows = [
    { weekday: 4, hour: 18, minute: 0 },
    { weekday: 6, hour: 9, minute: 30 },
  ];
  const schedule = reminderScheduleForChallenge(flexibleChallenge({ flexibleReminderRows: rows }) as any);
  const plan = plannedReminderDates(schedule, [], new Date(2026, 3, 6, 12), 8);
  assert.deepEqual(plan.map((date) => `${dateKey(date)} ${date.getHours()}:${date.getMinutes()}`), [
    "2026-04-09 18:0", "2026-04-11 9:30",
  ]);
});

test("canonical rows reject duplicate weekdays", () => {
  const duplicate = [
    { weekday: 4, hour: 18, minute: 0 },
    { weekday: 4, hour: 9, minute: 30 },
  ];
  assert.equal(hasDuplicateFlexibleReminderWeekday(duplicate), true);
  assert.deepEqual(normalizeFlexibleWeeklyReminderRows(duplicate), [duplicate[0]]);
});

test("enabled legacy flexible setting without a day has no schedule", () => {
  const schedule = reminderScheduleForChallenge(flexibleChallenge({ reminderDays: undefined }) as any);
  assert.deepEqual(normalizeReminderDays(undefined), []);
  assert.deepEqual(plannedReminderDates(schedule, ["18:00"], new Date(2026, 3, 6, 12)), []);
  assert.equal(isFlexibleReminderRowSelectionValid("flexibleWeekly", true, []), false);
  assert.equal(isFlexibleReminderRowSelectionValid("flexibleWeekly", false, []), true);
  assert.equal(isFlexibleReminderRowSelectionValid("daily", true, []), true);
});

test("legacy selected days and shared time migrate to canonical rows", () => {
  assert.deepEqual(migrateFlexibleWeeklyReminderRows(undefined, [3, 5], ["18:00"]), [
    { weekday: 4, hour: 18, minute: 0 },
    { weekday: 6, hour: 18, minute: 0 },
  ]);
  assert.deepEqual(migrateFlexibleWeeklyReminderRows(undefined, undefined, ["18:00"]), []);
});

test("Thursday reminder is independent of a Monday flexible period start", () => {
  const challenge = flexibleChallenge({ flexibleWeeklyStartDay: 0, reminderDays: [3] });
  const schedule = reminderScheduleForChallenge(challenge as any);
  assert.equal(schedule.isActiveOnDate("2026-04-06"), false);
  assert.equal(schedule.isActiveOnDate("2026-04-09"), true);
  const changedPeriod = scheduleFlexibleWeeklySettings(challenge as any, 5, 2, "2026-04-06");
  assert.deepEqual(changedPeriod.reminderDays, [3]);
});

test("a selected time already past today moves to the same weekday next week", () => {
  const schedule = reminderScheduleForChallenge(flexibleChallenge({ reminderDays: [3] }) as any);
  const plan = plannedReminderDates(schedule, ["18:00"], new Date(2026, 3, 9, 18, 1), 8);
  assert.deepEqual(plan.map(dateKey), ["2026-04-16"]);
});

test("rolling plan covers every selected occurrence in the existing 30-day horizon", () => {
  const schedule = reminderScheduleForChallenge(flexibleChallenge({ reminderDays: [3] }) as any);
  const plan = plannedReminderDates(schedule, ["18:00"], new Date(2026, 3, 9, 10), 30);
  assert.deepEqual(plan.map(dateKey), [
    "2026-04-09", "2026-04-16", "2026-04-23", "2026-04-30", "2026-05-07",
  ]);
});

test("local reminder time survives DST and month/year boundaries", () => {
  const sunday = reminderScheduleForChallenge(flexibleChallenge({ reminderDays: [6] }) as any);
  const dstPlan = plannedReminderDates(sunday, ["18:00"], new Date(2026, 2, 20, 12), 10);
  assert.deepEqual(dstPlan.map(dateKey), ["2026-03-22", "2026-03-29"]);
  assert.ok(dstPlan.every((date) => date.getHours() === 18));
  assert.notEqual(dstPlan[0].getTimezoneOffset(), dstPlan[1].getTimezoneOffset());

  const yearPlan = plannedReminderDates(
    reminderScheduleForChallenge(flexibleChallenge({ reminderDays: [3] }) as any),
    ["18:00"],
    new Date(2026, 11, 30, 12),
    10,
  );
  assert.deepEqual(yearPlan.map(dateKey), ["2026-12-31", "2027-01-07"]);

  const monthPlan = plannedReminderDates(
    reminderScheduleForChallenge(flexibleChallenge({ reminderDays: [6] }) as any),
    ["18:00"],
    new Date(2026, 0, 30, 12),
    5,
  );
  assert.deepEqual(monthPlan.map(dateKey), ["2026-02-01"]);
});

test("changing selected days journals the replacement and removes old notifications safely", async () => {
  setRemindersPremiumEnabled(true);
  const oldIds = ["old-thursday"];
  const challenge = flexibleChallenge({ reminderDays: [3] });
  const run = runtimeHarness({
    challenges: [challenge],
    history: [], challengeStats: {}, reminderNotifIds: { "flex-1": oldIds },
  }, oldIds);
  const nextRows = [
    { weekday: 2, hour: 18, minute: 0 },
    { weekday: 6, hour: 18, minute: 0 },
  ];
  const prepared = await prepareChallengeReminders(
    "flex-1", "Run", ["18:00"], true,
    reminderScheduleForChallenge(challenge as any, nextRows), run.runtime,
  );

  const journals = await readReminderOperationJournals("u-flex", run.store);
  assert.equal(journals.length, 1);
  assert.ok(run.requests.length > 0);
  assert.ok(run.requests.every((request) =>
    request.content.data[REMINDER_OPERATION_DATA_KEY] === journals[0].operationId));

  await run.runtime.updateState((state) => prepared.applyToState(state));
  await prepared.finalize();

  assert.deepEqual(run.state().challenges[0].reminderDays, [1, 5]);
  assert.deepEqual(run.state().challenges[0].flexibleReminderRows, nextRows);
  assert.ok(run.cancelled.includes("old-thursday"));
  assert.equal(run.scheduled.has("old-thursday"), false);
  assert.equal((await readReminderOperationJournals("u-flex", run.store)).length, 0);
  assert.equal((await readReminderCleanupQueue("u-flex", run.store)).length, 0);
});

test("restart recovery rolls back an unfinished flexible-weekly replacement", async () => {
  const challenge = flexibleChallenge({ reminderDays: [3] });
  const canonicalState = {
    challenges: [challenge], history: [], challengeStats: {},
    reminderNotifIds: { "flex-1": ["old-thursday"] },
  };
  const run = runtimeHarness(canonicalState, ["old-thursday", "new-orphan"]);
  const operation = createReminderOperationJournal({
    uid: "u-flex",
    challengeId: "flex-1",
    enabled: true,
    originalIds: ["old-thursday"],
    now: new Date("2026-04-06T10:00:00.000Z"),
  });
  await writeReminderOperationJournal(operation, run.store);
  await updateReminderOperationJournal("u-flex", operation.operationId, (current) => ({
    ...current,
    phase: "scheduling",
    newIds: ["new-orphan"],
  }), run.store);
  const orphan = run.scheduled.get("new-orphan") as any;
  orphan.content.data[REMINDER_OPERATION_DATA_KEY] = operation.operationId;

  await recoverReminderNotificationOperations({
    uid: "u-flex",
    store: run.store,
    Notifications: run.runtime.Notifications,
    isUidCurrent: () => true,
    loadCanonicalState: async () => canonicalState as any,
  });

  assert.deepEqual([...run.scheduled.keys()], ["old-thursday"]);
  assert.equal((await readReminderOperationJournals("u-flex", run.store)).length, 0);
  assert.equal((await readReminderCleanupQueue("u-flex", run.store)).length, 0);
});

test("legacy time-only flexible reminder is rejected while enabled and can be disabled through journal cleanup", async () => {
  setRemindersPremiumEnabled(true);
  const challenge = flexibleChallenge({ reminderDays: undefined });
  const run = runtimeHarness({
    challenges: [challenge],
    history: [], challengeStats: {}, reminderNotifIds: { "flex-1": ["old-daily"] },
  }, ["old-daily"]);
  await assert.rejects(() => prepareChallengeReminders(
    "flex-1", "Run", ["18:00"], true,
    reminderScheduleForChallenge(challenge as any), run.runtime,
  ), /NOTIFICATIONS_FLEXIBLE_ROWS_REQUIRED/);
  assert.equal(run.requests.length, 0);
  assert.deepEqual([...run.scheduled.keys()], ["old-daily"]);
  assert.equal(run.state().challenges[0].reminderEnabled, true);
  const prepared = await prepareChallengeReminders("flex-1", "Run", [], false, undefined, run.runtime);
  await run.runtime.updateState((state) => prepared.applyToState(state));
  await prepared.finalize();
  assert.equal(run.state().challenges[0].reminderEnabled, false);
  assert.deepEqual(run.state().challenges[0].reminderDays, []);
  assert.deepEqual([...run.scheduled.keys()], []);
});

test("an inactive legacy reminder can be cleaned even when another Free reminder is active", async () => {
  setRemindersPremiumEnabled(false);
  const inactive = flexibleChallenge({
    enabled: false,
    reminderEnabled: true,
    flexibleReminderRows: [],
    reminderDays: undefined,
    reminderTimes: [],
  });
  const other = {
    id: "other-active", text: "Other", enabled: true,
    reminderEnabled: true, reminderTimes: ["09:00"], period: "daily",
  };
  const run = runtimeHarness({
    challenges: [inactive, other], history: [], challengeStats: {},
    reminderNotifIds: { "flex-1": ["old-inactive"] },
  }, ["old-inactive"]);
  const prepared = await prepareChallengeReminders(
    "flex-1", "Run", [], true,
    reminderScheduleForChallenge(inactive as any), run.runtime,
  );
  assert.equal(run.requests.length, 0);
  await run.runtime.updateState((state) => prepared.applyToState(state));
  await prepared.finalize();
  assert.equal(run.state().challenges[0].enabled, false);
  assert.equal(run.state().challenges[0].reminderEnabled, true);
  assert.deepEqual(run.state().reminderNotifIds?.["flex-1"] ?? [], []);
  assert.deepEqual([...run.scheduled.keys()], []);
});

test("Free limit applies per challenge and does not truncate flexible reminder rows", async () => {
  setRemindersPremiumEnabled(false);
  const rows = [1, 2, 3, 4].map((weekday) => ({ weekday, hour: 8 + weekday, minute: 0 }));
  const challenge = flexibleChallenge({ flexibleReminderRows: rows, reminderDays: undefined });
  const run = runtimeHarness({ challenges: [challenge], history: [], challengeStats: {}, reminderNotifIds: {} });
  const prepared = await prepareChallengeReminders(
    "flex-1", "Run", rows.map(({ hour }) => `${String(hour).padStart(2, "0")}:00`), true,
    reminderScheduleForChallenge(challenge as any), run.runtime,
  );
  assert.equal(prepared.reminderRows.length, 4);
  assert.equal(run.requests.length, 4);
  assert.ok(run.requests.every((request) => request.trigger.type === "weekly"));
  await prepared.rollback();
});

test("flexible weekly uses bounded recurring weekly triggers on Android and iOS", async () => {
  setRemindersPremiumEnabled(true);
  for (const platform of ["android", "ios"]) {
    const challenge = flexibleChallenge({ reminderDays: [0] });
    const run = runtimeHarness({
      challenges: [challenge], history: [], challengeStats: {}, reminderNotifIds: {},
    }, [], platform);
    const prepared = await prepareChallengeReminders(
      "flex-1", "Run", ["18:00"], true,
      reminderScheduleForChallenge(challenge as any), run.runtime,
    );
    assert.equal(run.requests.length, 1, platform);
    assert.ok(run.requests.every((request) => request.trigger.type === "weekly"), platform);
    assert.ok(run.requests.every((request) =>
      platform === "android" ? request.trigger.channelId === "reminders_high_v1" : request.trigger.channelId === undefined), platform);
    assert.ok(run.requests.every((request) => request.content.channelId === undefined), platform);
    await prepared.rollback();
  }
});

test("production prepare accepts daily, every2, custom and flexibleWeekly trigger shapes", async () => {
  setRemindersPremiumEnabled(true);
  const cases = [
    {
      period: "daily",
      schedule: { period: "daily", enabled: true, isActiveOnDate: () => true },
      expectedType: "daily",
    },
    {
      period: "every2",
      schedule: { period: "every2", enabled: true, isActiveOnDate: (dateISO: string) => Number(dateISO.slice(-2)) % 2 === 0 },
      expectedType: "date",
    },
    {
      period: "custom",
      schedule: { period: "custom", enabled: true, activeWeekdays: [0, 2], isActiveOnDate: () => true },
      expectedType: "weekly",
    },
    {
      period: "flexibleWeekly",
      schedule: {
        period: "flexibleWeekly", enabled: true,
        reminderRows: [{ weekday: 4, hour: 18, minute: 0 }],
        isActiveOnDate: (dateISO: string) => new Date(`${dateISO}T12:00:00`).getDay() === 4,
      },
      expectedType: "weekly",
    },
  ] as const;

  for (const item of cases) {
    const challenge = flexibleChallenge({ period: item.period });
    const run = runtimeHarness({ challenges: [challenge], history: [], challengeStats: {}, reminderNotifIds: {} });
    const prepared = await prepareChallengeReminders(
      "flex-1", "Run", ["18:00"], true, item.schedule as any, run.runtime,
    );
    assert.ok(run.requests.length > 0, item.period);
    assert.ok(run.requests.every((request) => request.trigger.type === item.expectedType), item.period);
    assert.ok(run.requests.every((request) => request.trigger.channelId === "reminders_high_v1"), item.period);
    await prepared.rollback();
  }
});

test("daily, every2 and custom schedules retain their existing cadence", () => {
  const daily = reminderScheduleForChallenge({
    id: "d", text: "Daily", enabled: true, period: "daily",
  } as any);
  assert.equal(daily.isActiveOnDate("2026-04-06"), true);
  assert.equal(daily.isActiveOnDate("2026-04-07"), true);

  const every2 = reminderScheduleForChallenge({
    id: "e", text: "Every 2", enabled: true, period: "every2", periodAnchor: "2026-04-06",
  } as any);
  assert.equal(every2.isActiveOnDate("2026-04-06"), true);
  assert.equal(every2.isActiveOnDate("2026-04-07"), false);
  assert.equal(every2.isActiveOnDate("2026-04-08"), true);

  const custom = reminderScheduleForChallenge({
    id: "c", text: "Custom", enabled: true, period: "custom", customDays: [0, 2],
  } as any);
  assert.equal(custom.isActiveOnDate("2026-04-06"), true);
  assert.equal(custom.isActiveOnDate("2026-04-07"), false);
  assert.equal(custom.isActiveOnDate("2026-04-08"), true);
});

test("both personal notification editors render canonical day-time rows and validate them", async () => {
  for (const file of ["app/(tabs)/challenges.tsx", "app/(tabs)/index.tsx"]) {
    const source = await readFile(file, "utf8");
    assert.match(source, /t\.flexibleWeekly\.weekdays\.map/);
    assert.match(source, /t\.flexibleWeekly\.addNotificationRow/);
    assert.match(source, /isFlexibleReminderRowSelectionValid/);
    assert.match(source, /notificationDayRequiredTitle/);
    assert.match(source, /paddingBottom: Math\.max\(32, insets\.bottom \+ 20\)/);
  }
});
