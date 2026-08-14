import AsyncStorage from "@react-native-async-storage/async-storage";

export const REMINDER_OPERATION_DATA_KEY = "oneMoreReminderOperationId";
export const REMINDER_REVISION_DATA_KEY = "oneMoreReminderRevision";

export type ReminderOperationPhase =
  | "prepared"
  | "scheduling"
  | "scheduled"
  | "persisted"
  | "rollingBack"
  | "cleaningOld";

export type ReminderOperationJournal = {
  operationId: string;
  uid: string;
  challengeId: string;
  revision: string;
  enabled: boolean;
  originalIds: string[];
  newIds: string[];
  phase: ReminderOperationPhase;
  createdAtISO: string;
  updatedAtISO: string;
};

export type ReminderCleanupItem = {
  operationId: string;
  uid: string;
  challengeId: string;
  ids: string[];
  includeOperationTaggedNotifications: boolean;
  createdAtISO: string;
};

export type NotificationJournalStore = Pick<
  typeof AsyncStorage,
  "getItem" | "setItem" | "removeItem"
>;

const journalKey = (uid: string) => `onemore_notification_journal_v1_${uid}`;
const cleanupKey = (uid: string) => `onemore_notification_cleanup_v1_${uid}`;
const storeLocks = new Map<string, Promise<void>>();
type MutationGuard = () => boolean;

function requireMutationAllowed(guard?: MutationGuard): void {
  if (guard && !guard()) throw new Error("NOTIFICATION_UID_CHANGED");
}

function uniqueIds(ids: unknown): string[] {
  return Array.from(new Set(
    (Array.isArray(ids) ? ids : []).map(String).filter(Boolean),
  ));
}

function normalizeJournal(value: unknown, uid: string): ReminderOperationJournal | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ReminderOperationJournal>;
  const phases: ReminderOperationPhase[] = [
    "prepared", "scheduling", "scheduled", "persisted", "rollingBack", "cleaningOld",
  ];
  if (!raw.operationId || raw.uid !== uid || !raw.challengeId || !raw.revision ||
      !phases.includes(raw.phase as ReminderOperationPhase)) return null;
  return {
    operationId: String(raw.operationId),
    uid,
    challengeId: String(raw.challengeId),
    revision: String(raw.revision),
    enabled: raw.enabled === true,
    originalIds: uniqueIds(raw.originalIds),
    newIds: uniqueIds(raw.newIds),
    phase: raw.phase as ReminderOperationPhase,
    createdAtISO: typeof raw.createdAtISO === "string" ? raw.createdAtISO : new Date(0).toISOString(),
    updatedAtISO: typeof raw.updatedAtISO === "string" ? raw.updatedAtISO : new Date(0).toISOString(),
  };
}

function normalizeCleanup(value: unknown, uid: string): ReminderCleanupItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ReminderCleanupItem[] => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Partial<ReminderCleanupItem>;
    if (!raw.operationId || raw.uid !== uid || !raw.challengeId) return [];
    return [{
      operationId: String(raw.operationId),
      uid,
      challengeId: String(raw.challengeId),
      ids: uniqueIds(raw.ids),
      includeOperationTaggedNotifications: raw.includeOperationTaggedNotifications === true,
      createdAtISO: typeof raw.createdAtISO === "string" ? raw.createdAtISO : new Date(0).toISOString(),
    }];
  });
}

async function serialized<T>(uid: string, operation: () => Promise<T>): Promise<T> {
  const previous = storeLocks.get(uid) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const chained = previous.catch(() => undefined).then(() => current);
  storeLocks.set(uid, chained);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (storeLocks.get(uid) === chained) storeLocks.delete(uid);
  }
}

