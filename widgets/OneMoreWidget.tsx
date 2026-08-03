"use no memo";

import React from "react";
import { FlexWidget, TextWidget } from "react-native-android-widget";
import type { WidgetInfo } from "react-native-android-widget";
import type { WidgetChallenge, WidgetLanguage, WidgetModel } from "../lib/widgetModel";
import {
  createWidgetRowLayout,
  dimensionsFromWidgetInfo,
  type WidgetDimensions,
  type WidgetRowLayout,
  type WidgetVariant,
} from "../lib/widgetLayout";
import { widgetDayStateLabel, widgetCopy } from "../lib/widgetCopy";
import { createWidgetCompletionActionData } from "../lib/widgetAction";
import { createWidgetRenderModel } from "../lib/widgetRenderModel";

export const WIDGET_COMPLETE_CHALLENGE = "WIDGET_COMPLETE_CHALLENGE";
export const WIDGET_COMPLETE_SHARED_CHALLENGE = "WIDGET_COMPLETE_SHARED_CHALLENGE";

export function createVisibleFallback(_widgetInfo: WidgetInfo, language: WidgetLanguage = "cs") {
  const t = widgetCopy[language];
  return <FlexWidget style={{ width: "match_parent", height: "match_parent", backgroundColor: "#0B1220", borderRadius: 16, padding: 10, justifyContent: "center", alignItems: "center", flexGap: 4 }}>
    <TextWidget text="OneMore" style={{ color: "#F8FAFC", fontSize: 15, fontWeight: "bold", textAlign: "center" }} />
    <TextWidget text={t.loading} style={{ color: "#CBD5E1", fontSize: 11, textAlign: "center" }} />
  </FlexWidget>;
}

function actionData(item: WidgetChallenge, widgetId: number) {
  return createWidgetCompletionActionData(widgetId, item.id, item.shared ? "shared" : "personal");
}

function CompleteButton({ item, language, widgetId, width, height }: { item: WidgetChallenge; language: WidgetLanguage; widgetId: number; width: number; height: number }) {
  const completed = item.dayState === "activeCompleted";
  const actionable = item.dayState === "activePending" && !item.lockedByPremiumExpiration;
  const restDay = item.dayState === "restDay";
  return <FlexWidget
    accessibilityLabel={item.lockedByPremiumExpiration ? widgetCopy[language].premiumExpired : widgetDayStateLabel(language, item.dayState)}
    clickAction={actionable ? (item.shared ? WIDGET_COMPLETE_SHARED_CHALLENGE : WIDGET_COMPLETE_CHALLENGE) : undefined}
    clickActionData={actionable ? actionData(item, widgetId) : undefined}
    style={{ width, height, backgroundColor: completed ? "#164E4A" : restDay ? "#334155" : "#F59E0B", borderRadius: height <= 38 ? 8 : 9, justifyContent: "center", alignItems: "center" }}>
    <TextWidget text={item.lockedByPremiumExpiration ? widgetCopy[language].getPremium : `${completed ? "✓ " : ""}${widgetDayStateLabel(language, item.dayState)}`} maxLines={1} style={{ color: item.lockedByPremiumExpiration ? "#CBD5E1" : completed ? "#99F6E4" : restDay ? "#CBD5E1" : "#111827", fontSize: width <= 64 ? 10 : 11, fontWeight: "bold", textAlign: "center" }} />
  </FlexWidget>;
}

function WeekDots({ item }: { item: WidgetChallenge }) {
  return <FlexWidget style={{ width: 54, height: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
    {item.week.map((day) => <FlexWidget key={day.date} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: day.kind === "completed" ? "#2DD4BF" : day.kind === "partial" ? "#F59E0B" : day.kind === "inactive" ? "#1E293B" : "#64748B" }} />)}
  </FlexWidget>;
}

function ExpandedWeek({ item, language, today }: { item: WidgetChallenge; language: WidgetLanguage; today: string }) {
  return <FlexWidget style={{ width: "match_parent", height: 28, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 6 }}>
    {item.week.map((day, index) => <FlexWidget key={day.date} style={{ width: 24, height: 26, backgroundColor: day.date === today ? "#3A2A12" : "#0B1220", borderRadius: 6, justifyContent: "center", alignItems: "center", flexGap: 1 }}>
      <TextWidget text={widgetCopy[language].days[index]} maxLines={1} style={{ color: day.date === today ? "#F59E0B" : "#94A3B8", fontSize: 8, textAlign: "center" }} />
      <TextWidget text={day.kind === "completed" ? "●" : day.kind === "partial" ? "◐" : day.kind === "inactive" ? "–" : "○"} maxLines={1} style={{ color: day.kind === "completed" ? "#2DD4BF" : day.kind === "partial" ? "#F59E0B" : day.kind === "inactive" ? "#475569" : "#94A3B8", fontSize: 9, textAlign: "center" }} />
    </FlexWidget>)}
  </FlexWidget>;
}

