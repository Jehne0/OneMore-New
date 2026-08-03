import AsyncStorage from "@react-native-async-storage/async-storage";

export type WidgetSelectionMode = "manual" | "automatic";

export type WidgetInstanceConfig = {
  widgetId: number;
  uid: string;
  mode: WidgetSelectionMode;
  orderedChallengeIds: string[];
  /** Exact selection last persisted while Premium was confirmed active. */
  premiumSelectedChallengeIds: string[];
  /** Distinguishes a real Premium selection from legacy/corrupt Free state. */
  premiumSelectionRecorded: boolean;
  lastPremiumActive: boolean | null;
  updatedAtISO: string;
  version: 2;
};

type CompatibleWidgetConfig = Omit<WidgetInstanceConfig, "version" | "premiumSelectedChallengeIds" | "premiumSelectionRecorded" | "lastPremiumActive"> & {
  version: 1 | 2;
  premiumSelectedChallengeIds?: string[];
  premiumSelectionRecorded?: boolean;
  lastPremiumActive?: boolean | null;
};

type Store = Pick<typeof AsyncStorage, "getItem" | "setItem" | "removeItem"> & Partial<Pick<typeof AsyncStorage, "getAllKeys">>;
const key = (widgetId: number, uid: string) => `onemore_widget_config:${uid}:${widgetId}`;
const ownersKey = (widgetId: number) => `onemore_widget_config_owners:${widgetId}`;
const configIndexKey = (uid: string) => `onemore_widget_config_ids:${uid}`;
const accessKey = (uid: string) => `onemore_widget_access:${uid}`;
const uidQueues = new Map<string, Promise<void>>();

export type WidgetAccessPolicy = {
  uid: string;
  activeFreeChallengeId: string | null;
  updatedAtISO: string;
  version: 2;
};
type CompatibleAccessPolicy = WidgetAccessPolicy | {
  uid: string;
  activeFreeChallengeId: string | null;
  orderedChallengeIds?: string[];
  updatedAtISO: string;
  version: 1;
};
export type WidgetChallengeAccess = { orderedIds: string[]; activeId: string | null; frozenIds: string[] };
export type ReconciledWidgetConfigs = {
  policy: WidgetAccessPolicy;
  configs: Map<number, WidgetInstanceConfig>;
  accessByWidgetId: Map<number, WidgetChallengeAccess>;
};

function uniqueIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))]
    : [];
}

function filterAvailable(ids: string[], available: Set<string>): string[] {
  return uniqueIds(ids).filter((id) => available.has(id));
}

function withUidQueue<T>(uid: string, operation: () => Promise<T>): Promise<T> {
  const previous = uidQueues.get(uid) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(operation);
  const tail = result.then(() => {}, () => {});
  uidQueues.set(uid, tail);
  return result.finally(() => {
    if (uidQueues.get(uid) === tail) uidQueues.delete(uid);
  });
}

/**
 * Resolves rendering access without inventing frozen rows. `frozenEligibleIds`
 * must come from a confirmed Premium selection, never from the global policy.
 */
export function resolveWidgetChallengeAccess(
  availableIds: string[], configuredIds: string[], premium: boolean,
  policy: CompatibleAccessPolicy | null, frozenEligibleIds: string[] = []
): WidgetChallengeAccess {
  const availableOrder = uniqueIds(availableIds);
  const available = new Set(availableOrder);
  const configured = filterAvailable(configuredIds, available);
  if (premium) return { orderedIds: configured, activeId: configured[0] ?? null, frozenIds: [] };

  const preferred = policy?.activeFreeChallengeId;
  const activeId = preferred && available.has(preferred)
    ? preferred
    : configured[0] ?? availableOrder[0] ?? null;
  const provenFrozen = filterAvailable(frozenEligibleIds, available).filter((id) => id !== activeId);
  const orderedIds = uniqueIds([...(activeId ? [activeId] : []), ...provenFrozen]);
  return { orderedIds, activeId, frozenIds: provenFrozen };
}