export async function readReminderOperationJournals(
  uid: string,
  store: NotificationJournalStore = AsyncStorage,
): Promise<ReminderOperationJournal[]> {
  if (!uid) return [];
  try {
    const parsed: unknown = JSON.parse((await store.getItem(journalKey(uid))) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.map((item) => normalizeJournal(item, uid)).filter((item): item is ReminderOperationJournal => !!item)
      : [];
  } catch {
    return [];
  }
}

export async function writeReminderOperationJournal(
  journal: ReminderOperationJournal,
  store: NotificationJournalStore = AsyncStorage,
  canMutate?: MutationGuard,
): Promise<void> {
  await serialized(journal.uid, async () => {
    const current = await readReminderOperationJournals(journal.uid, store);
    requireMutationAllowed(canMutate);
    const next = [...current.filter((item) => item.operationId !== journal.operationId), journal];
    await store.setItem(journalKey(journal.uid), JSON.stringify(next));
  });
}

export async function updateReminderOperationJournal(
  uid: string,
  operationId: string,
  update: (journal: ReminderOperationJournal) => ReminderOperationJournal,
  store: NotificationJournalStore = AsyncStorage,
  canMutate?: MutationGuard,
): Promise<ReminderOperationJournal | null> {
  return serialized(uid, async () => {
    const current = await readReminderOperationJournals(uid, store);
    requireMutationAllowed(canMutate);
    const index = current.findIndex((item) => item.operationId === operationId);
    if (index < 0) return null;
    const nextJournal = update(current[index]);
    const next = [...current];
    next[index] = { ...nextJournal, updatedAtISO: new Date().toISOString() };
    await store.setItem(journalKey(uid), JSON.stringify(next));
    return next[index];
  });
}

export async function removeReminderOperationJournal(
  uid: string,
  operationId: string,
  store: NotificationJournalStore = AsyncStorage,
  canMutate?: MutationGuard,
): Promise<void> {
  await serialized(uid, async () => {
    const current = await readReminderOperationJournals(uid, store);
    requireMutationAllowed(canMutate);
    const next = current.filter((item) => item.operationId !== operationId);
    if (next.length) await store.setItem(journalKey(uid), JSON.stringify(next));
    else await store.removeItem(journalKey(uid));
  });
}

export async function readReminderCleanupQueue(
  uid: string,
  store: NotificationJournalStore = AsyncStorage,
): Promise<ReminderCleanupItem[]> {
  if (!uid) return [];
  try {
    const parsed: unknown = JSON.parse((await store.getItem(cleanupKey(uid))) ?? "[]");
    return normalizeCleanup(parsed, uid);
  } catch {
    return [];
  }
}

export async function enqueueReminderCleanup(
  item: ReminderCleanupItem,
  store: NotificationJournalStore = AsyncStorage,
  canMutate?: MutationGuard,
): Promise<void> {
  await serialized(item.uid, async () => {
    const current = await readReminderCleanupQueue(item.uid, store);
    requireMutationAllowed(canMutate);
    const existing = current.find((value) => value.operationId === item.operationId && value.challengeId === item.challengeId);
    const merged: ReminderCleanupItem = existing ? {
      ...existing,
      ids: uniqueIds([...existing.ids, ...item.ids]),
      includeOperationTaggedNotifications:
        existing.includeOperationTaggedNotifications || item.includeOperationTaggedNotifications,
    } : { ...item, ids: uniqueIds(item.ids) };
    const next = [...current.filter((value) =>
      value.operationId !== item.operationId || value.challengeId !== item.challengeId), merged];
    await store.setItem(cleanupKey(item.uid), JSON.stringify(next));
  });
}

export async function removeReminderCleanup(
  uid: string,
  operationId: string,
  challengeId: string,
  store: NotificationJournalStore = AsyncStorage,
  canMutate?: MutationGuard,
): Promise<void> {
  await serialized(uid, async () => {
    const current = await readReminderCleanupQueue(uid, store);
    requireMutationAllowed(canMutate);
    const next = current.filter((item) =>
      item.operationId !== operationId || item.challengeId !== challengeId);
    if (next.length) await store.setItem(cleanupKey(uid), JSON.stringify(next));
    else await store.removeItem(cleanupKey(uid));
  });
}

export function createReminderOperationJournal(input: {
  uid: string;
  challengeId: string;
  enabled: boolean;
  originalIds: string[];
  now?: Date;
}): ReminderOperationJournal {
  const now = input.now ?? new Date();
  const revision = `${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`;
  const operationId = `${input.uid}:${input.challengeId}:${revision}`;
  const iso = now.toISOString();
  return {
    operationId,
    uid: input.uid,
    challengeId: input.challengeId,
    revision,
    enabled: input.enabled,
    originalIds: uniqueIds(input.originalIds),
    newIds: [],
    phase: "prepared",
    createdAtISO: iso,
    updatedAtISO: iso,
  };
}
