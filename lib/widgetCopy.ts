import type { WidgetLanguage } from "./widgetModel";

export const widgetCopy: Record<WidgetLanguage, {
  loading: string; signIn: string; empty: string; rest: string; today: string;
  complete: string; completed: string; restDay: string; personal: string; shared: string;
  current: string; best: string; more: string; configure: string; premiumExpired: string; getPremium: string; days: string[];
}> = {
  cs: { loading: "Načítám…", signIn: "Přihlásit se", empty: "Vyber výzvu", rest: "Dnes máš volno", today: "Dnes", complete: "Splnit", completed: "Splněno", restDay: "Volný den", personal: "Osobní", shared: "Společná", current: "Série", best: "Rekord", more: "dalších", configure: "Nastavit výzvy", premiumExpired: "Premium skončilo", getPremium: "Získat Premium", days: ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"] },
  en: { loading: "Loading…", signIn: "Sign in", empty: "Choose a challenge", rest: "Rest day today", today: "Today", complete: "Complete", completed: "Completed", restDay: "Rest day", personal: "Personal", shared: "Shared", current: "Streak", best: "Best", more: "more", configure: "Choose challenges", premiumExpired: "Premium expired", getPremium: "Get Premium", days: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] },
  pl: { loading: "Ładowanie…", signIn: "Zaloguj się", empty: "Wybierz wyzwanie", rest: "Dziś odpoczywasz", today: "Dzisiaj", complete: "Wykonaj", completed: "Wykonano", restDay: "Dzień wolny", personal: "Osobiste", shared: "Wspólne", current: "Seria", best: "Rekord", more: "więcej", configure: "Ustaw wyzwania", premiumExpired: "Premium wygasło", getPremium: "Uzyskaj Premium", days: ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"] },
  de: { loading: "Wird geladen…", signIn: "Anmelden", empty: "Challenge wählen", rest: "Heute ist Ruhetag", today: "Heute", complete: "Erledigen", completed: "Erledigt", restDay: "Ruhetag", personal: "Persönlich", shared: "Gemeinsam", current: "Serie", best: "Rekord", more: "weitere", configure: "Challenges wählen", premiumExpired: "Premium abgelaufen", getPremium: "Premium holen", days: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] },
};

export function widgetCompletionLabel(language: WidgetLanguage, completed: boolean) {
  return completed ? widgetCopy[language].completed : widgetCopy[language].complete;
}

export function widgetDayStateLabel(language: WidgetLanguage, dayState: "activePending" | "activeCompleted" | "restDay") {
  return dayState === "restDay" ? widgetCopy[language].restDay : widgetCompletionLabel(language, dayState === "activeCompleted");
}
