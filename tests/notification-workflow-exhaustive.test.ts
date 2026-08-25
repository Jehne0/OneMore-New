import assert from "node:assert/strict";
import test from "node:test";

import { createChallengeId, createQuickChallenge } from "../lib/challengeIds";
import {
  REMINDER_OPERATION_DATA_KEY,
  createReminderOperationJournal,
  readReminderCleanupQueue,
  readReminderOperationJournals,
  writeReminderOperationJournal,
  type NotificationJournalStore,
  type ReminderOperationPhase,
} from "../lib/notificationJournal";
import {
  acquireNotificationSaveGuard,
  finishSuccessfulNotificationSave,
  runNotificationEditorSave,
} from "../lib/notificationSaveFlow";
import { recoverReminderNotificationOperations } from "../lib/reminderRecovery";
import {
  buildReminderTriggerInputs,
  ensureAndroidReminderChannel,
  reminderPlanningContext,
  refreshRemindersAfterForeground,
  savePersonalReminderWorkflow,
  setRemindersPremiumEnabled,
  type ReminderOperationRuntime,
  type ReminderSchedule,
} from "../lib/reminders";
import { validateExpoNotificationContent } from "../lib/notificationRuntime";

process.env.TZ = "Europe/Prague";
setRemindersPremiumEnabled(true);

const PERIODS = ["daily", "every2", "custom", "flexibleWeekly"] as const;
type Period = typeof PERIODS[number];
const TRIGGER_TYPES = { DAILY: "daily", DATE: "date", WEEKLY: "weekly" } as const;

function localISO(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isoWeekday(date: Date): number {
  return ((date.getDay() + 6) % 7) + 1;
}

function periodConfiguration(period: Period, isNewChallenge: boolean): { schedule: ReminderSchedule; times: string[] } {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = localISO(tomorrow);
  if (period === "flexibleWeekly") {
    return {
      schedule: {
        period,
        enabled: true,
        isNewChallenge,
        reminderRows: [
          { weekday: isoWeekday(tomorrow), hour: 8, minute: 0 },
          { weekday: isoWeekday(tomorrow) % 7 + 1, hour: 12, minute: 0 },
          { weekday: (isoWeekday(tomorrow) + 1) % 7 + 1, hour: 18, minute: 0 },
        ],
        isActiveOnDate: () => true,
      },
      times: [],
    };
  }
  return {
    schedule: {
      period,
      enabled: true,
      isNewChallenge,
      isActiveOnDate: period === "daily" ? () => true : (iso) => iso === tomorrowISO,
    },
    times: ["08:00", "12:00", "18:00"],
  };
}

function memoryStore(events: string[] = []): NotificationJournalStore {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      events.push(key.includes("notification_journal") ? "journal" : key.includes("notification_cleanup") ? "cleanup-store" : "store");
      values.set(key, value);
    },
    removeItem: async (key) => { values.delete(key); },
  };
}

type HarnessOptions = {
  platform?: "android" | "ios";
  newChallenge?: boolean;
  newChallengePersisted?: boolean;
  reminderEnabled?: boolean;
  challengeEnabled?: boolean;
  otherActiveReminder?: boolean;
  oldIds?: string[];
  permission?: "granted" | "denied" | "undetermined";
  failScheduleAt?: number;
  failPersist?: boolean;
  failOldCleanup?: boolean;
  switchUidDuringSchedule?: boolean;
  preflightFailure?: "throw" | "null";
};

