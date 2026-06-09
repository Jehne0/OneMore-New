import { Platform } from "react-native";
import Constants from "expo-constants";
import { getCachedState, loadState } from "./storage";
import { updateState } from "./storage";

type NotificationsModule = typeof import("expo-notifications");

let _Notifications: NotificationsModule | null = null;

async function N(): Promise<NotificationsModule> {
  if (_Notifications) return _Notifications;
  _Notifications = await import("expo-notifications");
  return _Notifications;
}

function isExpoGo(): boolean {
  return Constants.appOwnership === "expo";
}

// ---------------- PREMIUM GATE ----------------
let _premiumEnabled = false;

const FREE_MAX_TIMES = 3;
const PREMIUM_MAX_TIMES = 10;
const REMINDER_CHANNEL_ID = "reminders_high_v1";
const REMINDER_DATA_KEY = "oneMoreReminderKey";
const REMINDER_DATA_KIND = "oneMoreReminderKind";
const SHARED_REMINDER_PREFIX = "shared_";

type ReminderKind = "challenge" | "shared";

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

async function cancelReminderNotifications(
  Notifications: NotificationsModule,
  reminderKey: string,
  ids: string[]
): Promise<void> {
  const cancelled = new Set<string>();

  for (const nid of ids ?? []) {
    if (!nid || cancelled.has(String(nid))) continue;
    try {
      await Notifications.cancelScheduledNotificationAsync(String(nid));
      cancelled.add(String(nid));
    } catch {}
  }

  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const item of scheduled) {
      const id = String((item as any)?.identifier ?? "");
      const data = ((item as any)?.content?.data ?? {}) as Record<string, unknown>;
      if (!id || cancelled.has(id)) continue;
      if (String(data[REMINDER_DATA_KEY] ?? "") !== String(reminderKey)) continue;

      try {
        await Notifications.cancelScheduledNotificationAsync(id);
        cancelled.add(id);
      } catch {}
    }
  } catch {}
}

let handlerSet = false;
async function ensureHandler() {
  if (handlerSet) return;
  if (isExpoGo()) return;

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

let channelReady = false;
async function ensureAndroidChannel() {
  if (Platform.OS !== "android") return;
  if (channelReady) return;

  const Notifications = await N();

  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: "OneMore reminders",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });

  channelReady = true;
}

