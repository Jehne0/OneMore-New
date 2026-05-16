import { AppState } from "./storage";
import { getTodayISO } from "./clock";

function pickOne<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function isTodayClosed(state: AppState, today: string): boolean {
  const hist = (state as any).history;

  if (Array.isArray(hist)) {
    const e = hist.find((h: any) => {
      if (h?.date !== today) return false;

      // skipped = den je uzavřený
      if (h.status === "skipped") return true;

      // completed = den je uzavřený jen pokud to NENÍ dílčí progress 1/4, 2/4...
      if (h.status === "completed" && h.partial !== true) return true;

      return false;
    });

    if (e) return true;
  }

  // fallback pro starší data
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