function workflowHarness(period: Period, options: HarnessOptions = {}) {
  const platform = options.platform ?? "android";
  const events: string[] = [];
  const store = memoryStore(events);
  const challengeId = options.newChallenge ? createChallengeId() : `existing-${period}`;
  const baseConfig = periodConfiguration(period, options.newChallenge === true);
  const config = {
    ...baseConfig,
    schedule: { ...baseConfig.schedule, enabled: options.challengeEnabled !== false },
  };
  const challenge = {
    ...(options.newChallenge
      ? createQuickChallenge(`${period} challenge`, localISO(new Date()), challengeId)
      : { id: challengeId, text: `${period} challenge`, enabled: options.challengeEnabled !== false }),
    enabled: options.challengeEnabled !== false,
    period,
    targetPerDay: 3,
    reminderEnabled: options.reminderEnabled === true,
    reminderTimes: options.reminderEnabled ? config.times : [],
    ...(period === "flexibleWeekly" ? { flexibleReminderRows: config.schedule.reminderRows } : {}),
  };
  const oldIds = options.oldIds ?? [];
  let state: any = {
    challenges: options.newChallenge && !options.newChallengePersisted
      ? []
      : [
          challenge,
          ...(options.otherActiveReminder
            ? [{ id: "other-active", text: "Other", enabled: true, reminderEnabled: true, reminderTimes: ["09:00"] }]
            : []),
        ],
    history: [], challengeStats: {},
    reminderNotifIds: oldIds.length ? { [challengeId]: [...oldIds] } : {},
  };
  let uidCurrent = true;
  let failOldCleanup = options.failOldCleanup === true;
  let scheduleCalls = 0;
  const requests: any[] = [];
  const preflightTriggers: unknown[] = [];
  const scheduled = new Map<string, any>(oldIds.map((id) => [id, {
    identifier: id,
    content: { data: { oneMoreReminderKey: challengeId, oneMoreReminderKind: "challenge" } },
  }]));

  const Notifications = {
    SchedulableTriggerInputTypes: TRIGGER_TYPES,
    AndroidNotificationPriority: { HIGH: "high" },
    getAllScheduledNotificationsAsync: async () => [...scheduled.values()],
    getNextTriggerDateAsync: async (trigger: any) => {
      events.push("preflight");
      preflightTriggers.push(trigger);
      if (options.preflightFailure === "throw") {
        const error = new Error("preflight-failure");
        (error as Error & { code?: string }).code = "ERR_NOTIFICATIONS_FAILED_TO_GET_NEXT_TRIGGER_DATE";
        throw error;
      }
      if (options.preflightFailure === "null") return null;
      return trigger.type === "date" ? trigger.date.getTime() : Date.now() + 60_000;
    },
    scheduleNotificationAsync: async (request: any) => {
      scheduleCalls += 1;
      if (scheduleCalls === options.failScheduleAt) {
        const error = new Error(`schedule-failure-${scheduleCalls}`);
        (error as Error & { code?: string }).code = "ERR_NOTIFICATIONS_FAILED_TO_SCHEDULE";
        throw error;
      }
      assert.ok(preflightTriggers.includes(request.trigger), `${period}: preflight identity`);
      validateExpoNotificationContent(request.content, platform);
      assert.equal(request.content.channelId, undefined, `${period}: content.channelId`);
      assert.equal(request.content.sound, platform === "android" ? true : "default", `${period}/${platform}: sound`);
      assert.equal(request.content.priority, platform === "android" ? "high" : undefined, `${period}/${platform}: priority`);
      assert.equal(request.trigger.channelId, platform === "android" ? "reminders_high_v1" : undefined, `${period}/${platform}: trigger channel`);
      assert.deepEqual(Object.keys(request.content.data).sort(), [
        "oneMoreReminderKey", "oneMoreReminderKind", "oneMoreReminderOperationId", "oneMoreReminderRevision",
      ].sort(), `${period}: journal metadata location`);
      const id = `${period}-new-${scheduleCalls}`;
      events.push(`schedule:${id}`);
      requests.push(request);
      scheduled.set(id, { identifier: id, content: request.content, trigger: request.trigger });
      if (options.switchUidDuringSchedule) uidCurrent = false;
      return id;
    },
    cancelScheduledNotificationAsync: async (id: string) => {
      events.push(`cancel:${id}`);
      if (failOldCleanup && oldIds.includes(id)) throw new Error(`cleanup-failure-${id}`);
      scheduled.delete(id);
    },
  } as any;

  const permission = options.permission ?? "granted";
  const runtime: ReminderOperationRuntime = {
    uid: "workflow-user",
    isUidCurrent: () => uidCurrent,
    expoGo: false,
    platformOS: platform,
    Notifications,
    store,
    getCachedState: () => state,
    loadState: async () => state,
    updateState: async (updater) => { state = updater(state); return state; },
    loadNotificationSettings: async () => ({
      challengeReminders: true, friendRequests: true, incomingChallenges: true,
      sharedChallenges: true, friendCompletedSharedChallenge: true,
    }),
    ensureSchedulingReady: async () => {
      events.push("channel");
      events.push("permission");
      return {
        granted: permission === "granted",
        status: permission,
        canAskAgain: permission === "undetermined",
        channelId: "reminders_high_v1",
      };
    },
  };

  const save = async () => savePersonalReminderWorkflow({
    challengeId,
    challengeText: challenge.text,
    timesHHMM: config.times,
    enabled: true,
    scheduleOverride: config.schedule,
    runtimeOverride: runtime,
    ...(options.newChallenge && !options.newChallengePersisted ? {
      ensureChallengePersisted: async () => {
        events.push("persist-challenge");
        state = { ...state, challenges: [challenge] };
      },
    } : {}),
    persist: async (prepared) => {
      events.push("persist");
      if (options.failPersist) throw new Error("persist-failure");
      state = prepared.applyToState(state);
    },
  });

  return {
    runtime, save, events, requests, scheduled, oldIds, challengeId, config,
    state: () => state,
    setUidCurrent: (value: boolean) => { uidCurrent = value; },
    setFailOldCleanup: (value: boolean) => { failOldCleanup = value; },
    expectedTriggerCount: () => buildReminderTriggerInputs(
      config.schedule, config.times, platform, TRIGGER_TYPES as any,
    ).length,
  };
}

