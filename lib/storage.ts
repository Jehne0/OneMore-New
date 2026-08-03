import AsyncStorage from "@react-native-async-storage/async-storage";
import { ensureDaily } from "./logic";
import { getTodayISO } from "./clock";
import { auth } from "./firebase";
import { requestIosWidgetStateSync } from "./iosWidgetUpdateSignal";

const LEGACY_STORAGE_KEY = "onemore_state";
const LEGACY_BACKUP_KEY = "onemore_state_backup";
const LEGACY_CHALLENGES_KEY = "onemore_challenges_v1";
const LEGACY_STATS_KEY = "onemore_challengeStats_v1";
const LEGACY_LOCAL_UPDATED_AT_KEY = "onemore_local_updatedAtISO";
const UID_MIGRATION_MARKER_KEY = "onemore_state_migrated_to_uid";

const storageKeyForUid = (uid: string) => `${LEGACY_STORAGE_KEY}_${uid}`;
const backupKeyForUid = (uid: string) => `${LEGACY_BACKUP_KEY}_${uid}`;
const challengesKeyForUid = (uid: string) => `${LEGACY_CHALLENGES_KEY}_${uid}`;
const statsKeyForUid = (uid: string) => `${LEGACY_STATS_KEY}_${uid}`;
export const localUpdatedAtKeyForUid = (uid: string) =>
  `${LEGACY_LOCAL_UPDATED_AT_KEY}_${uid}`;

// ---- FAST-KEYS in-memory cache (pro ultra rychlé přepínání obrazovek) ----
// Pozn.: AsyncStorage.getItem + JSON.parse dokáže na některých zařízeních trvat překvapivě dlouho
// i pro relativně malé payloady. Proto cacheujeme výsledky a aktualizujeme je při saveState().
let _fastChallengesCache: Challenge[] | null = null;
let _fastStatsCache: Record<string, ChallengeStats> | null = null;
let _fastChallengesCacheUid: string | null = null;
let _fastStatsCacheUid: string | null = null;

// ✅ fallback klíče (když se někdy omylem změnil STORAGE_KEY a data jsou uložená jinde)
const LEGACY_KEYS = ["onemore_state_v2", "onemoreState", "oneMore_state"];
// ---------- CHALLENGE STATS HELPERS ----------
function normalizeStats(s?: ChallengeStats): ChallengeStats {
  return {
    completedCount: Number(s?.completedCount ?? 0),
    skippedCount: Number(s?.skippedCount ?? 0),
    lastCompletedDay: s?.lastCompletedDay,
    lastStreakDay: s?.lastStreakDay ?? s?.lastCompletedDay,
    currentStreak: Number(s?.currentStreak ?? 0),
    bestStreak: Number(s?.bestStreak ?? 0),
    skipCredits: Math.min(1, Math.max(0, Number(s?.skipCredits ?? 0))),
  };
}

