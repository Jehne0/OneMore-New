import type { WidgetDayState, WidgetLanguage, WidgetModel } from "./widgetModel";

export const IOS_WIDGET_SNAPSHOT_VERSION = 2;
/** Legacy iOS 16 widgets share this app-managed selection. iOS 17 widgets keep their own AppIntent configuration. */
export const IOS_WIDGET_CONFIG_ID = -1701;

export type IosWidgetMutation = {
  mutationId: string;
  uid: string;
  challengeId: string;
  challengeType: "personal" | "shared";
  date: string;
  expectedDoneBefore: number;
  createdAtISO: string;
};

export type IosWidgetDailyState = {
  date: string;
  done: number;
  target: number;
  completed: boolean;
  active: boolean;
  dayState: WidgetDayState;
  completedOnCurrentDate?: boolean;
  currentStreak?: number;
  bestStreak?: number;
  week: { date: string; kind: "completed" | "partial" | "missed" | "inactive" | "future"; done: number; target: number }[];
};

export type IosWidgetChallengeSnapshot = {
  challengeId: string;
  challengeName: string;
  challengeType: "personal" | "shared";
  currentStreak: number;
  bestStreak: number;
  todayDone: number;
  todayTarget: number;
  todayCompleted: boolean;
  isActiveToday: boolean;
  dayState: WidgetDayState;
  lockedByPremiumExpiration: boolean;
  allowsMultipleCompletionsToday?: boolean;
  completedOnCurrentDate?: boolean;
  competitiveStreakEnabled?: boolean;
  week: { date: string; kind: "completed" | "partial" | "missed" | "inactive" | "future"; done: number; target: number }[];
  /** Precomputed canonical states let WidgetKit cross midnight without React Native. */
  timelineDays: IosWidgetDailyState[];
};

export type IosWidgetConfigurationSnapshot = {
  version: 2;
  configurationKey: string;
  orderedChallengeIds: string[];
  premiumSelectedChallengeIds: string[];
  premiumSelectionRecorded: boolean;
  lastPremiumActive: boolean | null;
  updatedAtISO: string;
};

export type IosWidgetSessionState = "authenticated" | "restoring" | "confirmedSignedOut";
export type IosWidgetPremiumState = "checking" | "free" | "premium";

export type IosWidgetSnapshot = {
  version: 2;
  snapshotRevision: number;
  sessionState: IosWidgetSessionState;
  /** Both values must match before native code may display account data. */
  activeUid: string | null;
  accountUid: string | null;
  locale: WidgetLanguage;
  premium: boolean;
  premiumState: IosWidgetPremiumState;
  premiumExpirationDate: string | null;
  premiumLifetime: boolean;
  defaultConfiguration: IosWidgetConfigurationSnapshot;
  selectedChallengeIds: string[];
  challenges: IosWidgetChallengeSnapshot[];
  completedToday: number;
  countableToday: number;
  generatedAtISO: string;
  generatedForDate: string;
  timeZoneIdentifier: string;
};

export type IosWidgetResolvedSelection = {
  configuration: IosWidgetConfigurationSnapshot;
  orderedIds: string[];
  activeIds: string[];
  frozenIds: string[];
};

type SnapshotOptions = {
  sessionState?: IosWidgetSessionState;
  premiumState?: IosWidgetPremiumState;
  premiumExpirationDate?: string | null;
  premiumLifetime?: boolean;
  snapshotRevision?: number;
  defaultConfiguration?: Partial<IosWidgetConfigurationSnapshot>;
  timelineModels?: { date: string; model: WidgetModel }[];
  timeZoneIdentifier?: string;
};

const uniqueIds = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))]
  : [];

function dailyStateFor(model: WidgetModel, challengeId: string, date: string): IosWidgetDailyState | null {
  const item = model.challenges.find((challenge) => challenge.id === challengeId);
  if (!item) return null;
  return {
    date,
    done: Math.max(0, item.done),
    target: Math.max(1, item.target),
    completed: item.dayState === "activeCompleted",
    active: item.isActiveToday,
    dayState: item.dayState,
    completedOnCurrentDate: item.completedOnCurrentDate === true,
    currentStreak: Math.max(0, item.streak),
    bestStreak: Math.max(0, item.bestStreak),
    week: item.week.map((day) => ({ ...day })),
  };
}