function canonicalIds(run: ReturnType<typeof workflowHarness>): string[] {
  return run.state().reminderNotifIds?.[run.challengeId] ?? [];
}

function assertPersistedIdsAreScheduled(run: ReturnType<typeof workflowHarness>, context: string): void {
  const ids = canonicalIds(run);
  assert.ok(ids.length > 0, `${context}: persisted ids`);
  assert.equal(new Set(ids).size, ids.length, `${context}: duplicate ids`);
  assert.ok(ids.every((id) => run.scheduled.has(id)), `${context}: persisted id without scheduled notification`);
  assert.equal(ids.length, run.requests.length, `${context}: id/request count`);
}

test("new and existing challenges complete first enable for every period with exact persisted system IDs", async () => {
  for (const period of PERIODS) {
    for (const newChallenge of [true, false]) {
      const context = `${period}/${newChallenge ? "new" : "existing"}`;
      const run = workflowHarness(period, { newChallenge });
      await run.save();
      assertPersistedIdsAreScheduled(run, context);
      assert.equal(run.requests.length, run.expectedTriggerCount(), `${context}: exact trigger count`);
      assert.equal(run.state().challenges[0].reminderEnabled, true, context);
      if (newChallenge) assert.ok(run.events.indexOf("persist-challenge") < run.events.indexOf("preflight"), context);
      assert.equal((await readReminderOperationJournals("workflow-user", run.runtime.store)).length, 0, context);
      assert.equal((await readReminderCleanupQueue("workflow-user", run.runtime.store)).length, 0, context);
    }
  }
});

test("production request content is persistence-safe for every period, platform, and challenge lifecycle", async () => {
  for (const period of PERIODS) {
    for (const platform of ["android", "ios"] as const) {
      for (const newChallenge of [true, false]) {
        const context = `${period}/${platform}/${newChallenge ? "new" : "existing"}`;
        const run = workflowHarness(period, { platform, newChallenge });
        await run.save();
        assert.ok(run.requests.length > 0, context);
        for (const request of run.requests) {
          assert.doesNotThrow(() => validateExpoNotificationContent(request.content, platform), context);
          assert.equal(typeof request.content.sound, platform === "android" ? "boolean" : "string", context);
          assert.equal(request.content.sound, platform === "android" ? true : "default", context);
          assert.equal(request.trigger.channelId, platform === "android" ? "reminders_high_v1" : undefined, context);
        }
      }
    }
  }
});