function safeNonNegativeStreak(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseLocalDateKey(dateISO: string): Date | null {
  if (!DATE_KEY_RE.test(dateISO)) return null;
  const [yearRaw, monthRaw, dayRaw] = dateISO.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateKeyOrdinal(dateISO: string): number | null {
  if (!DATE_KEY_RE.test(dateISO)) return null;
  const [yearRaw, monthRaw, dayRaw] = dateISO.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function mergeChallengeStatsMonotonic(
  existing?: Record<string, ChallengeStats>,
  incoming?: Record<string, ChallengeStats>
): Record<string, ChallengeStats> {
  const existingMap = existing ?? {};
  if (!incoming || typeof incoming !== "object") return existingMap;

  const merged: Record<string, ChallengeStats> = { ...existingMap };

  for (const [id, incomingStats] of Object.entries(incoming)) {
    const existingStats = existingMap[id];
    const nextStats = { ...(existingStats ?? {}), ...(incomingStats ?? {}) } as ChallengeStats;

    nextStats.bestStreak = Math.max(
      safeNonNegativeStreak(existingStats?.bestStreak),
      safeNonNegativeStreak(incomingStats?.bestStreak)
    );

    merged[id] = nextStats;
  }

  return merged;
}

export function isChallengeEasyMode(challenge?: Pick<Challenge, "easyMode"> | null): boolean {
  return challenge?.easyMode === true;
}

export function challengeDisplayText(challenge?: Pick<Challenge, "text" | "easyMode"> | null, fallback = ""): string {
  const text = String(challenge?.text ?? fallback);
  return isChallengeEasyMode(challenge) ? `${text} (easy)` : text;
}

export function updateStatsOnCompleted(
  state: AppState,
  challengeId: string,
  today: string
): Record<string, ChallengeStats> {
  const map = { ...(state.challengeStats ?? {}) };
  const ch = (state.challenges ?? []).find((c: any) => String(c.id) === String(challengeId)) as any;
  const prev = normalizeStats(map[challengeId]);
  if (isChallengeEasyMode(ch) || isChallengeIdEasyMode(state, challengeId)) {
    map[challengeId] = {
      ...prev,
      completedCount: prev.completedCount + 1,
      lastCompletedDay: today,
    };
    return map;
  }

  const prevActive = prevActiveDayISO(ch ?? null, today);
  const lastStreakDay = prev.lastStreakDay ?? prev.lastCompletedDay;

  const dayAlreadyCounted = prev.lastCompletedDay === today;

  const nextStreak = dayAlreadyCounted
    ? prev.currentStreak
    : lastStreakDay === prevActive
      ? prev.currentStreak + 1
      : 1;
  const earnedFreeze = !dayAlreadyCounted && nextStreak > 0 && nextStreak % 10 === 0;

  const next: ChallengeStats = {
    ...prev,
    completedCount: prev.completedCount + 1,
    lastCompletedDay: today,
    lastStreakDay: today,
    currentStreak: nextStreak,
    bestStreak: Math.max(prev.bestStreak, nextStreak),
    skipCredits: earnedFreeze ? 1 : Math.min(1, prev.skipCredits),
  };

  map[challengeId] = next;
  return map;
}

export function updateStatsOnSkipped(
  state: AppState,
  challengeId: string,
  today: string
): Record<string, ChallengeStats> {
  const map = { ...(state.challengeStats ?? {}) };
  const ch = (state.challenges ?? []).find((c: any) => String(c.id) === String(challengeId)) as any;
  const prev = normalizeStats(map[challengeId]);
  if (isChallengeEasyMode(ch) || isChallengeIdEasyMode(state, challengeId)) {
    map[challengeId] = {
      ...prev,
      skippedCount: prev.skippedCount + 1,
    };
    return map;
  }

  const usesFreeze = prev.skipCredits > 0 && prev.currentStreak >= 10;

  const next: ChallengeStats = {
    ...prev,
    skippedCount: prev.skippedCount + 1,
    currentStreak: usesFreeze ? prev.currentStreak : 0,
    lastStreakDay: usesFreeze ? today : prev.lastStreakDay,
    skipCredits: usesFreeze ? 0 : prev.skipCredits,
  };

  map[challengeId] = next;
  return map;
}



// ---- in-memory cache + listeners (rychlejší UI, okamžité přepočty) ----
let _cache: AppState | null = null;
let _cacheUid: string | null = null;
const STATE_UID = Symbol("onemoreStateUid");
const _listeners = new Set<(s: AppState) => void>();

export function getCachedState(): AppState | null {
  const uid = auth.currentUser?.uid ?? null;
  return uid && _cacheUid === uid ? _cache : null;
}

export function subscribeState(fn: (s: AppState) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function _notify(next: AppState) {
  for (const fn of Array.from(_listeners)) {
    try {
      fn(next);
    } catch {}
  }
}


// ---------- TYPES ----------
export type Challenge = {
  id: string;
  text: string;
  enabled: boolean;
  deletedAt?: string; // ISO timestamp, když je výzva "smazaná"

  /**
   * ✅ Perioda výzvy
   * - daily: každý den
   * - every2: obden (podle anchor dne)
   * - custom: jen vybrané dny v týdnu
   */
  period?: "daily" | "every2" | "custom";

  /**
   * Pouze pro period="custom": dny v týdnu (0=Po … 6=Ne)
   */
  customDays?: number[];

  /**
   * Pouze pro period="every2": anchor den (YYYY-MM-DD)
   */
  periodAnchor?: string;

  /**
   * Kolikrát denně se má výzva splnit (Premium může 2×/3×/…)
   * Free: typicky 1
   */
  targetPerDay?: number; // default 1

  // Připomínky pro danou výzvu
  reminderEnabled?: boolean; // default false
  reminderTimes?: string[]; // ["HH:mm", ...] (např. ["09:00","18:00"])

  /** Irreversible fun mode: no streak reset, no new competitive stats/medals. */
  easyMode?: boolean;

  /** Inactive date ranges. `endDate` is exclusive; a missing end means paused now. */
  inactivePeriods?: { startDate: string; endDate?: string }[];
};


export type ArchivedChallenge = {
  id: string;
  text: string;
  enabled: boolean;
  deletedAtISO: string;
  easyMode?: boolean;
};

export type HistoryEntry = {
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:mm"
  atISO: string; // plný timestamp pro unikátní klíč a přesný čas
  challengeId?: string;
  challengeText: string; // snapshot textu v době uložení
  status: "completed" | "skipped";

  // ✅ true = jen dílčí splnění, např. 1/4, 2/4, 3/4
  // Streak se počítá až při posledním kroku, např. 4/4.
  partial?: boolean;
  protectedByFreeze?: boolean;
};


export type ChallengeStats = {
  completedCount: number;
  skippedCount: number;
  /** poslední den, kdy byla výzva splněna (YYYY-MM-DD) */
  lastCompletedDay?: string;
  /** poslední den, do kterého streak navazuje, včetně chráněného vynechání */
  lastStreakDay?: string;
  /** aktuální streak pro tuto výzvu (po dnech s alespoň 1 splněním) */
  currentStreak: number;
  /** nejlepší streak pro tuto výzvu */
  bestStreak: number;
  /** volný den pro zachování streaku; maximum je 1 */
  skipCredits: number;
};



export type AppState = {
  challenges: Challenge[];
  easyModeChallengeIds?: string[];

  // ✅ map challengeId -> scheduled notificationId(s) (kvůli rušení/změně)
  reminderNotifIds?: Record<string, string[]>;

  // daily pick (kompatibilita)
  lastPickDate?: string; // YYYY-MM-DD
  dailyIds?: string[]; // vybrané id(čka) na dnešek (zatím používáš 1)

  // streak
  lastCompletedDate?: string; // YYYY-MM-DD
  streak: number;

  // ✅ kdy byla appka naposled otevřená (pro doplňování vynechaných dní)
  lastOpenDate?: string; // YYYY-MM-DD

  // volby (pokud je používáš)
  mode?: string;
  oddEvenIds?: { odd: string; even: string };

  // ✅ rychlé statistiky per výzva (pro Historii/Statistiky)
  challengeStats?: Record<string, ChallengeStats>;

  // ✅ historie jako seznam záznamů (přežije smazání výzvy)
  history: HistoryEntry[];

  // ✅ archiv smazaných výzev (pro obrazovku Výzvy)
  archivedChallenges: ArchivedChallenge[];

  // ✅ TRVALÉ: výzvy, které byly někdy splněné (nikdy nemažeme při delete/disable/purge)
  // ukládáme jako klíče "id:<id>" nebo fallback "text:<snapshot>"
  everCompletedKeys: string[];
};

// ---------- DEFAULT STATE ----------
export const defaultState: AppState = {
  challenges: [],
  mode: "RANDOM_1",
  oddEvenIds: { odd: "1", even: "2" },
  streak: 0,
  lastOpenDate: undefined,
  history: [],
  archivedChallenges: [],
  easyModeChallengeIds: [],
  everCompletedKeys: [],

  // ✅ free reminder storage
  reminderNotifIds: {},
};

function stateUid(state: AppState): string | null {
  return String((state as any)?.[STATE_UID] ?? "") || null;
}

function tagStateForUid(state: AppState, uid?: string | null): AppState {
  if (!uid) return state;
  Object.defineProperty(state, STATE_UID, {
    value: uid,
    enumerable: true,
    configurable: true,
  });
  return state;
}

function createDefaultState(uid?: string | null): AppState {
  return tagStateForUid(
    {
      ...defaultState,
      challenges: [],
      oddEvenIds: { ...defaultState.oddEvenIds! },
      history: [],
      archivedChallenges: [],
      easyModeChallengeIds: [],
      everCompletedKeys: [],
      reminderNotifIds: {},
      challengeStats: {},
    },
    uid
  );
}

function clearStateCaches() {
  _cache = null;
  _cacheUid = null;
  _fastChallengesCache = null;
  _fastStatsCache = null;
  _fastChallengesCacheUid = null;
  _fastStatsCacheUid = null;
}

export function clearInMemoryState(): void {
  clearStateCaches();
  _notify(createDefaultState());
}

export function easyModeChallengeIdSet(
  state?: Pick<AppState, "challenges" | "archivedChallenges" | "easyModeChallengeIds"> | null
): Set<string> {
  const ids = new Set<string>();

  for (const id of state?.easyModeChallengeIds ?? []) {
    const normalized = String(id ?? "");
    if (normalized) ids.add(normalized);
  }

  for (const c of [...(state?.challenges ?? []), ...(state?.archivedChallenges ?? [])] as Array<Challenge | ArchivedChallenge>) {
    if (isChallengeEasyMode(c)) ids.add(String(c.id));
  }

  return ids;
}

export function isChallengeIdEasyMode(
  state: Pick<AppState, "challenges" | "archivedChallenges" | "easyModeChallengeIds"> | null | undefined,
  challengeId: string | number | null | undefined
): boolean {
  const id = String(challengeId ?? "");
  return !!id && easyModeChallengeIdSet(state).has(id);
}

// ---------- DATE HELPERS ----------
function timeHM(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function addDaysISO(iso: string, days: number): string {
  const d = parseLocalDateKey(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}

function yesterdayISO(): string {
  return addDaysISO(getTodayISO(), -1);
}


// 0=Po ... 6=Ne
function dowMon0(dateISO: string): number {
  const d = parseLocalDateKey(dateISO);
  if (!d) return 0;
  const js = d.getDay(); // 0=Ne..6=So
  return (js + 6) % 7;
}

function diffDaysISO(aISO: string, bISO: string): number {
  const a = dateKeyOrdinal(aISO);
  const b = dateKeyOrdinal(bISO);
  if (a == null || b == null) return 0;
  return a - b;
}

export function isChallengeActiveOnDate(c: Challenge | undefined | null, dateISO: string): boolean {
  if (!c) return true; // když nemáme definici, bereme jako daily
  if (c.deletedAt) return false;
  const inactivePeriods = Array.isArray(c.inactivePeriods) ? c.inactivePeriods : [];
  if (inactivePeriods.some((period) =>
    period.startDate <= dateISO && (!period.endDate || dateISO < period.endDate)
  )) return false;
  if (c.enabled === false && inactivePeriods.length === 0) return false;

  const period = c.period === "every2" || c.period === "custom" || c.period === "daily" ? c.period : "daily";
  if (period === "daily") return true;

  if (period === "every2") {
    const anchor = typeof c.periodAnchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.periodAnchor) ? c.periodAnchor : dateISO;
    const diff = diffDaysISO(dateISO, anchor);
    return Math.abs(diff) % 2 === 0;
  }

  // custom
  const days: number[] = Array.isArray(c.customDays)
    ? c.customDays
        .map((n: any) => Number(n))
        .filter((n: number) => Number.isFinite(n) && n >= 0 && n <= 6)
        .map((n: number) => Math.floor(n))
    : [];
  const dow = dowMon0(dateISO);
  return days.includes(dow);
}

function prevActiveDayISO(c: Challenge | undefined | null, todayISO: string): string {
  if (!c) return addDaysISO(todayISO, -1);
  for (let i = 1; i <= 36600; i++) {
    const d = addDaysISO(todayISO, -i);
    if (isChallengeActiveOnDate(c, d)) return d;
  }
  return addDaysISO(todayISO, -1);
}

function normalizeInactivePeriods(raw: unknown): { startDate: string; endDate?: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value: any) => {
    const startDate = String(value?.startDate ?? "");
    const endDate = value?.endDate == null ? undefined : String(value.endDate);
    if (!DATE_KEY_RE.test(startDate) || (endDate && !DATE_KEY_RE.test(endDate))) return [];
    if (endDate && endDate <= startDate) return [];
    return [endDate ? { startDate, endDate } : { startDate }];
  }).sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function transitionChallengeEnabled(challenge: Challenge, enabled: boolean, dateISO = getTodayISO()): Challenge {
  const wasEnabled = challenge.enabled !== false;
  if (wasEnabled === enabled) return { ...challenge, enabled };
  const periods = normalizeInactivePeriods(challenge.inactivePeriods);
  if (!enabled) {
    return { ...challenge, enabled: false, inactivePeriods: periods.some((p) => !p.endDate) ? periods : [...periods, { startDate: dateISO }] };
  }
  return {
    ...challenge,
    enabled: true,
    inactivePeriods: periods
      .map((period) => !period.endDate ? { ...period, endDate: dateISO } : period)
      .filter((period) => !period.endDate || period.endDate > period.startDate),
  };
}

// ---------- INTERNAL HELPERS ----------
async function readStateFromKey(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

function normalizeTimeHHMM(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? v : undefined;
}

function normalizeReminderNotifIds(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k);
    if (!key) continue;

    if (Array.isArray(v)) {
      const arr = (v as unknown[])
        .map((x) => (typeof x === "string" ? x : String(x ?? "")))
        .filter(Boolean);
      if (arr.length) out[key] = arr;
    } else if (typeof v === "string" && v) {
      // legacy: single string id
      out[key] = [v];
    } else if (v != null) {
      const s = String(v);
      if (s) out[key] = [s];
    }
  }
  return out;
}


/**
 * MIGRACE historie:
 * - pokud už je to HistoryEntry[] → normalizujeme
 * - pokud je to starý formát Record<string, Record<string, boolean>> → převedeme na entries
 */
function migrateHistory(rawHistory: unknown): HistoryEntry[] {
  // 1) nový formát: array
  if (Array.isArray(rawHistory)) {
    return rawHistory
      .filter(Boolean)
     .map((h: any): HistoryEntry => ({
  date: String(h.date ?? ""),
  time: String(h.time ?? ""),
  atISO: String(h.atISO ?? ""),
  challengeId: h.challengeId != null ? String(h.challengeId) : undefined,
  challengeText: String(h.challengeText ?? ""),
  status: h.status === "skipped" ? "skipped" : "completed",
  partial: h.partial === true,
  protectedByFreeze: h.protectedByFreeze === true,
}))
      .filter((h: HistoryEntry) => !!h.date);
  }

  // 2) starý formát: history[challengeId][YYYY-MM-DD] = true
  if (rawHistory && typeof rawHistory === "object") {
    const entries: HistoryEntry[] = [];

    for (const [challengeId, datesObj] of Object.entries(rawHistory as Record<string, unknown>)) {
      if (!datesObj || typeof datesObj !== "object") continue;

      for (const [date, completed] of Object.entries(datesObj as Record<string, unknown>)) {
        if (completed !== true) continue;

        entries.push({
          date: String(date),
          time: "00:00",
          atISO: `${String(date)}T00:00:00.000Z`,
          challengeId: String(challengeId),
          challengeText: "",
          status: "completed",
        });
      }
    }

    entries.sort((a, b) => (a.date < b.date ? 1 : -1));
    return entries;
  }

  return [];
}

function normalizeArchived(raw: unknown): ArchivedChallenge[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(Boolean)
    .map((a: any): ArchivedChallenge => ({
      id: String(a.id ?? ""),
      text: String(a.text ?? ""),
      enabled: a.enabled ?? true,
      deletedAtISO: String(a.deletedAtISO ?? a.deletedAt ?? new Date(0).toISOString()),
      easyMode: a.easyMode === true,
    }))
    .filter((a: ArchivedChallenge) => !!a.id);
}

function normalizeEverCompletedKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.map((x: unknown) => String(x)).filter(Boolean)));
}

