import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

export type NotificationSettings = {
  challengeReminders: boolean;
  friendRequests: boolean;
  incomingChallenges: boolean;
  sharedChallenges: boolean;
  friendCompletedSharedChallenge: boolean;
};

const KEY = "onemore_notification_settings";

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  challengeReminders: true,
  friendRequests: true,
  incomingChallenges: true,
  sharedChallenges: true,
  friendCompletedSharedChallenge: true,
};

function normalizeNotificationSettings(raw: any): NotificationSettings {
  return {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...(raw && typeof raw === "object" ? raw : {}),
  };
}

async function saveNotificationSettingsToCloud(next: NotificationSettings) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  await setDoc(
    doc(db, "users", uid),
    {
      notificationSettings: next,
      notificationSettingsUpdatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function loadNotificationSettings(): Promise<NotificationSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);

    const settings = raw
      ? normalizeNotificationSettings(JSON.parse(raw))
      : DEFAULT_NOTIFICATION_SETTINGS;

    // Syncne i starší lokální nastavení do Firestore, aby ho viděly Cloud Functions.
    saveNotificationSettingsToCloud(settings).catch((e) => {
      console.log("notification settings cloud sync failed", e);
    });

    return settings;
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

export async function saveNotificationSettings(next: NotificationSettings) {
  const normalized = normalizeNotificationSettings(next);

  await AsyncStorage.setItem(KEY, JSON.stringify(normalized));

  try {
    await saveNotificationSettingsToCloud(normalized);
  } catch (e) {
    console.log("notification settings cloud save failed", e);
  }
}