test("an inactive challenge keeps its reminder configuration without scheduling an iOS or Android notification", async () => {
  for (const period of PERIODS) {
    for (const platform of ["ios", "android"] as const) {
      const oldId = `${period}-${platform}-old`;
      const run = workflowHarness(period, {
        platform,
        challengeEnabled: false,
        reminderEnabled: true,
        otherActiveReminder: true,
        oldIds: [oldId],
      });
      await run.save();
      assert.equal(run.requests.length, 0, `${period}/${platform}: no native schedule while inactive`);
      assert.equal(run.events.includes("preflight"), false, `${period}/${platform}: no native trigger preflight while inactive`);
      assert.equal(run.events.includes("permission"), false, `${period}/${platform}: no permission prompt while inactive`);
      assert.equal(run.state().challenges[0].enabled, false, `${period}/${platform}: inactive persisted`);
      assert.equal(run.state().challenges[0].reminderEnabled, true, `${period}/${platform}: reminder preference preserved`);
      assert.deepEqual(canonicalIds(run), [], `${period}/${platform}: stale system IDs removed`);
      assert.equal(run.scheduled.has(oldId), false, `${period}/${platform}: old native reminder cleaned`);
    }
  }
});

test("persisted quick-create UUID reaches successful notification confirmation and 900ms editor close for every period", async () => {
  for (const period of PERIODS) {
    const run = workflowHarness(period, { newChallenge: true, newChallengePersisted: true });
    let quickCreateOpen = true;
    let notificationSectionOpen = true;
    let editorOpen = true;
    let confirmation = "";
    quickCreateOpen = false;
    await runNotificationEditorSave({
      save: run.save,
      confirm: () => finishSuccessfulNotificationSave({
        message: "Notification saved.",
        showConfirmation: (message) => { confirmation = message; },
        delay: async (milliseconds) => { assert.equal(milliseconds, 900, period); },
        closeEditor: () => {
          notificationSectionOpen = false;
          editorOpen = false;
        },
      }),
    });
    assert.equal(quickCreateOpen, false, `${period}: quick-create closed after persistence`);
    assert.match(run.challengeId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, period);
    assert.equal(run.state().challenges[0].id, run.challengeId, `${period}: stable persisted UUID`);
    assertPersistedIdsAreScheduled(run, `${period}/quick-create`);
    assert.equal(confirmation, "Notification saved.", period);
    assert.equal(notificationSectionOpen, false, period);
    assert.equal(editorOpen, false, period);
  }
});

test("change, disable and repeated identical save replace IDs without leaving duplicate or orphan notifications", async () => {
  for (const period of PERIODS) {
    const changed = workflowHarness(period, { reminderEnabled: true, oldIds: [`${period}-old-1`, `${period}-old-2`] });
    await changed.save();
    assertPersistedIdsAreScheduled(changed, `${period}/change`);
    assert.ok(changed.oldIds.every((id) => !changed.scheduled.has(id)), `${period}/change old cleanup`);

    const firstIds = [...canonicalIds(changed)];
    await changed.save();
    const secondIds = canonicalIds(changed);
    assert.ok(firstIds.every((id) => !changed.scheduled.has(id)), `${period}/repeat old replacement`);
    assert.ok(secondIds.every((id) => changed.scheduled.has(id)), `${period}/repeat canonical`);
    assert.equal(changed.scheduled.size, secondIds.length, `${period}/repeat no duplicate scheduled rows`);

    const disabled = workflowHarness(period, { reminderEnabled: true, oldIds: [`${period}-old`] });
    await savePersonalReminderWorkflow({
      challengeId: disabled.challengeId,
      challengeText: "disabled",
      timesHHMM: [],
      enabled: false,
      runtimeOverride: disabled.runtime,
      persist: async (prepared) => {
        await disabled.runtime.updateState((state) => prepared.applyToState(state));
      },
    });
    assert.equal(disabled.state().challenges[0].reminderEnabled, false, `${period}/disable`);
    assert.deepEqual(canonicalIds(disabled), [], `${period}/disable ids`);
    assert.equal(disabled.scheduled.size, 0, `${period}/disable cleanup`);
  }
});

