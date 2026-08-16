import assert from "node:assert/strict";
import test from "node:test";

import { createChallengeId } from "../lib/challengeIds";
import { commitPreparedNotificationChange } from "../lib/notificationSaveFlow";
import {
  sanitizeNotificationTrigger,
  validateExpoNotificationTrigger,
  waitForReminderAuthUser,
} from "../lib/notificationRuntime";
import { prepareChallengeReminders, type ReminderOperationRuntime, type ReminderSchedule } from "../lib/reminders";
import type { NotificationJournalStore } from "../lib/notificationJournal";

function memoryStore(events: string[]): NotificationJournalStore {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { events.push("journal"); values.set(key, value); },
    removeItem: async (key) => { values.delete(key); },
  };
}

function strictRuntime(period: ReminderSchedule["period"], permission: "granted" | "denied" | "undetermined" = "granted") {
  const events: string[] = [];
  const requests: any[] = [];
  const challenge = { id: "challenge-1", text: "Run", enabled: true, period, targetPerDay: 2 };
  const state: any = { challenges: [challenge], history: [], challengeStats: {}, reminderNotifIds: {} };
  const Notifications = {
    SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date" },
    AndroidNotificationPriority: { HIGH: "high" },
    getAllScheduledNotificationsAsync: async () => [],
    cancelScheduledNotificationAsync: async () => {},
    getNextTriggerDateAsync: async (trigger: unknown) => {
      events.push("next-trigger");
      const valid = validateExpoNotificationTrigger(trigger, "android", new Date(Date.now() - 1));
      const value = sanitizeNotificationTrigger(valid);
      if (value.type === "date") return new Date(String(value.date)).getTime();
      return Date.now() + 60_000;
    },
    scheduleNotificationAsync: async (request: any) => {
      events.push("schedule");
      validateExpoNotificationTrigger(request.trigger, "android", new Date(Date.now() - 1));
      requests.push(request);
      return `notification-${requests.length}`;
    },
  } as any;
  const runtime: ReminderOperationRuntime = {
    uid: "user-1",
    isUidCurrent: () => true,
    expoGo: false,
    platformOS: "android",
    Notifications,
    store: memoryStore(events),
    getCachedState: () => state,
    loadState: async () => state,
    updateState: async (updater) => updater(state),
    loadNotificationSettings: async () => ({
      challengeReminders: true, friendRequests: true, incomingChallenges: true,
      sharedChallenges: true, friendCompletedSharedChallenge: true,
    }),
    ensureSchedulingReady: async () => {
      events.push("permission-channel");
      return { granted: permission === "granted", status: permission, canAskAgain: permission === "undetermined", channelId: "reminders_high_v1" };
    },
  };
  return { runtime, events, requests, challenge };
}

test("SDK 54 validator accepts exact Android daily and date shapes", () => {
  const daily = validateExpoNotificationTrigger({ type: "daily", hour: 8, minute: 5, channelId: "reminders_high_v1" }, "android");
  const date = validateExpoNotificationTrigger({ type: "date", date: new Date(Date.now() + 60_000), channelId: "reminders_high_v1" }, "android");
  assert.deepEqual(sanitizeNotificationTrigger(daily), { type: "daily", hour: 8, minute: 5, channelId: "reminders_high_v1" });
  assert.equal(sanitizeNotificationTrigger(date).type, "date");
});

test("SDK 54 validator rejects invalid native bridge inputs", () => {
  const future = new Date(Date.now() + 60_000);
  assert.throws(() => validateExpoNotificationTrigger({ date: future }, "android"), /missing type/);
  assert.throws(() => validateExpoNotificationTrigger({ type: "date", date: new Date("invalid"), channelId: "reminders_high_v1" }, "android"), /date must be valid/);
  assert.throws(() => validateExpoNotificationTrigger({ type: "date", date: new Date(Date.now() - 1), channelId: "reminders_high_v1" }, "android"), /future/);
  assert.throws(() => validateExpoNotificationTrigger({ type: "daily", hour: 8, minute: NaN, channelId: "reminders_high_v1" }, "android"), /minute/);
  assert.throws(() => validateExpoNotificationTrigger({ type: "daily", hour: 8, minute: 0, channelId: undefined }, "android"), /undefined/);
  assert.throws(() => validateExpoNotificationTrigger({ type: "date", date: future, channelId: "android-only" }, "ios"), /Android-only/);
  assert.throws(() => validateExpoNotificationTrigger({ type: "date", date: future, channelId: "x", repeats: false }, "android"), /unexpected/);
});

