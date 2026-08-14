import { ChallengeStats } from "./storage";

export type MedalTier = "none" | "brambora" | "steel" | "bronze" | "silver" | "gold" | "diamond";

export const MEDAL_THRESHOLDS: Array<{ tier: Exclude<MedalTier, "none">; days: number }> = [
  { tier: "diamond", days: 90 },
  { tier: "gold", days: 60 },
  { tier: "silver", days: 30 },
  { tier: "bronze", days: 20 },
  { tier: "steel", days: 10 },
  { tier: "brambora", days: 5 },
];

export const MEDAL_CYCLE_DAYS = 90;

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
export type EarnedMedalTier = Exclude<MedalTier, "none">;

export type MedalChallengeEntry = {
  challengeId: string;
  tier: EarnedMedalTier;
  bestStreak: number;
};

export function emptyMedalCounts(): MedalCounts {
  return { brambora: 0, steel: 0, bronze: 0, silver: 0, gold: 0, diamond: 0 };
}

export function medalChallengesFromStats(
  stats?: Record<string, ChallengeStats>,
  challengeIds?: Iterable<string>
): MedalChallengeEntry[] {
  const entries: MedalChallengeEntry[] = [];
  const map = stats ?? {};
  const allowedIds = challengeIds
    ? new Set(Array.from(challengeIds).map(String))
    : null;

  for (const id of Object.keys(map)) {
    if (allowedIds && !allowedIds.has(String(id))) continue;

    const bestStreak = safeStreak(Number(map[id]?.bestStreak ?? 0));
    const tier = tierForBestStreak(bestStreak);
    if (tier === "none") continue;

    entries.push({ challengeId: String(id), tier, bestStreak });
  }

  return entries;
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
  for (const entry of medalChallengesFromStats(stats, activeChallengeIds)) {
    counts[entry.tier] += 1;
  }

  return counts;
}