function upsertArchived(list: ArchivedChallenge[], item: ArchivedChallenge): ArchivedChallenge[] {
  const idx = (list ?? []).findIndex((x) => x.id === item.id);
  if (idx >= 0) {
    const copy = [...list];
    copy[idx] = item;
    return copy;
  }
  return [item, ...(list ?? [])];
}

/**
 * ✅ SAFE MERGE:
 * Když někdo omylem zavolá saveState s nekompletním objektem (např. jen {challenges}),
 * tady to opravíme: vždy zachováme existující history/archiv/streak atd.
 */
function mergeWithExisting(existing: AppState, incoming: Partial<AppState>): AppState {
  const merged: AppState = {
    ...existing,
    ...incoming,

    challenges: Array.isArray(incoming.challenges) ? incoming.challenges : existing.challenges,
    history: Array.isArray((incoming as any).history) ? (incoming as any).history : existing.history,
    archivedChallenges: Array.isArray((incoming as any).archivedChallenges)
      ? (incoming as any).archivedChallenges
      : existing.archivedChallenges,

    everCompletedKeys: Array.isArray((incoming as any).everCompletedKeys)
      ? (incoming as any).everCompletedKeys
      : existing.everCompletedKeys,

    // ✅ reminder notif map (zachovat)
    reminderNotifIds:
      (incoming as any).reminderNotifIds && typeof (incoming as any).reminderNotifIds === "object"
        ? (incoming as any).reminderNotifIds
        : existing.reminderNotifIds ?? {},

    streak: typeof incoming.streak === "number" ? incoming.streak : existing.streak,

    mode: incoming.mode ?? existing.mode,
    oddEvenIds: incoming.oddEvenIds ?? existing.oddEvenIds,

    lastPickDate: incoming.lastPickDate ?? existing.lastPickDate,
    dailyIds: incoming.dailyIds ?? existing.dailyIds,
    lastCompletedDate: Object.prototype.hasOwnProperty.call(incoming, "lastCompletedDate")
  ? incoming.lastCompletedDate
  : existing.lastCompletedDate,
    lastOpenDate: incoming.lastOpenDate ?? existing.lastOpenDate,
  };

  merged.challengeStats = mergeChallengeStatsMonotonic(
    existing.challengeStats,
    incoming.challengeStats
  );

  merged.history = migrateHistory(merged.history);
  const existingEasyIds = easyModeChallengeIdSet(existing);
  for (const id of normalizeEverCompletedKeys((incoming as any).easyModeChallengeIds)) {
    existingEasyIds.add(id);
  }
  const existingArchivedEasyIds = new Set(
    (existing.archivedChallenges ?? [])
      .filter((c: any) => c?.easyMode === true || existingEasyIds.has(String(c.id)))
      .map((c: any) => String(c.id))
  );

  merged.archivedChallenges = normalizeArchived(merged.archivedChallenges).map((c: any) => ({
    ...c,
    easyMode: c.easyMode === true || existingArchivedEasyIds.has(String(c.id)),
  }));
  merged.everCompletedKeys = normalizeEverCompletedKeys(merged.everCompletedKeys);

  merged.reminderNotifIds = normalizeReminderNotifIds(merged.reminderNotifIds);

  merged.challenges = (merged.challenges ?? []).map((c: any) => ({
    id: String(c.id),
    text: String(c.text ?? ""),
    enabled: c.enabled ?? true,
    deletedAt: c.deletedAt ? String(c.deletedAt) : undefined,

    // ✅ perioda
    period: c.period === "every2" || c.period === "custom" || c.period === "daily" ? c.period : "daily",
    customDays: Array.isArray(c.customDays)
          ? (Array.from(
              new Set(
                c.customDays
                  .map((n: any) => Number(n))
                  .filter((n: number) => Number.isFinite(n) && n >= 0 && n <= 6)
                  .map((n: number) => Math.floor(n))
              )
            ) as number[]).sort((a: number, b: number) => a - b)
          : [],
    periodAnchor:
      typeof c.periodAnchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.periodAnchor)
        ? String(c.periodAnchor)
        : undefined,

    // ✅ defaults
    targetPerDay:
      typeof c.targetPerDay === "number" && Number.isFinite(c.targetPerDay) && c.targetPerDay > 0
        ? Math.floor(c.targetPerDay)
        : 1,

    reminderEnabled: typeof c.reminderEnabled === "boolean" ? c.reminderEnabled : false,
    reminderTimes: Array.isArray(c.reminderTimes)
      ? c.reminderTimes.map(normalizeTimeHHMM).filter(Boolean)
      : normalizeTimeHHMM(c.reminderTime)
        ? [normalizeTimeHHMM(c.reminderTime) as string]
        : [],
    easyMode: c.easyMode === true || existingEasyIds.has(String(c.id)),
    inactivePeriods: normalizeInactivePeriods(c.inactivePeriods).length > 0
      ? normalizeInactivePeriods(c.inactivePeriods)
      : c.enabled === false ? [{ startDate: "0001-01-01" }] : [],
  }));

  merged.easyModeChallengeIds = Array.from(
    new Set([
      ...normalizeEverCompletedKeys((incoming as any).easyModeChallengeIds),
      ...Array.from(existingEasyIds),
      ...Array.from(easyModeChallengeIdSet(merged)),
    ])
  );
    return merged;
}

