import { AppState } from "./storage";
import { getTodayISO } from "./clock";

function pickOne<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function isTodayClosed(state: AppState, today: string): boolean {
  // 1) robustně přes historii
  const hist = (state as any).history;
  if (Array.isArray(hist)) {
    // pokud existuje jakýkoliv záznam pro dnešek (completed/skipped), bereme den jako uzavřený (kvůli daily picku)
    const e = hist.find((h: any) => h?.date === today && (h.status === "completed" || h.status === "skipped"));
    if (e) return true;
  }

  // 2) fallback: starší kompatibilita přes lastCompletedDate
  if ((state as any).lastCompletedDate === today) return true;

  return false;
}

/**
 * Zajistí denní výběr (1 výzva denně).
 * DŮLEŽITÉ:
 * - nikdy neshazuje history / streak / atd.
 * - pokud už je dnešek uzavřený (completed/skipped), tak denní pick NEMĚNÍME
 */
export function ensureDaily(state: AppState): AppState {
  const today = getTodayISO();

  // ✅ LOCK: když už je dneska completed/skipped, pick se už nemění
  if (isTodayClosed(state, today)) {
    return state;
  }

  // Pokud už máme pick pro dnešek a vybraný challenge stále existuje a je enabled a není "switch off"
  const sameDay = state.lastPickDate === today;
  const currentId = state.dailyIds?.[0];

  const stillValid =
    !!currentId &&
    state.challenges.some((c: any) => String(c.id) === String(currentId) && c.enabled && !c.deletedAt);

  if (sameDay && stillValid) return state;

  // Vybereme nový id z enabled + not deletedAt
  const enabled = state.challenges.filter((c: any) => c.enabled && !c.deletedAt);
  const picked = pickOne(enabled);

  return {
    ...state,
    lastPickDate: today,
    dailyIds: picked ? [String((picked as any).id)] : [],
  };
}