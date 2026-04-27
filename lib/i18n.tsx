import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "cs" | "en" | "pl" | "de";
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
    langPL: string;
    langDE: string;
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
    upgrade: string;
    dayWord: string;
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
      langPL: "Polski",
      langDE: "Deutsch",
      account: "Účet",
      close: "Zavřít",
      darkMode: "Tmavý režim",
      shareAchievements: "Sdílet s přáteli své úspěchy",
      changePassword: "Změna hesla",
      changeUsername: "Změna uživatelského jména",
      premium: "Premium",
      upgrade: "Upgradovat",
      managePremium: "Spravovat Premium",
      logout: "Odhlásit se",
      deleteAccount: "Odstranit účet",
      dayWord: "den",
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
      langPL: "Polish",
      langDE: "German",
      account: "Account",
      close: "Close",
      darkMode: "Dark mode",
      shareAchievements: "Share my achievements with friends",
      changePassword: "Change password",
      changeUsername: "Change username",
      premium: "Premium",
      upgrade: "Upgrade",
      managePremium: "Manage Premium",
      logout: "Log out",
      deleteAccount: "Delete account",
      dayWord: "day",
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

  pl: {
    appSubtitle: "Jeden krok dziś. Wielka zmiana jutro.",
    tabs: {
      today: "OneMore",
      challenges: "Wyzwania",
      settings: "Ustawienia",
      profile: "Profil",
    },
    settings: {
      language: "Język",
      langCS: "Czeski",
      langEN: "Angielski",
      langPL: "Polski",
      langDE: "Niemiecki",
      account: "Konto",
      close: "Zamknij",
      darkMode: "Tryb ciemny",
      shareAchievements: "Udostępniaj znajomym swoje osiągnięcia",
      changePassword: "Zmień hasło",
      changeUsername: "Zmień nazwę użytkownika",
      premium: "Premium",
      upgrade: "Ulepsz",
      managePremium: "Zarządzaj Premium",
      logout: "Wyloguj się",
      deleteAccount: "Usuń konto",
       dayWord: "dzień",
    },
    login: {
      welcome: "Witaj w",
      subtitle: "Jeden krok dziś, wielka zmiana jutro.",
      email: "E-mail",
      password: "Hasło",
      remember: "Zapamiętaj mnie",
      forgot: "Nie pamiętasz hasła?",
      login: "ZALOGUJ SIĘ",
      loggingIn: "LOGOWANIE…",
      noAccount: "Nie masz jeszcze konta?",
      registerHere: "Zarejestruj się tutaj",
      lightMode: "☀️  Tryb jasny",
      darkMode: "🌙  Tryb ciemny",
      invalidEmailTitle: "Nieprawidłowy e-mail",
      invalidEmailText: "Wpisz poprawny adres e-mail.",
      missingPasswordTitle: "Brak hasła",
      missingPasswordText: "Wpisz hasło.",
      accountNotFoundTitle: "Nie znaleziono konta",
      accountNotFoundText: "Sprawdź e-mail albo zarejestruj się.",
      loginFailedTitle: "Logowanie nie powiodło się",
      loginFailedText: "Nieprawidłowy e-mail lub hasło.",
      timeoutTitle: "To trwa zbyt długo",
      timeoutText: "Logowanie się zawiesiło (słaby sygnał / Firebase niedostępne). Spróbuj ponownie.",
      genericErrorTitle: "Błąd",
      genericErrorText: "Nie udało się zalogować. Spróbuj ponownie.",
    },
    register: {
      title: "Rejestracja",
      subtitle: "Utwórz konto i zaczynamy.",
      username: "Nazwa użytkownika",
      email: "E-mail",
      password: "Hasło",
      createAccount: "UTWÓRZ KONTO",
      creating: "TWORZENIE…",
      haveAccount: "Masz już konto?",
      login: "Zaloguj się",
      missingNameTitle: "Brak nazwy użytkownika",
      missingNameText: "Wpisz nazwę użytkownika (min. 2 znaki).",
      invalidEmailTitle: "Nieprawidłowy e-mail",
      invalidEmailText: "Wpisz poprawny adres e-mail.",
      weakPasswordTitle: "Słabe hasło",
      weakPasswordText: "Hasło musi mieć co najmniej 6 znaków.",
      usernameTakenTitle: "Nazwa jest zajęta",
      usernameTakenText: "Spróbuj innej nazwy użytkownika.",
      cloudAccessTitle: "Brak dostępu do chmury",
      cloudAccessText: "Reguły Firestore blokują zapis (PERMISSION_DENIED). Sprawdź Firestore Rules i spróbuj ponownie.",
      cloudErrorTitle: "Błąd chmury",
      doneTitle: "Gotowe",
      doneText: "Konto zostało utworzone.",
      emailExistsTitle: "E-mail już istnieje",
      emailExistsText: "Ten e-mail jest już zarejestrowany. Spróbuj się zalogować.",
      timeoutTitle: "To trwa zbyt długo",
      timeoutText: "Rejestracja się zawiesiła (sygnał / Firebase). Spróbuj ponownie.",
      genericErrorTitle: "Błąd",
      genericErrorText: "Nie udało się zarejestrować. Spróbuj ponownie.",
    },
  },

  de: {
    appSubtitle: "Ein Schritt heute. Eine große Veränderung morgen.",
    tabs: {
      today: "OneMore",
      challenges: "Challenges",
      settings: "Einstellungen",
      profile: "Profil",
    },
    settings: {
      language: "Sprache",
      langCS: "Tschechisch",
      langEN: "Englisch",
      langPL: "Polnisch",
      langDE: "Deutsch",
      account: "Konto",
      close: "Schließen",
      darkMode: "Dunkler Modus",
      shareAchievements: "Meine Erfolge mit Freunden teilen",
      changePassword: "Passwort ändern",
      changeUsername: "Benutzernamen ändern",
      premium: "Premium",
      upgrade: "Upgraden",
      managePremium: "Premium verwalten",
      logout: "Abmelden",
      deleteAccount: "Konto löschen",
      dayWord: "Tag",
    },
    login: {
      welcome: "Willkommen bei",
      subtitle: "Ein Schritt heute, eine große Veränderung morgen.",
      email: "E-Mail",
      password: "Passwort",
      remember: "Merken",
      forgot: "Passwort vergessen?",
      login: "ANMELDEN",
      loggingIn: "ANMELDUNG…",
      noAccount: "Noch kein Konto?",
      registerHere: "Hier registrieren",
      lightMode: "☀️  Heller Modus",
      darkMode: "🌙  Dunkler Modus",
      invalidEmailTitle: "Ungültige E-Mail",
      invalidEmailText: "Bitte gib eine gültige E-Mail-Adresse ein.",
      missingPasswordTitle: "Passwort fehlt",
      missingPasswordText: "Bitte gib dein Passwort ein.",
      accountNotFoundTitle: "Konto nicht gefunden",
      accountNotFoundText: "Überprüfe deine E-Mail oder registriere dich.",
      loginFailedTitle: "Anmeldung fehlgeschlagen",
      loginFailedText: "Falsche E-Mail oder falsches Passwort.",
      timeoutTitle: "Das dauert zu lange",
      timeoutText: "Die Anmeldung hängt fest (schwaches Signal / Firebase nicht verfügbar). Bitte versuche es erneut.",
      genericErrorTitle: "Fehler",
      genericErrorText: "Anmeldung nicht möglich. Bitte versuche es erneut.",
    },
    register: {
      title: "Registrierung",
      subtitle: "Erstelle dein Konto und leg los.",
      username: "Benutzername",
      email: "E-Mail",
      password: "Passwort",
      createAccount: "KONTO ERSTELLEN",
      creating: "WIRD ERSTELLT…",
      haveAccount: "Du hast schon ein Konto?",
      login: "Anmelden",
      missingNameTitle: "Benutzername fehlt",
      missingNameText: "Bitte gib einen Benutzernamen ein (min. 2 Zeichen).",
      invalidEmailTitle: "Ungültige E-Mail",
      invalidEmailText: "Bitte gib eine gültige E-Mail-Adresse ein.",
      weakPasswordTitle: "Schwaches Passwort",
      weakPasswordText: "Das Passwort muss mindestens 6 Zeichen haben.",
      usernameTakenTitle: "Benutzername ist vergeben",
      usernameTakenText: "Versuche einen anderen Benutzernamen.",
      cloudAccessTitle: "Kein Cloud-Zugriff",
      cloudAccessText: "Firestore-Regeln blockieren den Schreibzugriff (PERMISSION_DENIED). Prüfe die Firestore Rules und versuche es erneut.",
      cloudErrorTitle: "Cloud-Fehler",
      doneTitle: "Fertig",
      doneText: "Das Konto wurde erstellt.",
      emailExistsTitle: "E-Mail existiert bereits",
      emailExistsText: "Diese E-Mail ist bereits registriert. Versuche dich anzumelden.",
      timeoutTitle: "Das dauert zu lange",
      timeoutText: "Die Registrierung hängt fest (Signal / Firebase). Bitte versuche es erneut.",
      genericErrorTitle: "Fehler",
      genericErrorText: "Registrierung nicht möglich. Bitte versuche es erneut.",
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
        if (saved === "cs" || saved === "en" || saved === "pl" || saved === "de") {
          setLangState(saved);
        }
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