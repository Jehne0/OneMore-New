import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NotificationContentInput } from "expo-notifications";
import { onAuthStateChanged } from "firebase/auth";
import { getTodayISO } from "./clock";
import { auth } from "./firebase";
import { loadNotificationSettings } from "./notificationSettings";
import { commitPreparedNotificationChange } from "./notificationSaveFlow";
import {
  REMINDER_OPERATION_DATA_KEY,
  REMINDER_REVISION_DATA_KEY,
  createReminderOperationJournal,
  enqueueReminderCleanup,
  readReminderCleanupQueue,
  readReminderOperationJournals,
  removeReminderCleanup,
  removeReminderOperationJournal,
  updateReminderOperationJournal,
  writeReminderOperationJournal,
  type NotificationJournalStore,
  type ReminderOperationJournal,
} from "./notificationJournal";
import {
  processReminderCleanupQueue,
  recoverReminderNotificationOperations as recoverReminderOperationsCore,
  recoverReminderNotificationOperationsUnlocked,
} from "./reminderRecovery";
import { acquireReminderMutationLock } from "./reminderMutationLock";
import { getCachedState, isChallengeActiveOnDate, loadState, type AppState, type Challenge } from "./storage";
import { updateState } from "./storage";
import {
  flexibleReminderRowTime,
  migrateFlexibleWeeklyReminderRows,
  normalizeFlexibleWeeklyReminderRows,
  type FlexibleWeeklyReminderRow,
} from "./flexibleReminderRows";
import { isStableChallengeId } from "./challengeIds";
import {
  attachNotificationFailure,
  logNotificationDiagnostic,
  notificationError,
  sanitizeNotificationTrigger,
  validateExpoNotificationContent,
  validateExpoNotificationTrigger,
  waitForReminderAuthUser,
  type NotificationDiagnostic,
  type NotificationSavePhase,
  type ReminderPermissionResult,
} from "./notificationRuntime";

type NotificationsModule = typeof import("expo-notifications");

export type ReminderOperationRuntime = {
  uid: string;
  isUidCurrent(): boolean;
  expoGo: boolean;
  platformOS: string;
  Notifications: NotificationsModule;
  store: NotificationJournalStore;
  getCachedState(): AppState | null;
  loadState(): Promise<AppState>;
  updateState(updater: (state: AppState) => AppState): Promise<AppState>;
  loadNotificationSettings: typeof loadNotificationSettings;
  ensureSchedulingReady(): Promise<boolean | ReminderPermissionResult>;
  diagnostic?(value: NotificationDiagnostic): void;
};

let _Notifications: NotificationsModule | null = null;

async function N(): Promise<NotificationsModule> {
  if (_Notifications) return _Notifications;
  _Notifications = await import("expo-notifications");
  return _Notifications;
}

async function isExpoGo(): Promise<boolean> {
  const Constants = (await import("expo-constants")).default;
  return Constants.appOwnership === "expo";
}

async function platformOS(): Promise<string> {
  return (await import("react-native")).Platform.OS;
}

async function defaultReminderOperationRuntime(): Promise<ReminderOperationRuntime> {
  // A personal challenge may already be visible from the UID-scoped cache while
  // Firebase Auth is still restoring currentUser. Journaling must wait for that
  // restoration instead of treating the transient null as a signed-out user.
  const { uid } = await waitForReminderAuthUser(auth);
  return {
    uid,
    isUidCurrent: () => auth.currentUser?.uid === uid,
    expoGo: await isExpoGo(),
    platformOS: await platformOS(),
    Notifications: await N(),
    store: AsyncStorage,
    getCachedState,
    loadState,
    updateState,
    loadNotificationSettings,
    ensureSchedulingReady: ensureReminderPermissions,
    diagnostic: logNotificationDiagnostic,
  };
}

// ---------------- PREMIUM GATE ----------------
let _premiumEnabled = false;

const FREE_MAX_TIMES = 3;
const PREMIUM_MAX_TIMES = 10;
const REMINDER_CHANNEL_ID = "reminders_high_v1";
const REMINDER_DATA_KEY = "oneMoreReminderKey";
const REMINDER_DATA_KIND = "oneMoreReminderKind";
const SHARED_REMINDER_PREFIX = "shared_";
const ROLLING_SCHEDULE_DAYS = 30;

type ReminderKind = "challenge" | "shared";
export type ReminderSchedule = {
  period?: "daily" | "every2" | "custom" | "flexibleWeekly";
  enabled?: boolean;
  /** Notification weekdays only (0=Monday … 6=Sunday), independent of challenge cadence. */
  reminderDays?: number[];
  reminderRows?: FlexibleWeeklyReminderRow[];
  isNewChallenge?: boolean;
  isActiveOnDate: (dateISO: string) => boolean;
};

export function setRemindersPremiumEnabled(v: boolean) {
  _premiumEnabled = !!v;
}

// ---------------- HELPERS ----------------
function parseHHMM(time: string): { hour: number; minute: number } | null {
  const m = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

function reminderKindForId(challengeId: string): ReminderKind {
  return String(challengeId).startsWith(SHARED_REMINDER_PREFIX) ? "shared" : "challenge";
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function reminderPlanningContext(
  now = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
): string {
  return `${localDateISO(now)}|${timeZone}`;
}

function weekdayMon0(dateISO: string): number {
  const [year, month, day] = dateISO.split("-").map(Number);
  const sunday0 = new Date(year, (month ?? 1) - 1, day ?? 1).getDay();
  return (sunday0 + 6) % 7;
}

export function normalizeReminderDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map(Number)
    .filter((day) => Number.isFinite(day) && day >= 0 && day <= 6)
    .map(Math.floor)))
    .sort((a, b) => a - b);
}

