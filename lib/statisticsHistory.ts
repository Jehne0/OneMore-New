export function countDailySkippedHistory(history: Array<{ status?: string; eventType?: string }>): number {
  return (history ?? []).filter((entry) =>
    entry.status === "skipped" && entry.eventType !== "weeklyGoalMissed").length;
}
