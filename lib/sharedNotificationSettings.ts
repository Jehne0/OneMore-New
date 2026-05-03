import AsyncStorage from "@react-native-async-storage/async-storage";

export type SharedNotificationSetting = {
  enabled: boolean;
  count: number;
  times: string[];
  friendCompletedSharedChallenge: boolean;
};

const KEY = "onemore_shared_notification_settings";

export const DEFAULT_SHARED_NOTIFICATION_SETTING: SharedNotificationSetting = {
  enabled: false,
  count: 1,
  times: [],
  friendCompletedSharedChallenge: true,
};

export async function loadSharedNotificationSettings(): Promise<
  Record<string, SharedNotificationSetting>
> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw);
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
    [sharedChallengeId]: {
      ...DEFAULT_SHARED_NOTIFICATION_SETTING,
      ...setting,
    },
  };

  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

export async function loadSharedNotificationSetting(
  sharedChallengeId: string
): Promise<SharedNotificationSetting> {
  const all = await loadSharedNotificationSettings();

  return {
    ...DEFAULT_SHARED_NOTIFICATION_SETTING,
    ...(all[sharedChallengeId] ?? {}),
  };
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