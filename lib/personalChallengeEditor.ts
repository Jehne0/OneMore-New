import {
  FLEXIBLE_WEEKLY_PERIOD,
  clampFlexibleWeeklyStartDay,
  clampFlexibleWeeklyTarget,
  localDayMon0,
  scheduleFlexibleWeeklySettings,
} from "./flexibleWeekly";
import { transitionChallengeEnabled, type Challenge } from "./storage";

export type PersonalChallengePeriod = "daily" | "every2" | "custom" | "flexibleWeekly";

export type PersonalChallengeEditorDraft = {
  text: string;
  enabled: boolean;
  easyMode: boolean;
  target: number;
  period: PersonalChallengePeriod;
  customDays: number[];
  periodAnchor: string | null;
  flexibleStartDay: number;
};

function dailyTarget(value: unknown): number {
  const target = Number(value);
  return Number.isFinite(target) ? Math.min(20, Math.max(1, Math.floor(target))) : 1;
}

export function normalizePersonalChallengeCustomDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map(Number)
    .filter((day) => Number.isFinite(day) && day >= 0 && day <= 6)
    .map(Math.floor)))
    .sort((a, b) => a - b);
}

export function personalChallengeEditorDraftFromChallenge(
  challenge: Challenge,
  todayISO: string,
): PersonalChallengeEditorDraft {
  const period: PersonalChallengePeriod = challenge.period === "every2" ||
    challenge.period === "custom" || challenge.period === FLEXIBLE_WEEKLY_PERIOD
    ? challenge.period
    : "daily";
  const customDays = normalizePersonalChallengeCustomDays(challenge.customDays);
  return {
    text: String(challenge.text ?? ""),
    enabled: challenge.enabled !== false,
    easyMode: challenge.easyMode === true,
    target: period === FLEXIBLE_WEEKLY_PERIOD
      ? clampFlexibleWeeklyTarget(challenge.flexibleWeeklyPending?.target ?? challenge.flexibleWeeklyTarget)
      : dailyTarget(challenge.targetPerDay),
    period,
    customDays: period === "custom"
      ? (customDays.length > 0 ? customDays : [localDayMon0(todayISO)])
      : [],
    periodAnchor: period === "every2" ? (challenge.periodAnchor || todayISO) : null,
    flexibleStartDay: clampFlexibleWeeklyStartDay(
      challenge.flexibleWeeklyPending?.startDay ?? challenge.flexibleWeeklyStartDay ?? localDayMon0(todayISO),
    ),
  };
}

/**
 * Applies one editor draft as a single state transition. Native reminder work is
 * deliberately performed only after this complete configuration has been built,
 * so toggling several controls cannot race multiple storage and iOS operations.
 */
export function applyPersonalChallengeEditorDraft(
  challenge: Challenge,
  draft: PersonalChallengeEditorDraft,
  todayISO: string,
  options: { hasFlexibleHistory?: boolean } = {},
): Challenge {
  const text = String(draft.text ?? "").trim() || String(challenge.text ?? "");
  const enabledChallenge = transitionChallengeEnabled(challenge, !!draft.enabled, todayISO);

  if (draft.period === FLEXIBLE_WEEKLY_PERIOD) {
    const target = clampFlexibleWeeklyTarget(draft.target);
    const startDay = clampFlexibleWeeklyStartDay(draft.flexibleStartDay);
    const mayConfigureImmediately = challenge.period === FLEXIBLE_WEEKLY_PERIOD &&
      options.hasFlexibleHistory !== true &&
      !challenge.flexibleWeeklyLastEvaluatedPeriodStart &&
      String(challenge.flexibleWeeklyFirstPeriodStart ?? todayISO) >= todayISO;
    return {
      ...scheduleFlexibleWeeklySettings(
        enabledChallenge,
        target,
        startDay,
        todayISO,
        mayConfigureImmediately,
      ),
      text,
      easyMode: challenge.easyMode === true || draft.easyMode === true,
    };
  }

  const normalizedCustomDays = normalizePersonalChallengeCustomDays(draft.customDays);
  const customDays = draft.period === "custom"
    ? (normalizedCustomDays.length > 0 ? normalizedCustomDays : [localDayMon0(todayISO)])
    : [];
  return {
    ...enabledChallenge,
    text,
    easyMode: challenge.easyMode === true || draft.easyMode === true,
    targetPerDay: dailyTarget(draft.target),
    period: draft.period,
    customDays,
    periodAnchor: draft.period === "every2"
      ? (draft.periodAnchor || todayISO)
      : undefined,
  };
}
