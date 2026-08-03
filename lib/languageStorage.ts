export type StoredLanguage = "cs" | "en" | "pl" | "de";
export const LANG_KEY = "onemore_lang";

export function parseStoredLanguage(value: string | null): StoredLanguage {
  return value === "cs" || value === "en" || value === "pl" || value === "de" ? value : "cs";
}
