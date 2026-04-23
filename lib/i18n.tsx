import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "cs" | "en";
const LANG_KEY = "onemore_lang";

export type Dictionary = {
  appSubtitle: string;
  tabs: {
    today: string;
    challenges: string;
    settings: string;
    profile: string;
  };
  settings: {
    language: string;
    langCS: string;
    langEN: string;
    account: string;
    close: string;
    darkMode: string;
    shareAchievements: string;
    changePassword: string;
    changeUsername: string;
    premium: string;
    managePremium: string;
    logout: string;
    deleteAccount: string;
  };
  login: {
    welcome: string;
    subtitle: string;
    email: string;
    password: string;
    remember: string;
    forgot: string;
    login: string;
    loggingIn: string;
    noAccount: string;
    registerHere: string;
    lightMode: string;
    darkMode: string;
    invalidEmailTitle: string;
    invalidEmailText: string;
    missingPasswordTitle: string;
    missingPasswordText: string;
    accountNotFoundTitle: string;
    accountNotFoundText: string;
    loginFailedTitle: string;
    loginFailedText: string;
    timeoutTitle: string;
    timeoutText: string;
    genericErrorTitle: string;
    genericErrorText: string;
  };
  register: {
    title: string;
    subtitle: string;
    username: string;
    email: string;
    password: string;
    createAccount: string;
    creating: string;
    haveAccount: string;
    login: string;
    missingNameTitle: string;
    missingNameText: string;
    invalidEmailTitle: string;
    invalidEmailText: string;
    weakPasswordTitle: string;
    weakPasswordText: string;
    usernameTakenTitle: string;
    usernameTakenText: string;
    cloudAccessTitle: string;
    cloudAccessText: string;
    cloudErrorTitle: string;
    doneTitle: string;
    doneText: string;
    emailExistsTitle: string;
    emailExistsText: string;
    timeoutTitle: string;
    timeoutText: string;
    genericErrorTitle: string;
    genericErrorText: string;
  };
};

