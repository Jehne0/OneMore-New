import AsyncStorage from "@react-native-async-storage/async-storage";
import { getTodayISO } from "./clock";
import { completeChallengeForUid } from "./challengeCompletion";
import { syncNow } from "./cloudSync";
import { auth } from "./firebase";
import { readAccountSnapshot } from "./accountSnapshot";
import { createIosWidgetSnapshot, IOS_WIDGET_CONFIG_ID, nextWidgetTimelineDates, type IosWidgetMutation, type IosWidgetPremiumState } from "./iosWidgetSnapshot";
import { replayIosWidgetMutations } from "./iosWidgetReplay";
import { acknowledgeIosWidgetOutbox, clearIosWidgetData, readIosWidgetOutbox, writeIosWidgetSnapshot } from "./iosWidgetNative";
import { parseStoredLanguage } from "./languageStorage";
import { isPremiumConfirmedForUid, readPremiumSnapshot } from "./premium";
import { isPremiumSnapshotActiveAt } from "./premiumSnapshot";
import { completeSharedChallengeForUid, readSharedCache, replayIosSharedCompletionsForCurrentUser } from "./sharedCompletion";
import { loadStateForUid } from "./storage";
import { readWidgetAccessPolicy, readWidgetConfig, reconcileAllWidgetConfigs, resolveWidgetChallengeAccess } from "./widgetConfig";
import { createWidgetModel } from "./widgetModel";
import { readWidgetActiveUid } from "./widgetSession";
import { ensureIosWidgetAccessGrant } from "./iosWidgetAccess";

let running: Promise<void> | null = null;

async function resolvePremium(uid: string): Promise<{
  active: boolean;
  state: IosWidgetPremiumState;
  expirationDate: string | null;
  lifetime: boolean;
}> {
  const [confirmed, premiumSnapshot, accountSnapshot] = await Promise.all([
    isPremiumConfirmedForUid(uid), readPremiumSnapshot(uid), readAccountSnapshot(uid),
  ]);
  const active = confirmed || !!premiumSnapshot && isPremiumSnapshotActiveAt(premiumSnapshot, uid);
  const expirationDate = premiumSnapshot?.expirationDate ?? accountSnapshot?.expirationDate ?? null;
  const lifetime = premiumSnapshot?.isLifetime === true || accountSnapshot?.lifetime === true || active && !expirationDate;
  const hasConfirmedFree = premiumSnapshot !== null || accountSnapshot?.premiumState === "free";
  return {
    active,
    state: active ? "premium" : hasConfirmedFree ? "free" : "checking",
    expirationDate,
    lifetime,
  };
}

export function syncIosWidgetState(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const uid = await readWidgetActiveUid();
    if (!uid) { await clearIosWidgetData(); return; }
    if (auth.currentUser?.uid === uid) await ensureIosWidgetAccessGrant(uid).catch(() => {});
    let outbox: IosWidgetMutation[] = [];
    try {
      const parsed: unknown = JSON.parse(await readIosWidgetOutbox());
      if (Array.isArray(parsed)) outbox = parsed as IosWidgetMutation[];
    } catch { /* Native code retains its valid backup. */ }
    const replay = await replayIosWidgetMutations(outbox, uid, {
      completePersonal: completeChallengeForUid,
      completeShared: completeSharedChallengeForUid,
    });
    if (replay.acknowledged.length) await acknowledgeIosWidgetOutbox(replay.acknowledged);
    if (auth.currentUser?.uid === uid) {
      await Promise.allSettled([
        ...(replay.changed ? [syncNow(uid)] : []),
        replayIosSharedCompletionsForCurrentUser(uid),
      ]);
    }
    const [state, shared, premiumAccess, language] = await Promise.all([
      loadStateForUid(uid), readSharedCache(uid), resolvePremium(uid),
      AsyncStorage.getItem("onemore_lang"),
    ]);
    const availableIds = [
      ...(state.challenges ?? []).filter((c) => c.enabled !== false && !c.deletedAt).map((c) => String(c.id)),
      ...shared.filter((c) => c.enabled !== false && c.status === "active" && c.memberUids.includes(uid) && !(c.leftBy ?? []).includes(uid)).map((c) => c.id),
    ];
    const [storedConfig, storedPolicy] = await Promise.all([
      readWidgetConfig(IOS_WIDGET_CONFIG_ID, uid), readWidgetAccessPolicy(uid),
    ]);
    // Unknown Premium must not be normalized to Free. During a cold start we
    // render the last proven state until entitlement verification completes.
    const normalizationPremium = premiumAccess.state === "checking"
      ? storedConfig?.lastPremiumActive === true
      : premiumAccess.active;
    const reconciled = premiumAccess.state === "checking"
      ? null
      : await reconcileAllWidgetConfigs(uid, availableIds, premiumAccess.active, [IOS_WIDGET_CONFIG_ID]);
    const policy = reconciled?.policy ?? storedPolicy;
    const access = reconciled?.accessByWidgetId.get(IOS_WIDGET_CONFIG_ID)
      ?? resolveWidgetChallengeAccess(
        availableIds,
        storedConfig?.orderedChallengeIds ?? [],
        normalizationPremium,
        policy,
        storedConfig?.premiumSelectionRecorded ? storedConfig.premiumSelectedChallengeIds : [],
      );
    const today = getTodayISO();
    const parsedLanguage = parseStoredLanguage(language);
    // The native extension receives a challenge catalog. Its iOS 17
    // AppIntent configuration independently chooses and normalizes rows for
    // each widget instance; iOS 16 uses defaultConfiguration below.
    const catalogModel = createWidgetModel(state, parsedLanguage, today, shared, uid, premiumAccess.active, availableIds, []);
    const timelineModels = nextWidgetTimelineDates(new Date(), 9).slice(1).map((date) => ({
      date,
      model: createWidgetModel(state, parsedLanguage, date, shared, uid, premiumAccess.active, availableIds, []),
    }));
    const normalizedConfig = reconciled?.configs.get(IOS_WIDGET_CONFIG_ID) ?? storedConfig;
    const snapshot = createIosWidgetSnapshot(catalogModel, uid, today, new Date().toISOString(), {
      sessionState: "authenticated",
      premiumState: premiumAccess.state,
      premiumExpirationDate: premiumAccess.expirationDate,
      premiumLifetime: premiumAccess.lifetime,
      snapshotRevision: Date.now(),
      defaultConfiguration: {
        configurationKey: "legacy-default",
        orderedChallengeIds: access.orderedIds,
        premiumSelectedChallengeIds: normalizedConfig?.premiumSelectedChallengeIds ?? [],
        premiumSelectionRecorded: normalizedConfig?.premiumSelectionRecorded === true,
        lastPremiumActive: normalizedConfig?.lastPremiumActive ?? null,
        updatedAtISO: normalizedConfig?.updatedAtISO ?? new Date().toISOString(),
      },
      timelineModels,
    });
    await writeIosWidgetSnapshot(JSON.stringify(snapshot));
  })().finally(() => { running = null; });
  return running;
}