test("public production prepare validates every period before permission, journal and schedule", async () => {
  const schedules: ReminderSchedule[] = [
    { period: "daily", enabled: true, isActiveOnDate: () => true },
    { period: "every2", enabled: true, isActiveOnDate: () => true },
    { period: "custom", enabled: true, isActiveOnDate: () => true },
    { period: "flexibleWeekly", enabled: true, reminderRows: [{ weekday: new Date().getDay() || 7, hour: 23, minute: 59 }], isActiveOnDate: () => true },
  ];
  for (const schedule of schedules) {
    const run = strictRuntime(schedule.period);
    const times = schedule.period === "flexibleWeekly" ? [] : ["08:00", "18:00"];
    const prepared = await prepareChallengeReminders("challenge-1", "Run", times, true, schedule, run.runtime);
    assert.ok(run.requests.length > 0, schedule.period);
    assert.ok(run.events.indexOf("next-trigger") < run.events.indexOf("permission-channel"), schedule.period);
    assert.ok(run.events.indexOf("permission-channel") < run.events.indexOf("journal"), schedule.period);
    assert.ok(run.events.indexOf("journal") < run.events.indexOf("schedule"), schedule.period);
    await prepared.rollback();
  }
});

test("denied and undetermined permission never mutate journal or scheduler", async () => {
  for (const status of ["denied", "undetermined"] as const) {
    const run = strictRuntime("daily", status);
    await assert.rejects(() => prepareChallengeReminders(
      "challenge-1", "Run", ["08:00"], true,
      { period: "daily", enabled: true, isActiveOnDate: () => true }, run.runtime,
    ), /NOTIFICATIONS_PERMISSION_DENIED/);
    assert.equal(run.events.includes("journal"), false);
    assert.equal(run.events.includes("schedule"), false);
  }
});

test("a personal challenge must have its stable ID persisted before scheduling", async () => {
  const run = strictRuntime("daily");
  run.runtime.getCachedState = () => ({ challenges: [], history: [], challengeStats: {}, reminderNotifIds: {} } as any);
  await assert.rejects(() => prepareChallengeReminders(
    "not-persisted", "Run", ["08:00"], true,
    { period: "daily", enabled: true, isActiveOnDate: () => true }, run.runtime,
  ), /NOTIFICATION_CHALLENGE_NOT_PERSISTED/);
  assert.equal(run.events.includes("schedule"), false);
});

test("new challenge IDs are UUIDs and stable values", () => {
  const id = createChallengeId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(String(id), id);
});

test("auth user is re-read after authStateReady and null remains an explicit error", async () => {
  const restored = { currentUser: null as { uid: string } | null, authStateReady: async () => { restored.currentUser = { uid: "user-after-ready" }; } };
  assert.deepEqual(await waitForReminderAuthUser(restored), { uid: "user-after-ready" });
  await assert.rejects(() => waitForReminderAuthUser({ currentUser: null, authStateReady: async () => {} }), /NOTIFICATION_UID_REQUIRED/);
});

test("durable cleanup failure does not report a successfully persisted change as failed", async () => {
  const phases: string[] = [];
  await commitPreparedNotificationChange({
    persist: async () => { phases.push("persisted"); },
    rollback: async () => { phases.push("rollback"); },
    finalize: async () => { throw new Error("cleanup temporarily unavailable"); },
    onPhase: (phase, error) => phases.push(`${phase}:${error ? "error" : "ok"}`),
  });
  assert.deepEqual(phases, ["persist:ok", "persisted", "cleanup:ok", "cleanup:error"]);
});