function parseAndMerge(raw: string): AppState {
  const parsed = JSON.parse(raw) as Partial<AppState>;
  const parsedChallenges = Array.isArray(parsed.challenges) ? parsed.challenges : [];
  const parsedArchivedChallenges = Array.isArray((parsed as any).archivedChallenges)
    ? ((parsed as any).archivedChallenges as any[])
    : [];
  const parsedEasyIds = new Set(normalizeEverCompletedKeys((parsed as any).easyModeChallengeIds));
  for (const c of parsedChallenges as any[]) {
    if (c?.easyMode === true) parsedEasyIds.add(String(c.id));
  }
  for (const c of parsedArchivedChallenges) {
    if (c?.easyMode === true) parsedEasyIds.add(String(c.id));
  }

  const challenges: Challenge[] = parsedChallenges.map((c: any) => ({
    id: String(c.id),
    text: String(c.text ?? ""),
    enabled: c.enabled ?? true,
    deletedAt: c.deletedAt ? String(c.deletedAt) : undefined,

    // ✅ perioda
    period: c.period === "every2" || c.period === "custom" || c.period === "daily" ? c.period : "daily",
    customDays: Array.isArray(c.customDays)
      ? (Array.from(
          new Set<number>(
            c.customDays
              .map((n: any) => Number(n))
              .filter((n: number) => Number.isFinite(n) && n >= 0 && n <= 6)
              .map((n: number) => Math.floor(n))
          )
        ) as number[]).sort((a: number, b: number) => a - b)
      : ([] as number[]),
    periodAnchor:
      typeof c.periodAnchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.periodAnchor)
        ? c.periodAnchor
        : undefined,

    // ✅ defaults
targetPerDay: typeof c.targetPerDay === "number" && Number.isFinite(c.targetPerDay) && c.targetPerDay > 0
  ? Math.floor(c.targetPerDay)
  : 1,

reminderEnabled: typeof c.reminderEnabled === "boolean" ? c.reminderEnabled : false,
reminderTimes: Array.isArray(c.reminderTimes)
  ? c.reminderTimes.map(normalizeTimeHHMM).filter(Boolean)
  : normalizeTimeHHMM(c.reminderTime)
    ? [normalizeTimeHHMM(c.reminderTime) as string]
    : [],
easyMode: c.easyMode === true || parsedEasyIds.has(String(c.id)),
inactivePeriods: normalizeInactivePeriods(c.inactivePeriods).length > 0
  ? normalizeInactivePeriods(c.inactivePeriods)
  : c.enabled === false ? [{ startDate: "0001-01-01" }] : [],

  }));

  const history: HistoryEntry[] = migrateHistory((parsed as any).history);
  const archivedChallenges = normalizeArchived(parsedArchivedChallenges).map((c: any) => ({
    ...c,
    easyMode: c.easyMode === true || parsedEasyIds.has(String(c.id)),
  }));

  const merged: AppState = {
    ...defaultState,
    ...parsed,
    challenges,
    history,
    streak: typeof parsed.streak === "number" ? parsed.streak : defaultState.streak,
    archivedChallenges,
    lastOpenDate: parsed.lastOpenDate ? String(parsed.lastOpenDate) : undefined,
    everCompletedKeys: normalizeEverCompletedKeys((parsed as any).everCompletedKeys),

    // ✅ reminder notif map
    reminderNotifIds: normalizeReminderNotifIds((parsed as any).reminderNotifIds),
  };

  merged.easyModeChallengeIds = Array.from(easyModeChallengeIdSet(merged));

  return merged;
}

export function normalizeAppStateSnapshot(
  raw: Partial<AppState> | AppState | unknown,
  uid?: string | null
): AppState {
  const parsed = parseAndMerge(JSON.stringify(raw && typeof raw === "object" ? raw : {}));
  const { next: migrated } = migrateBestStreakFromCurrent(parsed);
  return tagStateForUid(migrated, uid);
}

/**
 * ✅ Z historie doplní everCompletedKeys (kvůli starým datům),
 * aby "výzvy, které jsem kdy splnil" neukazovaly 0 po upgradu.
 * Dělá se bezpečně: jen přidává, nikdy neubírá.
 */
function migrateEverCompletedFromHistory(state: AppState): { next: AppState; changed: boolean } {
  const ever = new Set<string>(state.everCompletedKeys ?? []);
  const before = ever.size;

for (const h of state.history ?? []) {
  if (h.status !== "completed") continue;

  // ✅ Dílčí splnění typu 1/4 nesmí znamenat "výzva byla někdy splněna".
  if ((h as any).partial === true) continue;

  if (h.challengeId) ever.add(`id:${String(h.challengeId)}`);
  else if (h.challengeText) ever.add(`text:${String(h.challengeText)}`);
}

  if (ever.size === before) return { next: state, changed: false };
  return { next: { ...state, everCompletedKeys: Array.from(ever) }, changed: true };
}

/**
 * One-time normalization for older stats where currentStreak could be higher
 * than the stored historical maximum. Only raises bestStreak; never lowers it.
 */
export function calculateStreaksFromHistoryForChallenge(
  history: HistoryEntry[],
  challengeId: string,
  challenge?: Challenge
): { currentStreak: number; bestStreak: number; latestCompletedDay?: string; sortedDateKeys: string[] } {
  const eventsByDate = new Map<string, { completed: boolean; skipped: boolean }>();

  for (const entry of history ?? []) {
    if (String(entry?.challengeId ?? "") !== challengeId) continue;
    const date = String(entry?.date ?? "");
    if (!parseLocalDateKey(date)) continue;

    const event = eventsByDate.get(date) ?? { completed: false, skipped: false };
    if (entry.status === "completed" && entry.partial !== true) event.completed = true;
    if (entry.status === "skipped") event.skipped = true;
    eventsByDate.set(date, event);
  }

  const sortedDateKeys = Array.from(eventsByDate.keys()).sort((a, b) => a.localeCompare(b));
  let bestStreak = 0;
  let runLength = 0;
  let previousCompletedDay: string | undefined;
  let latestCompletedDay: string | undefined;

  for (const date of sortedDateKeys) {
    const event = eventsByDate.get(date);
    if (!event?.completed) {
      runLength = 0;
      previousCompletedDay = undefined;
      continue;
    }

    let connectsToPrevious = false;
    if (previousCompletedDay) {
      connectsToPrevious = true;
      for (let cursor = addDaysISO(previousCompletedDay, 1); cursor < date; cursor = addDaysISO(cursor, 1)) {
        if (isChallengeActiveOnDate(challenge, cursor)) {
          connectsToPrevious = false;
          break;
        }
      }
    }
    runLength = previousCompletedDay && connectsToPrevious ? runLength + 1 : 1;
    bestStreak = Math.max(bestStreak, runLength);
    previousCompletedDay = date;
    latestCompletedDay = date;
  }

  let currentStreak = 0;
  if (latestCompletedDay) {
    const latestEventDay = sortedDateKeys[sortedDateKeys.length - 1];
    if (latestEventDay === latestCompletedDay) {
      currentStreak = 1;
      let cursor = addDaysISO(latestCompletedDay, -1);
      while (true) {
        const event = eventsByDate.get(cursor);
        if (event?.skipped) break;
        if (event?.completed) currentStreak += 1;
        else if (isChallengeActiveOnDate(challenge, cursor)) break;
        cursor = addDaysISO(cursor, -1);
        if (!sortedDateKeys.length || cursor < sortedDateKeys[0]) break;
      }
    }
  }

  return { currentStreak, bestStreak, latestCompletedDay, sortedDateKeys };
}