function clean(value: unknown, widgetId: number, uid: string): WidgetInstanceConfig | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<CompatibleWidgetConfig>;
  if (item.widgetId !== widgetId || item.uid !== uid) return null;
  const orderedChallengeIds = uniqueIds(item.orderedChallengeIds);
  const isV2 = item.version === 2;

  // In v1 the UI could only persist multiple selections while Premium was
  // active. A single v1 selection carries no frozen-selection provenance and
  // is deliberately migrated as Free-safe, which repairs polluted policies.
  const legacyPremiumSelection = !isV2 && orderedChallengeIds.length > 1;
  const premiumSelectionRecorded = isV2
    ? item.premiumSelectionRecorded === true
    : legacyPremiumSelection;
  const premiumSelectedChallengeIds = isV2
    ? (premiumSelectionRecorded ? uniqueIds(item.premiumSelectedChallengeIds) : [])
    : (legacyPremiumSelection ? orderedChallengeIds : []);

  return {
    widgetId,
    uid,
    mode: item.mode === "automatic" ? "automatic" : "manual",
    orderedChallengeIds,
    premiumSelectedChallengeIds,
    premiumSelectionRecorded,
    lastPremiumActive: isV2 && typeof item.lastPremiumActive === "boolean" ? item.lastPremiumActive : null,
    updatedAtISO: typeof item.updatedAtISO === "string" ? item.updatedAtISO : new Date(0).toISOString(),
    version: 2,
  };
}

export function normalizeWidgetInstanceConfig(
  config: WidgetInstanceConfig,
  availableIds: string[],
  premium: boolean,
  policy: CompatibleAccessPolicy | null,
): { config: WidgetInstanceConfig; access: WidgetChallengeAccess } {
  const availableOrder = uniqueIds(availableIds);
  const available = new Set(availableOrder);
  const configured = filterAvailable(config.orderedChallengeIds, available);
  const premiumSelection = config.premiumSelectionRecorded
    ? filterAvailable(config.premiumSelectedChallengeIds, available)
    : [];
  const now = new Date().toISOString();

  if (premium) {
    // The first render after renewal restores only the selection that was
    // actually frozen. Free-era additions cannot enter this list.
    const restored = config.lastPremiumActive === false && config.premiumSelectionRecorded
      ? premiumSelection
      : config.mode === "automatic" ? availableOrder : configured;
    const normalized: WidgetInstanceConfig = {
      ...config,
      orderedChallengeIds: restored,
      premiumSelectedChallengeIds: restored,
      premiumSelectionRecorded: true,
      lastPremiumActive: true,
      updatedAtISO: now,
      version: 2,
    };
    return { config: normalized, access: resolveWidgetChallengeAccess(availableOrder, restored, true, policy) };
  }

  const access = resolveWidgetChallengeAccess(availableOrder, configured, false, policy, premiumSelection);
  const normalized: WidgetInstanceConfig = {
    ...config,
    // Automatic selection is Premium-only. Switching it to manual prevents a
    // later render from silently adding challenges created after expiration.
    mode: "manual",
    orderedChallengeIds: access.orderedIds,
    premiumSelectedChallengeIds: premiumSelection,
    premiumSelectionRecorded: config.premiumSelectionRecorded,
    lastPremiumActive: false,
    updatedAtISO: now,
    version: 2,
  };
  return { config: normalized, access };
}

export async function readWidgetAccessPolicy(uid: string, store: Store = AsyncStorage): Promise<WidgetAccessPolicy | null> {
  try {
    const parsed = JSON.parse((await store.getItem(accessKey(uid))) ?? "null") as Partial<CompatibleAccessPolicy> | null;
    if (!parsed || parsed.uid !== uid || (parsed.version !== 1 && parsed.version !== 2)) return null;
    return {
      uid,
      activeFreeChallengeId: typeof parsed.activeFreeChallengeId === "string" ? parsed.activeFreeChallengeId : null,
      updatedAtISO: typeof parsed.updatedAtISO === "string" ? parsed.updatedAtISO : new Date(0).toISOString(),
      version: 2,
    };
  } catch { return null; }
}

export async function updateWidgetAccessPolicy(
  uid: string,
  activeFreeChallengeId: string | null,
  store: Store = AsyncStorage,
): Promise<WidgetAccessPolicy> {
  const policy: WidgetAccessPolicy = {
    uid,
    activeFreeChallengeId,
    updatedAtISO: new Date().toISOString(),
    version: 2,
  };
  await store.setItem(accessKey(uid), JSON.stringify(policy));
  return policy;
}

export async function readWidgetConfig(widgetId: number, uid: string, store: Store = AsyncStorage) {
  try { return clean(JSON.parse((await store.getItem(key(widgetId, uid))) ?? "null"), widgetId, uid); }
  catch { return null; }
}

async function readNumberList(storageKey: string, store: Store): Promise<number[]> {
  try {
    const parsed: unknown = JSON.parse((await store.getItem(storageKey)) ?? "[]");
    return Array.isArray(parsed)
      ? [...new Set(parsed.map(Number).filter((id) => Number.isFinite(id)))]
      : [];
  } catch { return []; }
}

