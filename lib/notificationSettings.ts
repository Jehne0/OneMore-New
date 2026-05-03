import AsyncStorage from "@react-native-async-storage/async-storage";

export type NotificationSettings = {
  challengeReminders: boolean;
  friendRequests: boolean;
  incomingChallenges: boolean;
  sharedChallenges: boolean;
  friendCompletedSharedChallenge: boolean; // ✅ PŘIDAT
};

const KEY = "onemore_notification_settings";

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  challengeReminders: true,
  friendRequests: true,
  incomingChallenges: true,
  sharedChallenges: true,
  friendCompletedSharedChallenge: true, // ✅ PŘIDAT
};

export async function loadNotificationSettings(): Promise<NotificationSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_NOTIFICATION_SETTINGS;

    return {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...JSON.parse(raw),
    };
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

export async function saveNotificationSettings(next: NotificationSettings) {
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}