function migrateBestStreakFromCurrent(state: AppState): { next: AppState; changed: boolean } {
  const stats = state.challengeStats ?? {};
  let changed = false;
  const nextStats: Record<string, ChallengeStats> = { ...stats };
  const challengeIds = new Set<string>(Object.keys(stats).map(String));

  for (const entry of state.history ?? []) {
    const id = String(entry?.challengeId ?? "");
    if (id) challengeIds.add(id);
  }

  for (const id of challengeIds) {
    const value = stats[id];
    const currentStreak = safeNonNegativeStreak(value?.currentStreak);
    const bestStreak = safeNonNegativeStreak(value?.bestStreak);
    const challenge = (state.challenges ?? []).find((item) => String(item.id) === id);
    const calculated = calculateStreaksFromHistoryForChallenge(state.history ?? [], id, challenge);
    const hasHistory = calculated.sortedDateKeys.length > 0;
    const repairedCurrent = hasHistory ? calculated.currentStreak : currentStreak;
    const repairedBest = Math.max(bestStreak, calculated.bestStreak);

    if (repairedCurrent !== currentStreak || repairedBest > bestStreak) {
      const nextValue = normalizeStats(value);
      nextStats[id] = {
        ...nextValue,
        currentStreak: repairedCurrent,
        bestStreak: repairedBest,
        lastCompletedDay:
          calculated.latestCompletedDay && calculated.latestCompletedDay > String(nextValue.lastCompletedDay ?? "")
            ? calculated.latestCompletedDay
            : nextValue.lastCompletedDay,
        lastStreakDay:
          calculated.latestCompletedDay && calculated.latestCompletedDay > String(nextValue.lastStreakDay ?? "")
            ? calculated.latestCompletedDay
            : nextValue.lastStreakDay,
      };
      changed = true;

      if (__DEV__) {
        const rawHistoryEntries = (state.history ?? [])
          .filter((entry) => String(entry?.challengeId ?? "") === id)
          .map((entry) => {
            const parsedDate = parseLocalDateKey(String(entry.date));
            return {
              date: entry.date,
              status: entry.status,
              partial: entry.partial === true,
              parsedDate: parsedDate ? localDateKey(parsedDate) : null,
            };
          });

        console.log("[STREAK REPAIR]", {
          challengeId: id,
          rawHistoryEntries,
          sortedDateKeys: calculated.sortedDateKeys,
          calculatedCurrentStreak: calculated.currentStreak,
          calculatedBestStreak: calculated.bestStreak,
          storedCurrentStreak: currentStreak,
          storedBestStreak: bestStreak,
          displayedCurrentStreak: repairedCurrent,
          repairedBestStreak: repairedBest,
        });
      }
    }
  }

  if (!changed) return { next: state, changed: false };
  return { next: { ...state, challengeStats: nextStats }, changed: true };
}

/**
 * ✅ AUTO-UZÁVĚRKA POUZE VČEREJŠKA (u každé aktivní výzvy)
 * - Při prvním otevření dne (lastOpenDate != today) uzavře jen VČEREJŠEK.
 * - Pro každou výzvu, která je dnes aktivní (enabled && !deletedAt),
 *   pokud včera nemá záznam (completed/skipped), doplní "skipped".
 * - Starší dny se NEdoplňují → žádné zahlcení.
 * - Pokud se něco doplní jako skipped, streak se přeruší (streak = 0).
 */
export function backfillSkippedDaysAndBreakStreak(state: AppState): { next: AppState; changed: boolean } {
  const today = getTodayISO();
  const lastOpen = state.lastOpenDate ?? state.lastPickDate ?? state.lastCompletedDate;

  if (!lastOpen) {
    const next = { ...state, lastOpenDate: today };
    return { next, changed: next.lastOpenDate !== state.lastOpenDate };
  }

  if (lastOpen === today) {
    return { next: state, changed: false };
  }

  const y = addDaysISO(today, -1);

  const activeIds = new Set(
    (state.challenges ?? [])
      .filter((c) => c.enabled && !c.deletedAt)
      .map((c) => String(c.id))
  );

  if (activeIds.size === 0) {
    const next = { ...state, lastOpenDate: today };
    return { next, changed: next.lastOpenDate !== state.lastOpenDate };
  }

  // existuje už záznam pro včerejšek + danou výzvu?
  const hasEntryForId = new Set(
    (state.history ?? [])
      .filter((h) => h.date === y && h.challengeId != null)
      .map((h) => String(h.challengeId))
  );

  const additions: HistoryEntry[] = [];

  for (const id of activeIds) {
    if (hasEntryForId.has(id)) continue;

    const ch = (state.challenges ?? []).find((c: any) => String(c.id) === String(id)) as any;
    // když včera nebyl podle periody aktivní den, je to volno → NIC nezapisujeme
    if (!isChallengeActiveOnDate(ch ?? null, y)) continue;

    const text =
      state.challenges.find((c) => String(c.id) === id)?.text ??
      state.archivedChallenges?.find((a) => String(a.id) === id)?.text ??
      "(smazaná výzva)";

    const stats = normalizeStats((state.challengeStats ?? {})[id]);
    const easyMode = isChallengeIdEasyMode(state, id);

    additions.push({
      date: y,
      time: "23:59",
      atISO: `${y}T23:59:59.000Z`,
      challengeId: id,
      challengeText: text,
      status: "skipped",
      protectedByFreeze: !easyMode && stats.skipCredits > 0 && stats.currentStreak >= 10,
    });
  }

  if (additions.length === 0) {
    const next = { ...state, lastOpenDate: today };
    return { next, changed: next.lastOpenDate !== state.lastOpenDate };
  }

  const nextStats = additions.reduce((map, e) => {
    const cid = String((e as any).challengeId ?? "");
    if (!cid) return map;
    return e.status === "completed" ? updateStatsOnCompleted({ ...state, challengeStats: map } as AppState, cid, e.date) : updateStatsOnSkipped({ ...state, challengeStats: map } as AppState, cid, e.date);
  }, { ...(state.challengeStats ?? {}) } as Record<string, ChallengeStats>);

 const hasFullCompletedOnDate = (dateISO: string) =>
  (state.history ?? []).some((h: any) => {
    return (
      h?.date === dateISO &&
      h?.status === "completed" &&
      h?.partial !== true
    );
  });

const hadAnyCompletedYesterday =
  state.lastCompletedDate === y || hasFullCompletedOnDate(y);
const hadProtectedFreezeYesterday = additions.some(
  (e) => e.protectedByFreeze === true
);
const wasEasySkip = (entry: HistoryEntry) => {
  const cid = String(entry.challengeId ?? "");
  const challenge = (state.challenges ?? []).find((c: any) => String(c.id) === cid);
  return isChallengeIdEasyMode(state, cid) || isChallengeEasyMode(challenge);
};
const hadOnlyEasySkipsYesterday = additions.length > 0 && additions.every(wasEasySkip);

let repairedStreak = Number(state.streak ?? 0);

// ✅ Když starší verze appky uložila lastCompletedDate, ale streak zůstal 0,
// zkusíme hlavní streak dopočítat z historie.
if (hadAnyCompletedYesterday && repairedStreak <= 0) {
  let cursor = y;
  let count = 0;

  while (hasFullCompletedOnDate(cursor)) {
    count += 1;
    cursor = addDaysISO(cursor, -1);
  }

  repairedStreak = count;
}

const next: AppState = {
  ...state,

  // ✅ Hlavní streak "Držíš se už X. den" nesmí spadnout jen proto,
  // že některá konkrétní výzva byla včera vynechaná.
  // Padá jen tehdy, když včera nebyla splněná žádná výzva.
  streak: hadProtectedFreezeYesterday || hadOnlyEasySkipsYesterday ? state.streak : hadAnyCompletedYesterday ? Math.max(1, repairedStreak) : 0,

  lastOpenDate: today,
  challengeStats: nextStats,
  history: [...additions.reverse(), ...(state.history ?? [])],
};

return { next, changed: true };
}