test("scheduler failure at first, middle and last trigger rolls back every partial batch for every period", async () => {
  for (const period of PERIODS) {
    const probe = workflowHarness(period);
    const total = probe.expectedTriggerCount();
    assert.ok(total >= 3, `${period}: failure matrix needs at least three triggers`);
    for (const failAt of [1, Math.ceil(total / 2), total]) {
      const oldId = `${period}-canonical-old`;
      const run = workflowHarness(period, { reminderEnabled: true, oldIds: [oldId], failScheduleAt: failAt });
      await assert.rejects(() => run.save(), new RegExp(`schedule-failure-${failAt}`), `${period}/${failAt}`);
      assert.deepEqual([...run.scheduled.keys()], [oldId], `${period}/${failAt}: orphan rollback`);
      assert.deepEqual(canonicalIds(run), [oldId], `${period}/${failAt}: canonical state`);
      assert.equal((await readReminderOperationJournals("workflow-user", run.runtime.store)).length, 0, `${period}/${failAt}: journal`);
    }
  }
});

test("persist failure rolls back new IDs while cleanup failure after persist remains a successful durable save", async () => {
  for (const period of PERIODS) {
    const oldId = `${period}-old`;
    const persistFailure = workflowHarness(period, { reminderEnabled: true, oldIds: [oldId], failPersist: true });
    await assert.rejects(() => persistFailure.save(), /persist-failure/, period);
    assert.deepEqual([...persistFailure.scheduled.keys()], [oldId], `${period}: persist rollback`);
    assert.deepEqual(canonicalIds(persistFailure), [oldId], `${period}: persist canonical`);

    const cleanupFailure = workflowHarness(period, { reminderEnabled: true, oldIds: [oldId], failOldCleanup: true });
    await cleanupFailure.save();
    assertPersistedIdsAreScheduled(cleanupFailure, `${period}: cleanup failure`);
    assert.ok(cleanupFailure.scheduled.has(oldId), `${period}: old ID remains durably queued`);
    assert.equal((await readReminderCleanupQueue("workflow-user", cleanupFailure.runtime.store)).length, 1, period);
    assert.equal((await readReminderOperationJournals("workflow-user", cleanupFailure.runtime.store)).length, 1, period);
    cleanupFailure.setFailOldCleanup(false);
    await recoverReminderNotificationOperations({
      uid: "workflow-user",
      store: cleanupFailure.runtime.store,
      Notifications: cleanupFailure.runtime.Notifications,
      isUidCurrent: () => true,
      loadCanonicalState: async () => cleanupFailure.state(),
    });
    assert.equal(cleanupFailure.scheduled.has(oldId), false, `${period}: deferred cleanup recovery`);
    assert.equal((await readReminderCleanupQueue("workflow-user", cleanupFailure.runtime.store)).length, 0, period);
    assert.equal((await readReminderOperationJournals("workflow-user", cleanupFailure.runtime.store)).length, 0, period);
  }
});

test("granted, denied and undetermined permission states are distinct for every period", async () => {
  for (const period of PERIODS) {
    for (const permission of ["granted", "denied", "undetermined"] as const) {
      const run = workflowHarness(period, { permission });
      if (permission === "granted") {
        await run.save();
        assertPersistedIdsAreScheduled(run, `${period}/${permission}`);
      } else {
        await assert.rejects(
          () => run.save(),
          permission === "denied" ? /NOTIFICATIONS_PERMISSION_DENIED/ : /NOTIFICATIONS_PERMISSION_UNDETERMINED/,
          `${period}/${permission}`,
        );
        assert.equal(run.requests.length, 0, `${period}/${permission}: no schedule`);
        assert.equal((await readReminderOperationJournals("workflow-user", run.runtime.store)).length, 0, `${period}/${permission}: no journal`);
      }
    }
  }
});