async function registerWidgetConfig(widgetId: number, uid: string, store: Store): Promise<void> {
  const ids = await readNumberList(configIndexKey(uid), store);
  if (!ids.includes(widgetId)) await store.setItem(configIndexKey(uid), JSON.stringify([...ids, widgetId]));
  try {
    const ownersValue: unknown = JSON.parse((await store.getItem(ownersKey(widgetId))) ?? "[]");
    const owners = Array.isArray(ownersValue) ? ownersValue.filter((item): item is string => typeof item === "string") : [];
    if (!owners.includes(uid)) await store.setItem(ownersKey(widgetId), JSON.stringify([...owners, uid]));
  } catch {
    await store.setItem(ownersKey(widgetId), JSON.stringify([uid]));
  }
}

async function unregisterWidgetConfig(widgetId: number, uid: string, store: Store): Promise<void> {
  const ids = await readNumberList(configIndexKey(uid), store);
  const next = ids.filter((id) => id !== widgetId);
  if (next.length) await store.setItem(configIndexKey(uid), JSON.stringify(next));
  else await store.removeItem(configIndexKey(uid));
}

async function writeWidgetConfig(config: WidgetInstanceConfig, store: Store): Promise<void> {
  await store.setItem(key(config.widgetId, config.uid), JSON.stringify(config));
  await registerWidgetConfig(config.widgetId, config.uid, store);
}

export async function saveWidgetConfig(
  input: Pick<WidgetInstanceConfig, "widgetId" | "uid" | "mode" | "orderedChallengeIds">,
  store: Store = AsyncStorage,
): Promise<WidgetInstanceConfig> {
  const config = clean({
    ...input,
    premiumSelectedChallengeIds: [],
    premiumSelectionRecorded: false,
    lastPremiumActive: null,
    updatedAtISO: new Date().toISOString(),
    version: 2,
  }, input.widgetId, input.uid)!;
  await writeWidgetConfig(config, store);
  return config;
}

export async function saveWidgetSelection(
  input: Pick<WidgetInstanceConfig, "widgetId" | "uid" | "mode" | "orderedChallengeIds">,
  availableIds: string[],
  premium: boolean,
  activeFreeChallengeId: string | null,
  store: Store = AsyncStorage,
): Promise<WidgetInstanceConfig> {
  return withUidQueue(input.uid, async () => {
    const previous = await readWidgetConfig(input.widgetId, input.uid, store);
    const available = new Set(uniqueIds(availableIds));
    const selected = filterAvailable(input.orderedChallengeIds, available);
    const retainedPremiumSelection = premium
      ? selected
      : (previous?.premiumSelectionRecorded
        ? previous.premiumSelectedChallengeIds.filter((id) => selected.includes(id))
        : []);
    const base = clean({
      widgetId: input.widgetId,
      uid: input.uid,
      mode: premium ? input.mode : "manual",
      orderedChallengeIds: selected,
      premiumSelectedChallengeIds: retainedPremiumSelection,
      premiumSelectionRecorded: premium || previous?.premiumSelectionRecorded === true,
      lastPremiumActive: premium,
      updatedAtISO: new Date().toISOString(),
      version: 2,
    }, input.widgetId, input.uid)!;
    await writeWidgetConfig(base, store);

    const requestedActive = premium
      ? (await readWidgetAccessPolicy(input.uid, store))?.activeFreeChallengeId ?? selected[0] ?? null
      : activeFreeChallengeId && selected.includes(activeFreeChallengeId)
        ? activeFreeChallengeId
        : selected[0] ?? null;
    await updateWidgetAccessPolicy(input.uid, requestedActive, store);
    const reconciled = await reconcileAllWidgetConfigsUnlocked(input.uid, availableIds, premium, [input.widgetId], store);
    return reconciled.configs.get(input.widgetId) ?? base;
  });
}

async function listWidgetConfigIds(uid: string, explicitIds: number[], store: Store): Promise<number[]> {
  const ids = new Set([...await readNumberList(configIndexKey(uid), store), ...explicitIds]);
  if (store.getAllKeys) {
    const prefix = `onemore_widget_config:${uid}:`;
    for (const storageKey of await store.getAllKeys()) {
      if (!storageKey.startsWith(prefix)) continue;
      const widgetId = Number(storageKey.slice(prefix.length));
      if (Number.isFinite(widgetId)) ids.add(widgetId);
    }
  }
  return [...ids];
}

function sameConfigState(left: WidgetInstanceConfig, right: WidgetInstanceConfig): boolean {
  return left.version === right.version
    && left.mode === right.mode
    && left.premiumSelectionRecorded === right.premiumSelectionRecorded
    && left.lastPremiumActive === right.lastPremiumActive
    && JSON.stringify(left.orderedChallengeIds) === JSON.stringify(right.orderedChallengeIds)
    && JSON.stringify(left.premiumSelectedChallengeIds) === JSON.stringify(right.premiumSelectedChallengeIds);
}