export function createIosWidgetSnapshot(
  model: WidgetModel,
  activeUid: string | null,
  date: string,
  generatedAtISO = new Date().toISOString(),
  options: SnapshotOptions = {},
): IosWidgetSnapshot {
  const sessionState = options.sessionState ?? (activeUid ? "authenticated" : "confirmedSignedOut");
  const accountUid = sessionState === "authenticated" ? activeUid : null;
  const premiumState = options.premiumState ?? (model.premium ? "premium" : "free");
  const timelineModels = [{ date, model }, ...(options.timelineModels ?? []).filter((item) => item.date !== date)];
  const challenges = model.challenges.map((item) => ({
    challengeId: item.id,
    challengeName: item.title.trim(),
    challengeType: item.shared ? "shared" as const : "personal" as const,
    currentStreak: Math.max(0, item.streak),
    bestStreak: Math.max(0, item.bestStreak),
    todayDone: Math.max(0, item.done),
    todayTarget: Math.max(1, item.target),
    todayCompleted: item.dayState === "activeCompleted",
    isActiveToday: item.isActiveToday,
    dayState: item.dayState,
    lockedByPremiumExpiration: item.lockedByPremiumExpiration === true,
    allowsMultipleCompletionsToday: item.allowsMultipleCompletionsToday !== false,
    completedOnCurrentDate: item.completedOnCurrentDate === true,
    competitiveStreakEnabled: item.competitiveStreakEnabled !== false,
    week: item.week.map((day) => ({ ...day })),
    timelineDays: timelineModels
      .map((frame) => dailyStateFor(frame.model, item.id, frame.date))
      .filter((value): value is IosWidgetDailyState => value !== null),
  }));
  const catalogIds = challenges.map((item) => item.challengeId);
  const provided = options.defaultConfiguration;
  const defaultConfiguration: IosWidgetConfigurationSnapshot = {
    version: 2,
    configurationKey: provided?.configurationKey ?? "legacy-default",
    orderedChallengeIds: uniqueIds(provided?.orderedChallengeIds ?? catalogIds),
    premiumSelectedChallengeIds: uniqueIds(provided?.premiumSelectedChallengeIds),
    premiumSelectionRecorded: provided?.premiumSelectionRecorded === true,
    lastPremiumActive: typeof provided?.lastPremiumActive === "boolean" ? provided.lastPremiumActive : null,
    updatedAtISO: provided?.updatedAtISO ?? generatedAtISO,
  };
  const catalog = new Set(catalogIds);
  const selectedChallengeIds = defaultConfiguration.orderedChallengeIds.filter((id) => catalog.has(id));
  const frozen = defaultConfiguration.lastPremiumActive === false && defaultConfiguration.premiumSelectionRecorded
    ? new Set(defaultConfiguration.premiumSelectedChallengeIds.filter((id) => id !== selectedChallengeIds[0]))
    : new Set<string>();
  const countable = challenges.filter((item) => selectedChallengeIds.includes(item.challengeId) && !frozen.has(item.challengeId) && item.isActiveToday);
  return {
    version: IOS_WIDGET_SNAPSHOT_VERSION,
    snapshotRevision: Math.max(0, Math.floor(options.snapshotRevision ?? 0)),
    sessionState,
    activeUid,
    accountUid,
    locale: model.language,
    premium: premiumState === "premium",
    premiumState,
    premiumExpirationDate: options.premiumExpirationDate ?? null,
    premiumLifetime: options.premiumLifetime === true,
    defaultConfiguration,
    selectedChallengeIds,
    challenges,
    completedToday: countable.filter((item) => item.dayState === "activeCompleted").length,
    countableToday: countable.length,
    generatedAtISO,
    generatedForDate: date,
    timeZoneIdentifier: options.timeZoneIdentifier ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
  };
}

const dayStates: WidgetDayState[] = ["activePending", "activeCompleted", "restDay"];
export function parseIosWidgetSnapshot(value: string): IosWidgetSnapshot | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const item = parsed as Partial<IosWidgetSnapshot>;
    if (item.version !== 2 || !(<unknown[]>["cs", "en", "pl", "de"]).includes(item.locale) || !Array.isArray(item.challenges)) return null;
    if (!(<unknown[]>["authenticated", "restoring", "confirmedSignedOut"]).includes(item.sessionState)) return null;
    if (!(<unknown[]>["checking", "free", "premium"]).includes(item.premiumState)) return null;
    if (item.activeUid !== null && typeof item.activeUid !== "string") return null;
    if (item.accountUid !== null && typeof item.accountUid !== "string") return null;
    if (item.sessionState === "authenticated" && (!item.activeUid || item.activeUid !== item.accountUid)) return null;
    if (typeof item.generatedAtISO !== "string" || typeof item.generatedForDate !== "string" || !Number.isSafeInteger(item.snapshotRevision)) return null;
    if (!item.defaultConfiguration || item.defaultConfiguration.version !== 2) return null;
    const challenges = item.challenges.filter((challenge): challenge is IosWidgetChallengeSnapshot =>
      !!challenge && typeof challenge.challengeId === "string" && typeof challenge.challengeName === "string" &&
      (challenge.challengeType === "personal" || challenge.challengeType === "shared") &&
      typeof challenge.isActiveToday === "boolean" && dayStates.includes(challenge.dayState) &&
      Number.isFinite(challenge.currentStreak) && Number.isFinite(challenge.todayDone) &&
      Number.isFinite(challenge.todayTarget) && Array.isArray(challenge.week) && Array.isArray(challenge.timelineDays));
    if (challenges.length !== item.challenges.length) return null;
    return { ...item, challenges } as IosWidgetSnapshot;
  } catch {
    return null;
  }
}

