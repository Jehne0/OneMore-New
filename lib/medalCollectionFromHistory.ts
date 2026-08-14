import { addLocalDays, FLEXIBLE_WEEKLY_PERIOD, flexibleWeeklyCompetitiveRuns } from "./flexibleWeekly";
import type { AppState } from "./storage";
import {
  MEDAL_CYCLE_DAYS,
  MEDAL_THRESHOLDS,
  type EarnedMedalTier,
} from "./medals";

export const MEDAL_HISTORY_THRESHOLDS: ReadonlyArray<{ tier: EarnedMedalTier; days: number }> =
  [...MEDAL_THRESHOLDS].reverse();

export const MAX_MEDAL_COUNT_PER_CHALLENGE = 10;

export type MedalHistoryCounts = Record<EarnedMedalTier, number>;

function emptyCounts(): MedalHistoryCounts {
  return { brambora: 0, steel: 0, bronze: 0, silver: 0, gold: 0, diamond: 0 };
}

function safeBestStreak(value: unknown): number {
  const streak = Number(value);
  return Math.max(0, Math.floor(Number.isFinite(streak) ? streak : 0));
}

function earnedMedalCount(bestStreak: number, threshold: number): number {
  if (bestStreak < threshold) return 0;
  return 1 + Math.floor((bestStreak - threshold) / MEDAL_CYCLE_DAYS);
}

function addRunMedals(counts: MedalHistoryCounts, runLength: number) {
  for (const medal of MEDAL_HISTORY_THRESHOLDS) {
    counts[medal.tier] = Math.min(
      counts[medal.tier] + earnedMedalCount(runLength, medal.days),
      MAX_MEDAL_COUNT_PER_CHALLENGE,
    );
  }
}

export function medalCollectionFromHistory(
  state: AppState | null | undefined,
  isActiveOnDate: (challenge: any, dateISO: string) => boolean,
  todayISO: string,
) {
  const stats = state?.challengeStats ?? {};
  const history = state?.history ?? [];
  const challengeIds = new Set<string>(Object.keys(stats).map(String));
  const easyModeChallengeIds = new Set((state?.easyModeChallengeIds ?? []).map(String));
  const definitions = new Map<string, any>();
  const eventsByChallenge = new Map<string, Map<string, {
    completed: boolean;
    skipped: boolean;
    protectedByFreeze: boolean;
  }>>();

  for (const challenge of [...(state?.archivedChallenges ?? []), ...(state?.challenges ?? [])]) {
    const id = String((challenge as any)?.id ?? "");
    if (id) definitions.set(id, challenge);
  }

  for (const entry of history) {
    const challengeId = String(entry?.challengeId ?? "");
    const date = String(entry?.date ?? "");
    if (!challengeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    challengeIds.add(challengeId);
    const byDate = eventsByChallenge.get(challengeId) ?? new Map();
    const event = byDate.get(date) ?? { completed: false, skipped: false, protectedByFreeze: false };
    if (entry.status === "completed" && entry.partial !== true) event.completed = true;
    if (entry.status === "skipped" && entry.eventType !== "weeklyGoalMissed") {
      event.skipped = true;
      event.protectedByFreeze ||= entry.protectedByFreeze === true;
    }
    byDate.set(date, event);
    eventsByChallenge.set(challengeId, byDate);
  }

  const counts = emptyCounts();
  const earnedByChallenge = new Map<string, MedalHistoryCounts>();
  const streaksByChallenge = new Map<string, { currentStreak: number; bestStreak: number }>();
  for (const challengeId of challengeIds) {
    const earned = emptyCounts();
    const definition = definitions.get(challengeId);
    const schedule = definition ? { ...definition, enabled: true, deletedAt: undefined } : null;
    const easyMode = easyModeChallengeIds.has(challengeId) || definition?.easyMode === true;
    let hasUsableHistoryRun = false;
    let hasCanonicalStreakHistory = false;
    let rebuiltCurrent = 0;
    let rebuiltBest = 0;

    if (!easyMode && definition?.period === FLEXIBLE_WEEKLY_PERIOD) {
      const rebuilt = flexibleWeeklyCompetitiveRuns(history, challengeId);
      for (const run of rebuilt.runs) addRunMedals(earned, run);
      hasUsableHistoryRun = rebuilt.runs.length > 0;
      hasCanonicalStreakHistory = rebuilt.hasCanonicalEvents;
      rebuiltCurrent = rebuilt.currentStreak;
      rebuiltBest = rebuilt.bestStreak;
    } else if (!easyMode) {
      const events = Array.from(eventsByChallenge.get(challengeId)?.entries() ?? [])
        .sort(([left], [right]) => left.localeCompare(right));
      hasCanonicalStreakHistory = events.length > 0;
      let runLength = 0;
      let previousDate: string | null = null;
      const commitRun = () => {
        if (runLength < 1) return;
        hasUsableHistoryRun = true;
        rebuiltBest = Math.max(rebuiltBest, runLength);
        addRunMedals(earned, runLength);
        runLength = 0;
      };
      for (const [date, event] of events) {
        if (previousDate) {
          for (let missing = addLocalDays(previousDate, 1); missing < date && missing < todayISO; missing = addLocalDays(missing, 1)) {
            if (!schedule || isActiveOnDate(schedule, missing)) {
              commitRun();
              break;
            }
          }
        }
        const active = !schedule || isActiveOnDate(schedule, date);
        if (event.completed) runLength += 1;
        else if (event.skipped && !event.protectedByFreeze && active) commitRun();
        else if (active && date < todayISO) commitRun();
        previousDate = date;
      }
      rebuiltCurrent = runLength;
      if (previousDate && rebuiltCurrent > 0) {
        for (let missing = addLocalDays(previousDate, 1); missing < todayISO; missing = addLocalDays(missing, 1)) {
          if (!schedule || isActiveOnDate(schedule, missing)) {
            rebuiltCurrent = 0;
            break;
          }
        }
      }
      commitRun();
    }

    // bestStreak is monotonic by design, so medals already shown to the user
    // are never removed after canonical history reconstruction.
    const preservedBest = safeBestStreak(stats[challengeId]?.bestStreak);
    const preservedCurrent = safeBestStreak(stats[challengeId]?.currentStreak);
    if (!hasUsableHistoryRun || preservedBest > 0) {
      for (const medal of MEDAL_HISTORY_THRESHOLDS) {
        earned[medal.tier] = Math.max(
          earned[medal.tier],
          Math.min(earnedMedalCount(preservedBest, medal.days), MAX_MEDAL_COUNT_PER_CHALLENGE),
        );
      }
    }
    for (const medal of MEDAL_HISTORY_THRESHOLDS) counts[medal.tier] += earned[medal.tier];
    earnedByChallenge.set(challengeId, earned);
    streaksByChallenge.set(challengeId, {
      currentStreak: easyMode ? 0 : hasCanonicalStreakHistory ? rebuiltCurrent : preservedCurrent,
      bestStreak: easyMode ? 0 : Math.max(rebuiltBest, preservedBest),
    });
  }

  return {
    state: {
      active: {
        brambora: counts.brambora > 0,
        steel: counts.steel > 0,
        bronze: counts.bronze > 0,
        silver: counts.silver > 0,
        gold: counts.gold > 0,
        diamond: counts.diamond > 0,
      },
      counts,
    },
    earnedByChallenge,
    streaksByChallenge,
  };
}