test("throwing and null diagnostic preflight results never block the valid scheduler for any period", async () => {
  for (const period of PERIODS) {
    for (const preflightFailure of ["throw", "null"] as const) {
      const run = workflowHarness(period, { preflightFailure });
      await run.save();
      assertPersistedIdsAreScheduled(run, `${period}/${preflightFailure}`);
      assert.equal(run.requests.length, run.expectedTriggerCount(), `${period}/${preflightFailure}: scheduler count`);
    }
  }
});

test("a deleted Android channel is recreated and only existence, not normalized properties, is required", async () => {
  let channel: any = null;
  let creates = 0;
  let requestedChannel: any = null;
  const Notifications: any = {
    AndroidImportance: { HIGH: 4 },
    AndroidNotificationVisibility: { PUBLIC: 1 },
    getNotificationChannelAsync: async () => channel,
    setNotificationChannelAsync: async (id: string, value: any) => {
      creates += 1;
      requestedChannel = value;
      channel = { id, importance: 3, sound: null, vibrationPattern: [0, 250] };
    },
  };
  assert.equal(await ensureAndroidReminderChannel(Notifications, 33), "reminders_high_v1");
  assert.equal(creates, 1);
  assert.equal(requestedChannel.sound, "default", "channel keeps the Android default sound");
  assert.equal(await ensureAndroidReminderChannel(Notifications, 33), "reminders_high_v1");
  assert.equal(creates, 1, "normalized existing channel must be accepted");
  channel = null;
  assert.equal(await ensureAndroidReminderChannel(Notifications, 33), "reminders_high_v1");
  assert.equal(creates, 2, "deleted channel must be recreated");
});

test("UID change during a native scheduling await leaves a recoverable journal and no permanent orphan", async () => {
  for (const period of PERIODS) {
    const oldId = `${period}-old`;
    const run = workflowHarness(period, {
      reminderEnabled: true,
      oldIds: [oldId],
      switchUidDuringSchedule: true,
    });
    await assert.rejects(() => run.save(), /NOTIFICATION_UID_CHANGED/, period);
    assert.ok(run.scheduled.size > 1, `${period}: native result must be discoverable as an orphan`);
    assert.equal((await readReminderOperationJournals("workflow-user", run.runtime.store)).length, 1, period);
    run.setUidCurrent(true);
    await recoverReminderNotificationOperations({
      uid: "workflow-user",
      store: run.runtime.store,
      Notifications: run.runtime.Notifications,
      isUidCurrent: () => true,
      loadCanonicalState: async () => run.state(),
    });
    assert.deepEqual([...run.scheduled.keys()], [oldId], `${period}: recovery removes orphan`);
    assert.equal((await readReminderOperationJournals("workflow-user", run.runtime.store)).length, 0, period);
  }
});

test("all journal phases recover idempotently for every period", async () => {
  const phases: ReminderOperationPhase[] = [
    "prepared", "scheduling", "scheduled", "persisted", "cleaningOld", "rollingBack",
  ];
  for (const period of PERIODS) {
    for (const phase of phases) {
      const events: string[] = [];
      const store = memoryStore(events);
      const operation = createReminderOperationJournal({
        uid: "recovery-user", challengeId: `recovery-${period}`, enabled: true,
        originalIds: ["old"], now: new Date("2028-01-03T10:00:00.000Z"),
      });
      await writeReminderOperationJournal({ ...operation, phase, newIds: ["new"] }, store);
      const scheduled = new Map<string, any>([
        ["old", { identifier: "old", content: { data: {} } }],
        ["new", { identifier: "new", content: { data: { [REMINDER_OPERATION_DATA_KEY]: operation.operationId } } }],
      ]);
      const Notifications = {
        getAllScheduledNotificationsAsync: async () => [...scheduled.values()],
        cancelScheduledNotificationAsync: async (id: string) => { scheduled.delete(id); },
      };
      const persisted = phase === "persisted" || phase === "cleaningOld";
      const canonicalState: any = {
        challenges: [{ id: `recovery-${period}`, text: period, enabled: true, period, reminderEnabled: true }],
        reminderNotifIds: { [`recovery-${period}`]: [persisted ? "new" : "old"] },
      };
      const runtime = {
        uid: "recovery-user", store, Notifications, isUidCurrent: () => true,
        loadCanonicalState: async () => canonicalState,
      };
      await recoverReminderNotificationOperations(runtime);
      await recoverReminderNotificationOperations(runtime);
      assert.deepEqual([...scheduled.keys()], [persisted ? "new" : "old"], `${period}/${phase}`);
      assert.equal((await readReminderOperationJournals("recovery-user", store)).length, 0, `${period}/${phase}`);
      assert.equal((await readReminderCleanupQueue("recovery-user", store)).length, 0, `${period}/${phase}`);
    }
  }
});

