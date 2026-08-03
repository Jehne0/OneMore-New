import type { Lang } from "./i18n";

export const CURRENT_WHATS_NEW_ID = "whats_new_widget_2026_07";

export type WhatsNewCopy = {
  title: string;
  popupEyebrow: string;
  popupBody: string;
  close: string;
  menuSubtitle: string;
  entries: Array<{
    id: string;
    date: string;
    title: string;
    bullets: string[];
  }>;
};

const COPY: Record<Lang, WhatsNewCopy> = {
  cs: {
    title: "Co je nového",
    popupEyebrow: "Novinka: Widget na plochu",
    popupBody: "Nově si můžeš přidat OneMore widget na domovskou obrazovku. Ve widgetu uvidíš své výzvy, streak, dnešní stav a můžeš výzvu splnit přímo z plochy.",
    close: "Zavřít",
    menuSubtitle: "Nové funkce a vylepšení",
    entries: [{ id: CURRENT_WHATS_NEW_ID, date: "07/2026", title: "Widget na plochu", bullets: ["Přidán widget na domovskou obrazovku", "Zobrazuje výzvy, streak a dnešní stav", "Výzvu lze splnit přímo z widgetu", "Podporuje více velikostí"] }],
  },
  en: {
    title: "What's new",
    popupEyebrow: "New: Home screen widget",
    popupBody: "You can now add the OneMore widget to your home screen. It shows your challenges, streak, and today's status, and lets you complete a challenge right from the home screen.",
    close: "Close",
    menuSubtitle: "New features and improvements",
    entries: [{ id: CURRENT_WHATS_NEW_ID, date: "07/2026", title: "Home screen widget", bullets: ["Added a widget for the home screen", "Shows challenges, streak, and today's status", "Challenges can be completed directly from the widget", "Supports multiple sizes"] }],
  },
  pl: {
    title: "Co nowego",
    popupEyebrow: "Nowość: Widżet na ekranie",
    popupBody: "Możesz teraz dodać widżet OneMore do ekranu głównego. Zobaczysz w nim swoje wyzwania, serię i dzisiejszy stan oraz ukończysz wyzwanie bezpośrednio z ekranu.",
    close: "Zamknij",
    menuSubtitle: "Nowe funkcje i ulepszenia",
    entries: [{ id: CURRENT_WHATS_NEW_ID, date: "07/2026", title: "Widżet na ekranie", bullets: ["Dodano widżet na ekran główny", "Wyświetla wyzwania, serię i dzisiejszy stan", "Wyzwanie można ukończyć bezpośrednio z widżetu", "Obsługuje wiele rozmiarów"] }],
  },
  de: {
    title: "Was ist neu?",
    popupEyebrow: "Neu: Startbildschirm-Widget",
    popupBody: "Du kannst jetzt das OneMore-Widget zu deinem Startbildschirm hinzufügen. Es zeigt deine Challenges, deine Serie und den heutigen Status. Eine Challenge kannst du direkt auf dem Startbildschirm abschließen.",
    close: "Schließen",
    menuSubtitle: "Neue Funktionen und Verbesserungen",
    entries: [{ id: CURRENT_WHATS_NEW_ID, date: "07/2026", title: "Startbildschirm-Widget", bullets: ["Widget für den Startbildschirm hinzugefügt", "Zeigt Challenges, Serie und heutigen Status", "Challenges können direkt im Widget abgeschlossen werden", "Unterstützt mehrere Größen"] }],
  },
};

export function getWhatsNewCopy(lang: Lang): WhatsNewCopy {
  return COPY[lang];
}
