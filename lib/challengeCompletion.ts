import AsyncStorage from "@react-native-async-storage/async-storage";
import { getTodayISO } from "./clock";
import {
  type AppState,
  type Challenge,
  isChallengeActiveOnDate,
  isChallengeEasyMode,
  loadStateForUid,
  saveStateForUid,
  updateStatsOnCompleted,
} from "./storage";
import {
  FLEXIBLE_WEEKLY_PERIOD,
  canCompleteFlexibleWeekly,
  flexibleWeeklyProgress,
  reconcileFlexibleWeeklyPeriods,
  updateFlexibleWeeklyStatsOnCompletion,
} from "./flexibleWeekly";

export type CompletionMutation = {
  id: string;
  uid: string;
  challengeId: string;
  date: string;
  createdAtISO: string;
};

export type CompletionResult =
  | { status: "completed"; state: AppState; completedDay: boolean }
  | { status: "already-completed" | "inactive" | "not-found"; state: AppState };

const outboxKey = (uid: string) => `onemore_widget_outbox_${uid}`;
const locks = new Map<string, Promise<CompletionResult>>();
type CompletionStore = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> };
export type CompletionRepository = {
  store: CompletionStore;
  load(uid: string): Promise<AppState>;
  save(state: AppState, uid: string): Promise<void>;
};

export async function readCompletionOutbox(uid: string, store: CompletionStore = AsyncStorage): Promise<CompletionMutation[]> {
  try {
    const parsed: unknown = JSON.parse((await store.getItem(outboxKey(uid))) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is CompletionMutation =>
          !!item && typeof item === "object" &&
          (item as CompletionMutation).uid === uid &&
          typeof (item as CompletionMutation).challengeId === "string" &&
          typeof (item as CompletionMutation).date === "string")
      : [];
  } catch {
    return [];
  }
}

async function enqueue(mutation: CompletionMutation, store: CompletionStore): Promise<void> {
  const current = await readCompletionOutbox(mutation.uid, store);
  if (current.some((item) => item.id === mutation.id)) return;
  await store.setItem(outboxKey(mutation.uid), JSON.stringify([...current, mutation]));
}

export async function clearCompletionOutbox(uid: string): Promise<void> {
  await AsyncStorage.removeItem(outboxKey(uid));
}

export async function acknowledgeCompletionOutbox(uid: string): Promise<void> {
  await clearCompletionOutbox(uid);
}

function targetFor(challenge: Challenge): number {
  if (challenge.period === FLEXIBLE_WEEKLY_PERIOD) {
    return flexibleWeeklyProgress(challenge, [], getTodayISO()).target;
  }
  const raw = Math.floor(Number(challenge.targetPerDay ?? 1));
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

export function applyChallengeCompletion(
  state: AppState,
  challengeId: string,
  date = getTodayISO(),
  now = new Date()
): CompletionResult {
  const id = String(challengeId);
  state = reconcileFlexibleWeeklyPeriods(state, date, {
    challengeIds: [id],
    isActiveOnDate: (challenge, day) => isChallengeActiveOnDate(challenge, day),
    isEasyMode: (challenge) => isChallengeEasyMode(challenge),
  }).next;
  const challenge = (state.challenges ?? []).find((item) => String(item.id) === id);
  if (!challenge) return { status: "not-found", state };
  if (!isChallengeActiveOnDate(challenge, date)) return { status: "inactive", state };

  const completedToday = (state.history ?? []).filter(
    (entry) => entry.date === date && entry.status === "completed" && String(entry.challengeId) === id
  ).length;
  const flexible = challenge.period === FLEXIBLE_WEEKLY_PERIOD;
  const flexibleProgress = flexible ? flexibleWeeklyProgress(challenge, state.history ?? [], date) : null;
  const completed = flexibleProgress?.done ?? completedToday;
  const target = flexibleProgress?.target ?? targetFor(challenge);
  if ((flexible && !canCompleteFlexibleWeekly(challenge, state.history ?? [], date)) || (!flexible && completed >= target)) {
    return { status: "already-completed", state };
  }

  const completedDay = flexible || completed + 1 >= target;
  const completedPeriod = completed + 1 >= target;
  const history = (state.history ?? []).filter(
    (entry) => !(entry.date === date && entry.status === "skipped" && String(entry.challengeId) === id)
  );
  const ever = new Set((state.everCompletedKeys ?? []).map(String));
  if (completedDay) ever.add(`id:${id}`);
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const next: AppState = {
    ...state,
    challengeStats: flexible
      ? updateFlexibleWeeklyStatsOnCompletion(state, id, date, isChallengeEasyMode(challenge))
      : completedDay ? updateStatsOnCompleted(state, id, date) : state.challengeStats,
    history: [{
      date,
      time,
      atISO: now.toISOString(),
      challengeId: id,
      challengeText: challenge.text,
      status: "completed",
      ...(flexible ? { eventType: "flexibleWeeklyCompleted" as const } : {}),
      partial: flexible ? false : !completedDay,
    }, ...history],
    lastCompletedDate: completedDay && !isChallengeEasyMode(challenge) ? date : state.lastCompletedDate,
    everCompletedKeys: Array.from(ever),
  };
  return { status: "completed", state: next, completedDay: flexible ? completedPeriod : completedDay };
}

export async function completeChallengeForUid(
  uid: string,
  challengeId: string,
  date = getTodayISO()
): Promise<CompletionResult> {
  return completeChallengeWithRepository(uid, challengeId, date, {
    store: AsyncStorage,
    load: loadStateForUid,
    save: saveStateForUid,
  });
}

export async function completeChallengeWithRepository(
  uid: string,
  challengeId: string,
  date: string,
  repository: CompletionRepository
): Promise<CompletionResult> {
  const lockKey = `${uid}:${challengeId}:${date}`;
  const existing = locks.get(lockKey);
  if (existing) return existing;

  const operation: Promise<CompletionResult> = (async (): Promise<CompletionResult> => {
    const state = await repository.load(uid);
    const result = applyChallengeCompletion(state, challengeId, date);
    if (result.status !== "completed") return result;
    const mutation: CompletionMutation = {
      id: `${uid}:${challengeId}:${date}`,
      uid,
      challengeId: String(challengeId),
      date,
      createdAtISO: new Date().toISOString(),
    };
    // Durable intent first: a crash/network loss cannot make cloud bootstrap win.
    await enqueue(mutation, repository.store);
    await repository.save(result.state, uid);
    return result;
  })().finally(() => locks.delete(lockKey));
  locks.set(lockKey, operation);
  return operation;
}
