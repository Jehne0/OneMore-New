import {
  clearDailyRemindersForChallenge,
  setDailyRemindersForChallenge,
} from "./reminders";
import { getCachedState, loadState } from "./storage";
import { isSharedChallengeActiveOnDate, type SharedChallenge } from "./sharedChallenges";
import { loadSharedNotificationSettings } from "./sharedNotificationSettings";

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

export async function refreshScheduledSharedReminders(challenges: SharedChallenge[]): Promise<void> {
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