export function isReminderDaySelectionValid(
  period: ReminderSchedule["period"],
  enabled: boolean,
  value: unknown,
): boolean {
  return !enabled || period !== "flexibleWeekly" || normalizeReminderDays(value).length > 0;
}

export function isFlexibleReminderRowSelectionValid(
  period: ReminderSchedule["period"],
  enabled: boolean,
  value: unknown,
): boolean {
  return !enabled || period !== "flexibleWeekly" || normalizeFlexibleWeeklyReminderRows(value).length > 0;
}

function dateForISOAndTime(dateISO: string, hour: number, minute: number): Date {
  const [year, month, day] = dateISO.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1, hour, minute, 0, 0);
}

export function reminderScheduleForChallenge(
  challenge: Challenge | undefined | null,
  reminderRowsOverride?: FlexibleWeeklyReminderRow[],
): ReminderSchedule {
  const period =
    challenge?.period === "flexibleWeekly" || challenge?.period === "every2" || challenge?.period === "custom" || challenge?.period === "daily"
      ? challenge.period
      : "daily";

  const reminderRows = migrateFlexibleWeeklyReminderRows(
    reminderRowsOverride ?? challenge?.flexibleReminderRows,
    reminderRowsOverride ? undefined : challenge?.reminderDays,
    challenge?.reminderTimes,
  );
  const reminderDays = reminderRows.length > 0
    ? reminderRows.map((row) => row.weekday - 1)
    : normalizeReminderDays(reminderRowsOverride ? undefined : challenge?.reminderDays);

  return {
    period,
    enabled: !!challenge && challenge.enabled !== false && !challenge.deletedAt,
    reminderDays,
    reminderRows,
    isActiveOnDate: period === "flexibleWeekly"
      ? (dateISO) => reminderRows.some((row) => row.weekday === weekdayMon0(dateISO) + 1)
      : (dateISO) => isChallengeActiveOnDate(challenge ?? null, dateISO),
  };
}

async function resolveReminderSchedule(reminderKey: string, override?: ReminderSchedule): Promise<ReminderSchedule> {
  if (override) return override;

  if (reminderKindForId(reminderKey) === "challenge") {
    const latest = getCachedState() ?? (await loadState());
    const challenge = (latest.challenges ?? []).find((c) => String(c.id) === String(reminderKey));
    return reminderScheduleForChallenge(challenge ?? null);
  }

  return {
    period: "daily",
    enabled: true,
    isActiveOnDate: () => true,
  };
}

function shouldUseDailyTrigger(schedule: ReminderSchedule, now = new Date()): boolean {
  const period = schedule.period ?? "daily";
  return schedule.enabled !== false && period === "daily" && schedule.isActiveOnDate(localDateISO(now));
}

export function plannedReminderDates(
  schedule: ReminderSchedule,
  timesHHMM: string[],
  now = new Date(),
  horizonDays = ROLLING_SCHEDULE_DAYS,
): Date[] {
  if (schedule.enabled === false) return [];
  const parsedTimes = Array.from(new Set(timesHHMM))
    .map(parseHHMM)
    .filter((value): value is { hour: number; minute: number } => !!value);
  const fromISO = localDateISO(now);
  const dates: Date[] = [];

  for (let offset = 0; offset < horizonDays; offset += 1) {
    const dateISO = addDaysISO(fromISO, offset);
    if (!schedule.isActiveOnDate(dateISO)) continue;
    const timesForDate = schedule.period === "flexibleWeekly"
      ? normalizeFlexibleWeeklyReminderRows(schedule.reminderRows)
          .filter((row) => row.weekday === weekdayMon0(dateISO) + 1)
          .map(({ hour, minute }) => ({ hour, minute }))
      : parsedTimes;
    for (const time of timesForDate) {
      const date = dateForISOAndTime(dateISO, time.hour, time.minute);
      if (date.getTime() > now.getTime()) dates.push(date);
    }
  }

  return dates;
}

export function buildReminderTriggerInputs(
  schedule: ReminderSchedule,
  timesHHMM: string[],
  platform: string,
  triggerTypes: Pick<NotificationsModule["SchedulableTriggerInputTypes"], "DAILY" | "DATE">,
  now = new Date(),
  horizonDays = ROLLING_SCHEDULE_DAYS,
): ReturnType<typeof validateExpoNotificationTrigger>[] {
  const parsedTimes = Array.from(new Set(timesHHMM.filter(Boolean)))
    .map((time) => ({ time, parsed: parseHHMM(time) }))
    .filter((item): item is { time: string; parsed: { hour: number; minute: number } } => !!item.parsed);
  const withAndroidChannel = (trigger: Record<string, unknown>): Record<string, unknown> => platform === "android"
    ? { ...trigger, channelId: REMINDER_CHANNEL_ID }
    : trigger;

  if (shouldUseDailyTrigger(schedule, now)) {
    return parsedTimes.map(({ parsed }) => validateExpoNotificationTrigger(withAndroidChannel({
      type: triggerTypes.DAILY,
      hour: parsed.hour,
      minute: parsed.minute,
    }), platform, now));
  }

  const planningTimes = schedule.period === "flexibleWeekly"
    ? normalizeFlexibleWeeklyReminderRows(schedule.reminderRows).map(flexibleReminderRowTime)
    : parsedTimes.map(({ time }) => time);
  return plannedReminderDates(schedule, planningTimes, now, horizonDays).map((date) =>
    validateExpoNotificationTrigger(withAndroidChannel({
      type: triggerTypes.DATE,
      date,
    }), platform, now));
}

