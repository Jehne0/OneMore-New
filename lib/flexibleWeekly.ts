import type { AppState, Challenge, ChallengeStats, HistoryEntry } from "./storage";

export const FLEXIBLE_WEEKLY_PERIOD = "flexibleWeekly" as const;

export type FlexibleWeeklyPendingSettings = {
  target: number;
  startDay: number;
  effectiveFrom: string;
  previousPeriodEnd?: string;
};

export type FlexibleWeeklyWindow = {
  start: string;
  end: string;
  target: number;
  startDay: number;
};

export type FlexibleWeeklyDefinition = {
  target: number;
  startDay: number;
  firstPeriodStart: string;
  lastEvaluatedPeriodStart?: string;
  pending?: FlexibleWeeklyPendingSettings;
  updatedAtISO: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalDateKey(value: unknown): value is string {
  return typeof value === "string" && DATE_RE.test(value);
}

export function addLocalDays(dateISO: string, days: number): string {
  const [year, month, day] = dateISO.split("-").map(Number);
  const value = new Date(year, (month ?? 1) - 1, day ?? 1, 12);
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function localDayMon0(dateISO: string): number {
  const [year, month, day] = dateISO.split("-").map(Number);
  const value = new Date(year, (month ?? 1) - 1, day ?? 1, 12);
  return (value.getDay() + 6) % 7;
}

function ordinal(dateISO: string): number {
  const [year, month, day] = dateISO.split("-").map(Number);
  return Math.floor(Date.UTC(year, (month ?? 1) - 1, day ?? 1) / 86_400_000);
}

export function clampFlexibleWeeklyTarget(value: unknown): number {
  const parsed = Math.floor(Number(value ?? 1));
  return Number.isFinite(parsed) ? Math.min(7, Math.max(1, parsed)) : 1;
}

export function clampFlexibleWeeklyStartDay(value: unknown): number {
  const parsed = Math.floor(Number(value ?? 0));
  return Number.isFinite(parsed) ? Math.min(6, Math.max(0, parsed)) : 0;
}

export function nextWeekdayOnOrAfter(dateISO: string, startDay: number): string {
  const wanted = clampFlexibleWeeklyStartDay(startDay);
  const delta = (wanted - localDayMon0(dateISO) + 7) % 7;
  return addLocalDays(dateISO, delta);
}

export function nextWeekdayAfter(dateISO: string, startDay: number): string {
  const candidate = nextWeekdayOnOrAfter(addLocalDays(dateISO, 1), startDay);
  return candidate;
}

export function normalizeFlexibleWeeklyPending(value: unknown): FlexibleWeeklyPendingSettings | undefined {
  if (!value || typeof value !== "object") return undefined;
  const pending = value as Partial<FlexibleWeeklyPendingSettings>;
  if (!isLocalDateKey(pending.effectiveFrom)) return undefined;
  return {
    target: clampFlexibleWeeklyTarget(pending.target),
    startDay: clampFlexibleWeeklyStartDay(pending.startDay),
    effectiveFrom: pending.effectiveFrom,
    previousPeriodEnd: isLocalDateKey(pending.previousPeriodEnd) && pending.previousPeriodEnd < pending.effectiveFrom
      ? pending.previousPeriodEnd
      : undefined,
  };
}

export function normalizeFlexibleWeeklyDefinitions(value: unknown): Record<string, FlexibleWeeklyDefinition> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, FlexibleWeeklyDefinition> = {};
  for (const [id, raw] of Object.entries(value as Record<string, any>)) {
    if (!id || !raw || typeof raw !== "object" || !isLocalDateKey(raw.firstPeriodStart)) continue;
    result[id] = {
      target: clampFlexibleWeeklyTarget(raw.target),
      startDay: clampFlexibleWeeklyStartDay(raw.startDay),
      firstPeriodStart: raw.firstPeriodStart,
      lastEvaluatedPeriodStart: isLocalDateKey(raw.lastEvaluatedPeriodStart) ? raw.lastEvaluatedPeriodStart : undefined,
      pending: normalizeFlexibleWeeklyPending(raw.pending),
      updatedAtISO: typeof raw.updatedAtISO === "string" ? raw.updatedAtISO : new Date(0).toISOString(),
    };
  }
  return result;
}

function definitionForChallenge(challenge: Challenge, updatedAtISO: string): FlexibleWeeklyDefinition | null {
  if (challenge.period !== FLEXIBLE_WEEKLY_PERIOD || !isLocalDateKey(challenge.flexibleWeeklyFirstPeriodStart)) return null;
  return {
    target: clampFlexibleWeeklyTarget(challenge.flexibleWeeklyTarget),
    startDay: clampFlexibleWeeklyStartDay(challenge.flexibleWeeklyStartDay),
    firstPeriodStart: challenge.flexibleWeeklyFirstPeriodStart,
    lastEvaluatedPeriodStart: isLocalDateKey(challenge.flexibleWeeklyLastEvaluatedPeriodStart)
      ? challenge.flexibleWeeklyLastEvaluatedPeriodStart
      : undefined,
    pending: normalizeFlexibleWeeklyPending(challenge.flexibleWeeklyPending),
    updatedAtISO,
  };
}

function sameDefinition(left: FlexibleWeeklyDefinition | undefined, right: FlexibleWeeklyDefinition): boolean {
  if (!left) return false;
  const comparable = (value: FlexibleWeeklyDefinition) => ({
    target: value.target,
    startDay: value.startDay,
    firstPeriodStart: value.firstPeriodStart,
    lastEvaluatedPeriodStart: value.lastEvaluatedPeriodStart,
    pending: value.pending,
  });
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

export function synchronizeFlexibleWeeklyDefinitions(state: AppState, updatedAtISO = new Date().toISOString()): AppState {
  const previous = normalizeFlexibleWeeklyDefinitions(state.flexibleWeeklyDefinitions);
  const next: Record<string, FlexibleWeeklyDefinition> = {};
  for (const challenge of state.challenges ?? []) {
    const definition = definitionForChallenge(challenge, updatedAtISO);
    if (!definition) continue;
    const old = previous[String(challenge.id)];
    next[String(challenge.id)] = sameDefinition(old, definition) ? old : definition;
  }
  if (JSON.stringify(previous) === JSON.stringify(next) && state.flexibleWeeklyWriterVersion === 2) return state;
  return { ...state, flexibleWeeklyDefinitions: next, flexibleWeeklyWriterVersion: 2 };
}

export function restoreFlexibleWeeklyDefinitions(state: AppState, todayISO: string): AppState {
  const definitions = normalizeFlexibleWeeklyDefinitions(state.flexibleWeeklyDefinitions);
  const restoredIds = new Set<string>();
  const challenges = (state.challenges ?? []).map((challenge) => {
    const definition = definitions[String(challenge.id)];
    if (!definition || challenge.period === FLEXIBLE_WEEKLY_PERIOD) return challenge;
    restoredIds.add(String(challenge.id));
    return normalizeFlexibleWeeklyFields({
      ...challenge,
      period: FLEXIBLE_WEEKLY_PERIOD,
      targetPerDay: 1,
      flexibleWeeklyTarget: definition.target,
      flexibleWeeklyStartDay: definition.startDay,
      flexibleWeeklyFirstPeriodStart: definition.firstPeriodStart,
      flexibleWeeklyLastEvaluatedPeriodStart: definition.lastEvaluatedPeriodStart,
      flexibleWeeklyPending: definition.pending,
    }, todayISO) as Challenge;
  });
  if (restoredIds.size === 0) return { ...state, flexibleWeeklyDefinitions: definitions };

  const byId = new Map(challenges.map((challenge) => [String(challenge.id), challenge]));
  const retainedCounts = new Map<string, Set<string>>();
  const history = (state.history ?? []).filter((entry) => {
    const id = String(entry.challengeId ?? "");
    if (!restoredIds.has(id)) return true;
    const challenge = byId.get(id)!;
    const first = challenge.flexibleWeeklyFirstPeriodStart;
    if (!isLocalDateKey(first) || entry.date < first) return true;
    if (entry.status === "skipped" && entry.eventType !== "weeklyGoalMissed" && !entry.flexibleWeeklyPeriodStart) return false;
    if (entry.status !== "completed") return true;
    const window = flexibleWeeklyWindowForDate(challenge, entry.date);
    if (!window) return false;
    const key = `${id}:${window.start}`;
    const dates = retainedCounts.get(key) ?? new Set<string>();
    if (dates.has(entry.date) || dates.size >= window.target) return false;
    dates.add(entry.date);
    retainedCounts.set(key, dates);
    return true;
  }).map((entry) => {
    const id = String(entry.challengeId ?? "");
    const challenge = byId.get(id);
    if (!restoredIds.has(id) || entry.status !== "completed" || !challenge) return entry;
    const first = challenge.flexibleWeeklyFirstPeriodStart;
    return isLocalDateKey(first) && entry.date >= first
      ? { ...entry, eventType: "flexibleWeeklyCompleted" as const, partial: false }
      : entry;
  });
  return { ...state, challenges, history, flexibleWeeklyDefinitions: definitions };
}

/** Additive normalization only. Non-flexible challenges are returned untouched. */
export function normalizeFlexibleWeeklyFields<T extends Record<string, any>>(challenge: T, todayISO: string): T {
  if (challenge.period !== FLEXIBLE_WEEKLY_PERIOD) return challenge;
  const startDay = clampFlexibleWeeklyStartDay(challenge.flexibleWeeklyStartDay);
  const firstPeriodStart = isLocalDateKey(challenge.flexibleWeeklyFirstPeriodStart)
    ? challenge.flexibleWeeklyFirstPeriodStart
    : nextWeekdayOnOrAfter(
        isLocalDateKey(challenge.createdDate) ? challenge.createdDate : todayISO,
        startDay,
      );
  return {
    ...challenge,
    targetPerDay: 1,
    flexibleWeeklyTarget: clampFlexibleWeeklyTarget(challenge.flexibleWeeklyTarget ?? challenge.targetPerDay),
    flexibleWeeklyStartDay: startDay,
    flexibleWeeklyFirstPeriodStart: firstPeriodStart,
    flexibleWeeklyLastEvaluatedPeriodStart: isLocalDateKey(challenge.flexibleWeeklyLastEvaluatedPeriodStart)
      ? challenge.flexibleWeeklyLastEvaluatedPeriodStart
      : undefined,
    flexibleWeeklyPending: normalizeFlexibleWeeklyPending(challenge.flexibleWeeklyPending),
  };
}

export function flexibleWeeklyWindowForDate(
  challenge: Pick<Challenge, "period" | "flexibleWeeklyTarget" | "flexibleWeeklyStartDay" | "flexibleWeeklyFirstPeriodStart" | "flexibleWeeklyPending">,
  dateISO: string,
): FlexibleWeeklyWindow | null {
  if (challenge.period !== FLEXIBLE_WEEKLY_PERIOD) return null;
  const pending = normalizeFlexibleWeeklyPending(challenge.flexibleWeeklyPending);
  const usingPending = !!pending && dateISO >= pending.effectiveFrom;
  const target = usingPending ? pending.target : clampFlexibleWeeklyTarget(challenge.flexibleWeeklyTarget);
  const startDay = usingPending ? pending.startDay : clampFlexibleWeeklyStartDay(challenge.flexibleWeeklyStartDay);
  const first = usingPending
    ? pending.effectiveFrom
    : challenge.flexibleWeeklyFirstPeriodStart;
  if (pending && !usingPending) {
    const explicitEnd = pending.previousPeriodEnd;
    const oldFirst = challenge.flexibleWeeklyFirstPeriodStart;
    let previousPeriodEnd = explicitEnd;
    if (!previousPeriodEnd && isLocalDateKey(oldFirst) && pending.effectiveFrom > oldFirst) {
      const elapsedBeforeEffective = ordinal(pending.effectiveFrom) - ordinal(oldFirst) - 1;
      const candidateStart = addLocalDays(oldFirst, Math.floor(Math.max(0, elapsedBeforeEffective) / 7) * 7);
      const candidateEnd = addLocalDays(candidateStart, 6);
      previousPeriodEnd = candidateEnd < pending.effectiveFrom ? candidateEnd : addLocalDays(candidateEnd, -7);
    }
    if (previousPeriodEnd && dateISO > previousPeriodEnd) return null;
  }
  if (!isLocalDateKey(first) || dateISO < first) return null;
  const elapsed = ordinal(dateISO) - ordinal(first);
  const start = addLocalDays(first, Math.floor(elapsed / 7) * 7);
  return { start, end: addLocalDays(start, 6), target, startDay };
}

export function flexibleWeeklyProgress(
  challenge: Challenge,
  history: HistoryEntry[],
  dateISO: string,
): { done: number; target: number; window: FlexibleWeeklyWindow | null } {
  const window = flexibleWeeklyWindowForDate(challenge, dateISO);
  const target = window?.target ?? clampFlexibleWeeklyTarget(challenge.flexibleWeeklyTarget);
  if (!window) return { done: 0, target, window: null };
  const dates = new Set(
    (history ?? [])
      .filter((entry) =>
        entry.status === "completed" &&
        String(entry.challengeId ?? "") === String(challenge.id) &&
        entry.date >= window.start && entry.date <= window.end && entry.date <= dateISO)
      .map((entry) => entry.date),
  );
  return { done: Math.min(target, dates.size), target, window };
}

export function canCompleteFlexibleWeekly(
  challenge: Challenge,
  history: HistoryEntry[],
  dateISO: string,
): boolean {
  const progress = flexibleWeeklyProgress(challenge, history, dateISO);
  if (!progress.window || progress.done >= progress.target) return false;
  return !(history ?? []).some((entry) =>
    entry.status === "completed" && entry.date === dateISO && String(entry.challengeId ?? "") === String(challenge.id));
}

export function scheduleFlexibleWeeklySettings(
  challenge: Challenge,
  target: number,
  startDay: number,
  todayISO: string,
  applyImmediately = false,
): Challenge {
  const nextTarget = clampFlexibleWeeklyTarget(target);
  const nextStartDay = clampFlexibleWeeklyStartDay(startDay);
  if (applyImmediately || challenge.period !== FLEXIBLE_WEEKLY_PERIOD || !isLocalDateKey(challenge.flexibleWeeklyFirstPeriodStart)) {
    return normalizeFlexibleWeeklyFields({
      ...challenge,
      period: FLEXIBLE_WEEKLY_PERIOD,
      targetPerDay: 1,
      flexibleWeeklyTarget: nextTarget,
      flexibleWeeklyStartDay: nextStartDay,
      flexibleWeeklyFirstPeriodStart: nextWeekdayOnOrAfter(todayISO, nextStartDay),
      flexibleWeeklyPending: undefined,
      flexibleWeeklyLastEvaluatedPeriodStart: undefined,
    }, todayISO);
  }
  const existingPending = normalizeFlexibleWeeklyPending(challenge.flexibleWeeklyPending);
  if (existingPending && existingPending.target === nextTarget && existingPending.startDay === nextStartDay) {
    return challenge;
  }
  if (!existingPending && clampFlexibleWeeklyTarget(challenge.flexibleWeeklyTarget) === nextTarget &&
      clampFlexibleWeeklyStartDay(challenge.flexibleWeeklyStartDay) === nextStartDay) {
    return challenge;
  }
  const current = flexibleWeeklyWindowForDate(challenge, todayISO);
  const afterCurrent = current ? addLocalDays(current.end, 1) : todayISO;
  const effectiveFrom = nextWeekdayOnOrAfter(afterCurrent, nextStartDay);
  return {
    ...challenge,
    flexibleWeeklyPending: {
      target: nextTarget,
      startDay: nextStartDay,
      effectiveFrom,
      previousPeriodEnd: current?.end,
    },
  };
}

function normalizedStats(value?: ChallengeStats): ChallengeStats {
  return {
    completedCount: Math.max(0, Number(value?.completedCount ?? 0)),
    skippedCount: Math.max(0, Number(value?.skippedCount ?? 0)),
    lastCompletedDay: value?.lastCompletedDay,
    lastStreakDay: value?.lastStreakDay ?? value?.lastCompletedDay,
    currentStreak: Math.max(0, Number(value?.currentStreak ?? 0)),
    bestStreak: Math.max(0, Number(value?.bestStreak ?? 0)),
    skipCredits: Math.min(1, Math.max(0, Number(value?.skipCredits ?? 0))),
  };
}

export type FlexibleWeeklyReconcileOptions = {
  challengeIds?: Iterable<string>;
  isActiveOnDate?: (challenge: Challenge, dateISO: string) => boolean;
  isEasyMode?: (challenge: Challenge) => boolean;
};

function defaultIsActiveOnDate(challenge: Challenge, dateISO: string): boolean {
  if (challenge.enabled === false || challenge.deletedAt) return false;
  return !(challenge.inactivePeriods ?? []).some((period) =>
    period.startDate <= dateISO && (!period.endDate || dateISO < period.endDate));
}

function periodIsFullyActive(
  challenge: Challenge,
  start: string,
  isActiveOnDate: (challenge: Challenge, dateISO: string) => boolean,
): boolean {
  for (let offset = 0; offset < 7; offset += 1) {
    if (!isActiveOnDate(challenge, addLocalDays(start, offset))) return false;
  }
  return true;
}

export type FlexibleWeeklyCompetitiveRuns = {
  runs: number[];
  currentStreak: number;
  bestStreak: number;
  lastCompletedDay?: string;
  hasCanonicalEvents: boolean;
};

/**
 * The single canonical interpreter for competitive flexible-weekly history.
 * A successful period is one completion event; a failed period closes the
 * current run. Calendar gaps are deliberately neutral.
 */
export function flexibleWeeklyCompetitiveRuns(
  history: HistoryEntry[],
  challengeId: string,
): FlexibleWeeklyCompetitiveRuns {
  const events = (history ?? [])
    .filter((entry) => String(entry.challengeId ?? "") === challengeId &&
      (entry.eventType === "flexibleWeeklyCompleted" ||
        entry.eventType === "weeklyGoalMissed" || !!entry.flexibleWeeklyPeriodStart))
    .sort((left, right) =>
      left.date.localeCompare(right.date) || left.time.localeCompare(right.time) || left.atISO.localeCompare(right.atISO));
  const runs: number[] = [];
  let currentStreak = 0;
  let bestStreak = 0;
  let lastCompletedDay: string | undefined;
  for (const entry of events) {
    if (entry.eventType === "flexibleWeeklyCompleted") {
      currentStreak += 1;
      bestStreak = Math.max(bestStreak, currentStreak);
      lastCompletedDay = entry.date;
    } else if (currentStreak > 0) {
      runs.push(currentStreak);
      currentStreak = 0;
    }
  }
  if (currentStreak > 0) runs.push(currentStreak);
  return {
    runs,
    currentStreak,
    bestStreak,
    lastCompletedDay,
    hasCanonicalEvents: events.length > 0,
  };
}

function rebuildFlexibleWeeklyCompetitiveStats(
  history: HistoryEntry[],
  challengeId: string,
  previous: ChallengeStats | undefined,
): ChallengeStats {
  const base = normalizedStats(previous);
  const rebuilt = flexibleWeeklyCompetitiveRuns(history, challengeId);
  if (!rebuilt.hasCanonicalEvents) return base;
  return {
    ...base,
    currentStreak: rebuilt.currentStreak,
    bestStreak: Math.max(base.bestStreak, rebuilt.bestStreak),
    lastCompletedDay: rebuilt.lastCompletedDay ?? base.lastCompletedDay,
    lastStreakDay: rebuilt.lastCompletedDay ?? base.lastStreakDay,
  };
}

export function resumeFlexibleWeeklyChallenge(challenge: Challenge, todayISO: string): Challenge {
  if (challenge.period !== FLEXIBLE_WEEKLY_PERIOD) return challenge;
  const startDay = clampFlexibleWeeklyStartDay(
    challenge.flexibleWeeklyPending?.startDay ?? challenge.flexibleWeeklyStartDay,
  );
  const target = clampFlexibleWeeklyTarget(
    challenge.flexibleWeeklyPending?.target ?? challenge.flexibleWeeklyTarget,
  );
  return normalizeFlexibleWeeklyFields({
    ...challenge,
    flexibleWeeklyTarget: target,
    flexibleWeeklyStartDay: startDay,
    flexibleWeeklyFirstPeriodStart: nextWeekdayOnOrAfter(todayISO, startDay),
    flexibleWeeklyLastEvaluatedPeriodStart: undefined,
    flexibleWeeklyPending: undefined,
  }, todayISO) as Challenge;
}

/**
 * Evaluates each closed seven-day window once. Failures keep real completion
 * entries and add one idempotent period-failure entry for audit/history.
 */
export function reconcileFlexibleWeeklyPeriods(
  state: AppState,
  todayISO: string,
  options: FlexibleWeeklyReconcileOptions = {},
): { next: AppState; changed: boolean } {
  let changed = false;
  let history = [...(state.history ?? [])];
  const stats = { ...(state.challengeStats ?? {}) };
  const allowedIds = options.challengeIds ? new Set(Array.from(options.challengeIds, String)) : null;
  const isActiveOnDate = options.isActiveOnDate ?? defaultIsActiveOnDate;
  const isEasyMode = options.isEasyMode ?? ((challenge: Challenge) => challenge.easyMode === true);
  const challenges = (state.challenges ?? []).map((raw) => {
    if (raw.period !== FLEXIBLE_WEEKLY_PERIOD || allowedIds && !allowedIds.has(String(raw.id))) return raw;
    let challenge = normalizeFlexibleWeeklyFields(raw as any, todayISO) as Challenge;
    if (JSON.stringify(challenge) !== JSON.stringify(raw)) changed = true;

    const evaluateConfiguration = (limit: string) => {
      const first = challenge.flexibleWeeklyFirstPeriodStart;
      if (!isLocalDateKey(first)) return;
      let cursor = first;
      let lastEvaluated = challenge.flexibleWeeklyLastEvaluatedPeriodStart;
      while (addLocalDays(cursor, 6) < limit) {
        if (!lastEvaluated || cursor > lastEvaluated) {
          const end = addLocalDays(cursor, 6);
          if (periodIsFullyActive(challenge, cursor, isActiveOnDate)) {
            const target = clampFlexibleWeeklyTarget(challenge.flexibleWeeklyTarget);
            const completedDates = new Set(history.filter((entry) =>
              entry.status === "completed" && String(entry.challengeId ?? "") === String(challenge.id) &&
              entry.date >= cursor && entry.date <= end).map((entry) => entry.date));
            if (completedDates.size < target) {
              const failureExists = history.some((entry) =>
                (entry.eventType === "weeklyGoalMissed" || !!entry.flexibleWeeklyPeriodStart) &&
                entry.flexibleWeeklyPeriodStart === cursor && String(entry.challengeId ?? "") === String(challenge.id));
              if (!failureExists) {
                history.unshift({
                  date: end,
                  time: "23:59",
                  atISO: `${end}T23:59:59.000Z`,
                  challengeId: String(challenge.id),
                  challengeText: challenge.text,
                  status: "skipped",
                  eventType: "weeklyGoalMissed",
                  flexibleWeeklyPeriodStart: cursor,
                  flexibleWeeklyDone: completedDates.size,
                  flexibleWeeklyTarget: target,
                });
              }
              if (!isEasyMode(challenge)) {
                const current = normalizedStats(stats[String(challenge.id)]);
                stats[String(challenge.id)] = { ...current, currentStreak: 0 };
              }
            }
          }
          lastEvaluated = cursor;
          changed = true;
        }
        cursor = addLocalDays(cursor, 7);
      }
      challenge = { ...challenge, flexibleWeeklyLastEvaluatedPeriodStart: lastEvaluated };
    };

    const pending = normalizeFlexibleWeeklyPending(challenge.flexibleWeeklyPending);
    if (pending && pending.effectiveFrom <= todayISO) {
      evaluateConfiguration(pending.effectiveFrom);
      challenge = {
        ...challenge,
        flexibleWeeklyTarget: pending.target,
        flexibleWeeklyStartDay: pending.startDay,
        flexibleWeeklyFirstPeriodStart: pending.effectiveFrom,
        flexibleWeeklyLastEvaluatedPeriodStart: undefined,
        flexibleWeeklyPending: undefined,
      };
      changed = true;
      evaluateConfiguration(todayISO);
    } else {
      evaluateConfiguration(todayISO);
    }

    if (!isEasyMode(challenge)) {
      const rebuilt = rebuildFlexibleWeeklyCompetitiveStats(history, String(challenge.id), stats[String(challenge.id)]);
      if (JSON.stringify(rebuilt) !== JSON.stringify(stats[String(challenge.id)])) {
        stats[String(challenge.id)] = rebuilt;
        changed = true;
      }
    }
    return challenge;
  });

  return changed ? { next: { ...state, challenges, history, challengeStats: stats }, changed: true } : { next: state, changed: false };
}

export function updateFlexibleWeeklyStatsOnCompletion(
  state: AppState,
  challengeId: string,
  dateISO: string,
  easyMode = false,
): Record<string, ChallengeStats> {
  const map = { ...(state.challengeStats ?? {}) };
  const previous = normalizedStats(map[challengeId]);
  if (easyMode) {
    map[challengeId] = {
      ...previous,
      completedCount: previous.completedCount + 1,
      lastCompletedDay: dateISO,
    };
    return map;
  }
  const nextStreak = previous.currentStreak + 1;
  map[challengeId] = {
    ...previous,
    completedCount: previous.completedCount + 1,
    lastCompletedDay: dateISO,
    lastStreakDay: dateISO,
    currentStreak: nextStreak,
    bestStreak: Math.max(previous.bestStreak, nextStreak),
    skipCredits: nextStreak > 0 && nextStreak % 10 === 0 ? 1 : previous.skipCredits,
  };
  return map;
}
