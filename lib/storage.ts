import AsyncStorage from "@react-native-async-storage/async-storage";
import { ensureDaily } from "./logic";
import { getTodayISO } from "./clock";

const STORAGE_KEY = "onemore_state";
const BACKUP_KEY = "onemore_state_backup";
const CHALLENGES_KEY = "onemore_challenges_v1";
const STATS_KEY = "onemore_challengeStats_v1";
const LOCAL_UPDATED_AT_KEY = "onemore_local_updatedAtISO";

// ---- FAST-KEYS in-memory cache (pro ultra rychlé přepínání obrazovek) ----
// Pozn.: AsyncStorage.getItem + JSON.parse dokáže na některých zařízeních trvat překvapivě dlouho
// i pro relativně malé payloady. Proto cacheujeme výsledky a aktualizujeme je při saveState().
let _fastChallengesCache: Challenge[] | null = null;
let _fastStatsCache: Record<string, ChallengeStats> | null = null;

// ✅ fallback klíče (když se někdy omylem změnil STORAGE_KEY a data jsou uložená jinde)
const LEGACY_KEYS = ["onemore_state_v2", "onemoreState", "oneMore_state"];
// ---------- CHALLENGE STATS HELPERS ----------
function normalizeStats(s?: ChallengeStats): ChallengeStats {
  return {
    completedCount: Number(s?.completedCount ?? 0),
    skippedCount: Number(s?.skippedCount ?? 0),
    lastCompletedDay: s?.lastCompletedDay,
    currentStreak: Number(s?.currentStreak ?? 0),
    bestStreak: Number(s?.bestStreak ?? 0),
  };
}

export function updateStatsOnCompleted(
  state: AppState,
  challengeId: string,
  today: string
): Record<string, ChallengeStats> {
  const map = { ...(state.challengeStats ?? {}) };
  const prev = normalizeStats(map[challengeId]);
  const ch = (state.challenges ?? []).find((c: any) => String(c.id) === String(challengeId)) as any;
  const prevActive = prevActiveDayISO(ch ?? null, today);

  const dayAlreadyCounted = prev.lastCompletedDay === today;

  const nextStreak = dayAlreadyCounted
    ? prev.currentStreak
    : prev.lastCompletedDay === prevActive
      ? prev.currentStreak + 1
      : 1;

  const next: ChallengeStats = {
    ...prev,
    completedCount: prev.completedCount + 1,
    lastCompletedDay: today,
    currentStreak: nextStreak,
    bestStreak: Math.max(prev.bestStreak, nextStreak),
  };

  map[challengeId] = next;
  return map;
}

export function updateStatsOnSkipped(
  state: AppState,
  challengeId: string,
  _today: string
): Record<string, ChallengeStats> {
  const map = { ...(state.challengeStats ?? {}) };
  const prev = normalizeStats(map[challengeId]);

  const next: ChallengeStats = {
    ...prev,
    skippedCount: prev.skippedCount + 1,
    currentStreak: 0,
  };

  map[challengeId] = next;
  return map;
}



// ---- in-memory cache + listeners (rychlejší UI, okamžité přepočty) ----
let _cache: AppState | null = null;
const _listeners = new Set<(s: AppState) => void>();

export function getCachedState(): AppState | null {
  return _cache;
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
};


export type ArchivedChallenge = {
  id: string;
  text: string;
  enabled: boolean;
  deletedAtISO: string;
};

export type HistoryEntry = {
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:mm"
  atISO: string; // plný timestamp pro unikátní klíč a přesný čas
  challengeId?: string;
  challengeText: string; // snapshot textu v době uložení
  status: "completed" | "skipped";
};


export type ChallengeStats = {
  completedCount: number;
  skippedCount: number;
  /** poslední den, kdy byla výzva splněna (YYYY-MM-DD) */
  lastCompletedDay?: string;
  /** aktuální streak pro tuto výzvu (po dnech s alespoň 1 splněním) */
  currentStreak: number;
  /** nejlepší streak pro tuto výzvu */
  bestStreak: number;
};



