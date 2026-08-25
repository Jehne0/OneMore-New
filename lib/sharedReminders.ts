import {
  cancelScheduledChallengeReminderNotifications,
  clearDailyRemindersForChallenge,
  setDailyRemindersForChallenge,
} from "./reminders";
import { getCachedState, loadState } from "./storage";
import { isSharedChallengeActiveOnDate, type SharedChallenge } from "./sharedChallenges";
import { loadNotificationSettings } from "./notificationSettings";
import {
  loadSharedNotificationSetting,
  loadSharedNotificationSettings,
  normalizeSharedNotificationSetting,
  saveSharedNotificationSetting,
  type SharedNotificationSetting,
} from "./sharedNotificationSettings";

const SHARED_PREFIX = "shared_";

export function sharedReminderId(sharedChallengeId: string) {
  return `${SHARED_PREFIX}${sharedChallengeId}`;
}

export async function setSharedRemindersForChallenge(
  sharedChallengeId: string,
  title: string,
  times: string[],
  challenge?: SharedChallenge
) {
  const id = sharedReminderId(sharedChallengeId);

  await setDailyRemindersForChallenge(
    id,
    title,
    times,
    challenge
      ? {
          period: challenge.period,
          enabled: challenge.enabled !== false && challenge.status === "active",
          isActiveOnDate: (dateISO) => isSharedChallengeActiveOnDate(challenge, dateISO),
        }
      : undefined
  );
}

export async function clearSharedRemindersForChallenge(
  sharedChallengeId: string
) {
  const id = sharedReminderId(sharedChallengeId);

  await clearDailyRemindersForChallenge(id);
}

export type SharedReminderWorkflowRuntime = {
  loadSetting: typeof loadSharedNotificationSetting;
  persistSetting: typeof saveSharedNotificationSetting;
  setReminders: typeof setSharedRemindersForChallenge;
  clearReminders: typeof clearSharedRemindersForChallenge;
};

/**
 * Saves the shared reminder preference before touching native iOS scheduling.
 * If native scheduling fails, the previous preference is restored. Only one
 * native reminder mutation is used, so rapid editor actions cannot create a
 * clear-then-schedule gap.
 */
export async function saveSharedReminderWorkflow(options: {
  challenge: SharedChallenge;
  setting: SharedNotificationSetting;
  previousSetting?: SharedNotificationSetting;
  runtime?: SharedReminderWorkflowRuntime;
}): Promise<SharedNotificationSetting> {
  const challengeId = String(options.challenge?.id ?? "").trim();
  if (!challengeId) throw new Error("SHARED_NOTIFICATION_CHALLENGE_REQUIRED");
  const runtime = options.runtime ?? {
    loadSetting: loadSharedNotificationSetting,
    persistSetting: saveSharedNotificationSetting,
    setReminders: setSharedRemindersForChallenge,
    clearReminders: clearSharedRemindersForChallenge,
  };
  const next = normalizeSharedNotificationSetting(options.setting);
  if (next.enabled && next.times.length === 0) {
    throw new Error("NOTIFICATIONS_TIME_REQUIRED");
  }
  const previous = normalizeSharedNotificationSetting(
    options.previousSetting ?? await runtime.loadSetting(challengeId),
  );

  await runtime.persistSetting(challengeId, next);
  try {
    if (next.enabled) {
      await runtime.setReminders(
        challengeId,
        options.challenge.title ?? "Shared challenge",
        next.times,
        options.challenge,
      );
    } else {
      await runtime.clearReminders(challengeId);
    }
  } catch (error) {
    await runtime.persistSetting(challengeId, previous).catch(() => undefined);
    throw error;
  }
  return next;
}

export async function refreshScheduledSharedReminders(challenges: SharedChallenge[]): Promise<void> {
  const notificationSettings = await loadNotificationSettings();
  if (!notificationSettings.challengeReminders) {
    await cancelScheduledChallengeReminderNotifications();
    return;
  }

  const settings = await loadSharedNotificationSettings();
  const byId = new Map((challenges ?? []).map((challenge) => [String(challenge.id), challenge]));

  for (const [sharedChallengeId, setting] of Object.entries(settings)) {
    const challenge = byId.get(String(sharedChallengeId));
    const times = Array.isArray(setting?.times) ? setting.times.filter(Boolean) : [];

    if (challenge && setting?.enabled && times.length && challenge.enabled !== false && challenge.status === "active") {
      await setSharedRemindersForChallenge(sharedChallengeId, challenge.title ?? "Shared challenge", times, challenge);
    } else {
      await clearSharedRemindersForChallenge(sharedChallengeId);
    }
  }

  const state = getCachedState() ?? (await loadState());
  const liveKeys = new Set((challenges ?? []).map((challenge) => sharedReminderId(challenge.id)));
  for (const key of Object.keys(state.reminderNotifIds ?? {})) {
    if (!String(key).startsWith(SHARED_PREFIX)) continue;
    if (liveKeys.has(String(key))) continue;
    await clearDailyRemindersForChallenge(String(key));
  }
}
