import type { WidgetChallenge, WidgetLanguage } from "./widgetModel";
import { createWidgetRowLayout } from "./widgetLayout";
import { widgetDayStateLabel } from "./widgetCopy";

export function createWidgetRenderModel(
  challenges: WidgetChallenge[],
  language: WidgetLanguage,
  width: number,
  height: number,
  today = ""
) {
  const layout = createWidgetRowLayout(width, height, challenges.length);
  return {
    layout,
    expandedWeek: layout.showExpandedWeek && challenges.length === 1 ? {
      item: challenges[0],
      labelsVisible: layout.showWeekLabels,
      todayIndex: challenges[0]?.week.findIndex((day) => day.date === today) ?? -1,
    } : null,
    rows: challenges.slice(0, layout.visibleRows).map((item) => {
      const completed = item.dayState === "activeCompleted";
      const challengeName = item.title.trim();
      return {
        item,
        snapshot: {
          challengeId: item.id,
          challengeName,
          challengeType: item.shared ? "shared" as const : "personal" as const,
          currentStreak: item.streak,
          todayCompleted: completed,
          isActiveToday: item.isActiveToday,
          dayState: item.dayState,
          todayProgress: { done: item.done, target: item.target },
          weeklyHistory: item.week,
          completionState: item.dayState === "restDay" ? "restDay" as const : completed ? "completed" as const : "available" as const,
        },
        title: { text: challengeName, maxLines: 1 as const, truncate: "END" as const },
        button: {
          visible: true as const,
          enabled: item.dayState === "activePending" && !item.lockedByPremiumExpiration,
          label: widgetDayStateLabel(language, item.dayState),
          width: layout.buttonWidth,
          challengeType: item.shared ? "shared" as const : "personal" as const,
        },
      };
    }),
  };
}