// ---------- STORAGE ----------


/**
 * ✅ FAST READS (nečte velký JSON state)
 * Používá se hlavně pro History screen, aby se otevíral okamžitě i při tisících záznamů.
 */
export async function loadChallengesFast(): Promise<Challenge[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  if (_fastChallengesCacheUid === uid && _fastChallengesCache) return _fastChallengesCache;
  try {
    const raw = await AsyncStorage.getItem(challengesKeyForUid(uid));
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const parsed = arr.map((c: any) => ({
          id: String(c.id),
          text: String(c.text ?? ""),
          enabled: c.enabled ?? true,
          deletedAt: c.deletedAt ? String(c.deletedAt) : undefined,
          period: c.period === "every2" || c.period === "custom" || c.period === "daily" ? c.period : "daily",
          customDays: Array.isArray(c.customDays)
                ? (Array.from(
                    new Set(
                      c.customDays
                        .map((n: any) => Number(n))
                        .filter((n: number) => Number.isFinite(n) && n >= 0 && n <= 6)
                        .map((n: number) => Math.floor(n))
                    )
                   ) as number[]).sort((a: number, b: number) => a - b)
                : [],
          periodAnchor:
            typeof c.periodAnchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.periodAnchor)
              ? c.periodAnchor
              : undefined,

          targetPerDay: typeof c.targetPerDay === "number" && Number.isFinite(c.targetPerDay) && c.targetPerDay > 0 ? Math.floor(c.targetPerDay) : 1,
          reminderEnabled: typeof c.reminderEnabled === "boolean" ? c.reminderEnabled : false,
          reminderTimes: Array.isArray(c.reminderTimes)
            ? c.reminderTimes.map(normalizeTimeHHMM).filter(Boolean)
            : normalizeTimeHHMM((c as any).reminderTime)
              ? [normalizeTimeHHMM((c as any).reminderTime) as string]
              : [],
          easyMode: c.easyMode === true,
          inactivePeriods: normalizeInactivePeriods(c.inactivePeriods).length > 0
            ? normalizeInactivePeriods(c.inactivePeriods)
            : c.enabled === false ? [{ startDate: "0001-01-01" }] : [],
        })) as Challenge[];

        if (auth.currentUser?.uid === uid) {
          _fastChallengesCacheUid = uid;
          _fastChallengesCache = parsed;
        }
        return parsed;
      }
    }
  } catch {}
  // ❗️NIKDY nefallbackuj na loadState() v UI screenech (blokuje JS na sekundy).
  // Pokud fast keys nejsou připravené, vrať prázdné a nech migraci proběhnout mimo obrazovku.
  return [] as any;
}

export async function loadChallengeStatsFast(): Promise<Record<string, ChallengeStats>> {
  const uid = auth.currentUser?.uid;
  if (!uid) return {};
  if (_fastStatsCacheUid === uid && _fastStatsCache) return _fastStatsCache;
  try {
    const raw = await AsyncStorage.getItem(statsKeyForUid(uid));
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        const parsed = obj as Record<string, ChallengeStats>;
        if (auth.currentUser?.uid === uid) {
          _fastStatsCacheUid = uid;
          _fastStatsCache = parsed;
        }
        return parsed;
      }
    }
  } catch {}
  // ❗️Bez fallbacku na loadState() – viz komentář u loadChallengesFast
  return {} as Record<string, ChallengeStats>;
}

async function persistFastKeys(state: AppState, uid: string) {
  try {
    await AsyncStorage.setItem(challengesKeyForUid(uid), JSON.stringify(state.challenges ?? []));
    await AsyncStorage.setItem(statsKeyForUid(uid), JSON.stringify((state as any).challengeStats ?? {}));

    if (auth.currentUser?.uid === uid) {
      // keep in-memory cache hot
      _fastChallengesCacheUid = uid;
      _fastStatsCacheUid = uid;
      _fastChallengesCache = (state.challenges ?? []) as any;
      _fastStatsCache = ((state as any).challengeStats ?? {}) as any;
    }
  } catch {
    // ignore
  }
}

let _legacyMigrationPromise: Promise<void> | null = null;

async function readLegacyState(): Promise<AppState | null> {
  for (const key of [LEGACY_STORAGE_KEY, LEGACY_BACKUP_KEY, ...LEGACY_KEYS]) {
    const raw = await readStateFromKey(key);
    if (!raw) continue;

    try {
      return parseAndMerge(raw);
    } catch {
      // Try the next legacy/backup key.
    }
  }

  return null;
}

function hasMeaningfulLocalState(state?: AppState | null): boolean {
  if (!state) return false;

  return (
    (state.challenges ?? []).length > 0 ||
    (state.history ?? []).length > 0 ||
    Object.keys(state.challengeStats ?? {}).length > 0 ||
    (state.archivedChallenges ?? []).length > 0 ||
    Number(state.streak ?? 0) > 0 ||
    (state.everCompletedKeys ?? []).length > 0
  );
}

async function readScopedStateFromRaw(raw: string | null): Promise<AppState | null> {
  if (!raw) return null;
  try {
    return parseAndMerge(raw);
  } catch {
    return null;
  }
}

async function ensureUidStorageReady(uid: string): Promise<void> {
  if (!_legacyMigrationPromise) {
    _legacyMigrationPromise = (async () => {
      const [scopedState, scopedBackup, marker] = await Promise.all([
        readStateFromKey(storageKeyForUid(uid)),
        readStateFromKey(backupKeyForUid(uid)),
        AsyncStorage.getItem(UID_MIGRATION_MARKER_KEY),
      ]);

      const existingScoped = await readScopedStateFromRaw(scopedState ?? scopedBackup);
      if (hasMeaningfulLocalState(existingScoped)) {
        if (!marker) {
          await AsyncStorage.setItem(UID_MIGRATION_MARKER_KEY, uid);
        }
        return;
      }

      if (marker && marker !== uid) return;

      const legacy = await readLegacyState();
      if (!legacy) return;

      const { next: normalized } = migrateBestStreakFromCurrent(legacy);
      const payload = JSON.stringify(normalized);
      const legacyUpdatedAt = await AsyncStorage.getItem(LEGACY_LOCAL_UPDATED_AT_KEY);

      await AsyncStorage.multiSet([
        [storageKeyForUid(uid), payload],
        [backupKeyForUid(uid), payload],
        [challengesKeyForUid(uid), JSON.stringify(normalized.challenges ?? [])],
        [statsKeyForUid(uid), JSON.stringify(normalized.challengeStats ?? {})],
        [localUpdatedAtKeyForUid(uid), legacyUpdatedAt ?? new Date().toISOString()],
      ]);
      await AsyncStorage.setItem(UID_MIGRATION_MARKER_KEY, uid);
    })().finally(() => {
      _legacyMigrationPromise = null;
    });
  }

  await _legacyMigrationPromise;
}

async function writeStateSnapshotForUid(
  uid: string,
  state: AppState,
  updatedAtISO = new Date().toISOString()
): Promise<void> {
  const payload = JSON.stringify(state);
  await AsyncStorage.multiSet([
    [storageKeyForUid(uid), payload],
    [backupKeyForUid(uid), payload],
    [localUpdatedAtKeyForUid(uid), updatedAtISO],
  ]);
  await persistFastKeys(state, uid);
}

export async function replaceStateForUid(
  state: Partial<AppState> | AppState,
  uid: string,
  updatedAtISO = new Date().toISOString()
): Promise<AppState> {
  const safe = normalizeAppStateSnapshot(state, uid);
  await writeStateSnapshotForUid(uid, safe, updatedAtISO);

  if (auth.currentUser?.uid === uid) {
    _cache = safe;
    _cacheUid = uid;
    _notify(safe);
  }

  return safe;
}