export function isIosWidgetPremiumActiveAt(snapshot: IosWidgetSnapshot, now = Date.now()): boolean {
  if (snapshot.premiumState !== "premium") return false;
  if (snapshot.premiumLifetime) return true;
  if (!snapshot.premiumExpirationDate) return false;
  const expiration = Date.parse(snapshot.premiumExpirationDate);
  return Number.isFinite(expiration) && expiration > now;
}

/** Pure TypeScript mirror of WidgetSharedState.swift configuration v2 rules. */
export function normalizeIosWidgetSelectionV2(input: {
  configuration: IosWidgetConfigurationSnapshot | null;
  configurationKey: string;
  requestedIds: string[];
  availableIds: string[];
  premiumState: IosWidgetPremiumState;
  premiumActive: boolean;
  nowISO?: string;
}): IosWidgetResolvedSelection {
  const available = new Set(uniqueIds(input.availableIds));
  const requested = uniqueIds(input.requestedIds).filter((id) => available.has(id));
  const previous = input.configuration?.configurationKey === input.configurationKey ? input.configuration : null;
  const base: IosWidgetConfigurationSnapshot = previous ?? {
    version: 2,
    configurationKey: input.configurationKey,
    orderedChallengeIds: requested,
    premiumSelectedChallengeIds: [],
    premiumSelectionRecorded: false,
    lastPremiumActive: null,
    updatedAtISO: input.nowISO ?? new Date().toISOString(),
  };
  let ordered: string[];
  let frozenIds: string[] = [];
  let configuration = { ...base };
  if (input.premiumState === "checking") {
    ordered = uniqueIds(previous?.orderedChallengeIds ?? requested).filter((id) => available.has(id));
    if (previous?.lastPremiumActive === false && previous.premiumSelectionRecorded) {
      frozenIds = uniqueIds(previous.premiumSelectedChallengeIds).filter((id) => available.has(id) && id !== ordered[0]);
    }
  } else if (input.premiumActive) {
    ordered = previous?.lastPremiumActive === false
      ? previous.premiumSelectionRecorded
        ? uniqueIds(previous.premiumSelectedChallengeIds).filter((id) => available.has(id))
        : requested.slice(0, 1)
      : requested;
    configuration = {
      ...configuration,
      orderedChallengeIds: ordered,
      premiumSelectedChallengeIds: ordered,
      premiumSelectionRecorded: true,
      lastPremiumActive: true,
    };
  } else {
    const active = requested[0] ?? previous?.orderedChallengeIds[0] ?? input.availableIds[0];
    const proven = previous?.premiumSelectionRecorded
      ? uniqueIds(previous.premiumSelectedChallengeIds).filter((id) => available.has(id))
      : [];
    frozenIds = proven.filter((id) => id !== active && requested.includes(id));
    ordered = uniqueIds([...(active ? [active] : []), ...frozenIds]);
    configuration = {
      ...configuration,
      orderedChallengeIds: ordered,
      premiumSelectedChallengeIds: proven,
      lastPremiumActive: false,
    };
  }
  configuration = { ...configuration, orderedChallengeIds: ordered, updatedAtISO: input.nowISO ?? new Date().toISOString() };
  return {
    configuration,
    orderedIds: ordered,
    activeIds: input.premiumActive || input.premiumState === "checking" ? ordered : ordered.slice(0, 1),
    frozenIds,
  };
}

export function limitIosWidgetChallenges(snapshot: IosWidgetSnapshot, now = Date.now()) {
  return isIosWidgetPremiumActiveAt(snapshot, now) ? snapshot.challenges : snapshot.challenges.slice(0, 1);
}

export function iosWidgetRowsForFamily(family: "systemSmall" | "systemMedium" | "systemLarge", count: number) {
  return Math.min(count, family === "systemSmall" ? 1 : family === "systemMedium" ? 2 : 5);
}

export function nextLocalMidnight(now = new Date()) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next;
}

export function nextWidgetTimelineDates(now = new Date(), days = 8): string[] {
  return Array.from({ length: days }, (_, offset) => {
    const value = new Date(now);
    value.setHours(12, 0, 0, 0);
    value.setDate(value.getDate() + offset);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  });
}

export function containsSensitiveWidgetData(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    /token|password|secret|apiKey|refreshToken/i.test(key) || containsSensitiveWidgetData(child));
}
