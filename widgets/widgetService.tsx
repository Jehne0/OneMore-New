import React from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getTodayISO } from "../lib/clock";
import { parseStoredLanguage } from "../lib/languageStorage";
import { createWidgetRowLayout, dimensionsFromWidgetInfo } from "../lib/widgetLayout";
import { getNativeWidgetDimensions } from "../lib/widgetSessionNative";
import { completeChallengeForUid } from "../lib/challengeCompletion";
import { syncNow } from "../lib/cloudSync";
import { loadStateForUid } from "../lib/storage";
import { createWidgetModel, type WidgetLanguage } from "../lib/widgetModel";
import { OneMoreWidget, createVisibleFallback } from "./OneMoreWidget";
import { completeSharedChallengeForUid, readSharedCache, replaySharedCompletionsForCurrentUser } from "../lib/sharedCompletion";
import { auth } from "../lib/firebase";
import { isPremiumConfirmedForUid } from "../lib/premium";
import { renderInitialWidget } from "../lib/widgetLifecycle";
import { deleteWidgetInstance, readWidgetAccessPolicy, reconcileAllWidgetConfigs, resolveWidgetChallengeAccess } from "../lib/widgetConfig";
import { readWidgetActiveUid, WIDGET_ACTIVE_UID_KEY } from "../lib/widgetSession";
import { handleWidgetCompletion } from "../lib/widgetCompletionAction";
import { WIDGET_COMPLETE_CHALLENGE, WIDGET_COMPLETE_SHARED_CHALLENGE } from "./OneMoreWidget";
import { WidgetRenderGate } from "../lib/widgetRenderGate";

export const WIDGET_NAME = "OneMore";
export const ACTIVE_UID_KEY = WIDGET_ACTIVE_UID_KEY;
const widgetRenderGate = new WidgetRenderGate();

function safeLanguage(value: string | null): WidgetLanguage {
  return parseStoredLanguage(value);
}

function availableChallengeIds(
  state: Awaited<ReturnType<typeof loadStateForUid>> | null,
  shared: Awaited<ReturnType<typeof readSharedCache>>,
  uid: string | null,
): string[] {
  if (!state) return [];
  return [
    ...(state.challenges ?? []).filter((item) => item.enabled !== false && !item.deletedAt).map((item) => String(item.id)),
    ...shared.filter((item) => item.enabled !== false && item.status === "active" && !!uid && item.memberUids.includes(uid) && !(item.leftBy ?? []).includes(uid)).map((item) => item.id),
  ];
}

async function reconcileStoredWidgetConfigs(): Promise<void> {
  const uid = await readWidgetActiveUid();
  if (!uid) return;
  const [state, shared, premium] = await Promise.all([
    loadStateForUid(uid), readSharedCache(uid), isPremiumConfirmedForUid(uid),
  ]);
  await reconcileAllWidgetConfigs(uid, availableChallengeIds(state, shared, uid), premium);
}

async function representation(widgetInfo: import("react-native-android-widget").WidgetInfo) {
  await Promise.race([
    auth.authStateReady().catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, 800)),
  ]);
  const [cachedUid, language, nativeDimensions] = await Promise.all([
    readWidgetActiveUid(), AsyncStorage.getItem("onemore_lang"), getNativeWidgetDimensions(widgetInfo.widgetId).catch(() => undefined),
  ]);
  // SharedPreferences is cleared only by explicit account actions. It remains
  // authoritative while Firebase JS is restoring after process/phone restart.
  const uid = cachedUid;
  const state = uid ? await loadStateForUid(uid) : null;
  const shared = uid ? await readSharedCache(uid) : [];
  const premium = uid ? await isPremiumConfirmedForUid(uid) : false;
  const today = getTodayISO();
  const availableIds = availableChallengeIds(state, shared, uid);
  const reconciled = uid
    ? await reconcileAllWidgetConfigs(uid, availableIds, premium, [widgetInfo.widgetId])
    : null;
  const access = reconciled?.accessByWidgetId.get(widgetInfo.widgetId)
    ?? resolveWidgetChallengeAccess(availableIds, [], premium, reconciled?.policy ?? null);
  const model = createWidgetModel(state, safeLanguage(language), today, shared, uid ?? "", premium, access.orderedIds, access.frozenIds);
  const dimensions = nativeDimensions ?? dimensionsFromWidgetInfo(widgetInfo.width, widgetInfo.height);
  const layout = createWidgetRowLayout(dimensions.availableWidth, dimensions.availableHeight, model.challenges.length);
  if (__DEV__) console.log("[OneMoreWidget] render", {
    widgetId: widgetInfo.widgetId,
    minWidth: dimensions.minWidth,
    maxWidth: dimensions.maxWidth,
    minHeight: dimensions.minHeight,
    maxHeight: dimensions.maxHeight,
    orientation: dimensions.orientation,
    availableWidth: dimensions.availableWidth,
    availableHeight: dimensions.availableHeight,
    variant: layout.variant,
    renderedChallenges: Math.min(model.challenges.length, layout.visibleRows),
  });
  return <OneMoreWidget model={model} widgetInfo={widgetInfo} dimensions={dimensions} today={today} />;
}

