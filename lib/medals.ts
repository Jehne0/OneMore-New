import { ChallengeStats } from "./storage";

export type MedalTier = "none" | "brambora" | "steel" | "bronze" | "silver" | "gold" | "diamond";

export const MEDAL_THRESHOLDS: Array<{ tier: Exclude<MedalTier, "none">; days: number }> = [
  { tier: "diamond", days: 180 },
  { tier: "gold", days: 90 },
  { tier: "silver", days: 30 },
  { tier: "bronze", days: 20 },
  { tier: "steel", days: 10 },
  { tier: "brambora", days: 5 },
];

export const MEDAL_CYCLE_DAYS = 180;

function safeStreak(streak: number): number {
  return Math.max(0, Math.floor(Number.isFinite(streak) ? streak : 0));
}

function tierForCycleDays(days: number): MedalTier {
  const s = safeStreak(days);
  for (const t of MEDAL_THRESHOLDS) {
    if (s >= t.days) return t.tier;
  }
  return "none";
}

export function tierForBestStreak(bestStreak: number): MedalTier {
  const s = safeStreak(bestStreak);
  if (s >= MEDAL_CYCLE_DAYS) return "diamond";
  return tierForCycleDays(s);
}

export type MedalCounts = Record<Exclude<MedalTier, "none">, number>;

export function emptyMedalCounts(): MedalCounts {
  return { brambora: 0, steel: 0, bronze: 0, silver: 0, gold: 0, diamond: 0 };
}

/**
 * Spočítá jednu nejlepší trvale odemčenou medaili za každou výzvu.
 * Vyšší tier nahrazuje nižší; stejná výzva nikdy nepřidá duplicitní medaili.
 */
export function medalCountsFromChallengeStats(
  stats?: Record<string, ChallengeStats>,
  activeChallengeIds?: Iterable<string>
): MedalCounts {
  const counts = emptyMedalCounts();
  const map = stats ?? {};
  const activeIds = activeChallengeIds ? new Set(Array.from(activeChallengeIds).map(String)) : null;

  for (const id of Object.keys(map)) {
    if (activeIds && !activeIds.has(String(id))) continue;
    const s = map[id];
    const bestStreak = safeStreak(Number(s?.bestStreak ?? 0));
    if (bestStreak <= 0) continue;

    const tier = tierForBestStreak(bestStreak);
    if (tier !== "none") counts[tier] += 1;
  }

  return counts;
}
