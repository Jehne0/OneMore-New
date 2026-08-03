import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth } from "./firebase";
import { requestIosWidgetStateSync } from "./iosWidgetUpdateSignal";
import {
  completeSharedChallengeToday,
  completeSharedChallengeFromWidgetBackend,
  isAcceptedSharedChallengeForUid,
  isSharedChallengeActiveOnDate,
  type SharedChallenge,
} from "./sharedChallenges";

export type CachedSharedChallenge = SharedChallenge & { completedByDate: Record<string, number> };
export type SharedCompletionMutation = {
  mutationId: string;
  uid: string;
  challengeId: string;
  date: string;
  ordinal: number;
  createdAtISO: string;
  attempts: number;
};
export type SharedCompletionStatus = "completed" | "already-completed" | "invalid" | "signed-out";
export type SharedReplayResult = { confirmed: number; rejected: number; pending: number };

type SharedStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};
type RemoteCompleter = (mutation: SharedCompletionMutation) => Promise<number>;

const cacheKey = (uid: string) => `onemore_shared_widget_cache_${uid}`;
const cacheBackupKey = (uid: string) => `onemore_shared_widget_cache_backup_${uid}`;
const outboxKey = (uid: string) => `onemore_shared_widget_outbox_${uid}`;
const locks = new Map<string, Promise<SharedCompletionStatus>>();

function cleanChallenges(value: unknown, uid: string): CachedSharedChallenge[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CachedSharedChallenge => {
    if (!item || typeof item !== "object") return false;
    const challenge = item as CachedSharedChallenge;
    return typeof challenge.id === "string" && Array.isArray(challenge.memberUids) &&
      challenge.memberUids.includes(uid) && !(challenge.leftBy ?? []).includes(uid);
  }).map((item) => ({ ...item, completedByDate: item.completedByDate ?? {} }));
}

export async function readSharedCache(uid: string, store: SharedStore = AsyncStorage): Promise<CachedSharedChallenge[]> {
  try { return cleanChallenges(JSON.parse((await store.getItem(cacheKey(uid))) ?? "[]"), uid); }
  catch {
    try { return cleanChallenges(JSON.parse((await store.getItem(cacheBackupKey(uid))) ?? "[]"), uid); }
    catch { return []; }
  }
}

async function writeSharedCache(uid: string, value: CachedSharedChallenge[], store: SharedStore) {
  const current = await store.getItem(cacheKey(uid));
  if (current) await store.setItem(cacheBackupKey(uid), current);
  await store.setItem(cacheKey(uid), JSON.stringify(value));
  if (store === AsyncStorage) requestIosWidgetStateSync();
}

export async function cacheSharedChallenges(uid: string, challenges: SharedChallenge[], store: SharedStore = AsyncStorage) {
  const previous = new Map((await readSharedCache(uid, store)).map((item) => [item.id, item]));
  const safe = challenges
    .filter((item) => item.memberUids.includes(uid) && !(item.leftBy ?? []).includes(uid))
    .map((item) => ({ ...item, completedByDate: previous.get(item.id)?.completedByDate ?? {} }));
  await writeSharedCache(uid, safe, store);
}

export async function cacheSharedProgress(
  uid: string, challengeId: string, date: string, completedCount: number, store: SharedStore = AsyncStorage
) {
  const list = await readSharedCache(uid, store);
  const next = list.map((item) => item.id === challengeId ? {
    ...item, completedByDate: { ...item.completedByDate, [date]: Math.max(0, Math.floor(completedCount)) },
  } : item);
  await writeSharedCache(uid, next, store);
}

export async function cacheSharedProgressHistory(
  uid: string,
  challengeId: string,
  rows: { date: string; completedCount: number }[],
  store: SharedStore = AsyncStorage
) {
  const validRows = rows
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-7);
  const list = await readSharedCache(uid, store);
  const next = list.map((item) => {
    if (item.id !== challengeId) return item;
    const completedByDate = { ...item.completedByDate };
    for (const row of validRows) {
      const remoteCount = Math.max(0, Math.floor(Number(row.completedCount) || 0));
      completedByDate[row.date] = Math.max(completedByDate[row.date] ?? 0, remoteCount);
    }
    return { ...item, completedByDate };
  });
  await writeSharedCache(uid, next, store);
}

