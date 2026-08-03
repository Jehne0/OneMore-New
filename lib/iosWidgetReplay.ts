import type { IosWidgetMutation } from "./iosWidgetSnapshot";

export type IosWidgetReplayDependencies = {
  completePersonal(uid: string, challengeId: string, date: string): Promise<{ status: string }>;
  completeShared(uid: string, challengeId: string, date: string): Promise<string>;
};

export function isValidIosWidgetMutation(value: unknown): value is IosWidgetMutation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<IosWidgetMutation>;
  return typeof item.mutationId === "string" && item.mutationId.length > 0
    && typeof item.uid === "string" && item.uid.length > 0
    && typeof item.challengeId === "string" && item.challengeId.length > 0
    && (item.challengeType === "personal" || item.challengeType === "shared")
    && typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
    && (item.expectedDoneBefore === undefined || Number.isSafeInteger(item.expectedDoneBefore) && item.expectedDoneBefore >= 0)
    && typeof item.createdAtISO === "string";
}

export async function replayIosWidgetMutations(items: IosWidgetMutation[], uid: string, deps: IosWidgetReplayDependencies) {
  const acknowledged: string[] = [];
  const seen = new Set<string>();
  let changed = false;
  for (const item of items) {
    if (!isValidIosWidgetMutation(item) || item.uid !== uid) continue;
    if (seen.has(item.mutationId)) {
      acknowledged.push(item.mutationId);
      continue;
    }
    seen.add(item.mutationId);
    try {
      const status = item.challengeType === "shared" ? await deps.completeShared(uid, item.challengeId, item.date) : (await deps.completePersonal(uid, item.challengeId, item.date)).status;
      if (["completed", "already-completed", "inactive", "not-found", "invalid"].includes(status)) { acknowledged.push(item.mutationId); changed ||= status === "completed"; }
    } catch { /* Preserve transient failures. */ }
  }
  return { acknowledged, changed };
}