export type AppState = {
  challenges: Challenge[];

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
  everCompletedKeys: [],

  // ✅ free reminder storage
  reminderNotifIds: {},
};

// ---------- DATE HELPERS ----------
function timeHM(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function yesterdayISO(): string {
  return addDaysISO(getTodayISO(), -1);
}


// 0=Po ... 6=Ne
function dowMon0(dateISO: string): number {
  const d = new Date(`${dateISO}T00:00:00`);
  const js = d.getDay(); // 0=Ne..6=So
  return (js + 6) % 7;
}

function diffDaysISO(aISO: string, bISO: string): number {
  const a = new Date(`${aISO}T00:00:00`).getTime();
  const b = new Date(`${bISO}T00:00:00`).getTime();
  return Math.floor((a - b) / 86400000);
}

function isChallengeActiveOnDate(c: Challenge | undefined | null, dateISO: string): boolean {
  if (!c) return true; // když nemáme definici, bereme jako daily
  if (c.enabled === false) return false;
  if (c.deletedAt) return false;

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

  const period = c.period === "every2" || c.period === "custom" || c.period === "daily" ? c.period : "daily";
  if (period === "daily") return addDaysISO(todayISO, -1);
  if (period === "every2") return addDaysISO(todayISO, -2);

  // custom: najdi nejbližší předchozí aktivní den (max 14 dní zpět jako pojistka)
  for (let i = 1; i <= 14; i++) {
    const d = addDaysISO(todayISO, -i);
    if (isChallengeActiveOnDate(c, d)) return d;
  }
  return addDaysISO(todayISO, -1);
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
    lastCompletedDate: incoming.lastCompletedDate ?? existing.lastCompletedDate,
    lastOpenDate: incoming.lastOpenDate ?? existing.lastOpenDate,
  };

  merged.history = migrateHistory(merged.history);
  merged.archivedChallenges = normalizeArchived(merged.archivedChallenges);
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
  }));
    // keep fast keys updated
    void persistFastKeys(merged as AppState);
    return merged;
}

function parseAndMerge(raw: string): AppState {
  const parsed = JSON.parse(raw) as Partial<AppState>;

  const challenges: Challenge[] = (parsed.challenges ?? []).map((c: any) => ({
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

  }));

  const history: HistoryEntry[] = migrateHistory((parsed as any).history);

  const merged: AppState = {
    ...defaultState,
    ...parsed,
    challenges,
    history,
    streak: typeof parsed.streak === "number" ? parsed.streak : defaultState.streak,
    archivedChallenges: normalizeArchived((parsed as any).archivedChallenges),
    lastOpenDate: parsed.lastOpenDate ? String(parsed.lastOpenDate) : undefined,
    everCompletedKeys: normalizeEverCompletedKeys((parsed as any).everCompletedKeys),

    // ✅ reminder notif map
    reminderNotifIds: normalizeReminderNotifIds((parsed as any).reminderNotifIds),
  };

  return merged;
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
    if (h.challengeId) ever.add(`id:${String(h.challengeId)}`);
    else if (h.challengeText) ever.add(`text:${String(h.challengeText)}`);
  }

  if (ever.size === before) return { next: state, changed: false };
  return { next: { ...state, everCompletedKeys: Array.from(ever) }, changed: true };
}

/**
 * ✅ AUTO-UZÁVĚRKA POUZE VČEREJŠKA (u každé aktivní výzvy)
 * - Při prvním otevření dne (lastOpenDate != today) uzavře jen VČEREJŠEK.
 * - Pro každou výzvu, která je dnes aktivní (enabled && !deletedAt),
 *   pokud včera nemá záznam (completed/skipped), doplní "skipped".
 * - Starší dny se NEdoplňují → žádné zahlcení.
 * - Pokud se něco doplní jako skipped, streak se přeruší (streak = 0).
 */
