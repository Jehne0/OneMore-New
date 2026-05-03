import {
  clearDailyRemindersForChallenge,
  setDailyRemindersForChallenge,
} from "./reminders";

const SHARED_PREFIX = "shared_";

export function sharedReminderId(sharedChallengeId: string) {
  return `${SHARED_PREFIX}${sharedChallengeId}`;
}

export async function setSharedRemindersForChallenge(
  sharedChallengeId: string,
  title: string,
  times: string[]
) {
  const id = sharedReminderId(sharedChallengeId);

  await setDailyRemindersForChallenge(
    id,
    title,
    times
  );
}

export async function clearSharedRemindersForChallenge(
  sharedChallengeId: string
) {
  const id = sharedReminderId(sharedChallengeId);

  await clearDailyRemindersForChallenge(id);
}