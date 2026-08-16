import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { createChallengeId } from "../lib/challengeIds";
import { commitPreparedNotificationChange } from "../lib/notificationSaveFlow";
import {
  attachNotificationFailure,
  formatNotificationFailureDetails,
  getNotificationFailureDetails,
  sanitizeNotificationTrigger,
  validateExpoNotificationTrigger,
  waitForReminderAuthUser,
} from "../lib/notificationRuntime";
import { prepareChallengeReminders, savePersonalReminderWorkflow, type ReminderOperationRuntime, type ReminderSchedule } from "../lib/reminders";
import type { NotificationJournalStore } from "../lib/notificationJournal";

function memoryStore(events: string[]): NotificationJournalStore {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { events.push("journal"); values.set(key, value); },
    removeItem: async (key) => { values.delete(key); },
  };
}

function loadInstalledExpoParseTrigger(): (trigger: unknown) => Record<string, unknown> {
  const validitySource = readFileSync("node_modules/expo-notifications/src/hasValidTriggerObject.ts", "utf8");
  const validityOutput = ts.transpileModule(validitySource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const validityExports: Record<string, unknown> = {};
  vm.runInNewContext(validityOutput, { exports: validityExports });

  const source = readFileSync("node_modules/expo-notifications/src/scheduleNotificationAsync.ts", "utf8");
  const start = source.indexOf("export function parseTrigger");
  assert.notEqual(start, -1, "installed Expo SDK 54 parseTrigger source must exist");
  const output = ts.transpileModule(source.slice(start), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(output, {
    exports,
    console,
    Date,
    Platform: { select: (choices: Record<string, unknown>) => choices.android },
    SchedulableTriggerInputTypes: {
      CALENDAR: "calendar", DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly",
      YEARLY: "yearly", DATE: "date", TIME_INTERVAL: "timeInterval",
    },
    hasValidTriggerObject: validityExports.hasValidTriggerObject,
  });
  return exports.parseTrigger as (trigger: unknown) => Record<string, unknown>;
}

const installedExpoParseTrigger = loadInstalledExpoParseTrigger();

function strictRuntime(period: ReminderSchedule["period"], permission: "granted" | "denied" | "undetermined" = "granted") {
  const events: string[] = [];
  const requests: any[] = [];
  const preflightTriggers: unknown[] = [];
  const challenge = { id: "challenge-1", text: "Run", enabled: true, period, targetPerDay: 2 };
  let state: any = { challenges: [challenge], history: [], challengeStats: {}, reminderNotifIds: {} };
  const Notifications = {
    SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date" },
    AndroidNotificationPriority: { HIGH: "high" },
    getAllScheduledNotificationsAsync: async () => [],
    cancelScheduledNotificationAsync: async () => {},
    getNextTriggerDateAsync: async (trigger: unknown) => {
      events.push("next-trigger");
      preflightTriggers.push(trigger);
      const valid = validateExpoNotificationTrigger(trigger, "android", new Date(Date.now() - 1));
      const value = sanitizeNotificationTrigger(valid);
      if (value.type === "date") return new Date(String(value.date)).getTime();
      return Date.now() + 60_000;
    },
    scheduleNotificationAsync: async (request: any) => {
      events.push("schedule");
      validateExpoNotificationTrigger(request.trigger, "android", new Date(Date.now() - 1));
      assert.ok(preflightTriggers.includes(request.trigger), "preflight and schedule must receive the same trigger object");
      assert.equal("channelId" in request.content, false, "channelId must never be placed in content");
      const parsed = installedExpoParseTrigger(request.trigger);
      assert.equal(parsed.type, request.trigger.type);
      if (request.trigger.type === "date") assert.equal(parsed.timestamp, request.trigger.date.getTime());
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
    updateState: async (updater) => (state = updater(state)),
    loadNotificationSettings: async () => ({
      challengeReminders: true, friendRequests: true, incomingChallenges: true,
      sharedChallenges: true, friendCompletedSharedChallenge: true,
    }),
    ensureSchedulingReady: async () => {
      events.push("permission-channel");
      return { granted: permission === "granted", status: permission, canAskAgain: permission === "undetermined", channelId: "reminders_high_v1" };
    },
  };
  return {
    runtime, events, requests, challenge,
    getState: () => state,
    setState: (next: any) => { state = next; },
  };
}

test("SDK 54 validator accepts exact Android daily and date shapes", () => {
  const daily = validateExpoNotificationTrigger({ type: "daily", hour: 8, minute: 5, channelId: "reminders_high_v1" }, "android");
  const date = validateExpoNotificationTrigger({ type: "date", date: new Date(Date.now() + 60_000), channelId: "reminders_high_v1" }, "android");
  assert.deepEqual(sanitizeNotificationTrigger(daily), { type: "daily", hour: 8, minute: 5, channelId: "reminders_high_v1" });
  assert.equal(sanitizeNotificationTrigger(date).type, "date");
});

test("installed Expo SDK 54 parser produces the native DATE and DAILY runtime objects", () => {
  const date = new Date(Date.now() + 60_000);
  assert.equal(
    JSON.stringify(installedExpoParseTrigger({ type: "date", date, channelId: "reminders_high_v1" })),
    JSON.stringify({ type: "date", timestamp: date.getTime(), channelId: "reminders_high_v1" }),
  );
  assert.equal(
    JSON.stringify(installedExpoParseTrigger({ type: "daily", hour: 8, minute: 5, channelId: "reminders_high_v1" })),
    JSON.stringify({ type: "daily", hour: 8, minute: 5, channelId: "reminders_high_v1" }),
  );
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
    ), status === "denied" ? /NOTIFICATIONS_PERMISSION_DENIED/ : /NOTIFICATIONS_PERMISSION_UNDETERMINED/);
    assert.equal(run.events.includes("journal"), false);
    assert.equal(run.events.includes("schedule"), false);
  }
});