export async function ensureFastKeys(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  try {
    const [cRaw, sRaw] = await Promise.all([
      AsyncStorage.getItem(challengesKeyForUid(uid)),
      AsyncStorage.getItem(statsKeyForUid(uid)),
    ]);
    if (cRaw && sRaw) return;

    // Jednorázově načti velký state (může trvat), ale NIKDY to nespouštěj při otevření Historie.
    const state = await loadStateForUid(uid);
    await persistFastKeys(state, uid);
  } catch {
    // ignore
  }
}
export async function loadStateForUid(uid: string): Promise<AppState> {
  if (!uid) return createDefaultState();
  if (_cacheUid === uid && _cache) return _cache;

  await ensureUidStorageReady(uid);

  const storageKey = storageKeyForUid(uid);
  const backupKey = backupKeyForUid(uid);

  try {
    let raw = await readStateFromKey(storageKey);
    let usedKey: string | null = raw ? storageKey : null;

    if (!raw) {
      const backupRaw = await readStateFromKey(backupKey);
      if (backupRaw) {
        raw = backupRaw;
        usedKey = backupKey;
      }
    }

    if (!raw) {
      const clean = createDefaultState(uid);
      if (auth.currentUser?.uid === uid) {
        _cache = clean;
        _cacheUid = uid;
      }
      return clean;
    }

    const merged = parseAndMerge(raw);
    const { next: migrated, changed: bestStreakMigrated } =
      migrateBestStreakFromCurrent(merged);
    const normalized = tagStateForUid(migrated, uid);
    if (auth.currentUser?.uid === uid) {
      _cache = normalized;
      _cacheUid = uid;
    }

    if ((usedKey && usedKey !== storageKey) || bestStreakMigrated) {
      try {
        await writeStateSnapshotForUid(uid, normalized);
      } catch (error) {
        if (__DEV__) {
          console.log("[STATE MIGRATION SAVE ERROR]", error);
        }
      }
    }

    return normalized;
  } catch {
    try {
      const backupRaw = await readStateFromKey(backupKey);
      if (backupRaw) {
        const merged = parseAndMerge(backupRaw);
        const { next: migrated } = migrateBestStreakFromCurrent(merged);
        const normalized = tagStateForUid(migrated, uid);
        if (auth.currentUser?.uid === uid) {
          _cache = normalized;
          _cacheUid = uid;
        }
        try {
          await writeStateSnapshotForUid(uid, normalized);
        } catch (error) {
          if (__DEV__) {
            console.log("[STATE BACKUP MIGRATION SAVE ERROR]", error);
          }
        }
        return normalized;
      }
    } catch {}
    const clean = createDefaultState(uid);
    if (auth.currentUser?.uid === uid) {
      _cache = clean;
      _cacheUid = uid;
    }
    return clean;
  }
}

export async function loadState(): Promise<AppState> {
  const uid = auth.currentUser?.uid;
  return uid ? loadStateForUid(uid) : createDefaultState();
}

export async function activateUserState(uid: string): Promise<AppState> {
  clearStateCaches();
  _notify(createDefaultState());

  const state = await loadStateForUid(uid);
  if (auth.currentUser?.uid === uid) {
    _cache = state;
    _cacheUid = uid;
    _notify(state);
  }
  return state;
}

/**
 * ✅ SAFE SAVE
 */
export async function saveStateForUid(state: AppState, uid: string): Promise<void> {
  if (!uid) return;

  const existing = await loadStateForUid(uid);
  const merged = tagStateForUid(mergeWithExisting(existing, state as any), uid);
  const { next: repaired } = migrateBestStreakFromCurrent(merged);
  const safe = tagStateForUid(repaired, uid);
  const backupKey = backupKeyForUid(uid);

  const existingCount = Array.isArray(existing?.challenges) ? existing.challenges.length : 0;
  const nextCount = Array.isArray(safe?.challenges) ? safe.challenges.length : 0;

  if (existingCount > 0 && nextCount === 0) {
    // Allow intentional deletion of all challenges (explicit challenges: [])
    const explicitlyEmpty = Array.isArray((state as any)?.challenges) && (state as any).challenges.length === 0;
    if (!explicitlyEmpty) {
      console.warn("Blocked saveState(): would overwrite existing challenges with empty list.");
      await AsyncStorage.setItem(backupKey, JSON.stringify(existing));
      return;
    }
  }

  await writeStateSnapshotForUid(uid, safe);
  if (auth.currentUser?.uid === uid) {
    _cache = safe;
    _cacheUid = uid;
    _notify(safe);
  }
  requestIosWidgetStateSync();
}

export async function saveState(state: AppState): Promise<void> {
  const uid = stateUid(state) ?? auth.currentUser?.uid;
  if (!uid) return;
  await saveStateForUid(state, uid);
}

/**
 * ✅ Jediný správný způsob, jak měnit state z UI
 */
export async function updateState(updater: (s: AppState) => AppState): Promise<AppState> {
  const s = await ensureDailyPick();
  const uid = stateUid(s) ?? auth.currentUser?.uid;
  const next = tagStateForUid(updater(s), uid);
  if (uid) await saveStateForUid(next, uid);
  return next;
}

// ---------- CHALLENGES HELPERS ----------
export async function renameChallenge(challengeId: string, newText: string): Promise<AppState> {
  return updateState((s) => {
    const text = newText.trim();
    if (!text) return s;

    const id = String(challengeId);

    const challenges = (s.challenges ?? []).map((c: any) =>
      String(c.id) === id ? { ...c, text } : c
    );

    // ✅ aktualizuj i uložené názvy v historii (ať se všude ukazuje nový název)
    const history = Array.isArray((s as any).history)
      ? ((s as any).history as any[]).map((h) =>
          String(h?.challengeId ?? "") === id ? { ...h, challengeText: text } : h
        )
      : (s as any).history;

    // (pokud by někdy existovalo archivedChallenges)
    const archivedChallenges = Array.isArray((s as any).archivedChallenges)
      ? ((s as any).archivedChallenges as any[]).map((c) =>
          String(c?.id ?? "") === id ? { ...c, text } : c
        )
      : (s as any).archivedChallenges;

    return {
      ...s,
      challenges,
      history,
      archivedChallenges,
    } as any;
  });
}


export async function softDeleteChallenge(challengeId: string): Promise<AppState> {
  return updateState((s) => {
    const nowISO = new Date().toISOString();

    const ch = (s.challenges ?? []).find((c) => c.id === challengeId);
    const snapshotText = ch?.text ?? "";

    const nextChallenges = (s.challenges ?? []).map((c) =>
      c.id === challengeId ? { ...c, enabled: false, deletedAt: nowISO } : c
    );

    // ✅ když jen switch OFF, uložíme snapshot do archivu (aby „nezmizela“)
    const archivedItem: ArchivedChallenge = {
      id: challengeId,
      text: snapshotText,
      enabled: false,
      deletedAtISO: nowISO,
      easyMode: isChallengeEasyMode(ch),
    };

    return {
      ...s,
      challenges: nextChallenges,
      archivedChallenges: upsertArchived(s.archivedChallenges ?? [], archivedItem),
    };
  });
}

export async function restoreChallenge(challengeId: string): Promise<AppState> {
  return updateState((s) => ({
    ...s,
    challenges: (s.challenges ?? []).map((c) =>
      c.id === challengeId ? { ...c, enabled: true, deletedAt: undefined } : c
    ),
    // ✅ když obnovíš, už to není „archivní“
    archivedChallenges: (s.archivedChallenges ?? []).filter((a) => a.id !== challengeId),
  }));
}

/**
 * ✅ Smazat nadobro
 */
export async function purgeChallenge(
  challengeId: string,
  opts?: { removeHistory?: boolean }
): Promise<AppState> {
  return updateState((s) => ({
    ...s,
    challenges: (s.challenges ?? []).filter((c) => c.id !== challengeId),
    archivedChallenges: (s.archivedChallenges ?? []).filter((a) => a.id !== challengeId),
    dailyIds: (s.dailyIds ?? []).filter((id) => id !== challengeId),
    history: opts?.removeHistory ? (s.history ?? []).filter((h) => h.challengeId !== challengeId) : s.history ?? [],
    // ✅ everCompletedKeys se NIKDY nemažou
    everCompletedKeys: s.everCompletedKeys ?? [],
  }));
}