export async function ensureReminderPermissions(): Promise<boolean> {
  if (isExpoGo()) return false;

  const Notifications = await N();
  await ensureHandler();
  await ensureAndroidChannel();

  const settings = await Notifications.getPermissionsAsync();

  if (settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return true;
  }

  const req = await Notifications.requestPermissionsAsync();
  return !!req.granted || req.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

// ---------------- API ----------------

export async function setDailyRemindersForChallenge(
  challengeId: string,
  challengeText: string,
  timesHHMM: string[]
): Promise<void> {
  if (isExpoGo()) {
    throw new Error("NOTIFICATIONS_EXPO_GO_UNSUPPORTED");
  }

  const maxTimes = _premiumEnabled ? PREMIUM_MAX_TIMES : FREE_MAX_TIMES;
  const parsed = Array.from(new Set((timesHHMM ?? []).filter(Boolean)))
    .map((t) => ({ t, p: parseHHMM(t) }))
    .filter((x) => !!x.p)
    .slice(0, maxTimes) as { t: string; p: { hour: number; minute: number } }[];
  if (!parsed.length) return;

  const Notifications = await N();
  const reminderKey = String(challengeId);
  const reminderKind = reminderKindForId(reminderKey);

  await ensureHandler();
  await ensureAndroidChannel();

  const ok = await ensureReminderPermissions();
  if (!ok) throw new Error("NOTIFICATIONS_PERMISSION_DENIED");

  if (!_premiumEnabled) {
    const latest = getCachedState() ?? (await loadState());
    const map = { ...(latest.reminderNotifIds ?? {}) };

    for (const [cid, nids] of Object.entries(map)) {
      if (String(cid) === String(challengeId)) continue;
      if (reminderKindForId(String(cid)) !== reminderKind) continue;

      await cancelReminderNotifications(Notifications, String(cid), nids ?? []);
    }

    await updateState((s) => {
      const nextChallenges = (s.challenges ?? []).map((c) => {
        if (String(c.id) === String(challengeId)) return c;
        if (c.reminderEnabled) return { ...c, reminderEnabled: false, reminderTimes: [] };
        return c;
      });

      const keepOld = (s.reminderNotifIds ?? {})[String(challengeId)] ?? [];
      const nextMap: Record<string, string[]> = {};

      if (keepOld.length) nextMap[String(challengeId)] = keepOld;

      return { ...s, challenges: nextChallenges, reminderNotifIds: nextMap };
    });
  }

  let oldIds: string[] = [];

  await updateState((s) => {
    oldIds = (s.reminderNotifIds?.[String(challengeId)] ?? []) as string[];
    return s;
  });

  await cancelReminderNotifications(Notifications, reminderKey, oldIds);

  const newIds: string[] = [];

  for (const { p } of parsed) {
    const trigger = {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: p.hour,
      minute: p.minute,
    } as any;

    const newId = await Notifications.scheduleNotificationAsync({
      content: {
        title: "OneMore",
        body: challengeText || "Připomínka výzvy",
        sound: "default",
        priority: Notifications.AndroidNotificationPriority.HIGH,
        data: {
          [REMINDER_DATA_KEY]: reminderKey,
          [REMINDER_DATA_KIND]: reminderKind,
        },
        ...(Platform.OS === "android" ? { channelId: REMINDER_CHANNEL_ID } : {}),
      },
      trigger,
    });

    newIds.push(newId);
  }

  await updateState((s) => ({
    ...s,
    challenges: (s.challenges ?? []).map((c) =>
      String(c.id) === String(challengeId)
        ? { ...c, reminderEnabled: true, reminderTimes: parsed.map((x) => x.t) }
        : c
    ),
    reminderNotifIds: {
      ...(s.reminderNotifIds ?? {}),
      [String(challengeId)]: newIds,
    },
  }));
}

export async function clearDailyRemindersForChallenge(challengeId: string): Promise<void> {
  if (isExpoGo()) {
    await updateState((s) => {
      const copy = { ...(s.reminderNotifIds ?? {}) };
      delete copy[String(challengeId)];

      const nextChallenges = (s.challenges ?? []).map((c) =>
        String(c.id) === String(challengeId)
          ? { ...c, reminderEnabled: false, reminderTimes: [] }
          : c
      );

      return { ...s, challenges: nextChallenges, reminderNotifIds: copy };
    });
    return;
  }

  const Notifications = await N();
  const reminderKey = String(challengeId);

  await ensureHandler();
  await ensureAndroidChannel();

  let oldIds: string[] = [];

  await updateState((s) => {
    oldIds = (s.reminderNotifIds?.[String(challengeId)] ?? []) as string[];
    return s;
  });

  await cancelReminderNotifications(Notifications, reminderKey, oldIds);

  await updateState((s) => {
    const copy = { ...(s.reminderNotifIds ?? {}) };
    delete copy[String(challengeId)];

    const nextChallenges = (s.challenges ?? []).map((c) =>
      String(c.id) === String(challengeId)
        ? { ...c, reminderEnabled: false, reminderTimes: [] }
        : c
    );

    return { ...s, challenges: nextChallenges, reminderNotifIds: copy };
  });
}

export function getFreeActiveReminderChallengeId(state: any): string | null {
  if (_premiumEnabled) return null;

  const ch = (state?.challenges ?? []) as any[];
  const active = ch.find((c) => c?.reminderEnabled);

  return active ? String(active.id) : null;
}

export const setDailyReminderForChallenge = async (
  challengeId: string,
  challengeText: string,
  timeHHMM: string
) => setDailyRemindersForChallenge(challengeId, challengeText, [timeHHMM]);

export const clearDailyReminderForChallenge = clearDailyRemindersForChallenge;