export function buildReminderNotificationContent(
  platform: string,
  challengeText: string,
  reminderKey: string,
  reminderKind: ReminderKind,
  operationId: string,
  revision: string | number,
  androidPriority?: NotificationContentInput["priority"],
): NotificationContentInput {
  const content: NotificationContentInput = {
    title: "OneMore",
    body: challengeText || "OneMore",
    sound: platform === "android" ? true : "default",
    ...(platform === "android" ? { priority: androidPriority } : {}),
    data: {
      [REMINDER_DATA_KEY]: reminderKey,
      [REMINDER_DATA_KIND]: reminderKind,
      [REMINDER_OPERATION_DATA_KEY]: operationId,
      [REMINDER_REVISION_DATA_KEY]: revision,
    },
  };
  validateExpoNotificationContent(content, platform);
  return content;
}

export async function recoverReminderNotificationOperations(
  options?: { uid?: string; challengeId?: string },
): Promise<void> {
  const uid = String(options?.uid ?? auth.currentUser?.uid ?? "");
  if (!uid || await isExpoGo()) return;
  const Notifications = await N();
  await recoverReminderOperationsCore({
    uid,
    challengeId: options?.challengeId,
    store: AsyncStorage,
    Notifications,
    loadCanonicalState: loadState,
    isUidCurrent: () => auth.currentUser?.uid === uid,
  });
}

export async function refreshRemindersAfterForeground(
  uid: string,
  operations: {
    recover: (uid: string) => Promise<void>;
    refresh: () => Promise<void>;
  } = {
    recover: (currentUid) => recoverReminderNotificationOperations({ uid: currentUid }),
    refresh: () => refreshScheduledChallengeReminders(),
  },
): Promise<void> {
  if (!uid) return;
  await operations.recover(uid);
  await operations.refresh();
}

let recoveryStarted = false;
let lastReminderPlanningContext = reminderPlanningContext();
export function startReminderNotificationRecovery(): void {
  if (recoveryStarted) return;
  recoveryStarted = true;
  onAuthStateChanged(auth, (user) => {
    if (user?.uid) {
      void recoverReminderNotificationOperations({ uid: user.uid }).catch(() => undefined);
    }
  });
  void import("react-native")
    .then(({ AppState }) => {
      AppState.addEventListener("change", (state) => {
        const uid = auth.currentUser?.uid;
        if (state === "active" && uid) {
          const planningContext = reminderPlanningContext();
          const planningContextChanged = planningContext !== lastReminderPlanningContext;
          lastReminderPlanningContext = planningContext;
          if (planningContextChanged) {
            void refreshRemindersAfterForeground(uid).catch(() => undefined);
          } else {
            void recoverReminderNotificationOperations({ uid }).catch(() => undefined);
          }
        }
      });
    })
    .catch(() => undefined);
}

let handlerSet = false;
async function ensureHandler() {
  if (handlerSet) return;
  if (await isExpoGo()) return;

  const Notifications = await N();

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  handlerSet = true;
}

