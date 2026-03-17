import { AppState, HistoryEntry } from "./storage";

export type MedalTier = "bronze" | "silver" | "gold";
export type MedalCounts = Record<MedalTier, number>;

export type ProfileStats = {
  longestStreak: number; // nejdelší streak (globálně podle dnů "completed")
  totalCompletedDays: number; // kolikrát bylo "completed" (unikátní dny)
  daysWithAnyEntry: number; // kolik dní má záznam (completed nebo skipped)
  medalCounts: MedalCounts; // kolik medailí jakého typu
};

// ✅ tolerantní typ: i kdyby TS tvrdil, že AppState nemá medals, my s tím umíme pracovat
type AppStateWithMedals = AppState & {
  medals?: Array<{ tier?: MedalTier | string }>;
};

function diffDaysISO(aISO: string, bISO: string): number {
  const a = new Date(aISO + "T00:00:00");
  const b = new Date(bISO + "T00:00:00");
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/**
 * Když by se v historii někdy objevily duplicity stejného dne,
 * vezmeme poslední (nejnovější) záznam pro dané datum.
 */
function dedupeByDate(history: HistoryEntry[]): HistoryEntry[] {
  const map = new Map<string, HistoryEntry>();
  for (const h of history ?? []) {
    if (!h?.date) continue;
    const prev = map.get(h.date);
    if (!prev) {
      map.set(h.date, h);
    } else {
      const a = String(prev.atISO ?? "");
      const b = String(h.atISO ?? "");
      map.set(h.date, b > a ? h : prev);
    }
  }
  return Array.from(map.values());
}

function sortByDateAsc(history: HistoryEntry[]): HistoryEntry[] {
  const arr = [...(history ?? [])];
  arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return arr;
}

export function getMedalCounts(state: AppStateWithMedals): MedalCounts {
  const counts: MedalCounts = { bronze: 0, silver: 0, gold: 0 };

  const medals = state.medals ?? [];
  for (const m of medals) {
    if (m?.tier === "gold") counts.gold++;
    else if (m?.tier === "silver") counts.silver++;
    else if (m?.tier === "bronze") counts.bronze++;
  }
  return counts;
}

export function getTotalCompletedDays(state: AppStateWithMedals): number {
  const history = sortByDateAsc(dedupeByDate(state.history ?? []));
  const completedDates = new Set<string>();
  for (const h of history) {
    if (h.status === "completed") completedDates.add(h.date);
  }
  return completedDates.size;
}

export function getDaysWithAnyEntry(state: AppStateWithMedals): number {
  const history = sortByDateAsc(dedupeByDate(state.history ?? []));
  const anyDates = new Set<string>();
  for (const h of history) {
    if (h.status === "completed" || h.status === "skipped") {
      anyDates.add(h.date);
    }
  }
  return anyDates.size;
}

/**
 * Nejdelší streak globálně: počítáme po sobě jdoucí dny,
 * kde byl stav "completed". (Skipped streak nepřidá.)
 */
export function getLongestStreak(state: AppStateWithMedals): number {
  const history = sortByDateAsc(dedupeByDate(state.history ?? []));
  const completedDates = history
    .filter((h) => h.status === "completed")
    .map((h) => h.date);

  if (completedDates.length === 0) return 0;

  let best = 1;
  let cur = 1;

  for (let i = 1; i < completedDates.length; i++) {
    const prev = completedDates[i - 1];
    const now = completedDates[i];
    const d = diffDaysISO(prev, now);

    if (d === 1) {
      cur++;
      if (cur > best) best = cur;
    } else if (d === 0) {
      continue;
    } else {
      cur = 1;
    }
  }

  return best;
}

export function computeProfileStats(state: AppStateWithMedals): ProfileStats {
  return {
    longestStreak: getLongestStreak(state),
    totalCompletedDays: getTotalCompletedDays(state),
    daysWithAnyEntry: getDaysWithAnyEntry(state),
    medalCounts: getMedalCounts(state),
  };
}