test("rapid double press starts only one production editor save", async () => {
  const lock = { current: false };
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let saves = 0;
  const press = async () => {
    if (!acquireNotificationSaveGuard(lock)) return;
    try {
      saves += 1;
      await blocked;
    } finally {
      lock.current = false;
    }
  };
  const first = press();
  const second = press();
  assert.equal(saves, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(saves, 1);
});

test("foreground after date or timezone change runs recovery before rebuilding the rolling plan", async () => {
  assert.notEqual(
    reminderPlanningContext(new Date(2028, 0, 3, 12), "Europe/Prague"),
    reminderPlanningContext(new Date(2028, 0, 3, 12), "America/New_York"),
  );
  assert.notEqual(
    reminderPlanningContext(new Date(2028, 0, 3, 12), "Europe/Prague"),
    reminderPlanningContext(new Date(2028, 0, 4, 12), "Europe/Prague"),
  );
  const events: string[] = [];
  await refreshRemindersAfterForeground("workflow-user", {
    recover: async (uid) => { events.push(`recover:${uid}`); },
    refresh: async () => { events.push("refresh-30-day-plan"); },
  });
  assert.deepEqual(events, ["recover:workflow-user", "refresh-30-day-plan"]);
});

test("button-to-editor-close integration covers channel, permission, journal, schedule, persist, cleanup and 900ms confirmation", async () => {
  const run = workflowHarness("daily", { reminderEnabled: true, oldIds: ["old-integration"] });
  let errorDialog = false;
  let notificationSectionOpen = true;
  let editorOpen = true;
  let confirmation = "";
  try {
    await runNotificationEditorSave({
      save: run.save,
      onSaved: () => { run.events.push("configuration-updated"); },
      confirm: () => finishSuccessfulNotificationSave({
        message: "Notification saved.",
        showConfirmation: (message) => { confirmation = message; run.events.push("confirmation"); },
        delay: async (milliseconds) => { run.events.push(`wait:${milliseconds}`); },
        closeEditor: () => {
          notificationSectionOpen = false;
          editorOpen = false;
          run.events.push("close-notification-and-editor");
        },
      }),
    });
  } catch {
    errorDialog = true;
  }

  assert.equal(errorDialog, false);
  assert.equal(confirmation, "Notification saved.");
  assert.equal(notificationSectionOpen, false);
  assert.equal(editorOpen, false);
  assertPersistedIdsAreScheduled(run, "integration");
  assert.deepEqual(run.state().challenges[0].reminderTimes, ["08:00", "12:00", "18:00"]);
  assert.equal(run.scheduled.size, canonicalIds(run).length, "integration: no duplicates");
  const first = (name: string) => run.events.findIndex((event) => event === name || event.startsWith(`${name}:`));
  assert.ok(first("preflight") < first("channel"));
  assert.ok(first("channel") < first("permission"));
  assert.ok(first("permission") < first("journal"));
  assert.ok(first("journal") < first("schedule"));
  assert.ok(first("schedule") < first("persist"));
  assert.ok(first("persist") < first("cancel"));
  assert.ok(first("cancel") < first("confirmation"));
  assert.ok(first("confirmation") < first("wait"));
  assert.ok(first("wait") < first("close-notification-and-editor"));
  assert.ok(run.events.includes("wait:900"));
});