export async function ensureAndroidReminderChannel(
  Notifications: NotificationsModule,
  platformVersion: number | string,
): Promise<string> {
  const supportsChannels = typeof platformVersion !== "number" || platformVersion >= 26;
  if (!supportsChannels) return REMINDER_CHANNEL_ID;
  if (!(await Notifications.getNotificationChannelAsync(REMINDER_CHANNEL_ID))) {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name: "OneMore reminders",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
  const channel = await Notifications.getNotificationChannelAsync(REMINDER_CHANNEL_ID);
  if (!channel) throw new Error("NOTIFICATIONS_CHANNEL_UNAVAILABLE");
  return REMINDER_CHANNEL_ID;
}

async function ensureAndroidChannel(): Promise<string | undefined> {
  const { Platform } = await import("react-native");
  if (Platform.OS !== "android") return;

  const Notifications = await N();
  return ensureAndroidReminderChannel(Notifications, Platform.Version);
}

function permissionResult(
  Notifications: NotificationsModule,
  settings: Awaited<ReturnType<NotificationsModule["getPermissionsAsync"]>>,
  channelId?: string,
): ReminderPermissionResult {
  const provisional = settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  const granted = settings.granted || provisional;
  const status = granted
    ? "granted"
    : String(settings.status) === "undetermined" ? "undetermined" : "denied";
  return { granted, status, canAskAgain: settings.canAskAgain !== false, channelId };
}

export async function ensureReminderPermissions(): Promise<ReminderPermissionResult> {
  if (await isExpoGo()) return { granted: false, status: "denied", canAskAgain: false };

  const Notifications = await N();
  try {
    await ensureHandler();
  } catch (error) {
    throw attachNotificationFailure(error, "PERMISSION");
  }
  let channelId: string | undefined;
  try {
    channelId = await ensureAndroidChannel();
  } catch (error) {
    throw attachNotificationFailure(error, "CHANNEL");
  }

  let settings: Awaited<ReturnType<NotificationsModule["getPermissionsAsync"]>>;
  try {
    settings = await Notifications.getPermissionsAsync();
  } catch (error) {
    throw attachNotificationFailure(error, "PERMISSION");
  }
  const current = permissionResult(Notifications, settings, channelId);
  if (current.granted || !current.canAskAgain) return current;
  let req: Awaited<ReturnType<NotificationsModule["requestPermissionsAsync"]>>;
  try {
    req = await Notifications.requestPermissionsAsync();
  } catch (error) {
    throw attachNotificationFailure(error, "PERMISSION");
  }
  return permissionResult(Notifications, req, channelId);
}

// ---------------- API ----------------

export type PreparedChallengeReminders = {
  times: string[];
  reminderDays: number[];
  reminderRows: FlexibleWeeklyReminderRow[];
  applyToState: (
    state: AppState,
    updateChallenge?: (challenge: Challenge) => Challenge
  ) => AppState;
  restoreOriginalState: () => Promise<void>;
  rollback: () => Promise<void>;
  finalize: () => Promise<void>;
  reportPhase: (phase: "persist" | "cleanup" | "complete", error?: unknown) => void;
};

export async function prepareChallengeReminders(
  challengeId: string,
  challengeText: string,
  timesHHMM: string[],
  enabled: boolean,
  scheduleOverride?: ReminderSchedule,
  runtimeOverride?: ReminderOperationRuntime,
): Promise<PreparedChallengeReminders> {
  let diagnosticPhase: NotificationSavePhase = "auth";
  let runtime: ReminderOperationRuntime;
  try {
    runtime = runtimeOverride ?? await defaultReminderOperationRuntime();
  } catch (error) {
    throw attachNotificationFailure(error, "AUTH");
  }
  const reminderKey = String(challengeId);
  const uid = runtime.uid;
  const expoGo = runtime.expoGo;
  const currentPlatform = runtime.platformOS;
  const emitDiagnostic = (value: Omit<NotificationDiagnostic, "phase" | "platform" | "challengeId"> = {}) => {
    runtime.diagnostic?.({
      phase: diagnosticPhase,
      platform: currentPlatform,
      challengeId: reminderKindForId(reminderKey),
      ...value,
    });
  };
  if (!expoGo && !uid) {
    throw attachNotificationFailure(new Error("NOTIFICATION_UID_REQUIRED"), "AUTH");
  }
  let releaseMutation: () => void;
  try {
    releaseMutation = uid && !expoGo
      ? await acquireReminderMutationLock(uid)
      : () => undefined;
  } catch (error) {
    throw attachNotificationFailure(error, "AUTH");
  }
  const uidStillCurrent = () => !uid || runtime.isUidCurrent();
  let lastTriggerType: string | undefined;
  let lastSoundType: string | undefined;
  try {
  if (!uidStillCurrent()) throw new Error("NOTIFICATION_UID_CHANGED");
  if (uid && !expoGo) {
    diagnosticPhase = "recovery";
    const Notifications = runtime.Notifications;
    if (!uidStillCurrent()) throw new Error("NOTIFICATION_UID_CHANGED");
    await recoverReminderNotificationOperationsUnlocked({
      uid,
      challengeId: reminderKey,
      store: runtime.store,
      Notifications,
      loadCanonicalState: runtime.loadState,
      isUidCurrent: uidStillCurrent,
    });
    if (!uidStillCurrent()) throw new Error("NOTIFICATION_UID_CHANGED");
  }
  diagnosticPhase = "prepare";
  const schedule = await resolveReminderSchedule(reminderKey, scheduleOverride);
  const reminderRows = schedule.period === "flexibleWeekly"
    ? normalizeFlexibleWeeklyReminderRows(schedule.reminderRows)
    : [];
  const maxTimes = schedule.period === "flexibleWeekly"
    ? 7
    : _premiumEnabled ? PREMIUM_MAX_TIMES : FREE_MAX_TIMES;
  const parsed = Array.from(new Set((timesHHMM ?? []).filter(Boolean)))
    .map((t) => ({ t, p: parseHHMM(t) }))
    .filter((x) => !!x.p)
    .slice(0, maxTimes) as { t: string; p: { hour: number; minute: number } }[];

  if (enabled && schedule.period === "flexibleWeekly" && reminderRows.length === 0) {
    throw new Error("NOTIFICATIONS_FLEXIBLE_ROWS_REQUIRED");
  }
  if (enabled && schedule.period !== "flexibleWeekly" && parsed.length === 0) {
    throw new Error("NOTIFICATIONS_TIME_REQUIRED");
  }

  const latest = runtime.getCachedState() ?? (await runtime.loadState());
  const challengeMissing = !(latest.challenges ?? []).some((challenge) => String(challenge.id) === reminderKey);
  const isNewChallenge = schedule.isNewChallenge === true;
  emitDiagnostic({ period: schedule.period, isNewChallenge });
  if (
    reminderKindForId(reminderKey) === "challenge" &&
    challengeMissing &&
    (!isNewChallenge || !isStableChallengeId(reminderKey))
  ) {
    throw new Error("NOTIFICATION_CHALLENGE_NOT_PERSISTED");
  }
  const reminderDays = schedule.period === "flexibleWeekly"
    ? reminderRows.map((row) => row.weekday - 1)
    : [];
  const oldIds = [...(latest.reminderNotifIds?.[reminderKey] ?? [])];
  if (enabled && !_premiumEnabled && reminderKindForId(reminderKey) === "challenge") {
    const otherActive = (latest.challenges ?? []).some((challenge) =>
      String(challenge.id) !== reminderKey && challenge.reminderEnabled === true);
    if (otherActive) throw new Error("NOTIFICATION_FREE_LIMIT");
  }
  const notificationSettings = await runtime.loadNotificationSettings();
  const shouldSchedule = enabled && schedule.enabled !== false && notificationSettings.challengeReminders;
  const newIds: string[] = [];
  let Notifications: NotificationsModule | null = null;
  let journal: ReminderOperationJournal | null = null;

  const createJournal = async () => {
    if (!uid || journal) return;
    if (!uidStillCurrent()) throw new Error("NOTIFICATION_UID_CHANGED");
    journal = createReminderOperationJournal({
      uid,
      challengeId: reminderKey,
      enabled,
      originalIds: oldIds,
    });
    await writeReminderOperationJournal(journal, runtime.store, uidStillCurrent);
    if (!uidStillCurrent()) throw new Error("NOTIFICATION_UID_CHANGED");
  };

  const queueOperationCleanup = async (includeTagged: boolean) => {
    if (!journal || !Notifications) return;
    if (!uidStillCurrent()) return;
    await enqueueReminderCleanup({
      operationId: journal.operationId,
      uid: journal.uid,
      challengeId: reminderKey,
      ids: [...newIds],
      includeOperationTaggedNotifications: includeTagged,
      createdAtISO: journal.createdAtISO,
    }, runtime.store, uidStillCurrent);
    if (!uidStillCurrent()) return;
    await processReminderCleanupQueue({
      uid: journal.uid,
      store: runtime.store,
      Notifications,
      isUidCurrent: uidStillCurrent,
    }, reminderKey);
    if (!uidStillCurrent()) return;
    const remaining = await readReminderCleanupQueue(journal.uid, runtime.store);
    if (!uidStillCurrent()) return;
    if (!remaining.some((item) => item.operationId === journal!.operationId && item.challengeId === reminderKey)) {
      await removeReminderOperationJournal(journal.uid, journal.operationId, runtime.store, uidStillCurrent);
    }
  };

  if (shouldSchedule) {
    if (expoGo) throw new Error("NOTIFICATIONS_EXPO_GO_UNSUPPORTED");

    Notifications = runtime.Notifications;
    diagnosticPhase = "triggerValidation";
    const channelAwareTriggers = buildReminderTriggerInputs(
      schedule,
      parsed.map(({ t }) => t),
      currentPlatform,
      Notifications.SchedulableTriggerInputTypes,
    );

    for (const trigger of channelAwareTriggers) {
      emitDiagnostic({ period: schedule.period, isNewChallenge, channelId: currentPlatform === "android" ? REMINDER_CHANNEL_ID : undefined, trigger: sanitizeNotificationTrigger(trigger) });
      if (typeof Notifications.getNextTriggerDateAsync === "function") {
        try {
          // Expo uses the same parseTrigger() for this preflight and for
          // scheduleNotificationAsync. A native preflight failure is diagnostic,
          // not an OS mutation, so it must not prevent the real scheduler from
          // accepting the exact same already-validated object.
          const next = await Notifications.getNextTriggerDateAsync(trigger);
          if (!Number.isFinite(next) || Number(next) <= Date.now()) {
            const failure = attachNotificationFailure(
              new Error("NOTIFICATIONS_INVALID_NEXT_TRIGGER_DATE"),
              "PREFLIGHT",
            );
            emitDiagnostic({
              period: schedule.period,
              isNewChallenge,
              channelId: currentPlatform === "android" ? REMINDER_CHANNEL_ID : undefined,
              trigger: sanitizeNotificationTrigger(trigger),
              error: notificationError(failure),
            });
          }
        } catch (error) {
          const failure = attachNotificationFailure(error, "PREFLIGHT");
          emitDiagnostic({
            period: schedule.period,
            isNewChallenge,
            channelId: currentPlatform === "android" ? REMINDER_CHANNEL_ID : undefined,
            trigger: sanitizeNotificationTrigger(trigger),
            error: notificationError(failure),
          });
        }
      }
    }

    diagnosticPhase = "channel";
    const readiness = await runtime.ensureSchedulingReady();
    const permission = typeof readiness === "boolean"
      ? { granted: readiness, status: readiness ? "granted" as const : "denied" as const, canAskAgain: false }
      : readiness;
    emitDiagnostic({ period: schedule.period, isNewChallenge, channelId: permission.channelId });
    diagnosticPhase = "permission";
    emitDiagnostic({ period: schedule.period, isNewChallenge, permission: permission.status, channelId: permission.channelId });
    if (!permission.granted) {
      throw attachNotificationFailure(
        new Error(permission.status === "undetermined"
          ? "NOTIFICATIONS_PERMISSION_UNDETERMINED"
          : "NOTIFICATIONS_PERMISSION_DENIED"),
        "PERMISSION",
      );
    }

    diagnosticPhase = "journal";
    await createJournal();
    if (!uidStillCurrent()) throw new Error("NOTIFICATION_UID_CHANGED");
    await updateReminderOperationJournal(uid, journal!.operationId, (current) => ({
      ...current,
      phase: "scheduling",
    }), runtime.store, uidStillCurrent);
    if (!uidStillCurrent()) throw new Error("NOTIFICATION_UID_CHANGED");
    try {
      for (const trigger of channelAwareTriggers) {
        diagnosticPhase = "schedule";
        if (!uidStillCurrent()) throw new Error("NOTIFICATION_UID_CHANGED");
        const content = buildReminderNotificationContent(
          currentPlatform,
          challengeText,
          reminderKey,
          reminderKindForId(reminderKey),
          journal!.operationId,
          journal!.revision,
          Notifications.AndroidNotificationPriority.HIGH,
        );
        lastTriggerType = String((trigger as unknown as { type?: unknown })?.type ?? "immediate");
        lastSoundType = typeof content.sound;
        let id: string;
        try {
          id = await Notifications.scheduleNotificationAsync({ content, trigger });
        } catch (error) {
          throw attachNotificationFailure(error, "SCHEDULE", {
            platform: currentPlatform,
            triggerType: lastTriggerType,
            soundType: lastSoundType,
          });
        }
        if (!uidStillCurrent()) throw new Error("NOTIFICATION_UID_CHANGED");
        newIds.push(String(id));
        await updateReminderOperationJournal(uid, journal!.operationId, (current) => ({
          ...current,
          newIds: [...newIds],
          phase: "scheduling",
        }), runtime.store, uidStillCurrent);
        if (!uidStillCurrent()) throw new Error("NOTIFICATION_UID_CHANGED");
      }
      if (!uidStillCurrent()) throw new Error("NOTIFICATION_UID_CHANGED");
      await updateReminderOperationJournal(uid, journal!.operationId, (current) => ({
        ...current,
        newIds: [...newIds],
        phase: "scheduled",
      }), runtime.store, uidStillCurrent);
      if (!uidStillCurrent()) throw new Error("NOTIFICATION_UID_CHANGED");
    } catch (error) {
      if (uidStillCurrent()) {
        await updateReminderOperationJournal(uid, journal!.operationId, (current) => ({
          ...current,
          newIds: [...newIds],
          phase: "rollingBack",
        }), runtime.store, uidStillCurrent).catch(() => null);
      }
      if (uidStillCurrent()) await queueOperationCleanup(true).catch(() => undefined);
      throw error;
    }
  } else if (!expoGo) {
    Notifications = runtime.Notifications;
    diagnosticPhase = "journal";
    await createJournal();
    if (!uidStillCurrent()) throw new Error("NOTIFICATION_UID_CHANGED");
    await updateReminderOperationJournal(uid, journal!.operationId, (current) => ({
      ...current,
      phase: "scheduled",
    }), runtime.store, uidStillCurrent);
    if (!uidStillCurrent()) throw new Error("NOTIFICATION_UID_CHANGED");
  }

  let rolledBack = false;
  let finalized = false;
  const times = schedule.period === "flexibleWeekly"
    ? reminderRows.map(flexibleReminderRowTime)
    : parsed.map((item) => item.t);

  return {
    times,
    reminderDays,
    reminderRows,
    reportPhase: (phase, error) => {
      diagnosticPhase = phase;
      emitDiagnostic({
        period: schedule.period,
        isNewChallenge,
        ...(error === undefined ? {} : { error: notificationError(error) }),
      });
    },
    applyToState: (state, updateChallenge) => {
      if (!uidStillCurrent()) throw new Error("NOTIFICATION_UID_CHANGED");
      const nextMap = { ...(state.reminderNotifIds ?? {}) };
      if (enabled && newIds.length > 0) nextMap[reminderKey] = [...newIds];
      else delete nextMap[reminderKey];

      return {
        ...state,
        challenges: (state.challenges ?? []).map((challenge) => {
          if (String(challenge.id) !== reminderKey) return challenge;
          const updated = updateChallenge ? updateChallenge(challenge) : challenge;
          return {
            ...updated,
            reminderEnabled: enabled,
            reminderTimes: enabled ? times : [],
            reminderDays: updated.period === "flexibleWeekly"
              ? (enabled ? reminderDays : [])
              : updated.reminderDays,
            flexibleReminderRows: updated.period === "flexibleWeekly"
              ? (enabled ? reminderRows : [])
              : updated.flexibleReminderRows,
          };
        }),
        reminderNotifIds: nextMap,
      };
    },
    restoreOriginalState: async () => {
      if (!uidStillCurrent()) throw new Error("NOTIFICATION_UID_CHANGED");
      await runtime.updateState(() => latest);
    },
    rollback: async () => {
      if (rolledBack || finalized) return;
      rolledBack = true;
      try {
        if (!uidStillCurrent() || !journal || !Notifications) return;
        await updateReminderOperationJournal(journal.uid, journal.operationId, (current) => ({
          ...current,
          newIds: [...newIds],
          phase: "rollingBack",
        }), runtime.store, uidStillCurrent).catch(() => null);
        if (!uidStillCurrent()) return;
        await queueOperationCleanup(true).catch(() => undefined);
      } finally {
        releaseMutation();
      }
    },
    finalize: async () => {
      if (finalized || rolledBack) return;
      finalized = true;
      try {
        diagnosticPhase = "cleanup";
        if (!uidStillCurrent() || !journal || !Notifications) return;
        await updateReminderOperationJournal(journal.uid, journal.operationId, (current) => ({
          ...current,
          newIds: [...newIds],
          phase: "persisted",
        }), runtime.store, uidStillCurrent);
        if (!uidStillCurrent()) return;
        await enqueueReminderCleanup({
          operationId: journal.operationId,
          uid: journal.uid,
          challengeId: reminderKey,
          ids: oldIds,
          includeOperationTaggedNotifications: false,
          createdAtISO: journal.createdAtISO,
        }, runtime.store, uidStillCurrent);
        if (!uidStillCurrent()) return;
        await updateReminderOperationJournal(journal.uid, journal.operationId, (current) => ({
          ...current,
          phase: "cleaningOld",
        }), runtime.store, uidStillCurrent);
        if (!uidStillCurrent()) return;
        await processReminderCleanupQueue({
          uid: journal.uid,
          store: runtime.store,
          Notifications,
          isUidCurrent: uidStillCurrent,
        }, reminderKey);
        if (!uidStillCurrent()) return;
        const remaining = await readReminderCleanupQueue(journal.uid, runtime.store);
        if (!uidStillCurrent()) return;
        if (!remaining.some((item) => item.operationId === journal!.operationId && item.challengeId === reminderKey)) {
          await removeReminderOperationJournal(journal.uid, journal.operationId, runtime.store, uidStillCurrent);
          if (!uidStillCurrent()) return;
        }
      } finally {
        releaseMutation();
      }
    },
  };
  } catch (error) {
    const failure = attachNotificationFailure(error, diagnosticPhase);
    emitDiagnostic({
      error: notificationError(failure),
      ...(lastTriggerType ? { triggerType: lastTriggerType } : {}),
      ...(lastSoundType ? { soundType: lastSoundType } : {}),
    });
    releaseMutation();
    throw failure;
  }
}

export type PersonalReminderWorkflowOptions = {
  challengeId: string;
  challengeText: string;
  timesHHMM: string[];
  enabled: boolean;
  scheduleOverride?: ReminderSchedule;
  runtimeOverride?: ReminderOperationRuntime;
  ensureChallengePersisted?: () => Promise<void>;
  persist: (prepared: PreparedChallengeReminders) => Promise<void>;
};

/** The complete production path used by both personal-challenge editors. */
export async function savePersonalReminderWorkflow(
  options: PersonalReminderWorkflowOptions,
): Promise<PreparedChallengeReminders> {
  if (options.ensureChallengePersisted) {
    try {
      await options.ensureChallengePersisted();
    } catch (error) {
      throw attachNotificationFailure(error, "STATE");
    }
  }
  const prepared = await prepareChallengeReminders(
    options.challengeId,
    options.challengeText,
    options.timesHHMM,
    options.enabled,
    options.scheduleOverride,
    options.runtimeOverride,
  );
  try {
    await commitPreparedNotificationChange({
      persist: async () => { await options.persist(prepared); },
      restore: prepared.restoreOriginalState,
      rollback: prepared.rollback,
      finalize: prepared.finalize,
      onPhase: prepared.reportPhase,
    });
  } catch (error) {
    throw attachNotificationFailure(error, "PERSIST");
  }
  return prepared;
}

export async function setDailyRemindersForChallenge(
  challengeId: string,
  challengeText: string,
  timesHHMM: string[],
  scheduleOverride?: ReminderSchedule
): Promise<void> {
  await savePersonalReminderWorkflow({
    challengeId,
    challengeText,
    timesHHMM,
    enabled: true,
    scheduleOverride,
    persist: async (prepared) => {
      await updateState((state) => prepared.applyToState(state));
    },
  });
}

export async function clearDailyRemindersForChallenge(challengeId: string): Promise<void> {
  await savePersonalReminderWorkflow({
    challengeId,
    challengeText: "OneMore",
    timesHHMM: [],
    enabled: false,
    persist: async (prepared) => {
      await updateState((state) => prepared.applyToState(state));
    },
  });
}

export function getFreeActiveReminderChallengeId(state: any): string | null {
  if (_premiumEnabled) return null;

  const ch = (state?.challenges ?? []) as any[];
  const active = ch.find((c) => c?.reminderEnabled);

  return active ? String(active.id) : null;
}

export async function refreshScheduledChallengeReminders(): Promise<void> {
  const notificationSettings = await loadNotificationSettings();
  if (!notificationSettings.challengeReminders) {
    await cancelScheduledChallengeReminderNotifications();
    return;
  }

  const latest = getCachedState() ?? (await loadState());

  for (const challenge of latest.challenges ?? []) {
    const id = String(challenge?.id ?? "");
    if (!id) continue;
    const hasScheduledIds = ((latest.reminderNotifIds ?? {})[id] ?? []).length > 0;

    const times = Array.isArray(challenge?.reminderTimes)
      ? challenge.reminderTimes.filter((time) => typeof time === "string" && parseHHMM(time))
      : [];
    const flexibleRows = challenge.period === "flexibleWeekly"
      ? migrateFlexibleWeeklyReminderRows(challenge.flexibleReminderRows, challenge.reminderDays, times)
      : [];
    const hasValidConfiguration = challenge.period === "flexibleWeekly"
      ? flexibleRows.length > 0
      : times.length > 0;

    if (challenge?.reminderEnabled && challenge.enabled !== false && !challenge.deletedAt && hasValidConfiguration) {
      await setDailyRemindersForChallenge(id, String(challenge.text ?? "OneMore"), times, reminderScheduleForChallenge(challenge));
    } else if (challenge?.reminderEnabled || hasScheduledIds) {
      await clearDailyRemindersForChallenge(id);
    }
  }
}

export async function cancelScheduledChallengeReminderNotifications(
  runtimeOverride?: ReminderOperationRuntime,
): Promise<void> {
  await cancelScheduledReminderKinds(new Set<ReminderKind>(["challenge", "shared"]), runtimeOverride);
}

export async function cancelScheduledPersonalReminderNotifications(
  runtimeOverride?: ReminderOperationRuntime,
): Promise<void> {
  await cancelScheduledReminderKinds(new Set<ReminderKind>(["challenge"]), runtimeOverride);
}

async function cancelScheduledReminderKinds(
  kinds: Set<ReminderKind>,
  runtimeOverride?: ReminderOperationRuntime,
): Promise<void> {
  const runtime = runtimeOverride ?? await defaultReminderOperationRuntime();
  if (runtime.expoGo) return;
  const uid = runtime.uid;
  if (!uid) return;
  const release = await acquireReminderMutationLock(uid);
  const isUidCurrent = runtime.isUidCurrent;
  try {
    if (!isUidCurrent()) return;
    const Notifications = runtime.Notifications;
    if (!isUidCurrent()) return;
    await recoverReminderNotificationOperationsUnlocked({
      uid,
      store: runtime.store,
      Notifications,
      loadCanonicalState: runtime.loadState,
      isUidCurrent,
    });
    if (!isUidCurrent()) return;

    const latest = runtime.getCachedState() ?? (await runtime.loadState());
    if (!isUidCurrent()) return;
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    if (!isUidCurrent()) return;
    const idsByChallenge = new Map<string, Set<string>>();
    const addIds = (challengeId: string, ids: string[]) => {
      if (!challengeId) return;
      const current = idsByChallenge.get(challengeId) ?? new Set<string>();
      ids.forEach((id) => { if (id) current.add(String(id)); });
      idsByChallenge.set(challengeId, current);
    };

    for (const [challengeId, ids] of Object.entries(latest.reminderNotifIds ?? {})) {
      if (kinds.has(reminderKindForId(challengeId))) addIds(String(challengeId), ids ?? []);
    }
    for (const item of scheduled) {
      const id = String((item as any)?.identifier ?? "");
      const data = ((item as any)?.content?.data ?? {}) as Record<string, unknown>;
      const kind = String(data[REMINDER_DATA_KIND] ?? "") as ReminderKind;
      const challengeId = String(data[REMINDER_DATA_KEY] ?? "");
      const operationId = String(data[REMINDER_OPERATION_DATA_KEY] ?? "");
      const belongsToCurrentState = idsByChallenge.get(challengeId)?.has(id) === true;
      const belongsToCurrentUid = operationId.startsWith(`${uid}:`);
      if (id && challengeId && kinds.has(kind) && (belongsToCurrentState || belongsToCurrentUid)) {
        addIds(challengeId, [id]);
      }
    }

    const operations: ReminderOperationJournal[] = [];
    for (const [challengeId, ids] of idsByChallenge) {
      if (!ids.size || !isUidCurrent()) return;
      const operation = {
        ...createReminderOperationJournal({
          uid,
          challengeId,
          enabled: true,
          originalIds: [...ids],
        }),
        phase: "cleaningOld" as const,
      };
      await writeReminderOperationJournal(operation, runtime.store, isUidCurrent);
      if (!isUidCurrent()) return;
      await enqueueReminderCleanup({
        operationId: operation.operationId,
        uid,
        challengeId,
        ids: [...ids],
        includeOperationTaggedNotifications: false,
        createdAtISO: operation.createdAtISO,
      }, runtime.store, isUidCurrent);
      if (!isUidCurrent()) return;
      operations.push(operation);
    }

    // Every affected set is durable before the first OS cancellation begins.
    for (const operation of operations) {
      if (!isUidCurrent()) return;
      await processReminderCleanupQueue({
        uid,
        store: runtime.store,
        Notifications,
        isUidCurrent,
      }, operation.challengeId);
      if (!isUidCurrent()) return;
      const remaining = await readReminderCleanupQueue(uid, runtime.store);
      if (!isUidCurrent()) return;
      if (!remaining.some((item) => item.operationId === operation.operationId && item.challengeId === operation.challengeId)) {
        await removeReminderOperationJournal(uid, operation.operationId, runtime.store, isUidCurrent);
        if (!isUidCurrent()) return;
      }
    }
  } finally {
    release();
  }
}

export const setDailyReminderForChallenge = async (
  challengeId: string,
  challengeText: string,
  timeHHMM: string
) => setDailyRemindersForChallenge(challengeId, challengeText, [timeHHMM]);

export const clearDailyReminderForChallenge = clearDailyRemindersForChallenge;
