import AsyncStorage from "@react-native-async-storage/async-storage";

export type SharedNotificationSetting = {
  enabled: boolean;
  count: number;
  times: string[];
  friendCompletedSharedChallenge: boolean;
};

const KEY = "onemore_shared_notification_settings";
const MAX_SHARED_NOTIFICATION_TIMES = 10;
const VALID_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const DEFAULT_SHARED_NOTIFICATION_SETTING: SharedNotificationSetting = {
  enabled: false,
  count: 1,
  times: [],
  friendCompletedSharedChallenge: true,
};

export function normalizeSharedNotificationSetting(value: unknown): SharedNotificationSetting {
  const record = value && typeof value === "object"
    ? value as Partial<SharedNotificationSetting>
    : {};
  const rawCount = Number(record.count);
  const count = Number.isFinite(rawCount)
    ? Math.min(MAX_SHARED_NOTIFICATION_TIMES, Math.max(1, Math.floor(rawCount)))
    : 1;
  const times = Array.isArray(record.times)
    ? Array.from(new Set(record.times
        .map((time) => String(time ?? "").trim())
        .filter((time) => VALID_TIME.test(time))))
        .slice(0, count)
    : [];
  return {
    enabled: record.enabled === true,
    count,
    times,
    friendCompletedSharedChallenge: record.friendCompletedSharedChallenge !== false,
  };
}

export async function loadSharedNotificationSettings(): Promise<
  Record<string, SharedNotificationSetting>
> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([id, setting]) => [
      String(id),
      normalizeSharedNotificationSetting(setting),
    ]));
  } catch {
    return {};
  }
}

export async function saveSharedNotificationSetting(
  sharedChallengeId: string,
  setting: SharedNotificationSetting
) {
  const all = await loadSharedNotificationSettings();

  const next = {
    ...all,
    [sharedChallengeId]: normalizeSharedNotificationSetting(setting),
  };

  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

export async function loadSharedNotificationSetting(
  sharedChallengeId: string
): Promise<SharedNotificationSetting> {
  const all = await loadSharedNotificationSettings();

  return normalizeSharedNotificationSetting(all[sharedChallengeId]);
}
export async function hasOtherActiveSharedNotification(
  currentSharedChallengeId: string
): Promise<boolean> {
  const all = await loadSharedNotificationSettings();

  return Object.entries(all).some(([id, setting]) => {
    if (String(id) === String(currentSharedChallengeId)) return false;
    return setting?.enabled === true;
  });
}

export async function hasAnyActiveSharedNotification(): Promise<boolean> {
  const all = await loadSharedNotificationSettings();

  return Object.values(all).some((setting) => {
    return setting?.enabled === true;
  });
}
