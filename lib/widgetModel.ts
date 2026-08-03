import type { AppState, Challenge } from "./storage";
import { isChallengeActiveOnDate } from "./storage";
import { validateCachedSharedChallenge, type CachedSharedChallenge } from "./sharedCompletion";

export type WidgetLanguage = "cs" | "en" | "pl" | "de";
export type WidgetDay = { date: string; kind: "completed" | "partial" | "missed" | "inactive" | "future"; done: number; target: number };
export type WidgetDayState = "activePending" | "activeCompleted" | "restDay";
export type WidgetChallenge = { id: string; title: string; done: number; target: number; streak: number; bestStreak: number; isActiveToday: boolean; dayState: WidgetDayState; shared?: boolean; lockedByPremiumExpiration?: boolean; week: WidgetDay[] };
export type WidgetModel = {
  kind: "signed-out" | "empty" | "rest" | "challenges";
  language: WidgetLanguage;
  challenges: WidgetChallenge[];
  completed: number;
  total: number;
  premium: boolean;
};

export function createWidgetModel(
  state: AppState | null, language: WidgetLanguage, date: string,
  shared: CachedSharedChallenge[] = [], uid = "", premium = false, selectedIds?: string[], frozenIds: string[] = []
): WidgetModel {
  if (!state) return { kind: "signed-out", language, challenges: [], completed: 0, total: 0, premium: false };
  const existing = (state.challenges ?? []).filter((item) => item.enabled !== false && !item.deletedAt);
  const eligibleShared = uid ? shared.filter((item) => selectedIds !== undefined
    ? item.enabled !== false && item.status === "active" && item.memberUids.includes(uid) && !(item.leftBy ?? []).includes(uid)
    : validateCachedSharedChallenge(item, uid, date)) : [];
  if (!existing.length && !eligibleShared.length) return { kind: "empty", language, challenges: [], completed: 0, total: 0, premium };
  const active = existing.filter((item) => isChallengeActiveOnDate(item, date));
  if (selectedIds === undefined && !active.length && !eligibleShared.length) return { kind: "rest", language, challenges: [], completed: 0, total: 0, premium };
  const weekDates = getWeekDates(date);
  const personal = (selectedIds !== undefined ? existing : active).map((challenge: Challenge): WidgetChallenge => {
    const targetRaw = Math.floor(Number(challenge.targetPerDay ?? 1));
    const target = Number.isFinite(targetRaw) && targetRaw > 0 ? targetRaw : 1;
    const done = (state.history ?? []).filter((entry) =>
      entry.date === date && entry.status === "completed" && String(entry.challengeId) === String(challenge.id)
    ).length;
    const isActiveToday = isChallengeActiveOnDate(challenge, date);
    const week = weekDates.map((day): WidgetDay => {
      const activeDay = isChallengeActiveOnDate(challenge, day);
      const dayDone = (state.history ?? []).filter((entry) => entry.date === day && entry.status === "completed" && String(entry.challengeId) === String(challenge.id)).length;
      return { date: day, done: Math.min(dayDone, target), target, kind: day > date ? "future" : !activeDay ? "inactive" : dayDone >= target ? "completed" : dayDone > 0 ? "partial" : "missed" };
    });
    return {
      id: String(challenge.id), title: challenge.text, done: Math.min(done, target), target,
      isActiveToday,
      dayState: !isActiveToday ? "restDay" : done >= target ? "activeCompleted" : "activePending",
      streak: Math.max(0, Number(state.challengeStats?.[String(challenge.id)]?.currentStreak ?? 0)),
      bestStreak: Math.max(0, Number(state.challengeStats?.[String(challenge.id)]?.bestStreak ?? 0)),
      week,
    };
  });
  const sharedRows = eligibleShared.map((item): WidgetChallenge => ({
    id: item.id, title: item.title, done: Math.min(item.completedByDate[date] ?? 0, item.targetPerDay),
    target: item.targetPerDay, streak: 0, bestStreak: 0, shared: true,
    isActiveToday: validateCachedSharedChallenge(item, uid, date),
    dayState: !validateCachedSharedChallenge(item, uid, date) ? "restDay" : (item.completedByDate[date] ?? 0) >= item.targetPerDay ? "activeCompleted" : "activePending",
    week: weekDates.map((day) => {
      const activeDay = validateCachedSharedChallenge(item, uid, day);
      const dayDone = Math.min(item.completedByDate[day] ?? 0, item.targetPerDay);
      return { date: day, done: dayDone, target: item.targetPerDay, kind: day > date ? "future" : !activeDay ? "inactive" : dayDone >= item.targetPerDay ? "completed" : dayDone > 0 ? "partial" : "missed" };
    }),
  }));
  const allChallenges = [...personal, ...sharedRows];
  const frozen = new Set(frozenIds);
  const challenges = (selectedIds !== undefined ? selectedIds.map((id) => allChallenges.find((item) => item.id === id)).filter((item): item is WidgetChallenge => !!item) : allChallenges)
    .map((item) => frozen.has(item.id) ? { ...item, lockedByPremiumExpiration: true } : item);
  if (selectedIds !== undefined && challenges.length === 0) {
    return { kind: "empty", language, challenges: [], completed: 0, total: 0, premium };
  }
  const countableChallenges = challenges.filter((item) => !item.lockedByPremiumExpiration);
  return {
    kind: "challenges", language, challenges,
    completed: countableChallenges.filter((item) => item.dayState === "activeCompleted").length,
    total: countableChallenges.filter((item) => item.isActiveToday).length, premium,
  };
}

function getWeekDates(date: string): string[] {
  const [year, month, day] = date.split("-").map(Number);
  const current = new Date(year, month - 1, day, 12);
  const mondayOffset = (current.getDay() + 6) % 7;
  current.setDate(current.getDate() - mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const value = new Date(current);
    value.setDate(current.getDate() + index);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  });
}
