import {
  REMINDER_OPERATION_DATA_KEY,
  enqueueReminderCleanup,
  readReminderCleanupQueue,
  readReminderOperationJournals,
  removeReminderCleanup,
  removeReminderOperationJournal,
  type NotificationJournalStore,
  type ReminderOperationJournal,
} from "./notificationJournal";
import type { AppState } from "./storage";
import { acquireReminderMutationLock } from "./reminderMutationLock";

export type RecoveryNotifications = {
  getAllScheduledNotificationsAsync(): Promise<any[]>;
  cancelScheduledNotificationAsync(id: string): Promise<void>;
};

export type ReminderRecoveryRuntime = {
  uid: string;
  store: NotificationJournalStore;
  Notifications: RecoveryNotifications;
  loadCanonicalState(): Promise<AppState>;
  isUidCurrent(): boolean;
  challengeId?: string;
};

function notificationId(item: any): string {
  return String(item?.identifier ?? "");
}

function idsForOperation(items: any[], operationId: string): string[] {
  return Array.from(new Set(items.filter((item) =>
    String(item?.content?.data?.[REMINDER_OPERATION_DATA_KEY] ?? "") === operationId)
    .map(notificationId).filter(Boolean)));
}

class ReminderUidChangedError extends Error {
  constructor() {
    super("NOTIFICATION_UID_CHANGED");
  }
}

function requireCurrent(runtime: Pick<ReminderRecoveryRuntime, "isUidCurrent">): void {
  if (!runtime.isUidCurrent()) throw new ReminderUidChangedError();
}

async function cancelAndVerify(
  Notifications: RecoveryNotifications,
  ids: string[],
  isUidCurrent: () => boolean,
): Promise<void> {
  const unique = Array.from(new Set(ids.map(String).filter(Boolean)));
  const failures: { id: string; error: unknown }[] = [];
  for (const id of unique) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!isUidCurrent()) throw new ReminderUidChangedError();
      try {
        await Notifications.cancelScheduledNotificationAsync(id);
        if (!isUidCurrent()) throw new ReminderUidChangedError();
        lastError = undefined;
        break;
      } catch (error) {
        if (error instanceof ReminderUidChangedError) throw error;
        lastError = error;
      }
    }
    if (lastError !== undefined) failures.push({ id, error: lastError });
  }
  if (!isUidCurrent()) throw new ReminderUidChangedError();
  const remainingScheduled = new Set((await Notifications.getAllScheduledNotificationsAsync()).map(notificationId));
  if (!isUidCurrent()) throw new ReminderUidChangedError();
  const remaining = unique.filter((id) => remainingScheduled.has(id));
  if (remaining.length) {
    const error = new Error(`NOTIFICATION_CLEANUP_PENDING:${remaining.join(",")}`);
    (error as any).failures = failures;
    throw error;
  }
}

function sameIdSet(left: string[], right: string[]): boolean {
  const a = Array.from(new Set(left.map(String).filter(Boolean))).sort();
  const b = Array.from(new Set(right.map(String).filter(Boolean))).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function operationPersistedInState(journal: ReminderOperationJournal, state: AppState, newIds: string[]): boolean {
  if (journal.phase === "persisted" || journal.phase === "cleaningOld") return true;
  const challenge = (state.challenges ?? []).find((item) => String(item.id) === journal.challengeId);
  const canonicalIds = (state.reminderNotifIds ?? {})[journal.challengeId] ?? [];
  if (journal.enabled) return challenge?.reminderEnabled === true && sameIdSet(canonicalIds, newIds);
  return challenge?.reminderEnabled !== true && canonicalIds.length === 0;
}

export async function processReminderCleanupQueue(
  runtime: Pick<ReminderRecoveryRuntime, "uid" | "store" | "Notifications" | "isUidCurrent">,
  challengeId?: string,
): Promise<void> {
  const items = await readReminderCleanupQueue(runtime.uid, runtime.store);
  if (!runtime.isUidCurrent()) return;
  for (const item of items) {
    if (!runtime.isUidCurrent() || challengeId && item.challengeId !== challengeId) continue;
    try {
      const scheduled = await runtime.Notifications.getAllScheduledNotificationsAsync();
      requireCurrent(runtime);
      const tagged = item.includeOperationTaggedNotifications ? idsForOperation(scheduled, item.operationId) : [];
      requireCurrent(runtime);
      await cancelAndVerify(runtime.Notifications, [...item.ids, ...tagged], runtime.isUidCurrent);
      requireCurrent(runtime);
      await removeReminderCleanup(
        runtime.uid,
        item.operationId,
        item.challengeId,
        runtime.store,
        runtime.isUidCurrent,
      );
      requireCurrent(runtime);
    } catch (error) {
      if (error instanceof ReminderUidChangedError) return;
      // Bounded to one attempt per item/pass; durable state is retried later.
    }
  }
}

export async function recoverReminderNotificationOperationsUnlocked(runtime: ReminderRecoveryRuntime): Promise<void> {
  if (!runtime.uid || !runtime.isUidCurrent()) return;
  await processReminderCleanupQueue(runtime, runtime.challengeId);
  if (!runtime.isUidCurrent()) return;
  const journals = await readReminderOperationJournals(runtime.uid, runtime.store);
  if (!runtime.isUidCurrent()) return;
  for (const journal of journals) {
    if (!runtime.isUidCurrent() || runtime.challengeId && journal.challengeId !== runtime.challengeId) continue;
    try {
      const scheduled = await runtime.Notifications.getAllScheduledNotificationsAsync();
      requireCurrent(runtime);
      const discoveredNewIds = Array.from(new Set([...journal.newIds, ...idsForOperation(scheduled, journal.operationId)]));
      const state = await runtime.loadCanonicalState();
      requireCurrent(runtime);
      const persisted = operationPersistedInState(journal, state, discoveredNewIds);
      requireCurrent(runtime);
      await enqueueReminderCleanup({
        operationId: journal.operationId,
        uid: runtime.uid,
        challengeId: journal.challengeId,
        ids: persisted ? journal.originalIds : discoveredNewIds,
        includeOperationTaggedNotifications: !persisted,
        createdAtISO: journal.createdAtISO,
      }, runtime.store, runtime.isUidCurrent);
      requireCurrent(runtime);
      await processReminderCleanupQueue(runtime, journal.challengeId);
      requireCurrent(runtime);
      const remaining = await readReminderCleanupQueue(runtime.uid, runtime.store);
      requireCurrent(runtime);
      if (!remaining.some((item) => item.operationId === journal.operationId && item.challengeId === journal.challengeId)) {
        requireCurrent(runtime);
        await removeReminderOperationJournal(
          runtime.uid,
          journal.operationId,
          runtime.store,
          runtime.isUidCurrent,
        );
        requireCurrent(runtime);
      }
    } catch (error) {
      if (error instanceof ReminderUidChangedError) return;
      // Journal remains durable for a later startup/foreground/change pass.
    }
  }
}

export async function recoverReminderNotificationOperations(runtime: ReminderRecoveryRuntime): Promise<void> {
  if (!runtime.uid || !runtime.isUidCurrent()) return;
  const release = await acquireReminderMutationLock(runtime.uid);
  try {
    if (!runtime.isUidCurrent()) return;
    await recoverReminderNotificationOperationsUnlocked(runtime);
  } finally {
    release();
  }
}