export async function readSharedOutbox(uid: string, store: SharedStore = AsyncStorage): Promise<SharedCompletionMutation[]> {
  try {
    const value: unknown = JSON.parse((await store.getItem(outboxKey(uid))) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is SharedCompletionMutation =>
      !!item && typeof item === "object" && (item as SharedCompletionMutation).uid === uid &&
      typeof (item as SharedCompletionMutation).mutationId === "string") : [];
  } catch { return []; }
}

async function writeOutbox(uid: string, items: SharedCompletionMutation[], store: SharedStore) {
  await store.setItem(outboxKey(uid), JSON.stringify(items));
}

async function removeRejectedChallenge(uid: string, challengeId: string, store: SharedStore) {
  const list = await readSharedCache(uid, store);
  await writeSharedCache(uid, list.filter((item) => item.id !== challengeId), store);
}

export function validateCachedSharedChallenge(item: CachedSharedChallenge, uid: string, date: string): boolean {
  return item.enabled !== false && item.status === "active" &&
    isAcceptedSharedChallengeForUid(item, uid) && isSharedChallengeActiveOnDate(item, date);
}

export async function completeSharedChallengeForUid(
  uid: string, challengeId: string, date: string, store: SharedStore = AsyncStorage
): Promise<SharedCompletionStatus> {
  const key = `${uid}:${challengeId}:${date}`;
  const running = locks.get(key);
  if (running) return running;
  const task = (async () => {
    const list = await readSharedCache(uid, store);
    const challenge = list.find((item) => item.id === challengeId);
    if (!challenge || !validateCachedSharedChallenge(challenge, uid, date)) return "invalid" as const;
    const count = Math.max(0, challenge.completedByDate[date] ?? 0);
    if (count >= challenge.targetPerDay) return "already-completed" as const;
    const ordinal = count + 1;
    const mutationId = `shared:${uid}:${challengeId}:${date}:${ordinal}`;
    const outbox = await readSharedOutbox(uid, store);
    if (!outbox.some((item) => item.mutationId === mutationId)) {
      await writeOutbox(uid, [...outbox, { mutationId, uid, challengeId, date, ordinal, createdAtISO: new Date().toISOString(), attempts: 0 }], store);
    }
    await cacheSharedProgress(uid, challengeId, date, ordinal, store);
    return "completed" as const;
  })().finally(() => locks.delete(key));
  locks.set(key, task);
  return task;
}

function isPermanent(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? error);
  return ["not-member", "disabled", "left", "not-accepted", "not-active", "rest-day", "not-found", "permission-denied"]
    .some((code) => message.includes(code));
}

export async function replaySharedCompletionOutbox(
  uid: string,
  remote: RemoteCompleter,
  store: SharedStore = AsyncStorage
): Promise<SharedReplayResult> {
  const mutations = await readSharedOutbox(uid, store);
  const remaining: SharedCompletionMutation[] = [];
  let confirmed = 0;
  let rejected = 0;
  for (const mutation of mutations) {
    if (mutation.uid !== uid) continue;
    try {
      const count = await remote(mutation);
      await cacheSharedProgress(uid, mutation.challengeId, mutation.date, count, store);
      confirmed += 1;
    } catch (error) {
      if (isPermanent(error)) {
        rejected += 1;
        await removeRejectedChallenge(uid, mutation.challengeId, store);
      } else {
        remaining.push({ ...mutation, attempts: mutation.attempts + 1 });
      }
    }
  }
  await writeOutbox(uid, remaining, store);
  return { confirmed, rejected, pending: remaining.length };
}

export async function replaySharedCompletionsForCurrentUser(uid: string): Promise<SharedReplayResult> {
  if (auth.currentUser?.uid !== uid) return { confirmed: 0, rejected: 0, pending: (await readSharedOutbox(uid)).length };
  return replaySharedCompletionOutbox(uid, (mutation) =>
    completeSharedChallengeToday(mutation.challengeId, mutation.date, mutation.mutationId)
  );
}

/** iOS widget replay always crosses an authenticated callable permission boundary. */
export async function replayIosSharedCompletionsForCurrentUser(uid: string): Promise<SharedReplayResult> {
  if (auth.currentUser?.uid !== uid) return { confirmed: 0, rejected: 0, pending: (await readSharedOutbox(uid)).length };
  return replaySharedCompletionOutbox(uid, (mutation) =>
    completeSharedChallengeFromWidgetBackend(mutation.challengeId, mutation.date, mutation.mutationId)
  );
}