async function storedPolicyIsV2(uid: string, store: Store): Promise<boolean> {
  try {
    const parsed: unknown = JSON.parse((await store.getItem(accessKey(uid))) ?? "null");
    return !!parsed && typeof parsed === "object" && (parsed as { version?: unknown }).version === 2;
  } catch { return false; }
}

async function reconcileAllWidgetConfigsUnlocked(
  uid: string,
  availableIds: string[],
  premium: boolean,
  explicitWidgetIds: number[] = [],
  store: Store = AsyncStorage,
): Promise<ReconciledWidgetConfigs> {
  const availableOrder = uniqueIds(availableIds);
  const available = new Set(availableOrder);
  const widgetIds = await listWidgetConfigIds(uid, explicitWidgetIds, store);
  const configs = new Map<number, WidgetInstanceConfig>();
  for (const widgetId of widgetIds) {
    const config = await readWidgetConfig(widgetId, uid, store);
    if (config) configs.set(widgetId, config);
    else await unregisterWidgetConfig(widgetId, uid, store);
  }

  const previousPolicy = await readWidgetAccessPolicy(uid, store);
  const previousActive = previousPolicy?.activeFreeChallengeId;
  const firstConfigured = [...configs.values()]
    .flatMap((config) => config.orderedChallengeIds)
    .find((id) => available.has(id));
  const activeFreeChallengeId = previousActive && available.has(previousActive)
    ? previousActive
    : firstConfigured ?? availableOrder[0] ?? null;
  const policy = previousPolicy
    && previousPolicy.activeFreeChallengeId === activeFreeChallengeId
    && await storedPolicyIsV2(uid, store)
    ? previousPolicy
    : await updateWidgetAccessPolicy(uid, activeFreeChallengeId, store);
  const normalizedConfigs = new Map<number, WidgetInstanceConfig>();
  const accessByWidgetId = new Map<number, WidgetChallengeAccess>();
  for (const [widgetId, config] of configs) {
    const normalized = normalizeWidgetInstanceConfig(config, availableOrder, premium, policy);
    const persisted = sameConfigState(config, normalized.config) ? config : normalized.config;
    if (persisted !== config) await writeWidgetConfig(persisted, store);
    normalizedConfigs.set(widgetId, persisted);
    accessByWidgetId.set(widgetId, normalized.access);
  }
  return { policy, configs: normalizedConfigs, accessByWidgetId };
}

export function reconcileAllWidgetConfigs(
  uid: string,
  availableIds: string[],
  premium: boolean,
  explicitWidgetIds: number[] = [],
  store: Store = AsyncStorage,
): Promise<ReconciledWidgetConfigs> {
  return withUidQueue(uid, () => reconcileAllWidgetConfigsUnlocked(uid, availableIds, premium, explicitWidgetIds, store));
}

export async function deleteWidgetConfig(widgetId: number, uid: string, store: Store = AsyncStorage) {
  await store.removeItem(key(widgetId, uid));
  await unregisterWidgetConfig(widgetId, uid, store);
}

export async function deleteWidgetInstance(widgetId: number, store: Store = AsyncStorage) {
  try {
    const value: unknown = JSON.parse((await store.getItem(ownersKey(widgetId))) ?? "[]");
    if (Array.isArray(value)) {
      for (const uid of value) if (typeof uid === "string") {
        await store.removeItem(key(widgetId, uid));
        await unregisterWidgetConfig(widgetId, uid, store);
      }
    }
  } finally {
    await store.removeItem(ownersKey(widgetId));
  }
}

export function resolveWidgetAddRequest(selectedIds: string[], challengeId: string, premium: boolean): { selectedIds: string[]; requiresPremium: boolean } {
  const current = uniqueIds(selectedIds);
  if (current.includes(challengeId)) return { selectedIds: current, requiresPremium: false };
  if (!premium && current.length >= 1) return { selectedIds: current, requiresPremium: true };
  return { selectedIds: [...current, challengeId], requiresPremium: false };
}

export function selectConfiguredChallengeIds(
  availableIds: string[], config: CompatibleWidgetConfig | WidgetInstanceConfig | null, premium: boolean,
  policy: CompatibleAccessPolicy | null = null,
): string[] {
  if (!config) return premium ? [] : resolveWidgetChallengeAccess(availableIds, [], false, policy).orderedIds;
  const normalized = clean(config, config.widgetId, config.uid);
  if (!normalized) return [];
  return normalizeWidgetInstanceConfig(normalized, availableIds, premium, policy).access.orderedIds;
}
