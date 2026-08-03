import AsyncStorage from "@react-native-async-storage/async-storage";
import { getTodayISO } from "./clock";
import { completeChallengeForUid, type CompletionResult } from "./challengeCompletion";
import { auth } from "./firebase";

export const PENDING_WIDGET_COMPLETIONS_KEY = "onemore_pending_widget_completions";

export type PendingWidgetCompletion = {
  id: string;
  uid: string;
  challengeId: string;
  date: string;
  createdAtISO: string;
};

type Store = Pick<typeof AsyncStorage, "getItem" | "setItem" | "removeItem">;
export type WidgetCompletionDependencies = {
  store: Store;
  authenticatedUid: () => string | null;
  complete: (uid: string, challengeId: string, date: string) => Promise<CompletionResult>;
  sync: (uid: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const defaultDependencies = (): WidgetCompletionDependencies => ({
  store: AsyncStorage,
  authenticatedUid: () => auth.currentUser?.uid ?? null,
  complete: completeChallengeForUid,
  sync: async (uid) => {
    const { syncNow } = await import("./cloudSync");
    await syncNow(uid);
  },
  refresh: async () => {
    const { updateAllOneMoreWidgets } = await import("../widgets/widgetService");
    await updateAllOneMoreWidgets();
  },
});

export async function readPendingWidgetCompletions(store: Store = AsyncStorage): Promise<PendingWidgetCompletion[]> {
  try {
    const parsed: unknown = JSON.parse((await store.getItem(PENDING_WIDGET_COMPLETIONS_KEY)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is PendingWidgetCompletion =>
      !!item && typeof item === "object" && typeof (item as PendingWidgetCompletion).id === "string" &&
      typeof (item as PendingWidgetCompletion).uid === "string" && typeof (item as PendingWidgetCompletion).challengeId === "string" &&
      typeof (item as PendingWidgetCompletion).date === "string") : [];
  } catch {
    return [];
  }
}

async function writePending(items: PendingWidgetCompletion[], store: Store): Promise<void> {
  if (items.length) await store.setItem(PENDING_WIDGET_COMPLETIONS_KEY, JSON.stringify(items));
  else await store.removeItem(PENDING_WIDGET_COMPLETIONS_KEY);
}

export async function enqueueWidgetCompletion(
  uid: string,
  challengeId: string,
  date = getTodayISO(),
  store: Store = AsyncStorage
): Promise<PendingWidgetCompletion> {
  const item: PendingWidgetCompletion = {
    id: `${uid}:${challengeId}:${date}`,
    uid,
    challengeId: String(challengeId),
    date,
    createdAtISO: new Date().toISOString(),
  };
  const current = await readPendingWidgetCompletions(store);
  if (!current.some((entry) => entry.id === item.id)) await writePending([...current, item], store);
  return item;
}

export async function drainPendingWidgetCompletions(
  uid: string,
  dependencies: WidgetCompletionDependencies = defaultDependencies()
): Promise<{ completed: number; pending: number }> {
  const current = await readPendingWidgetCompletions(dependencies.store);
  if (dependencies.authenticatedUid() !== uid) return { completed: 0, pending: current.length };

  let completed = 0;
  const remaining: PendingWidgetCompletion[] = [];
  for (const item of current) {
    if (item.uid !== uid) {
      remaining.push(item);
      continue;
    }
    try {
      const result = await dependencies.complete(uid, item.challengeId, item.date);
      if (result.status === "completed") completed += 1;
      // already-completed is successful idempotent delivery; invalid entries
      // are also consumed so a malformed action cannot loop forever.
    } catch {
      remaining.push(item);
    }
  }
  await writePending(remaining, dependencies.store);
  if (completed > 0) await dependencies.sync(uid).catch(() => {});
  await dependencies.refresh().catch(() => {});
  return { completed, pending: remaining.length };
}

export async function handleWidgetCompletion(
  uid: string,
  challengeId: string,
  date = getTodayISO(),
  dependencies: WidgetCompletionDependencies = defaultDependencies()
): Promise<{ completed: number; pending: number }> {
  await enqueueWidgetCompletion(uid, challengeId, date, dependencies.store);
  return drainPendingWidgetCompletions(uid, dependencies);
}
