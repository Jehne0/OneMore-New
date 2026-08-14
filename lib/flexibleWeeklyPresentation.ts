import type { Lang } from "./i18n";

const LOCALES: Record<Lang, string> = {
  cs: "cs-CZ",
  en: "en-GB",
  pl: "pl-PL",
  de: "de-DE",
};

export function formatFlexibleWeeklyDate(dateISO: string, lang: Lang): string {
  const [year, month, day] = dateISO.split("-").map(Number);
  if (!year || !month || !day) return dateISO;
  return new Intl.DateTimeFormat(LOCALES[lang], {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatFlexibleWeeklyMissedLabel(options: {
  template: string;
  lang: Lang;
  start: string;
  end: string;
  done: number;
  target: number;
}): string {
  return options.template
    .replace("{start}", formatFlexibleWeeklyDate(options.start, options.lang))
    .replace("{end}", formatFlexibleWeeklyDate(options.end, options.lang))
    .replace("{done}", String(Math.max(0, options.done)))
    .replace("{target}", String(Math.max(1, options.target)));
}
