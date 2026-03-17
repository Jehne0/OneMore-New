import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "cs" | "en";
const LANG_KEY = "onemore_lang";

// ✅ 1) Nejprve definuj "shape" slovníku (stejné klíče pro cs i en)
export type Dictionary = {
  appSubtitle: string;
  tabs: {
    today: string;
    challenges: string;
    settings: string;
  };
  settings: {
    language: string;
    langCS: string;
    langEN: string;
  };
};

// ✅ 2) STRINGS typuj jako Record<Lang, Dictionary> (žádné union problémy)
export const STRINGS: Record<Lang, Dictionary> = {
  cs: {
    appSubtitle: "Jeden krok dnes. Velká změna zítra.",
    tabs: {
      today: "OneMore",
      challenges: "Výzvy",
      settings: "Nastavení",
    },
    settings: {
      language: "Jazyk",
      langCS: "Čeština",
      langEN: "English",
    },
  },
  en: {
    appSubtitle: "One step today. A big change tomorrow.",
    tabs: {
      today: "OneMore",
      challenges: "Challenges",
      settings: "Settings",
    },
    settings: {
      language: "Language",
      langCS: "Czech",
      langEN: "English",
    },
  },
};

type I18nValue = {
  lang: Lang;
  setLang: (l: Lang) => Promise<void>;
  t: Dictionary;
  isReady: boolean;
};

const I18nCtx = createContext<I18nValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("cs");
  const [isReady, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(LANG_KEY);
        if (saved === "cs" || saved === "en") setLangState(saved);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const setLang = async (l: Lang) => {
    setLangState(l);
    await AsyncStorage.setItem(LANG_KEY, l);
  };

  const t = useMemo(() => STRINGS[lang], [lang]);

  const value = useMemo<I18nValue>(
    () => ({ lang, setLang, t, isReady }),
    [lang, t, isReady]
  );

  if (!isReady) return null;
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error("useI18n must be used within LanguageProvider");
  return ctx;
}
