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
// Free verze: 1 připomínka celkem
let _premiumEnabled = false;

// Limity počtu notifikací za den
const FREE_MAX_TIMES = 3;
const PREMIUM_MAX_TIMES = 10;

/**
 * Zavolej někde při startu appky / po načtení profilu:
 * setRemindersPremiumEnabled(true) pro premium uživatele
 */
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
      shouldPlaySound: false,
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

  try {
    await Notifications.setNotificationChannelAsync("reminders", {
      name: "Reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  } catch {
    // když se nepovede, nepadáme – jen nebude channel
  }

  channelReady = true;
}

export async function ensureReminderPermissions(): Promise<boolean> {
  if (isExpoGo()) return false;
  const Notifications = await N();
  await ensureHandler();

  const settings = await Notifications.getPermissionsAsync();

  if (settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return true;
  }

  const req = await Notifications.requestPermissionsAsync();
  return !!req.granted || req.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

// ---------------- API ----------------

/**
 * Nastaví denní připomínky v daných časech (HH:mm) pro konkrétní výzvu.
 * - Free: povolena 1 výzva s připomínkami celkem (při nastavování nové se ostatní vypnou)
 * - Premium: neomezeně výzev + více časů na výzvu
 *
 * Pozn.: V Expo Go (SDK 53+) plánování notifikací nejde → vyhodí NOTIFICATIONS_EXPO_GO_UNSUPPORTED
 */
export async function setDailyRemindersForChallenge(
  challengeId: string,
  challengeText: string,
  timesHHMM: string[]
): Promise<void> {
  if (isExpoGo()) {
    throw new Error("NOTIFICATIONS_EXPO_GO_UNSUPPORTED");
  }

  // clamp podle plánu (free/premium)
  const maxTimes = _premiumEnabled ? PREMIUM_MAX_TIMES : FREE_MAX_TIMES;
  const times = (timesHHMM ?? []).filter(Boolean).slice(0, maxTimes);
  if (!times.length) return;

  const Notifications = await N();
  await ensureHandler();
  await ensureAndroidChannel();

  const ok = await ensureReminderPermissions();
  if (!ok) return;

  // validace + parse
  const parsed = times
    .map((t) => ({ t, p: parseHHMM(t) }))
    .filter((x) => !!x.p) as { t: string; p: { hour: number; minute: number } }[];
  if (!parsed.length) return;

  // FREE limit: jen 1 výzva s připomínkou → při nastavování nové přesuneme (zrušíme ostatní)
  if (!_premiumEnabled) {
    const latest = getCachedState() ?? (await loadState());
    const map = { ...(latest.reminderNotifIds ?? {}) };

    // zrušit všechny ostatní naplánované notifikace (u jiných výzev)
    for (const [cid, nids] of Object.entries(map)) {
      if (String(cid) === String(challengeId)) continue;
      for (const nid of (nids ?? [])) {
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

  // 1) zrušit staré notifikace této výzvy
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

  // 2) naplánovat nové notifikace pro každý čas
  const newIds: string[] = [];
  for (const { p, t } of parsed) {
    const trigger = {
      hour: p.hour,
      minute: p.minute,
      repeats: true,
    } as any;

    const newId = await Notifications.scheduleNotificationAsync({
      content: {
        title: "OneMore",
        body: challengeText || "Připomínka výzvy",
        ...(Platform.OS === "android" ? { channelId: "reminders" } : {}),
      },
      trigger,
    });

    newIds.push(newId);
  }

  // 3) uložit mapu a challenge flags
  await updateState((s) => ({
    ...s,
    challenges: (s.challenges ?? []).map((c) =>
      String(c.id) === String(challengeId)
        ? { ...c, reminderEnabled: true, reminderTimes: parsed.map((x) => x.t) }
        : c
    ),
    reminderNotifIds: { ...(s.reminderNotifIds ?? {}), [String(challengeId)]: newIds },
  }));
}

/**
 * Vypnutí všech připomínek pro výzvu.
 */
export async function clearDailyRemindersForChallenge(challengeId: string): Promise<void> {
  if (isExpoGo()) return;
  const Notifications = await N();
  await ensureHandler();

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

/**
 * Helper: ve free zjistí, která výzva má aktivní připomínky.
 */
export function getFreeActiveReminderChallengeId(state: any): string | null {
  if (_premiumEnabled) return null;
  const ch = (state?.challenges ?? []) as any[];
  const active = ch.find((c) => c?.reminderEnabled);
  return active ? String(active.id) : null;
}

// Backward-compatible aliases (pokud někde zůstane starý import)
export const setDailyReminderForChallenge = async (challengeId: string, challengeText: string, timeHHMM: string) =>
  setDailyRemindersForChallenge(challengeId, challengeText, [timeHHMM]);
export const clearDailyReminderForChallenge = clearDailyRemindersForChallenge;
