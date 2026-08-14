import { getTodayISO } from "./clock";
import {
  normalizeFlexibleWeeklyDefinitions,
  restoreFlexibleWeeklyDefinitions,
  synchronizeFlexibleWeeklyDefinitions,
} from "./flexibleWeekly";
import type { AppState } from "./storage";

export function shouldUploadLocalState(
  localUpdatedAtISO: string | null,
  cloudUpdatedAtISO: string | null,
  pendingMutationCount: number
): boolean {
  if (pendingMutationCount > 0) return true;
  return !!localUpdatedAtISO && (!cloudUpdatedAtISO || localUpdatedAtISO > cloudUpdatedAtISO);
}

/**
 * An older client does not know flexibleWeekly and may serialize it as daily
 * with all new fields missing. Preserve the local schedule in that one case;
 * ordinary fields still follow the newer cloud snapshot.
 */
export function preserveUnknownFlexibleWeeklyFields<T extends AppState>(
  local: T,
  cloud: T,
  cloudWriterVersion = 1,
  todayISO = getTodayISO(),
): T {
  // Writer v2 explicitly understands removal of the sidecar. Its legitimate
  // flexibleWeekly -> daily transition must therefore win by normal timestamp rules.
  if (cloudWriterVersion >= 2) return cloud;

  const localWithDefinitions = synchronizeFlexibleWeeklyDefinitions(local);
  const cloudDefinitions = normalizeFlexibleWeeklyDefinitions(cloud.flexibleWeeklyDefinitions);
  const localDefinitions = normalizeFlexibleWeeklyDefinitions(localWithDefinitions.flexibleWeeklyDefinitions);
  const mergedDefinitions = { ...cloudDefinitions };
  for (const [id, definition] of Object.entries(localDefinitions)) {
    if (!mergedDefinitions[id]) mergedDefinitions[id] = definition;
  }

  const protectedIds = new Set(Object.keys(mergedDefinitions));
  const cloudHistory = [...(cloud.history ?? [])];
  const historyKeys = new Set(cloudHistory.map((entry) =>
    `${entry.challengeId ?? ""}|${entry.date}|${entry.time}|${entry.atISO}|${entry.eventType ?? ""}`));
  for (const entry of local.history ?? []) {
    if (!protectedIds.has(String(entry.challengeId ?? ""))) continue;
    if (entry.eventType !== "flexibleWeeklyCompleted" && entry.eventType !== "weeklyGoalMissed") continue;
    const key = `${entry.challengeId ?? ""}|${entry.date}|${entry.time}|${entry.atISO}|${entry.eventType ?? ""}`;
    if (historyKeys.has(key)) continue;
    historyKeys.add(key);
    cloudHistory.push(entry);
  }

  // Legacy clients preserve unknown top-level state fields in OneMore's state
  // envelope. The sidecar lets a clean new install restore the period even
  // after the legacy challenge serializer changed it to daily.
  const seeded = {
    ...cloud,
    history: cloudHistory,
    flexibleWeeklyDefinitions: mergedDefinitions,
  } as T;
  return restoreFlexibleWeeklyDefinitions(seeded, todayISO) as T;
}