// ---------- DAILY PICK ----------
export async function ensureDailyPick(): Promise<AppState> {
  const state0 = await loadState();

  // ✅ 0) migrace: doplň everCompletedKeys ze staré historie (jen přidává)
  const { next: stateA, changed: migratedChanged } = migrateEverCompletedFromHistory(state0);

  // ✅ 1) doplnění vynechaných dnů + přerušení streak
  const { next: state1, changed: backfillChanged } = backfillSkippedDaysAndBreakStreak(stateA);

  let updated = ensureDaily(state1);

  // ✅ pojistka: ensureDaily nesmí shodit trvalé položky
  updated = {
    ...updated,
    everCompletedKeys: state1.everCompletedKeys ?? updated.everCompletedKeys ?? [],
    archivedChallenges: state1.archivedChallenges ?? updated.archivedChallenges ?? [],
    history: state1.history ?? updated.history ?? [],
    reminderNotifIds: state1.reminderNotifIds ?? updated.reminderNotifIds ?? {},
  };

  const enabledIds = new Set(
    (updated.challenges ?? [])
      .filter((c: Challenge) => c.enabled && !c.deletedAt)
      .map((c: Challenge) => c.id)
  );

  const beforeDaily = updated.dailyIds ?? [];
  const filteredDaily = beforeDaily.filter((id) => enabledIds.has(id));

  if (filteredDaily.length !== beforeDaily.length) {
    updated = { ...updated, dailyIds: filteredDaily };
  }

  if ((updated.dailyIds?.length ?? 0) === 0 && enabledIds.size > 0) {
    updated = ensureDaily({
      ...updated,
      dailyIds: [],
    });
  }

  // ✅ DŮLEŽITÉ: když uživatel zvýší denní frekvenci (targetPerDay),
  // nesmí zůstat "dnešek splněn" jen proto, že byl splněn za staré (nižší) frekvence.
  // Jinak by se dnes tvářilo jako completed, i když má být např. 3/6.
  const today = getTodayISO();
  if (updated.lastCompletedDate === today) {
    const pickedId = updated.dailyIds?.[0] != null ? String(updated.dailyIds[0]) : null;
    if (pickedId) {
      const ch = (updated.challenges ?? []).find((c: any) => String(c.id) === pickedId) as any;
      const t = Number(ch?.targetPerDay ?? 1);
      const target = Number.isFinite(t) && t > 0 ? Math.floor(t) : 1;

      const completedToday = (updated.history ?? []).filter(
        (h: any) => String(h?.challengeId ?? "") === pickedId && h?.date === today && h?.status === "completed"
      ).length;

      // Pokud dnešní completed není >= target, invalidujeme dnešní "completed" marker.
      if (!isChallengeIdEasyMode(updated, pickedId) && completedToday < target) {
        updated = {
          ...updated,
          lastCompletedDate: undefined,
          // konzervativně: pokud streak počítal i dnešek, ubereme ho o 1
          streak: Math.max(0, (updated.streak ?? 0) - 1),
        };
      }
    }
  }

  // lastOpenDate držíme zvlášť
  if (updated.lastOpenDate !== today) {
    updated = { ...updated, lastOpenDate: today };
  }

  const changed =
    migratedChanged ||
    backfillChanged ||
    JSON.stringify(state0) !== JSON.stringify(updated);
  if (changed) await saveState(updated);

  return updated;
}

// ---------- COMPLETION ----------
export async function markTodayCompleted(): Promise<AppState> {
  const state = await ensureDailyPick();
  const today = getTodayISO();

  const pickedId = state.dailyIds?.[0];

  const pickedChallenge = pickedId
    ? state.challenges.find((c) => String(c.id) === String(pickedId))
    : undefined;

  const pickedText = pickedChallenge?.text ?? "(smazaná výzva)";
  const pickedEasyMode = isChallengeIdEasyMode(state, pickedId);

  const rawTarget = Number(pickedChallenge?.targetPerDay ?? 1);
  const targetPerDay =
    Number.isFinite(rawTarget) && rawTarget > 0 ? Math.floor(rawTarget) : 1;

  const completedToday = (state.history ?? []).filter((h: any) => {
    const sameDay = h.date === today;
    const sameId = String(h.challengeId ?? "") === String(pickedId ?? "");
    return sameDay && sameId && h.status === "completed";
  }).length;

  // ✅ Už je dnes splněno celé, další kliknutí nic nepřidá.
  if (completedToday >= targetPerDay) {
    return state;
  }

  const nextCompletedToday = Math.min(targetPerDay, completedToday + 1);
  const isFullyCompletedNow = nextCompletedToday >= targetPerDay;

  const dayAlreadyCounted = state.lastCompletedDate === today;

  const nextStreak =
    dayAlreadyCounted
      ? state.streak
      : state.lastCompletedDate === yesterdayISO()
        ? state.streak + 1
        : 1;

  const now = new Date();

  const entry: HistoryEntry = {
    date: today,
    time: timeHM(now),
    atISO: now.toISOString(),
    challengeId: pickedId,
    challengeText: pickedText,
    status: "completed",

    // ✅ pokud ještě není dosažen target, je to jen dílčí progress
    partial: !isFullyCompletedNow,
  };

  // ✅ odstraníme jen dnešní skipped pro stejnou výzvu,
  // ale completed/progress záznamy necháme, aby šlo počítat 1/4, 2/4, 3/4, 4/4.
  const filtered = (state.history ?? []).filter((h) => {
    const sameDay = h.date === today;
    const sameId = String(h.challengeId ?? "") === String(pickedId ?? "");
    const isSkipped = h.status === "skipped";

    return !(sameDay && sameId && isSkipped);
  });

  const ever = new Set<string>(state.everCompletedKeys ?? []);

  if (isFullyCompletedNow) {
    const key = pickedId
      ? `id:${String(pickedId)}`
      : `text:${String(pickedText ?? "(bez výzvy)")}`;

    ever.add(key);
  }

const fixedLastCompletedDate =
  pickedEasyMode
    ? state.lastCompletedDate
    : isFullyCompletedNow
    ? today
    : state.lastCompletedDate === today
      ? undefined
      : state.lastCompletedDate;

const fixedStreak =
  pickedEasyMode
    ? state.streak
    : isFullyCompletedNow
    ? nextStreak
    : state.lastCompletedDate === today
      ? Math.max(0, (state.streak ?? 0) - 1)
      : state.streak;

  const updated: AppState = {
    ...state,

    // ✅ streak / lastCompletedDate se nastaví až při 4/4, ne při 1/4
lastCompletedDate: fixedLastCompletedDate,
streak: fixedStreak,

    challengeStats:
      isFullyCompletedNow && pickedId
        ? updateStatsOnCompleted(state, String(pickedId), today)
        : state.challengeStats,

    history: [entry, ...filtered],

    everCompletedKeys: Array.from(ever),
  };

  await saveState(updated);
  return updated;
}

export async function markTodaySkipped(): Promise<AppState> {
  const state = await ensureDailyPick();
  const today = getTodayISO();

  const pickedId = state.dailyIds?.[0];
  const pickedText = pickedId
    ? state.challenges.find((c) => c.id === pickedId)?.text ?? "(smazaná výzva)"
    : "(bez výzvy)";

  const pickedStats = pickedId ? normalizeStats((state.challengeStats ?? {})[String(pickedId)]) : null;
  const pickedChallenge = pickedId
    ? state.challenges.find((c) => String(c.id) === String(pickedId))
    : undefined;
  const pickedEasyMode = isChallengeIdEasyMode(state, pickedId);
  const usesFreeze = pickedEasyMode || (pickedStats ? pickedStats.skipCredits > 0 && pickedStats.currentStreak >= 10 : false);

  const now = new Date();
  const entry: HistoryEntry = {
    date: today,
    time: timeHM(now),
    atISO: now.toISOString(),
    challengeId: pickedId,
    challengeText: pickedText,
    status: "skipped",
    protectedByFreeze: usesFreeze,
  };

  // ✅ FIX: nemažeme celý dnešek, jen záznam pro stejnou výzzvu (pickedId) v dnešní den
  const filtered = (state.history ?? []).filter((h) => {
    const sameDay = h.date === today;
    const sameId = String(h.challengeId ?? "") === String(pickedId ?? "");
    return !(sameDay && sameId);
  });

  const updated: AppState = {
    ...state,
    streak: usesFreeze ? state.streak : 0,
    challengeStats: pickedId ? updateStatsOnSkipped(state, String(pickedId), today) : state.challengeStats,
    history: [entry, ...filtered],
  };

  await saveState(updated);
  return updated;
}