function backfillSkippedDaysAndBreakStreak(state: AppState): { next: AppState; changed: boolean } {
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

    additions.push({
      date: y,
      time: "23:59",
      atISO: `${y}T23:59:59.000Z`,
      challengeId: id,
      challengeText: text,
      status: "skipped",
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

  const next: AppState = {
    ...state,
    streak: 0,
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
  if (_fastChallengesCache) return _fastChallengesCache;
  try {
    const raw = await AsyncStorage.getItem(CHALLENGES_KEY);
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
        })) as Challenge[];

        _fastChallengesCache = parsed;
        return parsed;
      }
    }
  } catch {}
  // ❗️NIKDY nefallbackuj na loadState() v UI screenech (blokuje JS na sekundy).
  // Pokud fast keys nejsou připravené, vrať prázdné a nech migraci proběhnout mimo obrazovku.
  return [] as any;
}

export async function loadChallengeStatsFast(): Promise<Record<string, ChallengeStats>> {
  if (_fastStatsCache) return _fastStatsCache;
  try {
    const raw = await AsyncStorage.getItem(STATS_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        _fastStatsCache = obj as Record<string, ChallengeStats>;
        return _fastStatsCache;
      }
    }
  } catch {}
  // ❗️Bez fallbacku na loadState() – viz komentář u loadChallengesFast
  return {} as Record<string, ChallengeStats>;
}

async function persistFastKeys(state: AppState) {
  try {
    await AsyncStorage.setItem(CHALLENGES_KEY, JSON.stringify(state.challenges ?? []));
    await AsyncStorage.setItem(STATS_KEY, JSON.stringify((state as any).challengeStats ?? {}));

    // keep in-memory cache hot
    _fastChallengesCache = (state.challenges ?? []) as any;
    _fastStatsCache = ((state as any).challengeStats ?? {}) as any;
  } catch {
    // ignore
  }
}


export async function ensureFastKeys(): Promise<void> {
  try {
    const [cRaw, sRaw] = await Promise.all([
      AsyncStorage.getItem(CHALLENGES_KEY),
      AsyncStorage.getItem(STATS_KEY),
    ]);
    if (cRaw && sRaw) return;

    // Jednorázově načti velký state (může trvat), ale NIKDY to nespouštěj při otevření Historie.
    const state = await loadState();
    await persistFastKeys(state);
  } catch {
    // ignore
  }
}
export async function loadState(): Promise<AppState> {
  if (_cache) return _cache;
  try {
    let raw = await readStateFromKey(STORAGE_KEY);
    let usedKey: string | null = raw ? STORAGE_KEY : null;

    if (!raw) {
      const backupRaw = await readStateFromKey(BACKUP_KEY);
      if (backupRaw) {
        raw = backupRaw;
        usedKey = BACKUP_KEY;
      }
    }

    if (!raw) {
      for (const k of LEGACY_KEYS) {
        const legacyRaw = await readStateFromKey(k);
        if (legacyRaw) {
          raw = legacyRaw;
          usedKey = k;
          break;
        }
      }
    }

    if (!raw) return defaultState;

    const merged = parseAndMerge(raw);

    if (usedKey && usedKey !== STORAGE_KEY) {
      await saveState(merged);
    }

    return merged;
  } catch {
    try {
      const backupRaw = await readStateFromKey(BACKUP_KEY);
      if (backupRaw) {
        const merged = parseAndMerge(backupRaw);
        await saveState(merged);
        return merged;
      }
    } catch {}
    return defaultState;
  }
}

/**
 * ✅ SAFE SAVE
 */