function ChallengeRow({ item, model, widgetId, layout, last }: { item: WidgetChallenge; model: WidgetModel; widgetId: number; layout: WidgetRowLayout; last: boolean }) {
  const completed = item.dayState === "activeCompleted";
  const narrow = layout.variant === "small";
  return <FlexWidget style={{ width: "match_parent", height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingHorizontal: 6, borderBottomWidth: last ? 0 : 1, borderBottomColor: "#263449", flexGap: narrow ? 5 : 7 }}>
    <FlexWidget style={{ flex: 1, height: "match_parent", justifyContent: "center", flexGap: 2 }}>
      <TextWidget text={item.title} maxLines={1} truncate="END" style={{ color: item.lockedByPremiumExpiration ? "#94A3B8" : "#F8FAFC", fontSize: narrow ? 12 : 13, fontWeight: "bold" }} />
      {item.lockedByPremiumExpiration ? <TextWidget text={widgetCopy[model.language].premiumExpired} maxLines={1} style={{ color: "#F59E0B", fontSize: 9 }} /> : null}
      {narrow && layout.showStreak ? <TextWidget text={`🔥 ${item.streak}`} maxLines={1} style={{ color: "#FDBA74", fontSize: 10, fontWeight: "bold" }} /> : null}
    </FlexWidget>
    {!narrow && layout.showStreak ? <TextWidget text={`🔥 ${item.streak}`} maxLines={1} style={{ width: 36, color: "#FDBA74", fontSize: 10, fontWeight: "bold", textAlign: "center" }} /> : null}
    {!narrow && layout.showToday ? <TextWidget text={item.dayState === "restDay" ? "–" : completed ? "✓" : `${item.done}/${item.target}`} maxLines={1} style={{ width: 22, color: completed ? "#2DD4BF" : item.dayState === "restDay" ? "#64748B" : "#CBD5E1", fontSize: 10, fontWeight: "bold", textAlign: "center" }} /> : null}
    {!narrow && layout.showWeek ? <WeekDots item={item} /> : null}
    {!narrow && layout.showBest ? <TextWidget text={`★${item.bestStreak}`} maxLines={1} style={{ width: 30, color: "#94A3B8", fontSize: 9, textAlign: "center" }} /> : null}
    {!narrow && layout.showType ? <TextWidget text={item.shared ? "S" : "P"} maxLines={1} style={{ width: 12, color: "#94A3B8", fontSize: 8, textAlign: "center" }} /> : null}
    <CompleteButton item={item} language={model.language} widgetId={widgetId} width={layout.buttonWidth} height={layout.buttonHeight} />
  </FlexWidget>;
}

export function getWidgetVariant(widgetInfo: WidgetInfo, dimensions?: WidgetDimensions): WidgetVariant {
  const size = dimensions ?? dimensionsFromWidgetInfo(Number(widgetInfo.width), Number(widgetInfo.height));
  return createWidgetRowLayout(size.availableWidth, size.availableHeight, 5).variant;
}

export function OneMoreWidget({ model, widgetInfo, dimensions, today }: { model: WidgetModel; widgetInfo: WidgetInfo; dimensions?: WidgetDimensions; today?: string }) {
  const t = widgetCopy[model.language];
  const size = dimensions ?? dimensionsFromWidgetInfo(Number(widgetInfo.width), Number(widgetInfo.height));
  const renderModel = createWidgetRenderModel(model.challenges, model.language, size.availableWidth, size.availableHeight, today);
  const layout = renderModel.layout;
  const shown = renderModel.rows.map((row) => row.item);
  const status = model.kind === "signed-out" ? t.signIn : model.kind === "empty" ? t.empty : model.kind === "rest" ? t.rest : `${t.today} ${model.completed}/${model.total}`;

  return <FlexWidget style={{ width: "match_parent", height: "match_parent", justifyContent: "center", alignItems: "center" }}>
  <FlexWidget style={{ width: "match_parent", height: layout.compactSurfaceHeight ?? "match_parent", backgroundColor: "#0B1220", borderRadius: layout.compactSurfaceHeight ? 12 : 16, padding: layout.rootPadding, overflow: "hidden", flexGap: layout.compactSurfaceHeight ? 0 : 2 }}>
    {layout.showHeader ? <FlexWidget style={{ width: "match_parent", height: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 4 }}>
      <TextWidget text="OneMore" maxLines={1} style={{ color: "#F8FAFC", fontSize: 11, fontWeight: "bold" }} />
      <TextWidget text={status} maxLines={1} truncate="END" style={{ color: "#F59E0B", fontSize: 9, fontWeight: "600", textAlign: "right" }} />
    </FlexWidget> : null}
    {shown.length === 0 ? <FlexWidget style={{ width: "match_parent", flex: 1, justifyContent: "center", alignItems: "center" }}><TextWidget text={status} maxLines={2} style={{ color: "#CBD5E1", fontSize: 12, fontWeight: "600", textAlign: "center" }} /></FlexWidget>
      : <FlexWidget style={{ width: "match_parent", flex: 1 }}>{shown.map((item, index) => <ChallengeRow key={`${item.shared ? "s" : "p"}:${item.id}`} item={item} model={model} widgetId={widgetInfo.widgetId} layout={layout} last={index === shown.length - 1} />)}</FlexWidget>}
    {renderModel.expandedWeek ? <ExpandedWeek item={renderModel.expandedWeek.item} language={model.language} today={today ?? ""} /> : null}
  </FlexWidget>
  </FlexWidget>;
}