function fallbackRepresentation(widgetInfo: import("react-native-android-widget").WidgetInfo) {
  return createVisibleFallback(widgetInfo);
}

export async function updateAllOneMoreWidgets(): Promise<void> {
  // This runs even when there is currently no mounted Android widget, so a
  // deletion also prunes every stored instance configuration and iOS snapshot
  // source before a later widget render can reuse stale IDs.
  await reconcileStoredWidgetConfigs().catch(() => {});
  if (Platform.OS === "ios") {
    const { syncIosWidgetState } = await import("../lib/iosWidgetService");
    await syncIosWidgetState().catch(() => {});
    return;
  }
  if (Platform.OS !== "android") return;
  try {
    const { requestWidgetUpdate } = await import("react-native-android-widget");
    await requestWidgetUpdate({
      widgetName: WIDGET_NAME,
      renderWidget: async (widgetInfo) => {
        try { return await representation(widgetInfo); }
        catch { return fallbackRepresentation(widgetInfo); }
      },
    });
  } catch {
    // Widget availability must never affect the main application.
  }
}

export async function oneMoreWidgetTaskHandler(props: import("react-native-android-widget").WidgetTaskHandlerProps) {
  const renderGeneration = widgetRenderGate.begin(props.widgetInfo.widgetId);
  if (props.widgetAction === "WIDGET_DELETED") {
    widgetRenderGate.remove(props.widgetInfo.widgetId);
    await deleteWidgetInstance(props.widgetInfo.widgetId).catch(() => {});
    return;
  }
  if (props.widgetAction === "WIDGET_ADDED") {
    await renderInitialWidget({
      renderWidget: (value) => {
        if (widgetRenderGate.isCurrent(props.widgetInfo.widgetId, renderGeneration)) {
          props.renderWidget(value);
        }
      },
      fallback: fallbackRepresentation(props.widgetInfo),
      load: () => representation(props.widgetInfo),
    });
    return;
  }

  try {
    const activeUid = await readWidgetActiveUid();
    const authenticatedUid = auth.currentUser?.uid ?? null;
    const challengeId = typeof props.clickActionData?.challengeId === "string" ? props.clickActionData.challengeId : "";
    const actionWidgetId = Number(props.clickActionData?.widgetId);
    if (__DEV__) console.log("[OneMoreWidget] click", { widgetId: props.widgetInfo.widgetId, actionWidgetId, clickAction: props.clickAction, challengeId, challengeType: props.clickActionData?.challengeType });
    if (Number.isFinite(actionWidgetId) && actionWidgetId !== props.widgetInfo.widgetId) throw new Error("WIDGET_ID_MISMATCH");

    if (props.widgetAction === "WIDGET_CLICK" && props.clickAction === WIDGET_COMPLETE_CHALLENGE) {
      if (activeUid && challengeId) {
        const [clickPremium, clickPolicy] = await Promise.all([isPremiumConfirmedForUid(activeUid), readWidgetAccessPolicy(activeUid)]);
        if (!clickPremium && clickPolicy?.activeFreeChallengeId !== challengeId) throw new Error("WIDGET_CHALLENGE_FROZEN_AFTER_PREMIUM");
        const result = await handleWidgetCompletion(activeUid, challengeId, getTodayISO(), {
          store: AsyncStorage,
          // The persisted widget UID is authoritative for local mutation. A newly
          // started headless JS process often has not restored Firebase Auth yet.
          authenticatedUid: () => activeUid,
          complete: completeChallengeForUid,
          sync: async (uid) => { if (auth.currentUser?.uid === uid) await syncNow(uid); },
          refresh: async () => {},
        });
        if (__DEV__) console.log("[OneMoreWidget] personal completion", result);
      }
    }
    if (props.widgetAction === "WIDGET_CLICK" && props.clickAction === WIDGET_COMPLETE_SHARED_CHALLENGE) {
      if (activeUid && challengeId) {
        const [clickPremium, clickPolicy] = await Promise.all([isPremiumConfirmedForUid(activeUid), readWidgetAccessPolicy(activeUid)]);
        if (!clickPremium && clickPolicy?.activeFreeChallengeId !== challengeId) throw new Error("WIDGET_CHALLENGE_FROZEN_AFTER_PREMIUM");
        const result = await completeSharedChallengeForUid(activeUid, challengeId, getTodayISO());
        if (__DEV__) console.log("[OneMoreWidget] shared completion", { result });
        if (activeUid === authenticatedUid) {
          void replaySharedCompletionsForCurrentUser(activeUid).catch(() => {});
        }
      }
    }
    const completeSnapshot = await representation(props.widgetInfo);
    if (widgetRenderGate.isCurrent(props.widgetInfo.widgetId, renderGeneration)) {
      props.renderWidget(completeSnapshot);
    }
  } catch (error) {
    if (__DEV__) console.log("[OneMoreWidget] action/render failed", String((error as any)?.message ?? error));
    if (widgetRenderGate.isCurrent(props.widgetInfo.widgetId, renderGeneration)) {
      props.renderWidget(fallbackRepresentation(props.widgetInfo));
    }
  }
}
