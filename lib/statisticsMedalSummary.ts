import { medalCollectionFromHistory } from "./medalCollectionFromHistory";
import type { AppState } from "./storage";

export function medalDisplaySummaryFromHistory(
  state: AppState | null | undefined,
  isActiveOnDate: (challenge: any, dateISO: string) => boolean,
  todayISO: string,
) {
  const collection = medalCollectionFromHistory(state, isActiveOnDate, todayISO);
  let currentStreak = 0;
  let longestStreak = 0;
  for (const streak of collection.streaksByChallenge.values()) {
    currentStreak = Math.max(currentStreak, streak.currentStreak);
    longestStreak = Math.max(longestStreak, streak.bestStreak);
  }
  return {
    collection,
    currentStreak,
    bestStreak: longestStreak,
    longestStreak,
  };
}