export const STRINGS: Record<Lang, Dictionary> = {
  cs: {
    appSubtitle: "Jeden krok dnes. Velká změna zítra.",
    tabs: {
      today: "OneMore",
      challenges: "Výzvy",
      settings: "Nastavení",
      profile: "Profil",
    },
    settings: {
      language: "Jazyk",
      langCS: "Čeština",
      langEN: "English",
      account: "Účet",
      close: "Zavřít",
      darkMode: "Tmavý režim",
      shareAchievements: "Sdílet s přáteli své úspěchy",
      changePassword: "Změna hesla",
      changeUsername: "Změna uživatelského jména",
      premium: "Premium",
      managePremium: "Spravovat Premium",
      logout: "Odhlásit se",
      deleteAccount: "Odstranit účet",
    },
    login: {
      welcome: "Vítej v",
      subtitle: "Jeden krok dnes, velká změna zítra.",
      email: "E-mail",
      password: "Heslo",
      remember: "Zapamatovat",
      forgot: "Zapomenuté heslo?",
      login: "PŘIHLÁSIT",
      loggingIn: "PŘIHLAŠUJI…",
      noAccount: "Ještě nemáš účet?",
      registerHere: "Zaregistrujte se zde",
      lightMode: "☀️  Světlý režim",
      darkMode: "🌙  Tmavý režim",
      invalidEmailTitle: "Neplatný e-mail",
      invalidEmailText: "Zadej prosím platný e-mail.",
      missingPasswordTitle: "Chybí heslo",
      missingPasswordText: "Zadej prosím heslo.",
      accountNotFoundTitle: "Účet nenalezen",
      accountNotFoundText: "Zkontroluj e-mail nebo se registruj.",
      loginFailedTitle: "Přihlášení selhalo",
      loginFailedText: "Špatný e-mail nebo heslo.",
      timeoutTitle: "Trvá to moc dlouho",
      timeoutText: "Přihlášení se zaseklo (slabý signál / Firebase nedostupné). Zkus to prosím znovu.",
      genericErrorTitle: "Chyba",
      genericErrorText: "Nepodařilo se přihlásit. Zkus to prosím znovu.",
    },
    register: {
      title: "Registrace",
      subtitle: "Vytvoř si účet a pojď na to.",
      username: "Uživatelské jméno",
      email: "E-mail",
      password: "Heslo",
      createAccount: "VYTVOŘIT ÚČET",
      creating: "VYTVÁŘÍM…",
      haveAccount: "Už máš účet?",
      login: "Přihlásit se",
      missingNameTitle: "Chybí jméno",
      missingNameText: "Zadej prosím uživatelské jméno (min. 2 znaky).",
      invalidEmailTitle: "Neplatný e-mail",
      invalidEmailText: "Zadej prosím platný e-mail.",
      weakPasswordTitle: "Slabé heslo",
      weakPasswordText: "Heslo musí mít alespoň 6 znaků.",
      usernameTakenTitle: "Jméno je obsazené",
      usernameTakenText: "Zkus jiné uživatelské jméno.",
      cloudAccessTitle: "Nemám přístup do cloudu",
      cloudAccessText: "Firestore pravidla blokují zápis (PERMISSION_DENIED). Zkontroluj Firestore Rules a zkus to znovu.",
      cloudErrorTitle: "Chyba cloudu",
      doneTitle: "Hotovo",
      doneText: "Účet byl vytvořen.",
      emailExistsTitle: "E-mail už existuje",
      emailExistsText: "Tento e-mail už je zaregistrovaný. Zkus se přihlásit.",
      timeoutTitle: "Trvá to moc dlouho",
      timeoutText: "Registrace se zasekla (signál / Firebase). Zkus to prosím znovu.",
      genericErrorTitle: "Chyba",
      genericErrorText: "Nepodařilo se registrovat. Zkus to prosím znovu.",
    },
  },

  en: {
    appSubtitle: "One step today. A big change tomorrow.",
    tabs: {
      today: "OneMore",
      challenges: "Challenges",
      settings: "Settings",
      profile: "Profile",
    },
    settings: {
      language: "Language",
      langCS: "Czech",
      langEN: "English",
      account: "Account",
      close: "Close",
      darkMode: "Dark mode",
      shareAchievements: "Share my achievements with friends",
      changePassword: "Change password",
      changeUsername: "Change username",
      premium: "Premium",
      managePremium: "Manage Premium",
      logout: "Log out",
      deleteAccount: "Delete account",
    },
    login: {
      welcome: "Welcome to",
      subtitle: "One step today, a big change tomorrow.",
      email: "Email",
      password: "Password",
      remember: "Remember me",
      forgot: "Forgot password?",
      login: "LOG IN",
      loggingIn: "LOGGING IN…",
      noAccount: "Don’t have an account yet?",
      registerHere: "Register here",
      lightMode: "☀️  Light mode",
      darkMode: "🌙  Dark mode",
      invalidEmailTitle: "Invalid email",
      invalidEmailText: "Please enter a valid email.",
      missingPasswordTitle: "Missing password",
      missingPasswordText: "Please enter your password.",
      accountNotFoundTitle: "Account not found",
      accountNotFoundText: "Check your email or register first.",
      loginFailedTitle: "Login failed",
      loginFailedText: "Wrong email or password.",
      timeoutTitle: "This is taking too long",
      timeoutText: "Login got stuck (weak signal / Firebase unavailable). Please try again.",
      genericErrorTitle: "Error",
      genericErrorText: "Could not sign in. Please try again.",
    },
    register: {
      title: "Register",
      subtitle: "Create your account and let’s go.",
      username: "Username",
      email: "Email",
      password: "Password",
      createAccount: "CREATE ACCOUNT",
      creating: "CREATING…",
      haveAccount: "Already have an account?",
      login: "Log in",
      missingNameTitle: "Missing username",
      missingNameText: "Please enter a username (min. 2 characters).",
      invalidEmailTitle: "Invalid email",
      invalidEmailText: "Please enter a valid email.",
      weakPasswordTitle: "Weak password",
      weakPasswordText: "Password must be at least 6 characters.",
      usernameTakenTitle: "Username is taken",
      usernameTakenText: "Try a different username.",
      cloudAccessTitle: "No cloud access",
      cloudAccessText: "Firestore rules are blocking the write (PERMISSION_DENIED). Check Firestore Rules and try again.",
      cloudErrorTitle: "Cloud error",
      doneTitle: "Done",
      doneText: "Account has been created.",
      emailExistsTitle: "Email already exists",
      emailExistsText: "This email is already registered. Try logging in.",
      timeoutTitle: "This is taking too long",
      timeoutText: "Registration got stuck (signal / Firebase). Please try again.",
      genericErrorTitle: "Error",
      genericErrorText: "Could not register. Please try again.",
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
  const value = useMemo<I18nValue>(() => ({ lang, setLang, t, isReady }), [lang, t, isReady]);

  if (!isReady) return null;
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error("useI18n must be used within LanguageProvider");
  return ctx;
}