test("the full new-challenge save workflow persists first and covers every reminder period", async () => {
  const schedules: ReminderSchedule[] = [
    { period: "daily", enabled: true, isNewChallenge: true, isActiveOnDate: () => true },
    { period: "every2", enabled: true, isNewChallenge: true, isActiveOnDate: () => true },
    { period: "custom", enabled: true, isNewChallenge: true, isActiveOnDate: () => true },
    { period: "flexibleWeekly", enabled: true, isNewChallenge: true, reminderRows: [{ weekday: 1, hour: 8, minute: 0 }], isActiveOnDate: () => true },
  ];
  for (const schedule of schedules) {
    const run = strictRuntime(schedule.period);
    const id = createChallengeId();
    run.setState({ challenges: [], history: [], challengeStats: {}, reminderNotifIds: {} });
    await savePersonalReminderWorkflow({
      challengeId: id,
      challengeText: "New challenge",
      timesHHMM: schedule.period === "flexibleWeekly" ? [] : ["08:00"],
      enabled: true,
      scheduleOverride: schedule,
      runtimeOverride: run.runtime,
      ensureChallengePersisted: async () => {
        run.events.push("persist-challenge");
        run.setState({ ...run.getState(), challenges: [{ id, text: "New challenge", enabled: true, period: schedule.period, targetPerDay: 2 }] });
      },
      persist: async (prepared) => {
        run.events.push("persist-reminders");
        run.setState(prepared.applyToState(run.getState()));
      },
    });
    assert.ok(run.events.indexOf("persist-challenge") < run.events.indexOf("next-trigger"), schedule.period);
    assert.ok(run.events.indexOf("schedule") < run.events.indexOf("persist-reminders"), schedule.period);
    assert.equal(run.getState().challenges[0].reminderEnabled, true, schedule.period);
    assert.ok(run.requests.length > 0, schedule.period);
  }
});

