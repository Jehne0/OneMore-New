export const IS_PREMIUM = false; // zatím free
export const FREE_MAX_CHALLENGES = 2;

export function getPlanAccessibleChallengeIds(
  challenges: Array<{ id: string | number; deletedAt?: string }> | null | undefined,
  premium: boolean,
): Set<string> {
  const ids = (challenges ?? [])
    .filter((challenge) => !challenge?.deletedAt)
    .map((challenge) => String(challenge.id));
  return new Set(premium ? ids : ids.slice(0, FREE_MAX_CHALLENGES));
}
