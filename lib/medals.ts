import { ChallengeStats } from "./storage";

export type MedalTier = "none" | "brambora" | "steel" | "bronze" | "silver" | "gold" | "diamond";

export const MEDAL_THRESHOLDS: Array<{ tier: Exclude<MedalTier, "none">; days: number }> = [
  { tier: "diamond", days: 365 },
  { tier: "gold", days: 180 },
  { tier: "silver", days: 90 },
  { tier: "bronze", days: 45 },
  { tier: "steel", days: 30 },
  { tier: "brambora", days: 10 },
];

export function tierForBestStreak(bestStreak: number): MedalTier {
  const s = Math.max(0, Math.floor(Number.isFinite(bestStreak) ? bestStreak : 0));
  for (const t of MEDAL_THRESHOLDS) {
    if (s >= t.days) return t.tier;
  }
  return "none";
}

export type MedalCounts = Record<Exclude<MedalTier, "none">, number>;

export function emptyMedalCounts(): MedalCounts {
  return { brambora: 0, steel: 0, bronze: 0, silver: 0, gold: 0, diamond: 0 };
}

/**
 * Spočítá počty medailí napříč výzvami.
 * Každá výzva přidá max 1 medaili (tu nejvyšší podle bestStreak).
 */
export function medalCountsFromChallengeStats(
  stats?: Record<string, ChallengeStats>
): MedalCounts {
  const counts = emptyMedalCounts();
  const map = stats ?? {};

  for (const id of Object.keys(map)) {
    const s = map[id];
    const tier = tierForBestStreak(Number(s?.bestStreak ?? 0));
    if (tier === "none") continue;
    counts[tier] = (counts[tier] ?? 0) + 1;
  }

  return counts;
}
