export type WidgetChallengeType = "personal" | "shared";

export function createWidgetCompletionActionData(widgetId: number, challengeId: string, challengeType: WidgetChallengeType) {
  return {
    widgetId,
    challengeId: String(challengeId),
    challengeType,
    actionId: `${widgetId}:${challengeType}:${challengeId}`,
  };
}
