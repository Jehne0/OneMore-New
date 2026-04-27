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

export function setRemindersPremiumEnabled(v: boolean) {
  _premiumEnabled = !!v;
}

// ---------------- HELPERS ----------------
function parseHHMM(time: string): { hour: number; minute: number } | null {
  const m = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
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
  const times = Array.from(new Set((timesHHMM ?? []).filter(Boolean))).slice(0, maxTimes);
  if (!times.length) return;

  const Notifications = await N();

  await ensureHandler();
  await ensureAndroidChannel();

  const ok = await ensureReminderPermissions();
  if (!ok) return;

  const parsed = times
    .map((t) => ({ t, p: parseHHMM(t) }))
    .filter((x) => !!x.p) as { t: string; p: { hour: number; minute: number } }[];

  if (!parsed.length) return;

  if (!_premiumEnabled) {
    const latest = getCachedState() ?? (await loadState());
    const map = { ...(latest.reminderNotifIds ?? {}) };

    for (const [cid, nids] of Object.entries(map)) {
      if (String(cid) === String(challengeId)) continue;

      for (const nid of nids ?? []) {
        try {
          await Notifications.cancelScheduledNotificationAsync(nid);
        } catch {}
      }
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

  for (const nid of oldIds) {
    try {
      await Notifications.cancelScheduledNotificationAsync(nid);
    } catch {}
  }

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
  if (isExpoGo()) return;

  const Notifications = await N();

  await ensureHandler();
  await ensureAndroidChannel();

  let oldIds: string[] = [];

  await updateState((s) => {
    oldIds = (s.reminderNotifIds?.[String(challengeId)] ?? []) as string[];
    return s;
  });

  for (const nid of oldIds) {
    try {
      await Notifications.cancelScheduledNotificationAsync(nid);
    } catch {}
  }

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