export async function saveState(state: AppState): Promise<void> {
  const existing = await loadState();
  const safe = mergeWithExisting(existing, state as any);

  const existingCount = Array.isArray(existing?.challenges) ? existing.challenges.length : 0;
  const nextCount = Array.isArray(safe?.challenges) ? safe.challenges.length : 0;

  if (existingCount > 0 && nextCount === 0) {
    // Allow intentional deletion of all challenges (explicit challenges: [])
    const explicitlyEmpty = Array.isArray((state as any)?.challenges) && (state as any).challenges.length === 0;
    if (!explicitlyEmpty) {
      console.warn("Blocked saveState(): would overwrite existing challenges with empty list.");
      await AsyncStorage.setItem(BACKUP_KEY, JSON.stringify(existing));
      return;
    }
  }

  const payload = JSON.stringify(safe);
  await AsyncStorage.setItem(STORAGE_KEY, payload);
  await AsyncStorage.setItem(BACKUP_KEY, payload);
  await AsyncStorage.setItem(LOCAL_UPDATED_AT_KEY, new Date().toISOString());
  await persistFastKeys(safe);
  _cache = safe;
  _notify(safe);
}

/**
 * ✅ Jediný správný způsob, jak měnit state z UI
 */
export async function updateState(updater: (s: AppState) => AppState): Promise<AppState> {
  const s = await ensureDailyPick();
  const next = updater(s);
  await saveState(next);
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
      if (completedToday < target) {
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

  const changed = migratedChanged || backfillChanged || JSON.stringify(state0) !== JSON.stringify(updated);
  if (changed) await saveState(updated);

  return updated;
}

// ---------- COMPLETION ----------
export async function markTodayCompleted(): Promise<AppState> {
  const state = await ensureDailyPick();
  const today = getTodayISO();

  // pokud už je dnešek completed pro daily pick, neřešíme
  if (state.lastCompletedDate === today) return state;

  const nextStreak = state.lastCompletedDate === yesterdayISO() ? state.streak + 1 : 1;

  const pickedId = state.dailyIds?.[0];
  const pickedText = pickedId
    ? state.challenges.find((c) => c.id === pickedId)?.text ?? "(smazaná výzva)"
    : "(bez výzvy)";

  const now = new Date();
  const entry: HistoryEntry = {
    date: today,
    time: timeHM(now),
    atISO: now.toISOString(),
    challengeId: pickedId,
    challengeText: pickedText,
    status: "completed",
  };

  // ✅ FIX: nemažeme celý dnešek, jen záznam pro stejnou výzvu (pickedId) v dnešní den
  const filtered = (state.history ?? []).filter((h) => {
    const sameDay = h.date === today;
    const sameId = String(h.challengeId ?? "") === String(pickedId ?? "");
    return !(sameDay && sameId);
  });

  // ✅ trvalý záznam (nikdy neubírat)
  const key = pickedId ? `id:${String(pickedId)}` : `text:${String(pickedText ?? "(bez výzvy)")}`;
  const ever = new Set<string>(state.everCompletedKeys ?? []);
  ever.add(key);

  const updated: AppState = {
    ...state,
    lastCompletedDate: today,
    streak: nextStreak,
    challengeStats: pickedId ? updateStatsOnCompleted(state, String(pickedId), today) : state.challengeStats,
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

  const now = new Date();
  const entry: HistoryEntry = {
    date: today,
    time: timeHM(now),
    atISO: now.toISOString(),
    challengeId: pickedId,
    challengeText: pickedText,
    status: "skipped",
  };

  // ✅ FIX: nemažeme celý dnešek, jen záznam pro stejnou výzzvu (pickedId) v dnešní den
  const filtered = (state.history ?? []).filter((h) => {
    const sameDay = h.date === today;
    const sameId = String(h.challengeId ?? "") === String(pickedId ?? "");
    return !(sameDay && sameId);
  });

  const updated: AppState = {
    ...state,
    streak: 0,
    challengeStats: pickedId ? updateStatsOnSkipped(state, String(pickedId), today) : state.challengeStats,
    history: [entry, ...filtered],
  };

  await saveState(updated);
  return updated;
}