test("the full workflow changes and disables reminders for an existing persisted challenge", async () => {
  const run = strictRuntime("daily");
  run.setState({
    challenges: [{ ...run.challenge, reminderEnabled: true, reminderTimes: ["07:00"] }],
    history: [], challengeStats: {}, reminderNotifIds: { "challenge-1": ["old-notification"] },
  });
  await savePersonalReminderWorkflow({
    challengeId: "challenge-1", challengeText: "Run", timesHHMM: ["09:00"], enabled: true,
    scheduleOverride: { period: "daily", enabled: true, isActiveOnDate: () => true },
    runtimeOverride: run.runtime,
    persist: async (prepared) => run.setState(prepared.applyToState(run.getState())),
  });
  assert.deepEqual(run.getState().challenges[0].reminderTimes, ["09:00"]);

  const scheduledBeforeDisable = run.requests.length;
  await savePersonalReminderWorkflow({
    challengeId: "challenge-1", challengeText: "Run", timesHHMM: [], enabled: false,
    runtimeOverride: run.runtime,
    persist: async (prepared) => run.setState(prepared.applyToState(run.getState())),
  });
  assert.equal(run.requests.length, scheduledBeforeDisable);
  assert.equal(run.getState().challenges[0].reminderEnabled, false);
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

test("a newly-created stable challenge ID is not rejected only because it is absent from the old state", async () => {
  const run = strictRuntime("daily");
  run.runtime.getCachedState = () => ({ challenges: [], history: [], challengeStats: {}, reminderNotifIds: {} } as any);
  const prepared = await prepareChallengeReminders(
    createChallengeId(), "Run", ["08:00"], true,
    { period: "daily", enabled: true, isNewChallenge: true, isActiveOnDate: () => true }, run.runtime,
  );
  assert.equal(run.events.includes("schedule"), true);
  await prepared.rollback();
});

test("a missing non-UUID or foreign personal challenge ID stays rejected even when marked new", async () => {
  const run = strictRuntime("daily");
  run.runtime.getCachedState = () => ({ challenges: [], history: [], challengeStats: {}, reminderNotifIds: {} } as any);
  await assert.rejects(() => prepareChallengeReminders(
    "foreign-or-invalid-id", "Run", ["08:00"], true,
    { period: "daily", enabled: true, isNewChallenge: true, isActiveOnDate: () => true }, run.runtime,
  ), /NOTIFICATION_CHALLENGE_NOT_PERSISTED/);
  assert.equal(run.events.includes("schedule"), false);
});

test("diagnostic preflight rejection does not block the same valid trigger from native scheduling", async () => {
  const run = strictRuntime("daily");
  const inspectTrigger = run.runtime.Notifications.getNextTriggerDateAsync;
  run.runtime.Notifications.getNextTriggerDateAsync = async (trigger) => {
    await inspectTrigger(trigger);
    const error = new Error("native preflight unavailable");
    (error as Error & { code?: string }).code = "ERR_NOTIFICATIONS_FAILED_TO_GET_NEXT_TRIGGER_DATE";
    throw error;
  };
  const prepared = await prepareChallengeReminders(
    "challenge-1", "Run", ["08:00"], true,
    { period: "daily", enabled: true, isActiveOnDate: () => true }, run.runtime,
  );
  assert.equal(run.events.includes("schedule"), true);
  await prepared.rollback();
});

test("a native scheduling rejection is surfaced with the SCHEDULE production diagnostic code", async () => {
  const run = strictRuntime("daily");
  run.runtime.Notifications.scheduleNotificationAsync = async () => {
    const error = new Error("Failed to schedule the notification");
    (error as Error & { code?: string }).code = "ERR_NOTIFICATIONS_FAILED_TO_SCHEDULE";
    throw error;
  };
  await assert.rejects(async () => {
    try {
      await prepareChallengeReminders(
        "challenge-1", "Run", ["08:00"], true,
        { period: "daily", enabled: true, isActiveOnDate: () => true }, run.runtime,
      );
    } catch (error) {
      assert.deepEqual(getNotificationFailureDetails(error), {
        phase: "SCHEDULE",
        name: "Error",
        code: "ERR_NOTIFICATIONS_FAILED_TO_SCHEDULE",
        message: "Failed to schedule the notification",
      });
      throw error;
    }
  }, /Failed to schedule/);
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

test("copied production diagnostics contain phase and sanitized error only", () => {
  const id = createChallengeId();
  const error = new Error(`Scheduling failed for ${id}, person@example.com, Bearer secret-token-value`);
  (error as Error & { code?: string }).code = "ERR_NOTIFICATIONS_FAILED_TO_SCHEDULE";
  const details = formatNotificationFailureDetails(attachNotificationFailure(error, "schedule"));
  assert.match(details, /Phase: SCHEDULE/);
  assert.match(details, /Code: ERR_NOTIFICATIONS_FAILED_TO_SCHEDULE/);
  assert.doesNotMatch(details, new RegExp(id, "i"));
  assert.doesNotMatch(details, /person@example\.com|secret-token-value/);
});
