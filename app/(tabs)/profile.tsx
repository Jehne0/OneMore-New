import { Ionicons, MaterialCommunityIcons, Feather  } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  acceptSharedChallenge,
  createSharedChallenge,
  declineSharedChallenge,
  dowMon0,
  MAX_SHARED_MEMBERS,
  subscribeSharedChallenges,
  type SharedChallenge,
} from "../../lib/sharedChallenges";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getOfferingPackages,
  openCancelSubscription,
  purchasePackage,
  restorePurchases,
  revenueCatLogout,
} from "../../lib/revenuecat";

import { useTheme } from "../../lib/theme";
import { useI18n } from "../../lib/i18n";
import { isPremiumActive, subscribePremium } from "../../lib/premium";
import {
  EmailAuthProvider,
  deleteUser,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
} from "firebase/auth";
import { deleteDoc, doc, getDoc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { deleteCloudUserDoc } from "../../lib/cloud";
import { auth, db, functions } from "../../lib/firebase";
import {
  acceptFriend,
  declineFriend,
  removeFriend,
  sendFriendRequest,
  subscribeFriends,
  type FriendEdge,
} from "../../lib/friends";
import { resolveUidByUsername, getProfile } from "../../lib/usernames";
import { changeUsername } from "../../lib/usernames";

async function clearOneMoreStorage() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const oneMoreKeys = keys.filter((k) => String(k).startsWith("onemore_"));
    if (oneMoreKeys.length) {
      await AsyncStorage.multiRemove(oneMoreKeys);
    }
  } catch {
    // ignore
  }
}

type InfoScreen =
  | "menu"
  | "support"
  | "streak_medals"
  | "freeprem"
  | "privacy"
  | "terms"
  | "paywall";

type FriendsTab = "friends" | "requests" | "invites";

type FriendPreviewStats = {
  bestStreak: number;
  totalMedals: number;
  highestMedal: "none" | "brambora" | "steel" | "bronze" | "silver" | "gold" | "diamond";
  activeChallenges: number;
};

// ✅ veřejné HTML stránky (otevírá se v prohlížeči)
const PRIVACY_URL = "https://desigame.eu/privacy.html";
const TERMS_URL = "https://desigame.eu/terms.html";

const PROFILE_STRINGS = {
  cs: {
    dayMon: "Po",
dayTue: "Út",
dayWed: "St",
dayThu: "Čt",
dayFri: "Pá",
daySat: "So",
daySun: "Ne",
    streakFlamesInfo: "Ohýnek ukazuje, kolik dní po sobě máš splněno (série).\n\nPokud je výzva v daný den neaktivní nebo má volný den, série se neruší.\nSérie se resetuje jen tehdy, když nesplníš aktivní den výzvy. Výzvu můžeš deaktivovat bez ztráty série.",
medalsIntro: "Každá výzva si počítá medaile podle tvé nejdelší série:",
    deleteAccountTitle: "Odstranit účet?",
    deleteAccountText: "Tahle akce je nevratná. Účet bude smazán.",
    enterPassword: "Zadej heslo",
    cancel: "Zrušit",
    deleteAccountAction: "Chci odstranit účet",
    deletingAccount: "Mažu účet…",
    changePassword: "Změna hesla",
    close: "Zavřít",
    passwordResetInfo: "Pošleme ti e-mail s odkazem na změnu hesla.",
    email: "E-mail",
    sendLink: "Poslat odkaz",
    sending: "Odesílám…",
    changeUsername: "Změna uživatelského jména",
    newUsername: "Nové uživatelské jméno",
    saveChange: "Uložit změnu",
    saving: "Ukládám…",
    account: "Účet",
    darkMode: "Tmavý režim",
    shareAchievements: "Sdílet s přáteli své úspěchy",
    language: "Jazyk",
    premium: "Premium",
    managePremium: "Spravovat Premium",
    logout: "Odhlásit se",
    deleteAccount: "Odstranit účet",
    info: "Informace a historie",
    sendQuestion: "Poslat dotaz",
    querySubject: "Poslat dotaz",
    streaksMedals: "Ohýnky & medaile",
    freePremium: "Free & Premium",
    privacy: "Ochrana soukromí",
    terms: "Podmínky používání",
    limitsBenefits: "Limity & výhody",
    streaksRewards: "Série & odměny",
    history: "Historie výzev",
    historySubtitle: "Přehled plnění a série",
    flames: "Ohýnky",
    medals: "Medaile",
    premiumBuy: "Koupit Premium",
    premiumCancel: "Zrušit předplatné",
    open: "Otevřít",
    subject: "Předmět",
    message: "Zpráva",
    send: "Odeslat",
    friends: "Přátelé",
    requests: "Žádosti",
    challenges: "Výzvy",
    addFriend: "Přidat přítele",
    addByUsername: "Přidat podle username",
    addByUsernameHelp: "Zadej uživatelské jméno člověka, kterého chceš přidat.",
    add: "Přidat",
    myFriends: "Moji přátelé",
    addShort: "+ Přidat",
    invite: "Vyzvat",
    remove: "Odebrat",
    accept: "Přijmout",
    decline: "Odmítnout",
    sentRequests: "Odeslané žádosti",
    incomingRequests: "Příchozí žádosti",
    blocked: "Blokovaní",
    loadingFriends: "Načítám přátele...",
    noFriendsYet: "Zatím žádní přátelé.",
    loadingChallenges: "Načítám výzvy...",
    noRequests: "Zatím tu nemáš žádné žádosti.",
    noPendingChallenges: "Zatím tu nemáš žádné nepřijaté společné výzvy.",
    from: "Od",
    participants: "Účastníci",
    target: "Cíl",
    daily: "denně",
    every2: "obden",
    selectedDays: "ve vybrané dny",
    newSharedChallenge: "Nová společná výzva",
    sharedChallenge: "Společná výzva",
    selectUpToFriends: "Vyber až {count} přátel do jedné výzvy.",
    friendsLabel: "Přátelé",
    challengeName: "Název výzvy",
    challengeNamePlaceholder: "Např. Kliky",
    countPerDay: "Počet za den",
    period: "Perioda",
    dailyCap: "Denně",
    every2Cap: "Obden",
    customDays: "Vlastní dny",
    chooseDays: "Vyber dny",
    submit: "Odeslat",
    friendProfile: "Profil přítele",
    loadingStats: "Načítám statistiky...",
    userNotSharing: "Tento uživatel nesdílí své úspěchy.",
    statsUnavailable: "Statistiky nejsou dostupné.",
    longestStreak: "🔥 Nejdelší série",
    medalsCount: "🏅 Počet medailí",
    highestMedal: "💎 Nejvyšší medaile",
    activeChallenges: "✅ Aktivní výzvy",
    upgrade: "Upgradovat",
    ok: "OK",
    supportReplyEmail: "E-mail pro odpověď",
    supportPlaceholder: "tvuj@email.cz",
    supportSubjectPlaceholder: "Např. Problém s notifikacemi",
    supportMessagePlaceholder: "Popiš prosím svůj dotaz…",
    freeVersion: "Základní verze zdarma",
    bestChoice: "NEJLEPŠÍ VOLBA",
    premiumForResults: "Pro maximální výsledky",
    unlimitedChallenges: "Neomezené výzvy",
    unlimitedReminders: "Neomezené připomínky",
    fullHistory: "Plná historie výzev",
    unlimitedFriends: "Neomezeně přátel",
    unlimitedSharedChallenges: "Neomezené společné výzvy",
    getPremium: "Získat Premium",
    securePayment: "Bezpečná platba",
    cancelAnytime: "Zrušení kdykoliv",
    supportDevelopment: "Podporuješ vývoj",
    free: "Free",
    oneMoreFree: "OneMore zdarma. Premium bez limitů.",
    premiumActiveShort: "Premium je aktivní.",
    manageSubscription: "Spravuj své předplatné",
    unlockMore: "Odemkni více výzev, připomínek, přátel a společných výzev.",
    reminders: "Připomínky",
    historyChallenges: "Historie výzev",
    sharedChallenges: "Společné výzvy",
    activePremiumInfo: "Premium je aktivní. Můžeš ho kdykoliv zrušit nebo zkusit obnovit stav.",
    unlockPremiumInfo: "Odemkni Premium a získej neomezené výzvy, připomínky a přátele.",
    priceInfo: "Cena: zobrazí se po napojení nabídky (Offering) v RevenueCat.",
    unlimitedRemindersNotif: "Neomezené připomínky (notifikace)",
    unlimitedFriendsLink: "Neomezené propojení s přáteli",
    moreRewards: "Další odměny a drobné vychytávky (postupně)",
      profileTitleFriends: "Přátelé",
    profileTitleInfo: "Informace",
    passwordPlaceholder: "heslo",
    usernamePlaceholder: "username",
    noScalePremium: "Premium",
    noScaleFree: "Free",
    premiumFriendsOnly: "Společné výzvy s přáteli jsou dostupné jen v Premium verzi.",
    freeFriendsLimit: "Ve Free verzi můžeš mít jen 1 přítele. Pro více je potřeba Premium.",
    medalNone: "Žádná",
    medalPotato: "Bramborová",
    medalSteel: "Ocelová",
    medalBronze: "Bronzová",
    medalSilver: "Stříbrná",
    medalGold: "Zlatá",
    medalDiamond: "Diamantová",
    cancelRequestFailed: "Nepodařilo se zrušit.",
    declineFriendFailed: "Nepodařilo se odmítnout.",
    acceptFriendFailed: "Nepodařilo se přijmout.",
    removeFriendFailed: "Nepodařilo se odebrat.",
    medalPotatoDesc: "Začátek. 10 dní držíš směr.",
medalSteelDesc: "30 dní. Pevný základ.",
medalBronzeDesc: "45 dní. Už vzniká návyk.",
medalSilverDesc: "90 dní. Disciplína sílí.",
medalGoldDesc: "180 dní. Výborná výdrž.",
medalDiamondDesc: "365 dní. Životní styl.",
historyEmpty: "Žádná historie.",
historyCompleted: "Splněno",
historyMissed: "Nesplněno",
historyFreeDay: "Volný den",
historyArchived: "Archivovaná výzva",
historyActive: "Aktivní výzva",
clearHistory: "Vymazat historii",
clearHistoryConfirm: "Opravdu chceš smazat historii?",
  },
  en: {
    dayMon: "Mon",
dayTue: "Tue",
dayWed: "Wed",
dayThu: "Thu",
dayFri: "Fri",
daySat: "Sat",
daySun: "Sun",
        streakFlamesInfo: "The flame shows how many days in a row you have completed your challenge.\n\nIf a challenge is inactive on a given day or it is a rest day, the streak does not break.\nThe streak resets only when you miss an active challenge day. You can deactivate a challenge without losing the streak.",
medalsIntro: "Each challenge awards medals based on your longest streak:",
  deleteAccountTitle: "Delete account?",
  deleteAccountText: "This action is irreversible. Your account will be deleted.",
  enterPassword: "Enter password",
  cancel: "Cancel",
  deleteAccountAction: "Delete my account",
  deletingAccount: "Deleting account…",
  changePassword: "Change password",
  close: "Close",
  passwordResetInfo: "We will send you an email with a password reset link.",
  email: "Email",
  sendLink: "Send link",
  sending: "Sending…",
  changeUsername: "Change username",
  newUsername: "New username",
  saveChange: "Save changes",
  saving: "Saving…",
  account: "Account",
  darkMode: "Dark mode",
  shareAchievements: "Share my achievements with friends",
  language: "Language",
  premium: "Premium",
  managePremium: "Manage Premium",
  logout: "Log out",
  deleteAccount: "Delete account",
  info: "Information & History",
  sendQuestion: "Contact support",
  querySubject: "Contact support",
  streaksMedals: "Streaks & medals",
  freePremium: "Free & Premium",
  privacy: "Privacy policy",
  terms: "Terms of use",
  limitsBenefits: "Limits & benefits",
  streaksRewards: "Streaks & rewards",
  history: "Challenge history",
  historySubtitle: "Completion and streak overview",
  flames: "Flames",
  medals: "Medals",
  premiumBuy: "Buy Premium",
  premiumCancel: "Cancel subscription",
  open: "Open",
  subject: "Subject",
  message: "Message",
  send: "Send",
  friends: "Friends",
  requests: "Requests",
  challenges: "Challenges",
  addFriend: "Add friend",
  addByUsername: "Add by username",
  addByUsernameHelp: "Enter the username of the person you want to add.",
  add: "Add",
  myFriends: "My friends",
  addShort: "+ Add",
  invite: "Invite",
  remove: "Remove",
  accept: "Accept",
  decline: "Decline",
  sentRequests: "Sent requests",
  incomingRequests: "Incoming requests",
  blocked: "Blocked",
  loadingFriends: "Loading friends...",
  noFriendsYet: "No friends yet.",
  loadingChallenges: "Loading challenges...",
  noRequests: "You have no requests yet.",
  noPendingChallenges: "You have no pending shared challenges right now.",
  from: "From",
  participants: "Participants",
  target: "Target",
  daily: "daily",
  every2: "every other day",
  selectedDays: "on selected days",
  newSharedChallenge: "New shared challenge",
  sharedChallenge: "Shared challenge",
  selectUpToFriends: "Select up to {count} friends for one challenge.",
  friendsLabel: "Friends",
  challengeName: "Challenge name",
  challengeNamePlaceholder: "For example: Push-ups",
  countPerDay: "Count per day",
  period: "Period",
  dailyCap: "Daily",
  every2Cap: "Every other day",
  customDays: "Custom days",
  chooseDays: "Choose days",
  submit: "Send",
  friendProfile: "Friend profile",
  loadingStats: "Loading stats...",
  userNotSharing: "This user is not sharing achievements.",
  statsUnavailable: "Stats are not available.",
  longestStreak: "🔥 Longest streak",
  medalsCount: "🏅 Medal count",
  highestMedal: "💎 Highest medal",
  activeChallenges: "✅ Active challenges",
  upgrade: "Upgrade",
  ok: "OK",
  supportReplyEmail: "Reply email",
  supportPlaceholder: "your@email.com",
  supportSubjectPlaceholder: "For example: Notification issue",
  supportMessagePlaceholder: "Describe your issue…",
  freeVersion: "Basic version for free",
  bestChoice: "BEST VALUE",
  premiumForResults: "For maximum results",
  unlimitedChallenges: "Unlimited challenges",
  unlimitedReminders: "Unlimited reminders",
  fullHistory: "Full challenge history",
  unlimitedFriends: "Unlimited friends",
  unlimitedSharedChallenges: "Unlimited shared challenges",
  getPremium: "Get Premium",
  securePayment: "Secure payment",
  cancelAnytime: "Cancel anytime",
  supportDevelopment: "You support development",
  free: "Free",
  oneMoreFree: "OneMore for free. Premium without limits.",
  premiumActiveShort: "Premium is active.",
  manageSubscription: "Manage your subscription",
  unlockMore: "Unlock more challenges, reminders, friends, and shared challenges.",
  reminders: "Reminders",
  historyChallenges: "Challenge history",
  sharedChallenges: "Shared challenges",
  activePremiumInfo: "Premium is active. You can cancel it anytime or try restoring the status.",
  unlockPremiumInfo: "Unlock Premium and get unlimited challenges, reminders, and friends.",
  priceInfo: "Price will appear after the RevenueCat offering is connected.",
  unlimitedRemindersNotif: "Unlimited reminders (notifications)",
  unlimitedFriendsLink: "Unlimited friend connections",
  moreRewards: "More rewards and small extras (coming gradually)",
  profileTitleFriends: "Friends",
  profileTitleInfo: "Information",
  passwordPlaceholder: "password",
  usernamePlaceholder: "username",
  noScalePremium: "Premium",
  noScaleFree: "Free",
  premiumFriendsOnly: "Shared challenges with friends are available only in Premium.",
  freeFriendsLimit: "In the free version you can have only 1 friend. Upgrade to Premium for more.",
  medalNone: "None",
  medalPotato: "Potato",
  medalSteel: "Steel",
  medalBronze: "Bronze",
  medalSilver: "Silver",
  medalGold: "Gold",
  medalDiamond: "Diamond",
  removeFriendFailed: "Could not remove friend.",
  acceptFriendFailed: "Could not accept request.",
  declineFriendFailed: "Could not decline request.",
  cancelRequestFailed: "Could not cancel request.",
  medalPotatoDesc: "The beginning. 10 days on track.",
medalSteelDesc: "30 days. Strong foundation.",
medalBronzeDesc: "45 days. A habit is forming.",
medalSilverDesc: "90 days. Discipline grows.",
medalGoldDesc: "180 days. Excellent consistency.",
medalDiamondDesc: "365 days. A lifestyle.",
historyEmpty: "No history.",
historyCompleted: "Completed",
historyMissed: "Missed",
historyFreeDay: "Free day",
historyArchived: "Archived challenge",
historyActive: "Active challenge",
clearHistory: "Clear history",
clearHistoryConfirm: "Are you sure you want to delete history?",
},

pl: {
  dayMon: "Pn",
dayTue: "Wt",
dayWed: "Śr",
dayThu: "Cz",
dayFri: "Pt",
daySat: "So",
daySun: "Nd",
    upgrade: "Ulepsz",
unlimitedChallenges: "Nieograniczone wyzwania",
unlimitedReminders: "Nieograniczone przypomnienia",
fullHistory: "Pełna historia wyzwań",
unlimitedFriends: "Nieograniczeni znajomi",
unlimitedSharedChallenges: "Nieograniczone wspólne wyzwania",
historyCompleted: "Ukończono",
historyMissed: "Niewykonano",
historyFreeDay: "Dzień wolny",
historyArchived: "Archiwalne wyzwanie",
historyActive: "Aktywne wyzwanie",
clearHistory: "Wyczyść historię",
clearHistoryConfirm: "Czy na pewno chcesz usunąć historię?",
  streakFlamesInfo: "Płomień pokazuje, ile dni z rzędu udało Ci się wykonać wyzwanie.\n\nJeśli wyzwanie jest w danym dniu nieaktywne albo ma dzień wolny, seria się nie przerywa.\nSeria resetuje się tylko wtedy, gdy nie wykonasz aktywnego dnia wyzwania. Możesz dezaktywować wyzwanie bez utraty serii.",
medalsIntro: "Każde wyzwanie przyznaje medale według Twojej najdłuższej serii:",
  deleteAccountTitle: "Usunąć konto?",
  deleteAccountText: "Tej akcji nie można cofnąć. Konto zostanie usunięte.",
  enterPassword: "Wpisz hasło",
  cancel: "Anuluj",
  deleteAccountAction: "Chcę usunąć konto",
  deletingAccount: "Usuwam konto…",
  changePassword: "Zmiana hasła",
  close: "Zamknij",
  passwordResetInfo: "Wyślemy Ci e-mail z linkiem do zmiany hasła.",
  email: "E-mail",
  sendLink: "Wyślij link",
  sending: "Wysyłam…",
  changeUsername: "Zmiana nazwy użytkownika",
  newUsername: "Nowa nazwa użytkownika",
  saveChange: "Zapisz zmianę",
  saving: "Zapisuję…",
  account: "Konto",
  darkMode: "Tryb ciemny",
  shareAchievements: "Udostępniaj znajomym swoje osiągnięcia",
  language: "Język",
  premium: "Premium",
  managePremium: "Zarządzaj Premium",
  logout: "Wyloguj się",
  deleteAccount: "Usuń konto",
  info: "Informacje i historia",
  sendQuestion: "Kontakt z pomocą",
  querySubject: "Kontakt z pomocą",
  streaksMedals: "Serie i medale",
  freePremium: "Free & Premium",
  privacy: "Prywatność",
  terms: "Warunki korzystania",
  limitsBenefits: "Limity i korzyści",
  streaksRewards: "Serie i nagrody",
  history: "Historia wyzwań",
  historySubtitle: "Przegląd wykonania i serii",
  flames: "Płomienie",
  medals: "Medale",
  premiumBuy: "Kup Premium",
  premiumCancel: "Anuluj subskrypcję",
  open: "Otwórz",
  subject: "Temat",
  message: "Wiadomość",
  send: "Wyślij",
  friends: "Znajomi",
  requests: "Prośby",
  challenges: "Wyzwania",
  addFriend: "Dodaj znajomego",
  addByUsername: "Dodaj po nazwie użytkownika",
  addByUsernameHelp: "Wpisz nazwę użytkownika osoby, którą chcesz dodać.",
  add: "Dodaj",
  myFriends: "Moi znajomi",
  addShort: "+ Dodaj",
  invite: "Zaproś",
  remove: "Usuń",
  accept: "Akceptuj",
  decline: "Odrzuć",
  sentRequests: "Wysłane prośby",
  incomingRequests: "Otrzymane prośby",
  blocked: "Zablokowani",
  loadingFriends: "Ładuję znajomych...",
  noFriendsYet: "Nie masz jeszcze znajomych.",
  loadingChallenges: "Ładuję wyzwania...",
  noRequests: "Nie masz jeszcze żadnych próśb.",
  noPendingChallenges: "Nie masz teraz żadnych oczekujących wspólnych wyzwań.",
  from: "Od",
  participants: "Uczestnicy",
  target: "Cel",
  daily: "codziennie",
  every2: "co drugi dzień",
  selectedDays: "w wybrane dni",
  newSharedChallenge: "Nowe wspólne wyzwanie",
  sharedChallenge: "Wspólne wyzwanie",
  selectUpToFriends: "Wybierz maksymalnie {count} znajomych do jednego wyzwania.",
  friendsLabel: "Znajomi",
  challengeName: "Nazwa wyzwania",
  challengeNamePlaceholder: "Np. Pompki",
  countPerDay: "Liczba dziennie",
  period: "Okres",
  dailyCap: "Codziennie",
  every2Cap: "Co drugi dzień",
  customDays: "Własne dni",
  chooseDays: "Wybierz dni",
  submit: "Wyślij",
  friendProfile: "Profil znajomego",
  loadingStats: "Ładuję statystyki...",
  userNotSharing: "Ten użytkownik nie udostępnia swoich osiągnięć.",
  statsUnavailable: "Statystyki są niedostępne.",
  longestStreak: "🔥 Najdłuższa seria",
  medalsCount: "🏅 Liczba medali",
  highestMedal: "💎 Najwyższy medal",
  activeChallenges: "✅ Aktywne wyzwania",
  ok: "OK",
  supportReplyEmail: "E-mail do odpowiedzi",
  supportPlaceholder: "twoj@email.pl",
  supportSubjectPlaceholder: "Np. Problem z powiadomieniami",
  supportMessagePlaceholder: "Opisz proszę swój problem…",
  freeVersion: "Podstawowa wersja za darmo",
  bestChoice: "NAJLEPSZY WYBÓR",
  premiumForResults: "Dla maksymalnych efektów",
  getPremium: "Zdobądź Premium",
  securePayment: "Bezpieczna płatność",
  cancelAnytime: "Anulowanie w dowolnym momencie",
  supportDevelopment: "Wspierasz rozwój",
  free: "Free",
  oneMoreFree: "OneMore za darmo. Premium bez limitów.",
  premiumActiveShort: "Premium jest aktywne.",
  manageSubscription: "Zarządzaj subskrypcją",
  unlockMore: "Odblokuj więcej wyzwań, przypomnień, znajomych i wspólnych wyzwań.",
  reminders: "Przypomnienia",
  historyChallenges: "Historia wyzwań",
  sharedChallenges: "Wspólne wyzwania",
  activePremiumInfo: "Premium jest aktywne. Możesz je anulować w dowolnym momencie albo spróbować przywrócić status.",
  unlockPremiumInfo: "Odblokuj Premium i zyskaj nieograniczone wyzwania, przypomnienia i znajomych.",
  priceInfo: "Cena pojawi się po podłączeniu oferty w RevenueCat.",
  unlimitedRemindersNotif: "Nieograniczone przypomnienia / powiadomienia",
  unlimitedFriendsLink: "Nieograniczone połączenia ze znajomymi",
  moreRewards: "Więcej nagród i drobnych ulepszeń stopniowo",
  profileTitleFriends: "Znajomi",
  profileTitleInfo: "Informacje",
  passwordPlaceholder: "hasło",
  usernamePlaceholder: "nazwa użytkownika",
  noScalePremium: "Premium",
  noScaleFree: "Free",
  premiumFriendsOnly: "Wspólne wyzwania ze znajomymi są dostępne tylko w Premium.",
  freeFriendsLimit: "W wersji Free możesz mieć tylko 1 znajomego. Więcej wymaga Premium.",
  medalNone: "Brak",
  medalPotato: "Ziemniaczany",
  medalSteel: "Stalowy",
  medalBronze: "Brązowy",
  medalSilver: "Srebrny",
  medalGold: "Złoty",
  medalDiamond: "Diamentowy",
  cancelRequestFailed: "Nie udało się anulować.",
  declineFriendFailed: "Nie udało się odrzucić.",
  acceptFriendFailed: "Nie udało się zaakceptować.",
  removeFriendFailed: "Nie udało się usunąć.",
  medalPotatoDesc: "Początek. 10 dni trzymasz kierunek.",
medalSteelDesc: "30 dni. Solidna podstawa. Idziesz dalej.",
medalBronzeDesc: "45 dni. To zaczyna przypominać rutynę.",
medalSilverDesc: "Trzy miesiące. Nawyki stają się częścią dnia.",
medalGoldDesc: "Pół roku. Najwyższa dyscyplina.",
medalDiamondDesc: "Cały rok. To już styl życia.",

},

de: {
  dayMon: "Mo",
dayTue: "Di",
dayWed: "Mi",
dayThu: "Do",
dayFri: "Fr",
daySat: "Sa",
daySun: "So",
  unlimitedChallenges: "Unbegrenzte Herausforderungen",
unlimitedReminders: "Unbegrenzte Erinnerungen",
fullHistory: "Herausforderungsverlauf",
unlimitedFriends: "Unbegrenzte Freunde",
unlimitedSharedChallenges: "Unbegrenzte gemeinsame Herausforderungen",
  upgrade: "Upgraden",
historyEmpty: "Keine Historie.",
historyCompleted: "Erledigt",
historyMissed: "Nicht geschafft",
historyFreeDay: "Freier Tag",
historyArchived: "Archivierte Herausforderung",
historyActive: "Aktive Herausforderung",
clearHistory: "Verlauf löschen",
clearHistoryConfirm: "Möchtest du den Verlauf wirklich löschen?",
  streakFlamesInfo: "Die Flamme zeigt, wie viele Tage hintereinander du deine Herausforderung geschafft hast.\n\nWenn eine Herausforderung an einem Tag inaktiv ist oder ein freier Tag ist, wird die Serie nicht unterbrochen.\nDie Serie wird nur zurückgesetzt, wenn du einen aktiven Herausforderung-Tag verpasst. Du kannst eine Herausforderung deaktivieren, ohne die Serie zu verlieren.",
medalsIntro: "Jede Herausforderung vergibt Medaillen nach deiner längsten Serie:",
medalPotatoDesc: "Der Anfang. 10 Tage auf Kurs.",
medalSteelDesc: "30 Tage. Eine stabile Grundlage. Weiter so.",
medalBronzeDesc: "45 Tage. Es wird langsam zur Routine.",
medalSilverDesc: "Drei Monate. Gewohnheiten werden Teil deines Tages.",
medalGoldDesc: "Ein halbes Jahr. Starke Disziplin.",
medalDiamondDesc: "Ein ganzes Jahr. Das ist ein Lebensstil.",
  deleteAccountTitle: "Konto löschen?",
  deleteAccountText: "Diese Aktion kann nicht rückgängig gemacht werden. Das Konto wird gelöscht.",
  enterPassword: "Passwort eingeben",
  cancel: "Abbrechen",
  deleteAccountAction: "Konto löschen",
  deletingAccount: "Konto wird gelöscht…",
  changePassword: "Passwort ändern",
  close: "Zu",
  passwordResetInfo: "Wir senden dir eine E-Mail mit einem Link zum Ändern des Passworts.",
  email: "E-Mail",
  sendLink: "Link senden",
  sending: "Wird gesendet…",
  changeUsername: "Benutzernamen ändern",
  newUsername: "Neuer Benutzername",
  saveChange: "Änderung speichern",
  saving: "Speichern…",
  account: "Konto",
  darkMode: "Dunkler Modus",
  shareAchievements: "Erfolge mit Freunden teilen",
  language: "Sprache",
  premium: "Premium",
  managePremium: "Premium verwalten",
  logout: "Abmelden",
  deleteAccount: "Konto löschen",
  info: "Informationen und Verlauf",
  sendQuestion: "Support kontaktieren",
  querySubject: "Support kontaktieren",
  streaksMedals: "Serien & Medaillen",
  freePremium: "Free & Premium",
  privacy: "Datenschutz",
  terms: "Nutzungsbedingungen",
  limitsBenefits: "Limits & Vorteile",
  streaksRewards: "Serien & Belohnungen",
history: "Herausforderungsverlauf",
  historySubtitle: "Übersicht über Erfüllung und Serien",
  flames: "Flammen",
  medals: "Medaillen",
  premiumBuy: "Premium kaufen",
  premiumCancel: "Abo kündigen",
  open: "Öffnen",
  subject: "Betreff",
  message: "Nachricht",
  send: "Senden",
  friends: "Freunde",
  requests: "Anfragen",
  challenges: "Herausforderungen",
  addFriend: "Freund hinzufügen",
  addByUsername: "Per Benutzername hinzufügen",
  addByUsernameHelp: "Gib den Benutzernamen der Person ein, die du hinzufügen möchtest.",
  add: "Hinzufügen",
  myFriends: "Meine Freunde",
  addShort: "+ Hinzufügen",
  invite: "Einladen",
  remove: "Entfernen",
  accept: "Annehmen",
  decline: "Ablehnen",
  sentRequests: "Gesendete Anfragen",
  incomingRequests: "Eingehende Anfragen",
  blocked: "Blockiert",
  loadingFriends: "Freunde werden geladen...",
  noFriendsYet: "Noch keine Freunde.",
  loadingChallenges: "Challenges werden geladen...",
  noRequests: "Du hast noch keine Anfragen.",
  noPendingChallenges: "Du hast momentan keine offenen gemeinsamen Herausforderungen.",
  from: "Von",
  participants: "Teilnehmer",
  target: "Ziel",
  daily: "täglich",
  every2: "jeden zweiten Tag",
  selectedDays: "an ausgewählten Tagen",
  newSharedChallenge: "Neue gemeinsame Herausforderung",
  sharedChallenge: "Gemeinsame Herausforderung",
  selectUpToFriends: "Wähle bis zu {count} Freunde für eine Herausforderung.",
  friendsLabel: "Freunde",
  challengeName: "Name der Herausforderung",
  challengeNamePlaceholder: "Z. B. Liegestütze",
  countPerDay: "Anzahl pro Tag",
  period: "Zeitraum",
  dailyCap: "Täglich",
  every2Cap: "Jeden zweiten Tag",
  customDays: "Eigene Tage",
  chooseDays: "Tage auswählen",
  submit: "Senden",
  friendProfile: "Freundesprofil",
  loadingStats: "Statistiken werden geladen...",
  userNotSharing: "Dieser Nutzer teilt seine Erfolge nicht.",
  statsUnavailable: "Statistiken sind nicht verfügbar.",
  longestStreak: "🔥 Längste Serie",
  medalsCount: "🏅 Anzahl der Medaillen",
  highestMedal: "💎 Höchste Medaille",
  activeChallenges: "✅ Aktive Challenges",
    ok: "OK",
  supportReplyEmail: "E-Mail für Antwort",
  supportPlaceholder: "deine@email.de",
  supportSubjectPlaceholder: "Z. B. Problem mit Benachrichtigungen",
  supportMessagePlaceholder: "Beschreibe bitte dein Anliegen…",
  freeVersion: "Kostenlose Basisversion",
  bestChoice: "BESTE WAHL",
  premiumForResults: "Für maximale Ergebnisse",
  getPremium: "Premium holen",
  securePayment: "Sichere Zahlung",
  cancelAnytime: "Jederzeit kündbar",
  supportDevelopment: "Du unterstützt die Entwicklung",
  free: "Free",
  oneMoreFree: "OneMore kostenlos. Premium ohne Limits.",
  premiumActiveShort: "Premium ist aktiv.",
  manageSubscription: "Abo verwalten",
  unlockMore: "Schalte mehr Herausforderungen, Erinnerungen, Freunde und gemeinsame Herausforderungen frei.",
  reminders: "Erinnerungen",
  historyChallenges: "Herausforderungen-Verlauf",
  sharedChallenges: "Gemeinsame Herausforderungen",
  activePremiumInfo: "Premium ist aktiv. Du kannst es jederzeit kündigen oder den Status wiederherstellen.",
  unlockPremiumInfo: "Schalte Premium frei und erhalte unbegrenzte Herausforderungen, Erinnerungen und Freunde.",
  priceInfo: "Der Preis erscheint nach dem Verbinden des Offerings in RevenueCat.",
  unlimitedRemindersNotif: "Unbegrenzte Erinnerungen / Benachrichtigungen",
  unlimitedFriendsLink: "Unbegrenzte Verbindungen mit Freunden",
  moreRewards: "Weitere Belohnungen und kleine Extras schrittweise",
  profileTitleFriends: "Freunde",
  profileTitleInfo: "Informationen",
  passwordPlaceholder: "Passwort",
  usernamePlaceholder: "Benutzername",
  noScalePremium: "Premium",
  noScaleFree: "Free",
  premiumFriendsOnly: "Gemeinsame Herausforderungen mit Freunden sind nur in Premium verfügbar.",
  freeFriendsLimit: "In der Free-Version kannst du nur 1 Freund haben. Für mehr brauchst du Premium.",
  medalNone: "Keine",
  medalPotato: "Kartoffel",
  medalSteel: "Stahl",
  medalBronze: "Bronze",
  medalSilver: "Silber",
  medalGold: "Gold",
  medalDiamond: "Diamant",
  cancelRequestFailed: "Abbrechen fehlgeschlagen.",
  declineFriendFailed: "Ablehnen fehlgeschlagen.",
  acceptFriendFailed: "Annehmen fehlgeschlagen.",
  removeFriendFailed: "Entfernen fehlgeschlagen.",
}

} as const;

export default function ProfileTabScreen() {
  const router = useRouter();
  const { open, t } = useLocalSearchParams<{ open?: string; t?: string }>();
  const insets = useSafeAreaInsets();
  const { UI, isDark, toggle } = useTheme();
  const { lang, setLang } = useI18n();
const profileLang =
  lang === "cs" || lang === "en" || lang === "pl" || lang === "de"
    ? lang
    : "en";

const p = PROFILE_STRINGS[profileLang];


  // ✅ Změna username
  const [usernameOpen, setUsernameOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [usernameBusy, setUsernameBusy] = useState(false);

  // ✅ Username pro header (bere se z profilu ve Firestore)
  const [myUsername, setMyUsername] = useState(
    (auth.currentUser?.displayName ?? "").trim()
  );

  // ✅ Premium sjednocené s OneMore
  const [premium, setPremium] = useState(false);
  const [premiumBusy, setPremiumBusy] = useState(false);

  // ✅ Modaly – všechno schované
  const [accountOpen, setAccountOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [addFriendOpen, setAddFriendOpen] = useState(false);

  // ✅ Přátelé (Firestore)
  const [friendEdges, setFriendEdges] = useState<FriendEdge[]>([]);
  const [friendNames, setFriendNames] = useState<Record<string, string>>({});
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [addUsername, setAddUsername] = useState("");
  const [friendsBusy, setFriendsBusy] = useState(false);

// ✅ Přátelé modal – Přátelé / Výzvy
const [friendsTab, setFriendsTab] = useState<FriendsTab>("friends");
const [sharedInvites, setSharedInvites] = useState<SharedChallenge[]>([]);
const [sentSharedInvites, setSentSharedInvites] = useState<SharedChallenge[]>([]);
const [sharedChallenges, setSharedChallenges] = useState<SharedChallenge[]>([]);
const [sharedInvitesLoading, setSharedInvitesLoading] = useState(false);

const [shareAchievementsWithFriends, setShareAchievementsWithFriends] = useState(true);

  const [friendStatsOpen, setFriendStatsOpen] = useState(false);
  const [selectedFriendName, setSelectedFriendName] = useState("");
  const [selectedFriendLoading, setSelectedFriendLoading] = useState(false);
  const [selectedFriendShares, setSelectedFriendShares] = useState(true);
  const [selectedFriendStats, setSelectedFriendStats] = useState<FriendPreviewStats | null>(null);

  // ✅ delete účet modal (oranžové okno)
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteWorking, setDeleteWorking] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");

  // ✅ Info vnitřní navigace (menu jen ikonky)
  const [infoScreen, setInfoScreen] = useState<InfoScreen>("menu");

  // ✅ Podpora form (v Informace)
  const [supportEmail, setSupportEmail] = useState(
    (auth.currentUser?.email ?? "").trim()
  );
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportSending, setSupportSending] = useState(false);

  // ✅ Shared challenge modal
  const [challengeInviteOpen, setChallengeInviteOpen] = useState(false);
  const [challengeInviteFriendUids, setChallengeInviteFriendUids] = useState<string[]>([]);
  const [challengeInviteTitle, setChallengeInviteTitle] = useState("");
  const [challengeInviteTarget, setChallengeInviteTarget] = useState(1);
  const [challengeInvitePeriod, setChallengeInvitePeriod] = useState<"daily" | "every2" | "custom">("daily");
  const [challengeInviteCustomDays, setChallengeInviteCustomDays] = useState<number[]>([]);
  const [challengeInviteBusy, setChallengeInviteBusy] = useState(false);

  // ✅ změna hesla (v Účet)
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdEmail, setPwdEmail] = useState(
    (auth.currentUser?.email ?? "").trim()
  );
  const [pwdSending, setPwdSending] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSent, setPwdSent] = useState(false);

  // ✅ popup pro výsledek změny hesla (oranžové vyskakovací okno)
  const [pwdPopupOpen, setPwdPopupOpen] = useState(false);
  const [pwdPopupTitle, setPwdPopupTitle] = useState("");
  const [pwdPopupText, setPwdPopupText] = useState("");
  const [pwdPopupKind, setPwdPopupKind] = useState<"success" | "error">(
    "success"
  );

  const showPwdPopup = (
    kind: "success" | "error",
    title: string,
    text: string
  ) => {
    setPwdPopupKind(kind);
    setPwdPopupTitle(title);
    setPwdPopupText(text);
    setPwdPopupOpen(true);
  };


  // --- EFFECTS ---

  useEffect(() => {
    let mounted = true;
    isPremiumActive().then((p) => mounted && setPremium(!!p));
    const unsub = subscribePremium((p) => mounted && setPremium(!!p));
    return () => {
      mounted = false;
      unsub?.();
    };
  }, []);

  // ✅ Načíst můj username do headeru (z profilu)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try {
        const p = await getProfile(uid);
        if (!cancelled) setMyUsername((p?.username ?? "").trim());
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.currentUser?.uid]);

    useEffect(() => {
    let cancelled = false;

    (async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      try {
        const snap = await getDoc(doc(db, "users", uid));
        const share = snap.exists()
          ? snap.data()?.profile?.shareAchievementsWithFriends
          : undefined;

        if (!cancelled) {
          setShareAchievementsWithFriends(share !== false);
        }
      } catch {
        if (!cancelled) {
          setShareAchievementsWithFriends(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.currentUser?.uid]);

  // ✅ Přátelé: live list z Firestore + rovnou jména bez preblikávání
  useEffect(() => {
    
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setFriendEdges([]);
      setFriendNames({});
      setFriendsLoading(false);
      return;
    }

    let cancelled = false;
    setFriendsLoading(true);

    const unsub = subscribeFriends(async (edges) => {
      if (cancelled) return;

      const uids = [...new Set(edges.map((e) => e.otherUid))];
    const nextNames: Record<string, string> = {};

await Promise.all(
  uids.map(async (otherUid) => {
    try {
      const p = await getProfile(otherUid);
      console.log("PROFILE CHECK", otherUid, p);

      const shownName =
        typeof p?.username === "string" && p.username.trim()
          ? p.username.trim()
          : "";

      if (shownName) {
        nextNames[otherUid] = shownName;
      }
    } catch (e) {
      console.log("PROFILE CHECK ERROR", otherUid, e);
    }
  })
);

      if (cancelled) return;

      console.log("FRIEND NAMES MAP", nextNames);
      setFriendNames((prev) => ({
        ...prev,
        ...nextNames,
      }));
      setFriendEdges(edges);
      setFriendsLoading(false);
    });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [friendsOpen]);
  
    // ✅ Nepřijaté společné výzvy pro mě
  useEffect(() => {
   
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setSharedInvites([]);
      setSharedInvitesLoading(false);
      return;
    }

    let cancelled = false;
    setSharedInvitesLoading(true);

    const unsub = subscribeSharedChallenges(
      async (items) => {
        if (cancelled) return;

        setSharedChallenges(items);
    
        const incomingPending = items.filter((item) => {
          const isPending = item.status === "pending";
          const iAmMember = item.memberUids.includes(uid);
          const iAlreadyAccepted = item.acceptedBy.includes(uid);
          const createdByMe = String(item.createdBy) === String(uid);

          return isPending && iAmMember && !iAlreadyAccepted && !createdByMe;
        });

        const outgoingPending = items.filter((item) => {
  const isPending = item.status === "pending";
  const createdByMe = String(item.createdBy) === String(uid);

  return isPending && createdByMe;
});

        const extraUids = Array.from(
          new Set(
            incomingPending.flatMap((item) => item.memberUids)
          )
        ).filter(Boolean);

    const nextNames: Record<string, string> = {};

await Promise.all(
  extraUids.map(async (otherUid) => {
    try {
      const p = await getProfile(otherUid);
      const shownName =
        typeof p?.username === "string" && p.username.trim()
          ? p.username.trim()
          : "";

      if (shownName) {
        nextNames[otherUid] = shownName;
      }
    } catch {}
  })
);

        if (cancelled) return;

        setFriendNames((prev) => ({
          ...prev,
          ...nextNames,
        }));

        setSharedInvites(incomingPending);
        setSentSharedInvites(outgoingPending);
        setSharedInvitesLoading(false);
      },
      () => {
        if (cancelled) return;
        setSharedInvites([]);
        setSharedInvitesLoading(false);
      }
    );

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [friendsOpen]);

  const email = (auth.currentUser?.email ?? "").trim();

 const getShownFriendName = (uid: string) => {
  const v = friendNames[uid];
  if (typeof v === "string" && v.trim()) return v.trim();
  return p.loadingFriends;
};

const pendingInviteCount = sharedInvites.length + sentSharedInvites.length;

const myUid = auth.currentUser?.uid ?? "";

const sharedChallengeLimitCount = sharedChallenges.filter((item) => {
  const isMine = item.memberUids.includes(myUid);
  const notLeft = !(item.leftBy ?? []).includes(myUid);
  const enabled = item.enabled !== false;

  const blocksFreeLimit =
    item.status === "active" || item.status === "pending";

  return isMine && notLeft && enabled && blocksFreeLimit;
}).length;

const freeSharedLimitReached =
  !premium && sharedChallengeLimitCount >= 1;

  

const me = auth.currentUser?.uid ?? "";

const pendingFriendRequestCount = friendEdges.filter(
  (e) =>
    e.status === "pending" &&
    String(e.initiatedBy) !== String(me)
).length;

const getInviteCreatorName = (challenge: SharedChallenge) => {
  const creatorUid = String(challenge.createdBy ?? "");
  const v = friendNames[creatorUid];
  if (typeof v === "string" && v.trim()) return v.trim();
  return p.friends;
};

  const medalLabel = (tier: FriendPreviewStats["highestMedal"]) => {
    switch (tier) {
      case "brambora":
        return p.medalPotato;
      case "steel":
        return p.medalSteel;
      case "bronze":
        return p.medalBronze;
      case "silver":
        return p.medalSilver;
      case "gold":
        return p.medalGold;
      case "diamond":
        return p.medalDiamond;
      default:
        return p.medalNone;
    }
  };

  async function openFriendStats(friendUid: string) {
    try {
      setSelectedFriendLoading(true);
      setFriendStatsOpen(true);
      setSelectedFriendName(getShownFriendName(friendUid));
      setSelectedFriendStats(null);
      setSelectedFriendShares(true);

      const snap = await getDoc(doc(db, "users", String(friendUid)));

      if (!snap.exists()) {
        setSelectedFriendShares(false);
        return;
      }

      const profile = snap.data()?.profile ?? {};
      const share = profile?.shareAchievementsWithFriends !== false;
      const stats = profile?.friendStats ?? null;

      setSelectedFriendShares(share);

      if (!share || !stats) {
        setSelectedFriendStats(null);
        return;
      }

      setSelectedFriendStats({
        bestStreak: Number(stats?.bestStreak ?? 0) || 0,
        totalMedals: Number(stats?.totalMedals ?? 0) || 0,
        highestMedal: (stats?.highestMedal ?? "none") as FriendPreviewStats["highestMedal"],
        activeChallenges: Number(stats?.activeChallenges ?? 0) || 0,
      });
    } catch {
      setSelectedFriendShares(false);
      setSelectedFriendStats(null);
    } finally {
      setSelectedFriendLoading(false);
    }
  }

  const getInviteMembersLabel = (challenge: SharedChallenge) => {
    const me = auth.currentUser?.uid ?? "";
    const others = challenge.memberUids.filter((uid) => String(uid) !== String(me));

    const names = others.map((uid) => {
      const v = friendNames[String(uid)];
      if (typeof v === "string" && v.trim()) return v.trim();
      return lang === "cs" ? "Načítám..." : "Loading...";
    });

    if (!names.length) return p.sharedChallenge;
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]}, ${names[1]}`;
    return `${names[0]}, ${names[1]} +${names.length - 2}`;
  };

async function acceptSharedInviteFromFriends(challengeId: string) {
  const blockingCountExceptThis = sharedChallenges.filter((item) => {
    const isSameChallenge = String(item.id) === String(challengeId);
    const isMine = item.memberUids.includes(myUid);
    const notLeft = !(item.leftBy ?? []).includes(myUid);
    const enabled = item.enabled !== false;
    const blocksFreeLimit =
      item.status === "active" || item.status === "pending";

    return !isSameChallenge && isMine && notLeft && enabled && blocksFreeLimit;
  }).length;

  if (!premium && blockingCountExceptThis >= 1) {
    Alert.alert(
      p.premium,
      lang === "cs"
        ? "Ve Free verzi můžeš mít jen 1 společnou výzvu. Pro více je potřeba Premium."
        : "In the Free version you can have only 1 shared challenge. Upgrade to Premium for more."
    );
    return;
  }

  try {
    setFriendsBusy(true);
    await acceptSharedChallenge(challengeId);
    showPwdPopup(
      "success",
      p.challenges,
      lang === "cs" ? "Výzva byla přijata." : "Challenge was accepted."
    );
  } catch (e: any) {
    showPwdPopup(
      "error",
      p.challenges,
      e?.message ??
        (lang === "cs"
          ? "Nepodařilo se přijmout výzvu."
          : "Could not accept the challenge.")
    );
  } finally {
    setFriendsBusy(false);
  }
}

async function declineSharedInviteFromFriends(challengeId: string) {
  try {
    setFriendsBusy(true);
    await declineSharedChallenge(challengeId);
    showPwdPopup("success", p.challenges, lang === "cs" ? "Výzva byla odmítnuta." : "Challenge was declined.");
  } catch (e: any) {
    showPwdPopup(
      "error",
      p.challenges,
      e?.message ?? (lang === "cs" ? "Nepodařilo se odmítnout výzvu." : "Could not decline the challenge.")
    );
  } finally {
    setFriendsBusy(false);
  }
}

  const styles = useMemo(() => makeStyles(UI), [UI]);
const noScaleText = {
  allowFontScaling: false as const,
  maxFontSizeMultiplier: 1,
};
  // ✅ víc oranžové pozadí v light režimu
  const gradientColors = isDark
    ? [UI.bg, UI.bg]
    : [UI.accent, UI.bg, UI.bg, UI.accent];

  const gradientLocations = isDark ? [0, 1] : [0, 0.3, 0.7, 1];

  const openPayments = () => {
    // otevře paywall uvnitř Info modalu
    setInfoScreen("paywall");
    setInfoOpen(true);
  };

  // ✅ umožní otevřít paywall přímo z jiné záložky (např. OneMore → Premium)
  useEffect(() => {
    if (open === "paywall") {
      openPayments();
      // clear params so re-opening works reliably
      try {
        router.setParams({ open: undefined, t: undefined } as any);
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, t]);

  const buyPremium = async () => {
    if (premiumBusy) return;
    setPremiumBusy(true);
    try {
      const pkgs = await getOfferingPackages();
      if (!pkgs.length) {
        Alert.alert(
          p.premium,
          lang === "cs"
            ? "Balíčky Premium nejsou dostupné. (V Test Store se ujisti, že máš nastavené Offering/Package v RevenueCat.)"
            : "Premium packages are not available. (In Test Store, make sure your Offering/Package is configured in RevenueCat.)"
        );
        return;
      }
      await purchasePackage(pkgs[0]);
      Alert.alert(p.premium, lang === "cs" ? "Premium aktivováno." : "Premium activated.");
    } catch {
      Alert.alert(p.premium, lang === "cs" ? "Nepodařilo se aktivovat Premium." : "Could not activate Premium.");
    } finally {
      setPremiumBusy(false);
    }
  };

  const cancelPremiumNow = async () => {
    if (premiumBusy) return;
    Alert.alert(
      lang === "cs" ? "Zrušit Premium" : "Cancel Premium",
      lang === "cs" ? "Zrušení předplatného se provádí ve Store (Google Play / App Store). Chceš otevřít správu předplatného?" : "Subscription cancellation is handled in the Store (Google Play / App Store). Do you want to open subscription management?",
      [
        { text: lang === "cs" ? "Ne" : "No", style: "cancel" },
        {
          text: p.open,
          style: "default",
          onPress: async () => {
            setPremiumBusy(true);
            try {
              await openCancelSubscription();
            } catch {
              Alert.alert(
                p.premium,
                lang === "cs" ? "Nepodařilo se otevřít správu předplatného." : "Could not open subscription management."
              );
            } finally {
              setPremiumBusy(false);
            }
          },
        },
      ]
    );
  };

  const restorePremiumNow = async () => {
    if (premiumBusy) return;
    setPremiumBusy(true);
    try {
      await restorePurchases();
      // stav se propíše přes subscribePremium listener
      const v = await isPremiumActive();
      Alert.alert(p.premium, v ? (lang === "cs" ? "Premium je aktivní." : "Premium is active.") : (lang === "cs" ? "Premium není aktivní." : "Premium is not active."));
    } catch {
      Alert.alert(p.premium, lang === "cs" ? "Nepodařilo se obnovit stav Premium." : "Could not restore Premium status.");
    } finally {
      setPremiumBusy(false);
    }
  };

  const requestDeleteAccount = () => {
    setDeletePassword("");
    setDeleteOpen(true);
  };

  // ✅ REÁLNÉ smazání účtu (Firestore + usernames + Firebase Auth)
  const performDeleteAccount = async () => {
    if (deleteWorking) return;

    const user = auth.currentUser;
    if (!user || !user.email) {
      showPwdPopup("error", lang === "cs" ? "Nelze smazat účet" : "Cannot delete account", lang === "cs" ? "Nejsi přihlášený." : "You are not signed in.");
      setDeleteOpen(false);
      return;
    }

    const pwd = deletePassword.trim();
    if (!pwd) {
      showPwdPopup(
        "error",
        lang === "cs" ? "Chybí heslo" : "Missing password",
        lang === "cs" ? "Pro smazání účtu zadej heslo (kvůli bezpečnosti Firebase)." : "Enter your password to delete the account (required by Firebase security)."
      );
      return;
    }

    setDeleteWorking(true);
    try {
      // 1) reauth (řeší “musím mazat 2×”)
      const cred = EmailAuthProvider.credential(user.email, pwd);
      await reauthenticateWithCredential(user, cred);

      // 2) najdi usernameLower z users/{uid}.profile
      const uid = user.uid;
      let usernameLower: string | null = null;
      try {
        const snap = await getDoc(doc(db, "users", uid));
        const u = snap.exists() ? snap.data()?.profile?.usernameLower : null;
        if (typeof u === "string" && u.trim()) usernameLower = u.trim();
      } catch {}

      // 3) smaž registry username (uvolnění jména)
      if (usernameLower) {
        try {
          await deleteDoc(doc(db, "usernames", usernameLower));
        } catch (e) {
          console.log("delete username doc failed", e);
        }
      }

      // 4) smaž user dokument
      try {
        await deleteDoc(doc(db, "users", uid));
      } catch (e) {
        console.log("delete user doc failed", e);
      }

      // 5) (volitelně) smaž další cloud data, pokud máš
      try {
        await deleteCloudUserDoc(uid);
      } catch {
        // ignore
      }

      // 6) smaž Auth účet (teď už nepůjde přihlásit)
      await deleteUser(user);

      // 7) uklid lokální data
      await clearOneMoreStorage();

      // zavřeme modaly + přesměrujeme
      setDeleteOpen(false);
      setAccountOpen(false);
      router.replace("/login");
    } catch (err: any) {
      const code = String(err?.code ?? "");
      console.log("performDeleteAccount error", code, err);

      if (code.includes("auth/wrong-password")) {
        showPwdPopup(
          "error",
          lang === "cs" ? "Špatné heslo" : "Wrong password",
          lang === "cs" ? "Zadal jsi špatné heslo. Zkus to znovu." : "You entered the wrong password. Try again."
        );
        return;
      }

      if (code.includes("auth/requires-recent-login")) {
        setDeleteOpen(false);
        showPwdPopup(
          "error",
          lang === "cs" ? "Vyžadováno znovu přihlášení" : "Re-login required",
          lang === "cs" ? "Z bezpečnostních důvodů se musíš znovu přihlásit a pak smazání zopakovat. Odhlásím tě teď." : "For security reasons, you need to sign in again and then repeat the deletion. I will sign you out now."
        );
        try {
          await revenueCatLogout();
          await signOut(auth);
        } finally {
          await clearOneMoreStorage();
          router.replace("/login");
        }
        return;
      }

      setDeleteOpen(false);
      showPwdPopup(
        "error",
        lang === "cs" ? "Smazání se nepovedlo" : "Deletion failed",
        lang === "cs" ? "Nepodařilo se smazat účet. Zkus to prosím znovu." : "Could not delete the account. Please try again."
      );
    } finally {
      setDeleteWorking(false);
    }
  };

  const openPrivacyLink = async () => {
    const url = PRIVACY_URL;
    const ok = await Linking.canOpenURL(url);
    if (!ok) {
      Alert.alert(lang === "cs" ? "Odkaz" : "Link", lang === "cs" ? "Nepodařilo se otevřít Ochranu soukromí." : "Could not open the privacy policy.");
      return;
    }
    await Linking.openURL(url);
  };

  const openTermsLink = async () => {
    const url = TERMS_URL;
    const ok = await Linking.canOpenURL(url);
    if (!ok) {
      Alert.alert(lang === "cs" ? "Odkaz" : "Link", lang === "cs" ? "Nepodařilo se otevřít Podmínky používání." : "Could not open the terms of use.");
      return;
    }
    await Linking.openURL(url);
  };

  const sendSupport = async () => {
    const e = supportEmail.trim();
    const s = supportSubject.trim();
    const m = supportMessage.trim();

    if (!e || !s || !m) {
      showPwdPopup("error", lang === "cs" ? "Podpora" : "Support", lang === "cs" ? "Vyplň prosím e-mail, předmět i zprávu." : "Please fill in email, subject, and message." );
      return;
    }

    if (!auth.currentUser) {
      showPwdPopup("error", lang === "cs" ? "Podpora" : "Support", lang === "cs" ? "Musíš být přihlášený/á." : "You must be signed in.");
      return;
    }

    setSupportSending(true);
    try {
      const call = httpsCallable(functions, "sendSupportEmail");
      await call({ email: e, subject: s, message: m });

      setSupportSubject("");
      setSupportMessage("");

      // ✅ místo bílého Alert.alert použijeme tvůj oranžový popup
      showPwdPopup("success", lang === "cs" ? "Odesláno" : "Sent", lang === "cs" ? "Díky! Zpráva byla odeslána na podporu." : "Thanks! Your message was sent to support.");

      setInfoScreen("menu");
    } catch (err: any) {
      const code = String(err?.code ?? "");
      const msg0 = String(err?.message ?? "");

      let msg = lang === "cs" ? "Nepodařilo se odeslat zprávu. Zkus to prosím znovu." : "Could not send the message. Please try again.";
      if (code.includes("unauthenticated")) msg = lang === "cs" ? "Musíš být přihlášený/á." : "You must be signed in.";
      else if (code.includes("permission-denied"))
        msg = lang === "cs" ? "Nemáš oprávnění odeslat zprávu." : "You do not have permission to send the message.";
      else if (code.includes("invalid-argument"))
        msg = lang === "cs" ? "Zkontroluj prosím vyplněné údaje." : "Please check the entered details.";
      else if (msg0) msg = msg0;

      showPwdPopup("error", lang === "cs" ? "Chyba" : "Error", msg);
    } finally {
      setSupportSending(false);
    }
  };

  const requestPasswordReset = async () => {
    const e = pwdEmail.trim();
    if (!e) {
      setPwdError(lang === "cs" ? "Zadej prosím e-mail." : "Please enter your email.");
      showPwdPopup("error", lang === "cs" ? "Chybí e-mail" : "Missing email", lang === "cs" ? "Zadej prosím e-mail a zkus to znovu." : "Please enter your email and try again.");
      return;
    }

    setPwdError(null);
    setPwdSent(false);
    setPwdSending(true);
    try {
      await sendPasswordResetEmail(auth, e);
      setPwdSent(true);
      showPwdPopup(
        "success",
        lang === "cs" ? "Hotovo" : "Done",
        lang === "cs" ? "Poslali jsme ti e-mail s odkazem na změnu hesla. Zkontroluj i spam." : "We sent you an email with a password reset link. Check spam too."
      );
    } catch (err: any) {
      const code = String(err?.code ?? "");
      let msg = lang === "cs" ? "Nepodařilo se odeslat e-mail. Zkus to prosím znovu." : "Could not send the email. Please try again.";

      if (code.includes("auth/invalid-email"))
        msg = lang === "cs" ? "E-mail není ve správném formátu." : "The email format is invalid.";
      else if (code.includes("auth/user-not-found"))
        msg = lang === "cs" ? "Pro tento e-mail neexistuje účet." : "There is no account for this email.";
      else if (code.includes("auth/too-many-requests"))
        msg = lang === "cs" ? "Příliš mnoho pokusů. Zkus to prosím později." : "Too many attempts. Please try again later.";

      setPwdError(msg);
      showPwdPopup("error", lang === "cs" ? "Nepodařilo se odeslat" : "Could not send", msg);
    } finally {
      setPwdSending(false);
    }
  };

  const closeInfo = () => {
    setInfoOpen(false);
    setInfoScreen("menu");
  };

  function resetChallengeInviteForm() {
    setChallengeInviteFriendUids([]);
    setChallengeInviteTitle("");
    setChallengeInviteTarget(1);
    setChallengeInvitePeriod("daily");
    setChallengeInviteCustomDays([]);
    setChallengeInviteBusy(false);
  }

function openChallengeInvite(friendUid: string) {
    if (freeSharedLimitReached) {
    Alert.alert(
      p.premium,
      lang === "cs"
        ? "Ve Free verzi můžeš mít jen 1 společnou výzvu. Pro více je potřeba Premium."
        : "In the Free version you can have only 1 shared challenge. Upgrade to Premium for more."
    );
    return;
  }

    setChallengeInviteFriendUids([String(friendUid)]);
    setChallengeInviteTitle("");
    setChallengeInviteTarget(1);
    setChallengeInvitePeriod("daily");
    setChallengeInviteCustomDays([]);
    setChallengeInviteOpen(true);
  }

  function closeChallengeInvite() {
    if (challengeInviteBusy) return;
    setChallengeInviteOpen(false);
    resetChallengeInviteForm();
  }

  async function submitChallengeInvite() {
    try {
 
      const friendUids = Array.from(
        new Set(
          (challengeInviteFriendUids ?? [])
            .map((x) => String(x ?? "").trim())
            .filter(Boolean)
        )
      ).slice(0, MAX_SHARED_MEMBERS - 1);

      const title = challengeInviteTitle.trim();

      if (!friendUids.length) {
        showPwdPopup("error", p.sharedChallenge, lang === "cs" ? "Vyber aspoň jednoho přítele." : "Select at least one friend.");
        return;
      }

      if (!title) {
        showPwdPopup("error", p.sharedChallenge, lang === "cs" ? "Zadej název výzvy." : "Enter a challenge name.");
        return;
      }

      if (challengeInvitePeriod === "custom" && challengeInviteCustomDays.length === 0) {
        showPwdPopup("error", p.sharedChallenge, lang === "cs" ? "Vyber aspoň jeden den." : "Select at least one day.");
        return;
      }

      setChallengeInviteBusy(true);

      await createSharedChallenge({
        title,
        friendUids,
        targetPerDay: challengeInviteTarget,
        period: challengeInvitePeriod,
        customDays:
          challengeInvitePeriod === "custom"
            ? [...challengeInviteCustomDays].sort((a, b) => a - b)
            : [],
        periodAnchor:
          challengeInvitePeriod === "every2"
            ? new Date().toISOString().slice(0, 10)
            : null,
      });

      setChallengeInviteOpen(false);
      resetChallengeInviteForm();

      showPwdPopup(
        "success",
        p.sharedChallenge,
        lang === "cs" ? `Výzva byla vytvořena pro ${friendUids.length} ${friendUids.length === 1 ? "přítele" : friendUids.length >= 2 && friendUids.length <= 4 ? "přátele" : "přátel"}.` : `Challenge was created for ${friendUids.length} ${friendUids.length === 1 ? "friend" : "friends"}.`
      );
    } catch (e: any) {
      showPwdPopup(
        "error",
        p.sharedChallenge,
        e?.message ?? (lang === "cs" ? "Nepodařilo se vytvořit společnou výzvu." : "Could not create the shared challenge.")
      );
    } finally {
      setChallengeInviteBusy(false);
    }
  }

  const infoTitle = useMemo(() => {
    switch (infoScreen) {
      case "menu":
        return p.info;
      case "support":
        return p.sendQuestion;
      case "streak_medals":
        return p.streaksMedals;
      case "freeprem":
        return p.freePremium;
      case "paywall":
        return p.premium;
      case "privacy":
        return p.privacy;
      case "terms":
        return p.terms;
      default:
        return p.info;
    }
  }, [infoScreen]);

const incomingCount = friendEdges.filter(
  (e) =>
    e.status === "pending" &&
    String(e.initiatedBy) !== String(myUid)
).length;

  return (
    <View style={[styles.screen, { backgroundColor: UI.bg }]}>
      <LinearGradient
        colors={gradientColors as any}
        locations={gradientLocations as any}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.gradient}
      />

      {/* ✅ MODAL – Odstranit účet */}
      <Modal
        visible={deleteOpen}
        transparent
        animationType="fade"
        onRequestClose={() => !deleteWorking && setDeleteOpen(false)}
      >
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: UI.backdrop }]}
          onPress={() => !deleteWorking && setDeleteOpen(false)}
        />
        <View style={styles.popupWrap}>
          <View
            style={[
              styles.popupCard,
              {
                backgroundColor: "#FFE0C2",
                borderColor: "#FF8A1F",
              },
            ]}
          >
            <View style={styles.popupHeader}>
              <Text style={styles.popupTitle}>{p.deleteAccountTitle}</Text>

              <Pressable
                onPress={() => !deleteWorking && setDeleteOpen(false)}
                hitSlop={10}
                style={({ pressed }) => [styles.popupX, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name="close" size={20} color={"#0B1220"} />
              </Pressable>
            </View>

            <Text style={styles.popupText}>
              {p.deleteAccountText}
            </Text>

            <Text style={[styles.smallLabel, { color: "#0B1220", marginTop: 10 }]}>
              {p.enterPassword}
            </Text>
            <TextInput
              value={deletePassword}
              onChangeText={setDeletePassword}
              placeholder={p.passwordPlaceholder}
              placeholderTextColor={"rgba(11,18,32,0.55)"}
              secureTextEntry
              autoCapitalize="none"
              style={[
                styles.input,
                {
                  color: "#0B1220",
                  borderColor: "rgba(255,138,31,0.55)",
                  backgroundColor: "#FFD3A8",
                },
              ]}
            />

            <Pressable
              disabled={deleteWorking}
              onPress={() => setDeleteOpen(false)}
              style={({ pressed }) => [
                styles.popupBtn,
                (pressed || deleteWorking) && { opacity: 0.9 },
                deleteWorking && { opacity: 0.6 },
              ]}
            >
              <Text style={styles.popupBtnText}>{p.cancel}</Text>
            </Pressable>

            <Pressable
              disabled={deleteWorking}
              onPress={performDeleteAccount}
              style={({ pressed }) => [
                styles.dangerBtn,
                { marginTop: 10 },
                (pressed || deleteWorking) && { opacity: 0.9 },
                deleteWorking && { opacity: 0.6 },
              ]}
            >
              <Text style={styles.dangerText}>
                {deleteWorking ? p.deletingAccount : p.deleteAccountAction}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ✅ MODAL – Změna hesla */}
      <Modal
        visible={pwdOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPwdOpen(false)}
      >
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: UI.backdrop }]}
          onPress={() => setPwdOpen(false)}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: isDark ? UI.sheetBg : "#FFE0C2",
              borderColor: isDark ? UI.sheetStroke : "#FF8A1F",
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: UI.text }]}>
              {p.changePassword}
            </Text>

            <Pressable
              onPress={() => setPwdOpen(false)}
              style={({ pressed }) => [
                styles.closeBtn,
                { borderColor: UI.stroke, backgroundColor: UI.card2 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.closeText, { color: UI.text }]}>{p.close}</Text>
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 10 }}
          >
            <Text style={[styles.infoText, { color: UI.sub }]}>
              {p.passwordResetInfo}
            </Text>

            <Text style={[styles.smallLabel, { color: UI.sub, marginTop: 10 }]}>
              E-mail
            </Text>
            <TextInput
              value={pwdEmail}
              onChangeText={setPwdEmail}
              placeholder={p.supportPlaceholder}
              placeholderTextColor={UI.sub}
              autoCapitalize="none"
              keyboardType="email-address"
              style={[
                styles.input,
                { color: UI.text, borderColor: UI.stroke, backgroundColor: UI.card },
              ]}
            />

            <Pressable
              disabled={pwdSending}
              onPress={requestPasswordReset}
              style={({ pressed }) => [
                styles.primaryBtn,
                (pressed || pwdSending) && { opacity: 0.9 },
                pwdSending && { opacity: 0.6 },
              ]}
            >
              <Text style={styles.primaryBtnText}>
                {pwdSending ? p.sending : p.sendLink}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* ✅ MODAL – Změna uživatelského jména */}
      <Modal
        visible={usernameOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setUsernameOpen(false)}
      >
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: UI.backdrop }]}
          onPress={() => !usernameBusy && setUsernameOpen(false)}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: isDark ? UI.sheetBg : "#FFE0C2",
              borderColor: isDark ? UI.sheetStroke : "#FF8A1F",
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: UI.text }]}>
              {p.changeUsername}
            </Text>

            <Pressable
              onPress={() => !usernameBusy && setUsernameOpen(false)}
              style={({ pressed }) => [
                styles.closeBtn,
                { borderColor: UI.stroke, backgroundColor: UI.card2 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.closeText, { color: UI.text }]}>{p.close}</Text>
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 10 }}
          >
            <Text style={[styles.smallLabel, { color: UI.sub, marginTop: 10 }]}>
              {p.newUsername}
            </Text>
            <TextInput
              value={newUsername}
              onChangeText={setNewUsername}
              placeholder=""
              placeholderTextColor={UI.sub}
              autoCapitalize="none"
              style={[
                styles.input,
                {
                  color: UI.text,
                  borderColor: UI.stroke,
                  backgroundColor: UI.card2,
                },
              ]}
            />

            <Pressable
              disabled={usernameBusy}
              onPress={async () => {
                try {
                  if (!auth.currentUser?.uid) return;

                  const v = newUsername.trim();
                  if (!v) {
                    showPwdPopup(
                      "error",
                      lang === "cs" ? "Změna username" : "Change username",
                      lang === "cs" ? "Zadej prosím nové uživatelské jméno." : "Please enter a new username."
                    );
                    return;
                  }

                  setUsernameBusy(true);
                  await changeUsername(auth.currentUser.uid, v);

                  try {
                    await updateProfile(auth.currentUser, { displayName: v });
                  } catch {}

                  try {
                    const p = await getProfile(auth.currentUser.uid);
                    setMyUsername((p?.username ?? v).trim());
                  } catch {
                    setMyUsername(v);
                  }

                  setUsernameOpen(false);
                  setNewUsername("");

                  showPwdPopup("success", lang === "cs" ? "Hotovo" : "Done", lang === "cs" ? "Uživatelské jméno bylo změněno." : "Username has been changed.");
                } catch (e: any) {
                  showPwdPopup(
                    "error",
                    lang === "cs" ? "Změna username" : "Change username",
                    e?.message ?? (lang === "cs" ? "Změna se nepovedla." : "Change failed.")
                  );
                } finally {
                  setUsernameBusy(false);
                }
              }}
              style={({ pressed }) => [
                styles.primaryBtn,
                (pressed || usernameBusy) && { opacity: 0.9 },
                usernameBusy && { opacity: 0.6 },
              ]}
            >
              <Text style={styles.primaryBtnText}>
                {usernameBusy ? p.saving : p.saveChange}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* ✅ MODAL – Účet */}
      <Modal
        visible={accountOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAccountOpen(false)}
      >
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: UI.backdrop }]}
          onPress={() => setAccountOpen(false)}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: isDark ? UI.sheetBg : "#FFE0C2",
              borderColor: isDark ? UI.sheetStroke : "#FF8A1F",
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: UI.text }]}>{p.account}</Text>

            <Pressable
              onPress={() => setAccountOpen(false)}
              style={({ pressed }) => [
                styles.closeBtn,
                { borderColor: UI.stroke, backgroundColor: UI.card2 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.closeText, { color: UI.text }]}>{p.close}</Text>
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 10 }}
          >
            <View
              style={[
                styles.modalRow,
                { borderColor: UI.stroke, backgroundColor: UI.card },
              ]}
            >
              <Text style={[styles.modalLabel, { color: UI.text }]}>
                {p.darkMode}
              </Text>
              <Switch value={isDark} onValueChange={toggle} />
            </View>

            <View
              style={[
                styles.modalRow,
                { borderColor: UI.stroke, backgroundColor: UI.card },
              ]}
            >
              <Text style={[styles.modalLabel, { color: UI.text, flex: 1 }]}>
                {p.shareAchievements}
              </Text>
              <Switch
                value={shareAchievementsWithFriends}
                onValueChange={async (v) => {
                  setShareAchievementsWithFriends(v);
                  try {
                    const uid = auth.currentUser?.uid;
                    if (!uid) return;

                    await updateDoc(doc(db, "users", uid), {
                      "profile.shareAchievementsWithFriends": v,
                    });
                  } catch {
                    setShareAchievementsWithFriends((prev) => !prev);
                    showPwdPopup("error", lang === "cs" ? "Soukromí" : "Privacy", lang === "cs" ? "Nepodařilo se uložit nastavení." : "Could not save settings.");
                  }
                }}
              />
            </View>

            <View
              style={[
                styles.modalRow,
                { borderColor: UI.stroke, backgroundColor: UI.card },
              ]}
            >
              <Text style={[styles.modalLabel, { color: UI.text }]}>{p.language}</Text>
              <View style={styles.langPills}>
  <Pressable
    onPress={() => setLang("cs")}
    style={({ pressed }) => [
      styles.langPill,
      { borderColor: UI.stroke, backgroundColor: UI.card2 },
      lang === "cs" && {
        backgroundColor: UI.accent,
        borderColor: UI.accent,
      },
      pressed && { opacity: 0.9 },
    ]}
  >
    <Text
      style={[
        styles.langPillText,
        { color: lang === "cs" ? "#0B1220" : UI.text },
      ]}
    >
      CZ
    </Text>
  </Pressable>

  <Pressable
    onPress={() => setLang("en")}
    style={({ pressed }) => [
      styles.langPill,
      { borderColor: UI.stroke, backgroundColor: UI.card2 },
      lang === "en" && {
        backgroundColor: UI.accent,
        borderColor: UI.accent,
      },
      pressed && { opacity: 0.9 },
    ]}
  >
    <Text
      style={[
        styles.langPillText,
        { color: lang === "en" ? "#0B1220" : UI.text },
      ]}
    >
      EN
    </Text>
  </Pressable>

  <Pressable
    onPress={() => setLang("pl")}
    style={({ pressed }) => [
      styles.langPill,
      { borderColor: UI.stroke, backgroundColor: UI.card2 },
      lang === "pl" && {
        backgroundColor: UI.accent,
        borderColor: UI.accent,
      },
      pressed && { opacity: 0.9 },
    ]}
  >
    <Text
      style={[
        styles.langPillText,
        { color: lang === "pl" ? "#0B1220" : UI.text },
      ]}
    >
      PL
    </Text>
  </Pressable>

  <Pressable
    onPress={() => setLang("de")}
    style={({ pressed }) => [
      styles.langPill,
      { borderColor: UI.stroke, backgroundColor: UI.card2 },
      lang === "de" && {
        backgroundColor: UI.accent,
        borderColor: UI.accent,
      },
      pressed && { opacity: 0.9 },
    ]}
  >
    <Text
      style={[
        styles.langPillText,
        { color: lang === "de" ? "#0B1220" : UI.text },
      ]}
    >
      DE
    </Text>
  </Pressable>
</View>
            </View>

            <Pressable
              onPress={() => setPwdOpen(true)}
              style={({ pressed }) => [
                styles.modalLinkRow,
                { borderColor: UI.stroke, backgroundColor: UI.card },
                pressed && { opacity: 0.88 },
              ]}
            >
              <Text style={[styles.modalLinkText, { color: UI.text }]}>
                {p.changePassword}
              </Text>
              <Text style={[styles.chevron, { color: UI.text }]}>›</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setNewUsername("");
                setUsernameOpen(true);
              }}
              style={({ pressed }) => [
                styles.modalLinkRow,
                { borderColor: UI.stroke, backgroundColor: UI.card },
                pressed && { opacity: 0.88 },
              ]}
            >
              <Text style={[styles.modalLinkText, { color: UI.text }]}>
                {p.changeUsername}
              </Text>
              <Text style={[styles.chevron, { color: UI.text }]}>›</Text>
            </Pressable>

            {!premium && (
              <Pressable
                onPress={openPayments}
                style={({ pressed }) => [
                  styles.modalLinkRow,
                  { borderColor: UI.stroke, backgroundColor: UI.card },
                  pressed && { opacity: 0.88 },
                ]}
              >
                <Text style={[styles.modalLinkText, { color: UI.text }]}>
                  Premium
                </Text>
                <Text style={[styles.chevron, { color: UI.text }]}>›</Text>
              </Pressable>
            )}

            {premium && (
              <Pressable
                onPress={openPayments}
                style={({ pressed }) => [
                  styles.modalLinkRow,
                  { borderColor: UI.stroke, backgroundColor: UI.card },
                  pressed && { opacity: 0.88 },
                ]}
              >
          <Text style={[styles.modalLinkText, { color: UI.text }]}>
  {p.managePremium}
</Text>
                <Text style={[styles.chevron, { color: UI.text }]}>›</Text>
              </Pressable>
            )}

            <Pressable
              onPress={async () => {
                try {
                  await signOut(auth);
                } finally {
                  await AsyncStorage.removeItem("onemore_saved_login");
                  router.replace("/login");
                }
              }}
              style={({ pressed }) => [styles.dangerBtn, pressed && { opacity: 0.9 }]}
            >
              <Text style={styles.dangerText}>{p.logout}</Text>
            </Pressable>

            <Pressable
              onPress={requestDeleteAccount}
              style={({ pressed }) => [styles.dangerOutline, pressed && { opacity: 0.92 }]}
            >
              <Text style={styles.dangerOutlineText}>{p.deleteAccount}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* ✅ MODAL – Informace */}
      <Modal
        visible={infoOpen}
        transparent
        animationType="fade"
        onRequestClose={closeInfo}
      >
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: UI.backdrop }]}
          onPress={closeInfo}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: isDark ? UI.sheetBg : "#FFF2E4",
              borderColor: isDark ? UI.sheetStroke : "#FF8A1F",
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
              {infoScreen !== "menu" && (
                <Pressable
                  onPress={() => setInfoScreen("menu")}
                  hitSlop={8}
                  style={({ pressed }) => [styles.iconBackBtn, pressed && { opacity: 0.85 }]}
                >
                  <Ionicons name="chevron-back" size={18} color={UI.text} />
                </Pressable>
              )}
              <Text style={[styles.sheetTitle, { color: UI.text }]} numberOfLines={1}>
                {infoTitle}
              </Text>
            </View>

            <Pressable
              onPress={closeInfo}
              style={({ pressed }) => [
                styles.closeBtn,
                { borderColor: UI.stroke, backgroundColor: UI.card2 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.closeText, { color: UI.text }]}>{p.close}</Text>
            </Pressable>
          </View>

          {infoScreen === "menu" ? (
            <View style={{ paddingBottom: 10 }}>
              <View style={{ marginBottom: 14 }}>
                <Text style={[styles.infoTitle, { color: UI.text, fontSize: 22 }]} />
                <Text style={[styles.infoText, { color: UI.sub }]} />
              </View>

              <View style={styles.iconGrid}>
                <Pressable
                  onPress={() => setInfoScreen("freeprem")}
                  style={({ pressed }) => [
                    styles.iconTile,
                    { borderColor: UI.stroke, backgroundColor: UI.card },
                    pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
                  ]}
                >
                  <View
                    style={[
                      styles.iconCircle,
                      {
                        backgroundColor: "rgba(255,138,31,0.18)",
                        borderColor: "rgba(255,138,31,0.35)",
                      },
                    ]}
                  >
                    <Ionicons name="sparkles" size={26} color={UI.accent} />
                  </View>
                  <Text style={[styles.iconTileText, { color: UI.text, fontSize: 16 }]}>
                    Free & Premium
                  </Text>
                  <Text style={{ color: UI.sub, fontWeight: "700", fontSize: 13 }}>
                    {p.limitsBenefits}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setInfoScreen("streak_medals")}
                  style={({ pressed }) => [
                    styles.iconTile,
                    { borderColor: UI.stroke, backgroundColor: UI.card },
                    pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
                  ]}
                >
                  <View
                    style={[
                      styles.iconCircle,
                      {
                        backgroundColor: "rgba(255,138,31,0.18)",
                        borderColor: "rgba(255,138,31,0.35)",
                      },
                    ]}
                  >
                    <Ionicons name="flame" size={26} color={UI.accent} />
                  </View>
                  <Text style={[styles.iconTileText, { color: UI.text, fontSize: 16 }]}>
                    {p.streaksMedals}
                  </Text>
                  <Text style={{ color: UI.sub, fontWeight: "700", fontSize: 13 }}>
                    {p.streaksRewards}
                  </Text>
                </Pressable>


                <Pressable
                  onPress={() => setInfoScreen("privacy")}
                  style={({ pressed }) => [
                    styles.iconTile,
                    { borderColor: UI.stroke, backgroundColor: UI.card },
                    pressed && { opacity: 0.9 },
                  ]}
                >
                  <View
                    style={[
                      styles.iconCircle,
                      { backgroundColor: UI.card2, borderColor: UI.stroke },
                    ]}
                  >
                    <Ionicons name="shield-checkmark" size={24} color={UI.accent} />
                  </View>
                  <Text style={[styles.iconTileText, { color: UI.text }]}>
                    {p.privacy}
                  </Text>
                </Pressable>

<Pressable
  onPress={() => {
    setInfoOpen(false);
    router.push("/history");
  }}
  style={({ pressed }) => [
    styles.iconTile,
    {
      borderColor: UI.stroke,
      backgroundColor: UI.card,
    },
    pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
  ]}
>
  <View
    style={[
      styles.iconCircle,
      {
        backgroundColor: "rgba(255,138,31,0.18)",
        borderColor: "rgba(255,138,31,0.35)",
      },
    ]}
  >
    <Ionicons name="time-outline" size={24} color={UI.accent} />
  </View>

  <Text style={[styles.iconTileText, { color: UI.text, fontSize: 16 }]}>
    {p.history}
  </Text>

  <Text
    style={{
      color: UI.sub,
      fontWeight: "700",
      fontSize: 13,
      textAlign: "center",
      lineHeight: 18,
    }}
  >
    {p.historySubtitle}
  </Text>
</Pressable>
                <Pressable
                  onPress={() => setInfoScreen("terms")}
                  style={({ pressed }) => [
                    styles.iconTile,
                    { borderColor: UI.stroke, backgroundColor: UI.card },
                    pressed && { opacity: 0.9 },
                  ]}
                >
                  <View
                    style={[
                      styles.iconCircle,
                      { backgroundColor: UI.card2, borderColor: UI.stroke },
                    ]}
                  >
                    <Ionicons name="document-text" size={24} color={UI.accent} />
                  </View>
                  <Text style={[styles.iconTileText, { color: UI.text }]}>
                    {p.terms}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setInfoScreen("support")}
                  style={({ pressed }) => [
                    styles.iconTile,
                    { borderColor: UI.stroke, backgroundColor: UI.card },
                    pressed && { opacity: 0.9 },
                  ]}
                >
                  <View
                    style={[
                      styles.iconCircle,
                      { backgroundColor: UI.card2, borderColor: UI.stroke },
                    ]}
                  >
                    <Ionicons name="mail" size={24} color={UI.accent} />
                  </View>
           <Text style={[styles.iconTileText, { color: UI.text }]}>
  {p.sendQuestion}
</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 12 }}
            >
              {infoScreen === "streak_medals" && (
                <View
                  style={[
                    styles.infoCard,
                    { borderColor: UI.stroke, backgroundColor: UI.card },
                  ]}
                >
                  <Text style={[styles.infoTitle, { color: UI.text }]}>{p.flames}</Text>
                  <Text style={[styles.infoText, { color: UI.sub }]}>
                    {p.streakFlamesInfo}
                  </Text>

                  <Text style={[styles.infoTitle, { color: UI.text, marginTop: 16 }]}>
                    Medaile
                  </Text>
                  <Text style={[styles.infoText, { color: UI.sub, marginTop: 6 }]}>
                    {lang === "cs" ? "Každá výzva si počítá medaile podle tvé nejdelší série:" : "Each challenge awards medals based on your longest streak:"}
                  </Text>

                  <View style={styles.medalsGrid}>
                    {[
                      {
                        key: "brambora",
                        days: 10,
                        title: lang === "cs" ? "Brambora" : "Potato",
                        desc: p.medalPotatoDesc,
                        img: require("../../assets/medals/potato_medal.png"),
                      },
                      {
                        key: "steel",
                        days: 30,
                        title: lang === "cs" ? "Ocel" : "Steel",
                       desc: p.medalSteelDesc,
                        img: require("../../assets/medals/steel_medal.png"),
                      },
                      {
                        key: "bronze",
                        days: 45,
                        title: lang === "cs" ? "Bronz" : "Bronze",
                       desc: p.medalBronzeDesc,
                        img: require("../../assets/medals/bronze_medal.png"),
                      },
                      {
                        key: "silver",
                        days: 90,
                        title: lang === "cs" ? "Stříbro" : "Silver",
                       desc: p.medalSilverDesc,
                        img: require("../../assets/medals/silver_medal.png"),
                      },
                      {
                        key: "gold",
                        days: 180,
                        title: lang === "cs" ? "Zlato" : "Gold",
                        desc: p.medalGoldDesc,
                        img: require("../../assets/medals/gold_medal.png"),
                      },
                      {
                        key: "diamond",
                        days: 365,
                        title: lang === "cs" ? "Diamant" : "Diamond",
                     desc: p.medalDiamondDesc,
                        img: require("../../assets/medals/diamond_medal.png"),
                      },
                    ].map((m) => (
                      <View
                        key={m.key}
                        style={[
                          styles.medalRow,
                          { borderColor: UI.stroke, backgroundColor: UI.card2 },
                        ]}
                      >
                        <View
                          style={[
                            styles.medalIconWrap,
                            { borderColor: UI.stroke, backgroundColor: UI.card },
                          ]}
                        >
                          <Image source={m.img} style={styles.medalIcon} />
                        </View>

                        <View style={{ flex: 1 }}>
                          <Text style={[styles.medalTitle, { color: UI.text }]}>
                            {lang === "cs" ? `${m.days} dní – ${m.title}` : `${m.days} days – ${m.title}`}
                          </Text>
                          <Text style={[styles.medalDesc, { color: UI.sub }]}>
                            {m.desc}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}

{infoScreen === "freeprem" && (
  <View
    style={[
      styles.infoCard,
      { borderColor: UI.stroke, backgroundColor: UI.card },
    ]}
  >
    <LinearGradient
      colors={
        isDark
          ? ["rgba(255,145,0,0.18)", "rgba(255,120,0,0.06)"]
          : ["#FFF1DD", "#FFE3B3"]
      }
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.pmHero,
        !isDark && {
          borderColor: "#F2C27A",
          shadowColor: "#000",
          shadowOpacity: 0.06,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 2,
        },
      ]}
    >
      <View
        style={[
          styles.pmHeroIcon,
          !isDark && {
            backgroundColor: "#FFE7BF",
          },
        ]}
      >
        <MaterialCommunityIcons name="crown" size={24} color="#D97706" />
      </View>

      <View style={{ flex: 1 }}>
        <Text
          {...noScaleText}
          style={[
            styles.pmHeroTitle,
            !isDark && { color: "#7A3E00" },
          ]}
        >
          {premium ? p.premiumActiveShort : p.oneMoreFree}
        </Text>

        <Text
          {...noScaleText}
          style={[
            styles.pmHeroText,
            !isDark && { color: "#8A5A1F" },
          ]}
        >
          {premium ? p.manageSubscription : p.unlockMore}
        </Text>
      </View>
    </LinearGradient>

    <View
      style={[
        styles.pmPlanCard,
        {
          backgroundColor: isDark ? UI.card2 : "#FAFAFA",
          borderColor: isDark ? UI.stroke : "#D9DDE5",
        },
        !isDark && {
          shadowColor: "#000",
          shadowOpacity: 0.05,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
          elevation: 1,
        },
      ]}
    >
      <View style={styles.pmPlanHeader}>
        <View
          style={[
            styles.pmPlanBadgeFree,
            !isDark && { backgroundColor: "#EEF2F7" },
          ]}
        >
          <Feather name="gift" size={18} color={isDark ? "#C7CEDD" : "#64748B"} />
        </View>

        <View style={{ flex: 1 }}>
          <Text
            {...noScaleText}
            style={[
              styles.pmPlanTitle,
              { color: UI.text },
              !isDark && { color: "#1E293B" },
            ]}
          >
            Free
          </Text>
          <Text
            {...noScaleText}
            style={[
              styles.pmPlanSubtitle,
              { color: UI.sub },
              !isDark && { color: "#64748B" },
            ]}
          >
            {p.freeVersion}
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.pmList,
          !isDark && { borderTopColor: "#E5E7EB" },
        ]}
      >
        <View
          style={[
            styles.pmListRow,
            !isDark && { borderBottomColor: "#E5E7EB" },
          ]}
        >
          <Text
            {...noScaleText}
            style={[
              styles.pmListLabel,
              { color: UI.text },
              !isDark && { color: "#1E293B" },
            ]}
          >
           {p.challenges}
          </Text>
          <Text
            {...noScaleText}
            style={[
              styles.pmListValue,
              { color: UI.text },
              !isDark && { color: "#0F172A" },
            ]}
          >
            2
          </Text>
        </View>

        <View
          style={[
            styles.pmListRow,
            !isDark && { borderBottomColor: "#E5E7EB" },
          ]}
        >
          <Text
            {...noScaleText}
            style={[
              styles.pmListLabel,
              { color: UI.text },
              !isDark && { color: "#1E293B" },
            ]}
          >
            {p.reminders}
          </Text>
          <Text
            {...noScaleText}
            style={[
              styles.pmListValue,
              { color: UI.text },
              !isDark && { color: "#0F172A" },
            ]}
          >
            1
          </Text>
        </View>

        <View
          style={[
            styles.pmListRow,
            !isDark && { borderBottomColor: "#E5E7EB" },
          ]}
        >
          <Text
            {...noScaleText}
            style={[
              styles.pmListLabel,
              { color: UI.text },
              !isDark && { color: "#1E293B" },
            ]}
          >
            {p.history}
          </Text>
          <Text
            {...noScaleText}
            style={[
              styles.pmListValue,
              { color: UI.text },
              !isDark && { color: "#0F172A" },
            ]}
          >
            ×
          </Text>
        </View>

        <View
          style={[
            styles.pmListRow,
            !isDark && { borderBottomColor: "#E5E7EB" },
          ]}
        >
          <Text
            {...noScaleText}
            style={[
              styles.pmListLabel,
              { color: UI.text },
              !isDark && { color: "#1E293B" },
            ]}
          >
            {p.friends}
          </Text>
          <Text
            {...noScaleText}
            style={[
              styles.pmListValue,
              { color: UI.text },
              !isDark && { color: "#0F172A" },
            ]}
          >
            1
          </Text>
        </View>

        <View style={styles.pmListRowLast}>
          <Text
            {...noScaleText}
            style={[
              styles.pmListLabel,
              { color: UI.text },
              !isDark && { color: "#1E293B" },
            ]}
          >
            {p.sharedChallenges}
          </Text>
          <Text
            {...noScaleText}
            style={[
              styles.pmListValue,
              { color: UI.text },
              !isDark && { color: "#0F172A" },
            ]}
          >
            1
          </Text>
        </View>
      </View>
    </View>

    <LinearGradient
      colors={
        isDark
          ? ["rgba(255,159,26,0.18)", "rgba(255,120,0,0.07)"]
          : ["#A04A00", "#D97706"]
      }
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.pmPlanCardPremium,
        !isDark && {
          borderColor: "#C96A10",
          shadowColor: "#000",
          shadowOpacity: 0.10,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 3,
        },
      ]}
    >
      <View
        style={[
          styles.pmBestBadge,
          !isDark && { backgroundColor: "#7C2D12" },
        ]}
      >
        <Text {...noScaleText} style={styles.pmBestBadgeText}>
          {p.bestChoice}
        </Text>
      </View>

      <View style={styles.pmPlanHeader}>
        <View
          style={[
            styles.pmPlanBadgePremium,
            !isDark && { backgroundColor: "rgba(255,255,255,0.14)" },
          ]}
        >
          <MaterialCommunityIcons name="crown" size={18} color="#FFD166" />
        </View>

        <View style={{ flex: 1 }}>
          <Text {...noScaleText} style={styles.pmPlanTitlePremium}>
            Premium
          </Text>
          <Text {...noScaleText} style={styles.pmPlanSubtitlePremium}>
            {p.premiumForResults}
          </Text>
        </View>
      </View>

      <View style={styles.pmFeatureList}>
        <View style={styles.pmFeatureRow}>
          <Ionicons name="checkmark-circle" size={18} color="#FFD166" />
          <Text {...noScaleText} style={styles.pmFeatureText}>
            {p.unlimitedChallenges}
          </Text>
        </View>

        <View style={styles.pmFeatureRow}>
          <Ionicons name="checkmark-circle" size={18} color="#FFD166" />
          <Text {...noScaleText} style={styles.pmFeatureText}>
            {p.unlimitedReminders}
          </Text>
        </View>

        <View style={styles.pmFeatureRow}>
          <Ionicons name="checkmark-circle" size={18} color="#FFD166" />
          <Text {...noScaleText} style={styles.pmFeatureText}>
            {p.fullHistory}
          </Text>
        </View>

        <View style={styles.pmFeatureRow}>
          <Ionicons name="checkmark-circle" size={18} color="#FFD166" />
          <Text {...noScaleText} style={styles.pmFeatureText}>
            {p.unlimitedFriends}
          </Text>
        </View>

        <View style={styles.pmFeatureRow}>
          <Ionicons name="checkmark-circle" size={18} color="#FFD166" />
          <Text {...noScaleText} style={styles.pmFeatureText}>
            {p.unlimitedSharedChallenges}
          </Text>
        </View>
      </View>
    </LinearGradient>

    <Pressable
      style={[
        styles.pmCtaButton,
        !isDark && {
          backgroundColor: "#EA580C",
          shadowColor: "#000",
          shadowOpacity: 0.10,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 2,
        },
      ]}
      onPress={() => setInfoScreen("paywall")}
    >
      <Text {...noScaleText} style={styles.pmCtaButtonText}>
        {premium ? p.managePremium : p.getPremium}
      </Text>
      <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
    </Pressable>

    <View style={styles.pmBottomWrap}>
      <View style={styles.pmBottomItem}>
        <Ionicons name="shield-checkmark-outline" size={18} color={isDark ? "#FFB02E" : "#D97706"} />
        <Text
          {...noScaleText}
          style={[
            styles.pmBottomText,
            { color: UI.text },
            !isDark && { color: "#374151" },
          ]}
        >
          {p.securePayment}
        </Text>
      </View>

      <View style={styles.pmBottomItem}>
        <MaterialCommunityIcons name="restore" size={18} color={isDark ? "#FFB02E" : "#D97706"} />
        <Text
          {...noScaleText}
          style={[
            styles.pmBottomText,
            { color: UI.text },
            !isDark && { color: "#374151" },
          ]}
        >
          {p.cancelAnytime}
        </Text>
      </View>

      <View style={styles.pmBottomItem}>
        <Ionicons name="heart-outline" size={18} color={isDark ? "#FFB02E" : "#D97706"} />
        <Text
          {...noScaleText}
          style={[
            styles.pmBottomText,
            { color: UI.text },
            !isDark && { color: "#374151" },
          ]}
        >
          {p.supportDevelopment}
        </Text>
      </View>
    </View>
  </View>
)}
              {infoScreen === "paywall" && (
                <View
                  style={[
                    styles.infoCard,
                    { borderColor: UI.stroke, backgroundColor: UI.card },
                  ]}
                >
                  <Text style={[styles.infoTitle, { color: UI.text }]}>{p.premium}</Text>
                  <Text style={[styles.infoText, { color: UI.sub }]}>
                    {premium ? p.activePremiumInfo : p.unlockPremiumInfo}
                  </Text>

                  <View style={{ marginTop: 12, gap: 8 }}>
                    {[
                      p.unlimitedChallenges,
                      p.unlimitedRemindersNotif,
                      p.unlimitedFriendsLink,
                      p.moreRewards,
                    ].map((t) => (
                      <View
                        key={t}
                        style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
                      >
                        <Ionicons
                          name="checkmark-circle"
                          size={18}
                          color={UI.accent}
                        />
                        <Text style={{ color: UI.text, flex: 1, fontWeight: "700" }}>
                          {t}
                        </Text>
                      </View>
                    ))}
                  </View>

                  <View style={{ marginTop: 14 }}>
                    <Text style={{ color: UI.sub, fontWeight: "700" }}>
                      {p.priceInfo}
                    </Text>
                  </View>

                  {!premium ? (
                    <Pressable
                      disabled={premiumBusy}
                      onPress={buyPremium}
                      style={({ pressed }) => [
                        styles.primaryBtn,
                        { marginTop: 14, opacity: premiumBusy ? 0.6 : 1 },
                        pressed && !premiumBusy && { opacity: 0.9 },
                      ]}
                    >
                      {premiumBusy ? (
                        <ActivityIndicator />
                      ) : (
                        <Text style={styles.primaryBtnText}>{p.premiumBuy}</Text>
                      )}
                    </Pressable>
                  ) : (
                    <Pressable
                      disabled={premiumBusy}
                      onPress={cancelPremiumNow}
                      style={({ pressed }) => [
                        styles.dangerBtn,
                        { marginTop: 14, opacity: premiumBusy ? 0.6 : 1 },
                        pressed && !premiumBusy && { opacity: 0.9 },
                      ]}
                    >
                      <Text style={styles.dangerText}>{p.premiumCancel}</Text>
                    </Pressable>
                  )}

                </View>
              )}

              {infoScreen === "privacy" && (
                <View
                  style={[
                    styles.infoCard,
                    { borderColor: UI.stroke, backgroundColor: UI.card },
                  ]}
                >
                  <Text style={[styles.infoTitle, { color: UI.text }]}>
                    {p.privacy}
                  </Text>

                  <Pressable
                    onPress={openPrivacyLink}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      { marginTop: 10 },
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text style={styles.primaryBtnText}>{p.open}</Text>
                  </Pressable>
                </View>
              )}

              {infoScreen === "terms" && (
                <View
                  style={[
                    styles.infoCard,
                    { borderColor: UI.stroke, backgroundColor: UI.card },
                  ]}
                >
                  <Text style={[styles.infoTitle, { color: UI.text }]}>
                    {p.terms}
                  </Text>

                  <Pressable
                    onPress={openTermsLink}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      { marginTop: 10 },
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text style={styles.primaryBtnText}>{p.open}</Text>
                  </Pressable>
                </View>
              )}

              {infoScreen === "support" && (
                <View
                  style={[
                    styles.infoCard,
                    { borderColor: UI.stroke, backgroundColor: UI.card },
                  ]}
                >
                              <Text style={[styles.smallLabel, { color: UI.sub }]}>
                    {p.supportReplyEmail}
                  </Text>
                  <TextInput
                    value={supportEmail}
                    onChangeText={setSupportEmail}
                    placeholder={p.supportPlaceholder}
                    placeholderTextColor={UI.sub}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    style={[
                      styles.input,
                      {
                        color: UI.text,
                        borderColor: UI.stroke,
                        backgroundColor: UI.card2,
                      },
                    ]}
                  />

                  <Text style={[styles.smallLabel, { color: UI.sub }]}>{p.subject}</Text>
                  <TextInput
                    value={supportSubject}
                    onChangeText={setSupportSubject}
                    placeholder={p.supportSubjectPlaceholder}
                    placeholderTextColor={UI.sub}
                    style={[
                      styles.input,
                      {
                        color: UI.text,
                        borderColor: UI.stroke,
                        backgroundColor: UI.card2,
                      },
                    ]}
                  />

                  <Text style={[styles.smallLabel, { color: UI.sub }]}>{p.message}</Text>
                  <TextInput
                    value={supportMessage}
                    onChangeText={setSupportMessage}
                    placeholder={p.supportMessagePlaceholder}
                    placeholderTextColor={UI.sub}
                    multiline
                    style={[
                      styles.input,
                      styles.textArea,
                      {
                        color: UI.text,
                        borderColor: UI.stroke,
                        backgroundColor: UI.card2,
                      },
                    ]}
                  />

                  <Pressable
                    onPress={supportSending ? undefined : sendSupport}
                    disabled={supportSending}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      (pressed || supportSending) && { opacity: 0.9 },
                      supportSending && { opacity: 0.75 },
                    ]}
                  >
                    {supportSending ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <ActivityIndicator />
                        <Text style={styles.primaryBtnText}>{p.sending}</Text>
                      </View>
                    ) : (
                      <Text style={styles.primaryBtnText}>{p.send}</Text>
                    )}
                  </Pressable>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* ✅ MODAL – Přátelé */}
      <Modal
        visible={friendsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFriendsOpen(false)}
      >
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: UI.backdrop }]}
          onPress={() => {
            setAddFriendOpen(false);
            setFriendsOpen(false);
          }}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: isDark ? UI.sheetBg : "#FFE0C2",
              borderColor: isDark ? UI.sheetStroke : "#FF8A1F",
            },
          ]}
        >
   <View style={styles.sheetHeader}>
  {/* LEVÁ STRANA – záložky */}
  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
    <Pressable
      onPress={() => setFriendsTab("friends")}
      style={({ pressed }) => [
        styles.closeBtn,
        {
          borderColor: friendsTab === "friends" ? UI.accent : UI.stroke,
          backgroundColor: friendsTab === "friends" ? UI.accent : UI.card2,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text
        style={[
          styles.closeText,
          { color: friendsTab === "friends" ? "#0B1220" : UI.text },
        ]}
      >
       {p.friends}
      </Text>
    </Pressable>

<Pressable
  onPress={() => setFriendsTab("requests")}
  style={({ pressed }) => [
    styles.closeBtn,
    {
      borderColor: friendsTab === "requests" ? UI.accent : UI.stroke,
      backgroundColor: friendsTab === "requests" ? UI.accent : UI.card2,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    pressed && { opacity: 0.85 },
  ]}
>
  <Text
    style={[
      styles.closeText,
      { color: friendsTab === "requests" ? "#0B1220" : UI.text },
    ]}
  >
    {p.requests}
  </Text>

  {incomingCount > 0 && (
    <View
      style={{
        minWidth: 22,
        height: 22,
        borderRadius: 11,
        paddingHorizontal: 6,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor:
          friendsTab === "requests" ? "rgba(11,18,32,0.16)" : UI.accent,
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: "900",
          color: "#0B1220",
        }}
      >
        +{incomingCount}
      </Text>
    </View>
  )}
</Pressable>

    <Pressable
      onPress={() => setFriendsTab("invites")}
      style={({ pressed }) => [
        styles.closeBtn,
        {
          borderColor: friendsTab === "invites" ? UI.accent : UI.stroke,
          backgroundColor: friendsTab === "invites" ? UI.accent : UI.card2,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text
        style={[
          styles.closeText,
          { color: friendsTab === "invites" ? "#0B1220" : UI.text },
        ]}
      >
        {p.challenges}
      </Text>

      {pendingInviteCount > 0 && (
        <View
          style={{
            minWidth: 22,
            height: 22,
            borderRadius: 11,
            paddingHorizontal: 6,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor:
              friendsTab === "invites" ? "rgba(11,18,32,0.16)" : UI.accent,
          }}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: "900",
              color: "#0B1220",
            }}
          >
            +{pendingInviteCount}
          </Text>
        </View>
      )}
    </Pressable>
  </View>

  {/* PRAVÁ STRANA – Zavřít */}
  <Pressable
    onPress={() => {
      setAddFriendOpen(false);
      setFriendsOpen(false);
      setFriendsTab("friends");
    }}
    style={({ pressed }) => [
      styles.closeBtn,
      { borderColor: UI.stroke, backgroundColor: UI.card2 },
      pressed && { opacity: 0.85 },
    ]}
  >
    <Text style={[styles.closeText, { color: UI.text }]}>{p.close}</Text>
  </Pressable>
</View>

                   {friendsTab === "friends" ? (
            friendsLoading ? (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator size="large" />
                <Text style={{ marginTop: 12, color: UI.sub, fontWeight: "800" }}>
                  Načítám přátele...
                </Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ paddingBottom: 18 }}>
                {(() => {
                  const me = auth.currentUser?.uid ?? "";

                  const pending = friendEdges.filter((e) => e.status === "pending");

                  const incoming = pending.filter((e) => {
                    if (!me) return true;
                    return String(e.initiatedBy) !== String(me);
                  });

                  const outgoing = pending.filter((e) => {
                    if (!me) return false;
                    return String(e.initiatedBy) === String(me);
                  });

                  const accepted = friendEdges.filter((e) => e.status === "accepted");
                  const blocked = friendEdges.filter((e) => e.status === "blocked");

                  return (
                    <View style={{ gap: 12 }}>
                      <View
                        style={[
                          styles.infoCard,
                          { borderColor: UI.stroke, backgroundColor: UI.card },
                        ]}
                      >
                      
<View
  style={{
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    gap: 12,
  }}
>
 <Text style={[styles.infoTitle, { color: UI.text, marginBottom: 0 }]}>
  {p.myFriends}
</Text>

  <Pressable
    onPress={() => setAddFriendOpen(true)}
    style={({ pressed }) => [
      styles.smallBtn,
      pressed && { opacity: 0.9 },
    ]}
  >
    <Text style={styles.smallBtnText}>{p.addShort}</Text>
  </Pressable>
</View>

{!accepted.length ? (
  <Text style={[styles.infoText, { color: UI.sub, marginTop: 4 }]}>
    Zatím žádní přátelé.
  </Text>
) : (
  <>
    {accepted.map((e) => (
      <View
        key={"acc_" + e.otherUid}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 10,
          gap: 12,
        }}
      >
               <Pressable
          onPress={() => void openFriendStats(e.otherUid)}
          style={({ pressed }) => [
            { flex: 1, marginRight: 8 },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text
            style={{ color: UI.text, fontWeight: "900" }}
            numberOfLines={1}
          >
            {getShownFriendName(e.otherUid)}
          </Text>
        </Pressable>

        <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable
  onPress={() => openChallengeInvite(e.otherUid)}
style={({ pressed }) => [
  styles.smallBtn,
  freeSharedLimitReached && { opacity: 0.55 },
  pressed && { opacity: 0.9 },
]}
>
            <Text style={styles.smallBtnText}>{p.invite}</Text>
          </Pressable>

          <Pressable
            onPress={async () => {
              try {
                setFriendsBusy(true);
                await removeFriend(e.otherUid);
              } catch (err: any) {
               Alert.alert(
  p.friends,
  err?.message ?? p.removeFriendFailed
);
              } finally {
                setFriendsBusy(false);
              }
            }}
            style={({ pressed }) => [
              styles.smallBtnGhost,
              pressed && { opacity: 0.9 },
            ]}
          >
            <Text style={styles.smallBtnGhostText}>{p.remove}</Text>
          </Pressable>
        </View>
      </View>
    ))}
  </>
)}


                      </View>

                      {!!blocked.length && (
                        <View
                          style={[
                            styles.infoCard,
                            { borderColor: UI.stroke, backgroundColor: UI.card },
                          ]}
                        >
                          <Text style={[styles.infoTitle, { color: UI.text }]}>
                            Blokovaní
                          </Text>
                          {blocked.map((e) => (
                            <Text
                              key={"blocked_" + e.otherUid}
                              style={{ color: UI.text, fontWeight: "900", flex: 1, marginTop: 10 }}
                              numberOfLines={1}
                            >
                              {getShownFriendName(e.otherUid)}
                            </Text>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })()}
              </ScrollView>
            )
) : friendsTab === "requests" ? (
  <ScrollView contentContainerStyle={{ paddingBottom: 18 }}>
    {(() => {
      const me = auth.currentUser?.uid ?? "";
      const pending = friendEdges.filter((e) => e.status === "pending");

      const incoming = pending.filter((e) => {
        if (!me) return true;
        return String(e.initiatedBy) !== String(me);
      });

      const outgoing = pending.filter((e) => {
        if (!me) return false;
        return String(e.initiatedBy) === String(me);
      });

const incomingCount = incoming.length;

      if (!incomingCount && !outgoing.length) {
        return (
          <View style={[styles.infoCard, { borderColor: UI.stroke, backgroundColor: UI.card }]}>
            <Text style={[styles.infoTitle, { color: UI.text }]}>{p.requests}</Text>
            <Text style={[styles.infoText, { color: UI.sub }]}>{p.noRequests}</Text>
          </View>
        );
      }

      return (
        <View style={{ gap: 12 }}>
          {!!incomingCount && (
            <View style={[styles.infoCard, { borderColor: UI.stroke, backgroundColor: UI.card }]}>
              <Text style={[styles.infoTitle, { color: UI.text }]}>{p.incomingRequests}</Text>

              {incoming.map((e) => (
                <View key={"in_" + e.otherUid} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                  <Text style={{ color: UI.text, fontWeight: "900", flex: 1 }} numberOfLines={1}>
                    {getShownFriendName(e.otherUid)}
                  </Text>

                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <Pressable
                      onPress={async () => {
                        try {
                          const acceptedCount = friendEdges.filter((x) => x.status === "accepted").length;
                          if (!premium && acceptedCount >= 1) {
                            Alert.alert(p.friends, p.freeFriendsLimit);
                            return;
                          }
                          setFriendsBusy(true);
                          await acceptFriend(e.otherUid);
                        } catch (err: any) {
                          Alert.alert(p.friends, err?.message ?? p.acceptFriendFailed);
                        } finally {
                          setFriendsBusy(false);
                        }
                      }}
                      style={({ pressed }) => [styles.smallBtn, pressed && { opacity: 0.9 }]}
                    >
                      <Text style={styles.smallBtnText}>{p.accept}</Text>
                    </Pressable>

                    <Pressable
                      onPress={async () => {
                        try {
                          setFriendsBusy(true);
                          await declineFriend(e.otherUid);
                        } catch (err: any) {
                          Alert.alert(p.friends, err?.message ?? p.declineFriendFailed);
                        } finally {
                          setFriendsBusy(false);
                        }
                      }}
                      style={({ pressed }) => [styles.smallBtnGhost, pressed && { opacity: 0.9 }]}
                    >
                      <Text style={styles.smallBtnGhostText}>{p.decline}</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}

          {!!outgoing.length && (
            <View style={[styles.infoCard, { borderColor: UI.stroke, backgroundColor: UI.card }]}>
              <Text style={[styles.infoTitle, { color: UI.text }]}>{p.sentRequests}</Text>

              {outgoing.map((e) => (
                <View key={"out_" + e.otherUid} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                  <Text style={{ color: UI.sub, fontWeight: "900", flex: 1 }} numberOfLines={1}>
                    {getShownFriendName(e.otherUid)}
                  </Text>

                  <Pressable
                    onPress={async () => {
                      try {
                        setFriendsBusy(true);
                        await declineFriend(e.otherUid);
                      } catch (err: any) {
                        Alert.alert(p.friends, err?.message ?? p.cancelRequestFailed);
                      } finally {
                        setFriendsBusy(false);
                      }
                    }}
                    style={({ pressed }) => [styles.smallBtnGhost, pressed && { opacity: 0.9 }]}
                  >
                    <Text style={styles.smallBtnGhostText}>{p.cancel}</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>
      );
    })()}
  </ScrollView>
          ) : sharedInvitesLoading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator size="large" />
              <Text style={{ marginTop: 12, color: UI.sub, fontWeight: "800" }}>
                Načítám výzvy...
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ paddingBottom: 18 }}>
              <View style={{ gap: 12 }}>
             {!sharedInvites.length && !sentSharedInvites.length ? (
  <View
    style={[
      styles.infoCard,
      { borderColor: UI.stroke, backgroundColor: UI.card },
    ]}
  >
    <Text style={[styles.infoTitle, { color: UI.text }]}>
      {p.challenges}
    </Text>
    <Text style={[styles.infoText, { color: UI.sub }]}>
      {p.noPendingChallenges}
    </Text>
  </View>
) : (
  <>
    {sharedInvites.map((item) => (
      <View
        key={item.id}
        style={[
          styles.infoCard,
          { borderColor: UI.stroke, backgroundColor: UI.card },
        ]}
      >
        <Text style={[styles.infoTitle, { color: UI.text, marginBottom: 6 }]}>
          {item.title}
        </Text>

        <Text style={[styles.infoText, { color: UI.sub }]}>
          Od: {getInviteCreatorName(item)}
        </Text>

        <Text style={[styles.infoText, { color: UI.sub, marginTop: 4 }]}>
          Účastníci: {getInviteMembersLabel(item)}
        </Text>

        <Text style={[styles.infoText, { color: UI.sub, marginTop: 4 }]}>
          Cíl: {item.targetPerDay}×{" "}
          {item.period === "daily"
            ? p.daily
            : item.period === "every2"
              ? p.every2
              : p.selectedDays}
        </Text>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
          <Pressable
            disabled={friendsBusy}
            onPress={() => void acceptSharedInviteFromFriends(item.id)}
            style={({ pressed }) => [
              styles.smallBtn,
              pressed && { opacity: 0.9 },
              friendsBusy && { opacity: 0.6 },
            ]}
          >
            <Text style={styles.smallBtnText}>{p.accept}</Text>
          </Pressable>

          <Pressable
            disabled={friendsBusy}
            onPress={() => void declineSharedInviteFromFriends(item.id)}
            style={({ pressed }) => [
              styles.smallBtnGhost,
              pressed && { opacity: 0.9 },
              friendsBusy && { opacity: 0.6 },
            ]}
          >
            <Text style={styles.smallBtnGhostText}>{p.decline}</Text>
          </Pressable>
        </View>
      </View>
    ))}

    {sentSharedInvites.map((item) => (
      <View
        key={"sent_" + item.id}
        style={[
          styles.infoCard,
          { borderColor: UI.stroke, backgroundColor: UI.card },
        ]}
      >
        <Text style={[styles.infoTitle, { color: UI.text, marginBottom: 6 }]}>
          {item.title}
        </Text>

        <Text style={[styles.infoText, { color: UI.sub }]}>
          {lang === "cs" ? "Odesláno pro" : "Sent to"}: {getInviteMembersLabel(item)}
        </Text>

        <Text style={[styles.infoText, { color: UI.sub, marginTop: 4 }]}>
          {lang === "cs" ? "Čeká na přijetí." : "Waiting for acceptance."}
        </Text>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
          <Pressable
            disabled={friendsBusy}
            onPress={() => void declineSharedInviteFromFriends(item.id)}
            style={({ pressed }) => [
              styles.smallBtnGhost,
              pressed && { opacity: 0.9 },
              friendsBusy && { opacity: 0.6 },
            ]}
          >
            <Text style={styles.smallBtnGhostText}>
              {lang === "cs" ? "Zrušit" : "Cancel"}
            </Text>
          </Pressable>
        </View>
      </View>
    ))}
  </>
)}
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* ✅ MODAL – Přidat přítele */}
      <Modal
        visible={addFriendOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAddFriendOpen(false)}
      >
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: UI.backdrop }]}
          onPress={() => setAddFriendOpen(false)}
        />
        <View
          style={[
            styles.sheet,
            {
              height: "68%",
              backgroundColor: isDark ? UI.sheetBg : "#FFE0C2",
              borderColor: isDark ? UI.sheetStroke : "#FF8A1F",
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: UI.text }]}>
              Přidat přítele
            </Text>
            <Pressable
              onPress={() => setAddFriendOpen(false)}
              style={({ pressed }) => [
                styles.closeBtn,
                { borderColor: UI.stroke, backgroundColor: UI.card2 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.closeText, { color: UI.text }]}>{p.close}</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 18 }}>
            <View
              style={[
                styles.infoCard,
                { borderColor: UI.stroke, backgroundColor: UI.card },
              ]}
            >
              <Text style={[styles.infoTitle, { color: UI.text }]}>
                Přidat podle username
              </Text>
              <Text style={[styles.infoText, { color: UI.sub, marginTop: 8 }]}>
                Zadej uživatelské jméno člověka, kterého chceš přidat.
              </Text>

              <View
                style={{
                  flexDirection: "row",
                  gap: 10,
                  alignItems: "center",
                  marginTop: 12,
                }}
              >
                <TextInput
                  value={addUsername}
                  onChangeText={setAddUsername}
                  placeholder={p.usernamePlaceholder}
                  placeholderTextColor={UI.sub}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[
                    styles.input,
                    {
                      flex: 1,
                      color: UI.text,
                      borderColor: UI.stroke,
                      backgroundColor: UI.card2,
                    },
                  ]}
                />
                <Pressable
                  disabled={friendsBusy}
                  onPress={async () => {
                    try {
                      if (!auth.currentUser?.uid) return;
                      const me = auth.currentUser.uid;
                      const username = addUsername.trim();
                      if (!username) {
                        Alert.alert(p.friends, lang === "cs" ? "Zadej uživatelské jméno." : "Enter a username.");
                        return;
                      }

                      const acceptedCount = friendEdges.filter(
                        (e) => e.status === "accepted"
                      ).length;
                      if (!premium && acceptedCount >= 1) {
                        Alert.alert(
                          p.friends,
                          lang === "cs" ? "Ve Free verzi můžeš mít jen 1 přítele. Pro více je potřeba Premium." : "In the Free version you can have only 1 friend. Premium is required for more."
                        );
                        return;
                      }

                      setFriendsBusy(true);
                      const otherUid = await resolveUidByUsername(username);
                      if (!otherUid) {
                        Alert.alert(
                          p.friends,
                          lang === "cs" ? "Uživatel s tímto username nebyl nalezen." : "No user with this username was found."
                        );
                        return;
                      }
                      if (otherUid === me) {
                        Alert.alert(p.friends, lang === "cs" ? "Nemůžeš přidat sám sebe 🙂" : "You can’t add yourself 🙂");
                        return;
                      }
                      await sendFriendRequest(otherUid);
                  setAddUsername("");
setAddFriendOpen(false);
showPwdPopup("success", p.friends, lang === "cs" ? "Žádost odeslána." : "Request sent.");
                    } catch (e: any) {
                      Alert.alert(
                        p.friends,
                        e?.message ?? (lang === "cs" ? "Nepodařilo se odeslat žádost." : "Could not send the request.")
                      );
                    } finally {
                      setFriendsBusy(false);
                    }
                  }}
                  style={({ pressed }) => [
                    styles.smallBtn,
                    pressed && { opacity: 0.9 },
                    friendsBusy && { opacity: 0.6 },
                  ]}
                >
                  <Text style={styles.smallBtnText}>{p.add}</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ✅ MODAL – Nová společná výzva (Premium) */}
      <Modal
        visible={challengeInviteOpen}
        transparent
        animationType="fade"
        onRequestClose={closeChallengeInvite}
      >
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: UI.backdrop }]}
          onPress={closeChallengeInvite}
        />
        <View
          style={[
            styles.sheet,
            {
              height: "74%",
              backgroundColor: isDark ? UI.sheetBg : "#FFE0C2",
              borderColor: isDark ? UI.sheetStroke : "#FF8A1F",
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: UI.text }]}>
             {p.newSharedChallenge}
            </Text>

            <Pressable
              onPress={closeChallengeInvite}
              style={({ pressed }) => [
                styles.closeBtn,
                { borderColor: UI.stroke, backgroundColor: UI.card2 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.closeText, { color: UI.text }]}>{p.close}</Text>
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 18 }}
          >
            <View
              style={[
                styles.infoCard,
                { borderColor: UI.stroke, backgroundColor: UI.card },
              ]}
            >
              <Text style={[styles.infoTitle, { color: UI.text }]}>
                 {p.sharedChallenge}
              </Text>

              <Text style={[styles.infoText, { color: UI.sub, marginTop: -2 }]}>
                {p.selectUpToFriends.replace("{count}", String(MAX_SHARED_MEMBERS - 1))}
              </Text>

              <Text style={[styles.smallLabel, { color: UI.sub, marginTop: 12 }]}>
                {p.friends}
              </Text>

              <View style={styles.challengePills}>
                {friendEdges
                  .filter((e) => e.status === "accepted")
                  .map((e) => {
                    const uid = String(e.otherUid);
                    const active = challengeInviteFriendUids.includes(uid);
                    const disabled =
                      !active &&
                      challengeInviteFriendUids.length >= MAX_SHARED_MEMBERS - 1;

                    return (
                      <Pressable
                        key={uid}
                        onPress={() => {
                          setChallengeInviteFriendUids((prev) => {
                            const has = prev.includes(uid);
                            if (has) return prev.filter((x) => x !== uid);
                            if (prev.length >= MAX_SHARED_MEMBERS - 1) return prev;
                            return [...prev, uid];
                          });
                        }}
                        style={({ pressed }) => [
                          styles.challengePill,
                          {
                            borderColor: active ? UI.accent : UI.stroke,
                            backgroundColor: active ? UI.accent : UI.card2,
                            opacity: disabled ? 0.45 : 1,
                          },
                          pressed && { opacity: disabled ? 0.45 : 0.9 },
                        ]}
                      >
                        <Text
                          style={[
                            styles.challengePillText,
                            { color: active ? "#0B1220" : UI.text },
                          ]}
                        >
                          {getShownFriendName(uid)}
                        </Text>
                      </Pressable>
                    );
                  })}
              </View>

              <Text style={[styles.smallLabel, { color: UI.sub, marginTop: 12 }]}>
                {p.challengeName}
              </Text>
              <TextInput
                value={challengeInviteTitle}
                onChangeText={setChallengeInviteTitle}
                placeholder={p.challengeNamePlaceholder}
                placeholderTextColor={UI.sub}
                autoCapitalize="sentences"
                style={[
                  styles.input,
                  {
                    color: UI.text,
                    borderColor: UI.stroke,
                    backgroundColor: UI.card2,
                  },
                ]}
              />

              <Text style={[styles.smallLabel, { color: UI.sub, marginTop: 12 }]}>
                {p.countPerDay}
              </Text>
              <View style={styles.challengePills}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
                  const active = challengeInviteTarget === n;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => setChallengeInviteTarget(n)}
                      style={({ pressed }) => [
                        styles.challengePill,
                        {
                          borderColor: active ? UI.accent : UI.stroke,
                          backgroundColor: active ? UI.accent : UI.card2,
                        },
                        pressed && { opacity: 0.9 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.challengePillText,
                          { color: active ? "#0B1220" : UI.text },
                        ]}
                      >
                        {n}×
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.smallLabel, { color: UI.sub, marginTop: 12 }]}>
                {p.period}
              </Text>
              <View style={styles.challengePills}>
                {[
                 { key: "daily", label: p.dailyCap },
{ key: "every2", label: p.every2Cap },
{ key: "custom", label: p.customDays },
                ].map((opt) => {
                  const active = challengeInvitePeriod === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => {
                        setChallengeInvitePeriod(opt.key as "daily" | "every2" | "custom");
                        if (opt.key === "custom" && challengeInviteCustomDays.length === 0) {
                          const todayIso = new Date().toISOString().slice(0, 10);
                          setChallengeInviteCustomDays([dowMon0(todayIso)]);
                        }
                        if (opt.key !== "custom") {
                          setChallengeInviteCustomDays([]);
                        }
                      }}
                      style={({ pressed }) => [
                        styles.challengePill,
                        {
                          borderColor: active ? UI.accent : UI.stroke,
                          backgroundColor: active ? UI.accent : UI.card2,
                        },
                        pressed && { opacity: 0.9 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.challengePillText,
                          { color: active ? "#0B1220" : UI.text },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {challengeInvitePeriod === "custom" && (
                <>
                  <Text style={[styles.smallLabel, { color: UI.sub, marginTop: 12 }]}>
                    Vyber dny
                  </Text>
                  <View style={styles.challengePills}>
                    {[
  { k: 0, t: p.dayMon },
  { k: 1, t: p.dayTue },
  { k: 2, t: p.dayWed },
  { k: 3, t: p.dayThu },
  { k: 4, t: p.dayFri },
  { k: 5, t: p.daySat },
  { k: 6, t: p.daySun },
].map((d) => {
                      const active = challengeInviteCustomDays.includes(d.k);
                      return (
                        <Pressable
                          key={d.k}
                          onPress={() => {
                            setChallengeInviteCustomDays((prev) => {
                              const has = prev.includes(d.k);
                              const next = has
                                ? prev.filter((x) => x !== d.k)
                                : [...prev, d.k];
                              return [...next].sort((a, b) => a - b);
                            });
                          }}
                          style={({ pressed }) => [
                            styles.challengePill,
                            {
                              borderColor: active ? UI.accent : UI.stroke,
                              backgroundColor: active ? UI.accent : UI.card2,
                            },
                            pressed && { opacity: 0.9 },
                          ]}
                        >
                          <Text
                            style={[
                              styles.challengePillText,
                              { color: active ? "#0B1220" : UI.text },
                            ]}
                          >
                            {d.t}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}

              <Pressable
                disabled={challengeInviteBusy}
                onPress={submitChallengeInvite}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { marginTop: 16 },
                  (pressed || challengeInviteBusy) && { opacity: 0.9 },
                  challengeInviteBusy && { opacity: 0.65 },
                ]}
              >
                <Text style={styles.primaryBtnText}>
                 {challengeInviteBusy ? p.sending : p.submit}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>

            {/* ✅ MODAL – Statistiky přítele */}
      <Modal
        visible={friendStatsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFriendStatsOpen(false)}
      >
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: UI.backdrop }]}
          onPress={() => setFriendStatsOpen(false)}
        />
        <View
          style={[
            styles.sheet,
            {
              height: "52%",
              backgroundColor: isDark ? UI.sheetBg : "#FFE0C2",
              borderColor: isDark ? UI.sheetStroke : "#FF8A1F",
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: UI.text }]}>
              {selectedFriendName || "Profil přítele"}
            </Text>

            <Pressable
              onPress={() => setFriendStatsOpen(false)}
              style={({ pressed }) => [
                styles.closeBtn,
                { borderColor: UI.stroke, backgroundColor: UI.card2 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.closeText, { color: UI.text }]}>{p.close}</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 18 }}>
            <View
              style={[
                styles.infoCard,
                { borderColor: UI.stroke, backgroundColor: UI.card },
              ]}
            >
              {selectedFriendLoading ? (
                <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 30 }}>
                  <ActivityIndicator size="large" />
                  <Text style={{ marginTop: 12, color: UI.sub, fontWeight: "800" }}>
                    Načítám statistiky...
                  </Text>
                </View>
              ) : !selectedFriendShares ? (
                <Text style={[styles.infoText, { color: UI.sub }]}>
                  Tento uživatel nesdílí své úspěchy.
                </Text>
              ) : !selectedFriendStats ? (
                <Text style={[styles.infoText, { color: UI.sub }]}>
                  Statistiky nejsou dostupné.
                </Text>
              ) : (
                <View style={{ gap: 12 }}>
                  <View
                    style={[
                      styles.modalRow,
                      { borderColor: UI.stroke, backgroundColor: UI.card2 },
                    ]}
                  >
                    <Text style={[styles.modalLabel, { color: UI.text }]}>
                      🔥 Nejdelší série
                    </Text>
                    <Text style={[styles.modalLabel, { color: UI.text }]}>
                      {selectedFriendStats.bestStreak} dní
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.modalRow,
                      { borderColor: UI.stroke, backgroundColor: UI.card2 },
                    ]}
                  >
                    <Text style={[styles.modalLabel, { color: UI.text }]}>
                      🏅 Počet medailí
                    </Text>
                    <Text style={[styles.modalLabel, { color: UI.text }]}>
                      {selectedFriendStats.totalMedals}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.modalRow,
                      { borderColor: UI.stroke, backgroundColor: UI.card2 },
                    ]}
                  >
                    <Text style={[styles.modalLabel, { color: UI.text }]}>
                      💎 Nejvyšší medaile
                    </Text>
                    <Text style={[styles.modalLabel, { color: UI.text }]}>
                      {medalLabel(selectedFriendStats.highestMedal)}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.modalRow,
                      { borderColor: UI.stroke, backgroundColor: UI.card2 },
                    ]}
                  >
                    <Text style={[styles.modalLabel, { color: UI.text }]}>
                      ✅ Aktivní výzvy
                    </Text>
                    <Text style={[styles.modalLabel, { color: UI.text }]}>
                      {selectedFriendStats.activeChallenges}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ✅ PROFIL */}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 18, paddingBottom: 26 + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerBlock}>
      <Text
  numberOfLines={1}
  ellipsizeMode="tail"
  style={[styles.userName, { flex: 1, minWidth: 0 }]}
>
  {myUsername}
</Text>

          {!!email && (
            <Text style={styles.userEmail} numberOfLines={1}>
              {email}
            </Text>
          )}

       <View style={styles.versionRow}>
  <View
    style={[
      styles.versionChip,
      {
        borderColor: premium ? UI.accent : UI.stroke,
        backgroundColor: premium
          ? "rgba(255,138,31,0.18)"
          : UI.card,
      },
    ]}
  >
    {premium ? (
      <MaterialCommunityIcons
        name="crown"
        size={15}
        color={UI.accent}
        style={{ marginRight: 6 }}
      />
    ) : null}

    <Text
      style={[
        styles.versionChipText,
        { color: premium ? UI.accent : UI.text },
      ]}
    >
      {premium ? p.noScalePremium : p.noScaleFree}
    </Text>
  </View>

  {!premium && (
    <Pressable
      onPress={openPayments}
      style={({ pressed }) => [
        styles.upgradeChip,
        pressed && { opacity: 0.92 },
      ]}
    >
      <Text style={styles.upgradeChipText}>{p.upgrade}</Text>
    </Pressable>
  )}
</View>
        </View>

        <Pressable
          onPress={() => setAccountOpen(true)}
          style={({ pressed }) => [
            styles.bigItem,
            { borderColor: UI.stroke, backgroundColor: UI.card },
            pressed && { opacity: 0.88 },
          ]}
        >
          <Text style={[styles.bigItemText, { color: UI.text }]}>{p.account}</Text>
          <Text style={[styles.chevron, { color: UI.text }]}>›</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            setInfoScreen("menu");
            setInfoOpen(true);
          }}
          style={({ pressed }) => [
            styles.bigItem,
            { borderColor: UI.stroke, backgroundColor: UI.card },
            pressed && { opacity: 0.88 },
          ]}
        >
          <Text style={[styles.bigItemText, { color: UI.text }]}>{p.info}</Text>
          <Text style={[styles.chevron, { color: UI.text }]}>›</Text>
        </Pressable>

               <Pressable
          onPress={() => {
            setFriendsTab("friends");
            setFriendsOpen(true);
          }}
          style={({ pressed }) => [
            styles.bigItem,
            { borderColor: UI.stroke, backgroundColor: UI.card },
            pressed && { opacity: 0.88 },
          ]}
        >
          <Text style={[styles.bigItemText, { color: UI.text }]}>{p.friendsLabel}</Text>
          <Text style={[styles.chevron, { color: UI.text }]}>›</Text>
        </Pressable>
      </ScrollView>

      {/* ✅ POPUP */}
      <Modal
        visible={pwdPopupOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPwdPopupOpen(false)}
      >
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: UI.backdrop }]}
          onPress={() => setPwdPopupOpen(false)}
        />
        <View style={styles.popupWrap}>
          <View
            style={[
              styles.popupCard,
              { backgroundColor: "#FFE0C2", borderColor: "#FF8A1F" },
            ]}
          >
            <View style={styles.popupHeader}>
              <Text style={styles.popupTitle}>{pwdPopupTitle}</Text>
              <Pressable
                onPress={() => setPwdPopupOpen(false)}
                hitSlop={10}
                style={({ pressed }) => [styles.popupX, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name="close" size={20} color={"#0B1220"} />
              </Pressable>
            </View>
            <Text style={styles.popupText}>{pwdPopupText}</Text>
            <Pressable
              onPress={() => setPwdPopupOpen(false)}
              style={({ pressed }) => [styles.popupBtn, pressed && { opacity: 0.9 }]}
            >
              <Text style={styles.popupBtnText}>{p.ok}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(UI: any) {
  return StyleSheet.create({
    screen: { flex: 1 },
    gradient: { ...StyleSheet.absoluteFillObject },

    content: { paddingHorizontal: 18, gap: 12 },

    headerBlock: { paddingHorizontal: 2, paddingBottom: 6 },
    userName: {
  fontSize: 34,
  lineHeight: 38,
  fontWeight: "900",
  color: UI.text,
  includeFontPadding: false,
},
    userEmail: { marginTop: 6, fontSize: 15, fontWeight: "800", color: UI.sub },

    versionRow: {
      marginTop: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
   versionChip: {
  borderWidth: 1,
  borderRadius: 999,
  paddingHorizontal: 12,
  paddingVertical: 8,
  flexDirection: "row",
  alignItems: "center",
},
    versionChipText: { fontSize: 14, fontWeight: "900" },
    upgradeChip: {
      backgroundColor: UI.accent,
      borderRadius: 999,
      paddingHorizontal: 20,
      paddingVertical: 10,
    },
    upgradeChipText: { color: "#0B1220", fontSize: 16, fontWeight: "900" },

    bigItem: {
      borderRadius: 22,
      borderWidth: 1,
      paddingVertical: 20,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    bigItemText: { fontSize: 20, fontWeight: "900" },

    chevron: { fontSize: 24, fontWeight: "900", lineHeight: 24 },

    sheet: {
      position: "absolute",
      left: 12,
      right: 12,
      bottom: 12,
      height: "82%",
      borderRadius: 22,
      borderWidth: 1,
      padding: 14,
    },

pmHero: {
  borderRadius: 20,
  borderWidth: 1,
  borderColor: "rgba(255,159,26,0.20)",
  padding: 14,
  flexDirection: "row",
  alignItems: "center",
  gap: 12,
  marginBottom: 12,
},

pmHeroIcon: {
  width: 44,
  height: 44,
  borderRadius: 14,
  backgroundColor: "rgba(255,159,26,0.10)",
  alignItems: "center",
  justifyContent: "center",
},

pmHeroTitle: {
  color: "#FFF3E0",
  fontSize: 16,
  fontWeight: "900",
},

pmHeroText: {
  marginTop: 4,
  color: "#E8D2B0",
  fontSize: 12,
  lineHeight: 17,
  fontWeight: "700",
},

pmPlanCard: {
  borderRadius: 20,
  borderWidth: 1,
  padding: 14,
  marginBottom: 12,
},

pmPlanCardPremium: {
  borderRadius: 20,
  borderWidth: 1,
  borderColor: "rgba(255,159,26,0.30)",
  padding: 14,
  marginBottom: 12,
  position: "relative",
  overflow: "hidden",
},

pmPlanHeader: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  marginBottom: 12,
},

pmPlanBadgeFree: {
  width: 38,
  height: 38,
  borderRadius: 12,
  backgroundColor: "rgba(255,255,255,0.06)",
  alignItems: "center",
  justifyContent: "center",
},

pmPlanBadgePremium: {
  width: 38,
  height: 38,
  borderRadius: 12,
  backgroundColor: "rgba(255,159,26,0.12)",
  alignItems: "center",
  justifyContent: "center",
},

pmPlanTitle: {
  fontSize: 17,
  fontWeight: "900",
},

pmPlanSubtitle: {
  marginTop: 2,
  fontSize: 11,
  fontWeight: "700",
},

pmPlanTitlePremium: {
  color: "#FFF8EE",
  fontSize: 17,
  fontWeight: "900",
},

pmPlanSubtitlePremium: {
  marginTop: 2,
  color: "#FFE2B0",
  fontSize: 11,
  fontWeight: "800",
},

pmBestBadge: {
  position: "absolute",
  top: 10,
  right: 10,
  backgroundColor: "#F58A07",
  paddingHorizontal: 10,
  paddingVertical: 5,
  borderRadius: 999,
},

pmBestBadgeText: {
  color: "#FFF8ED",
  fontSize: 9,
  fontWeight: "900",
},

pmList: {
  borderTopWidth: 1,
  borderTopColor: "rgba(255,255,255,0.08)",
},

pmListRow: {
  minHeight: 40,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  borderBottomWidth: 1,
  borderBottomColor: "rgba(255,255,255,0.08)",
},

pmListRowLast: {
  minHeight: 40,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
},

pmListLabel: {
  fontSize: 13,
  fontWeight: "800",
},

pmListValue: {
  fontSize: 15,
  fontWeight: "900",
},

pmFeatureList: {
  gap: 10,
  marginTop: 4,
},

pmFeatureRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
},

pmFeatureText: {
  flex: 1,
  color: "#FFF7EF",
  fontSize: 13,
  fontWeight: "800",
},

pmCtaButton: {
  height: 50,
  borderRadius: 16,
  backgroundColor: "#F58A07",
  alignItems: "center",
  justifyContent: "center",
  flexDirection: "row",
  gap: 6,
  marginBottom: 12,
},

pmCtaButtonText: {
  color: "#fff",
  fontSize: 15,
  fontWeight: "900",
},

pmBottomWrap: {
  gap: 8,
},

pmBottomItem: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
},

pmBottomText: {
  fontSize: 12,
  fontWeight: "700",
},
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 10,
    },
    sheetTitle: { fontSize: 20, fontWeight: "900", flex: 1 },

   closeBtn: {
  borderWidth: 1,
  borderRadius: 14,
  paddingHorizontal: 10,
  paddingVertical: 8,
  minHeight: 40,
  flexShrink: 0,
  alignItems: "center",
  justifyContent: "center",
},
  closeText: {
  fontSize: 12,
  fontWeight: "800",
  includeFontPadding: false,
},

    iconBackBtn: {
      width: 34,
      height: 34,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: UI.card2,
      borderWidth: 1,
      borderColor: UI.stroke,
    },

    modalRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: 12,
      borderRadius: 14,
      borderWidth: 1,
      marginBottom: 10,
    },
    modalLabel: { fontSize: 16, fontWeight: "900", includeFontPadding: false },

    modalLinkRow: {
      marginTop: 10,
      borderRadius: 14,
      borderWidth: 1,
      paddingVertical: 14,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    modalLinkText: { fontSize: 16, fontWeight: "900" },

    langPills: { flexDirection: "row", alignItems: "center", gap: 8 },
  langPill: {
  minWidth: 38,
  height: 30,
  paddingHorizontal: 8,
  borderRadius: 999,
  borderWidth: 1,
  alignItems: "center",
  justifyContent: "center",
},
    
    langPillText: { fontSize: 12, fontWeight: "900" },

    dangerBtn: {
      marginTop: 12,
      borderRadius: 14,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#D12C2C",
    },
    dangerText: { color: "#fff", fontWeight: "900", fontSize: 16 },

    dangerOutline: {
      marginTop: 10,
      borderRadius: 14,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "rgba(209,44,44,0.55)",
      backgroundColor: "rgba(209,44,44,0.10)",
    },
    dangerOutlineText: { color: "#D12C2C", fontWeight: "900", fontSize: 16 },

    infoCard: {
      borderWidth: 1,
      borderRadius: 16,
      padding: 14,
      marginBottom: 10,
    },
    infoTitle: { fontSize: 18, fontWeight: "900", marginBottom: 10 },
    infoText: { fontSize: 15, fontWeight: "700", lineHeight: 22 },

    smallLabel: { marginTop: 6, fontSize: 13.5, fontWeight: "900" },
    input: {
      marginTop: 8,
      borderRadius: 14,
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 11,
      fontWeight: "800",
      fontSize: 15,
    },
    textArea: { minHeight: 120, textAlignVertical: "top" },

    primaryBtn: {
      marginTop: 12,
      borderRadius: 14,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: UI.accent,
    },
    primaryBtnText: { color: "#0B1220", fontWeight: "900", fontSize: 16 },

    smallBtn: {
      borderRadius: 14,
      paddingVertical: 10,
      paddingHorizontal: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: UI.accent,
    },
    smallBtnText: { color: "#0B1220", fontWeight: "900", fontSize: 14 },

    smallBtnGhost: {
      borderRadius: 14,
      paddingVertical: 10,
      paddingHorizontal: 12,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: UI.stroke,
      backgroundColor: UI.card2,
    },
    smallBtnGhostText: { color: UI.text, fontWeight: "900", fontSize: 14 },
    challengePills: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 8,
    },
    challengePill: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      minWidth: 52,
      alignItems: "center",
      justifyContent: "center",
    },
    challengePillText: {
      fontSize: 14,
      fontWeight: "900",
    },
    medalsGrid: { marginTop: 12, gap: 12 },

    medalRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 14,
      borderRadius: 22,
      borderWidth: 1,
    },

    medalIconWrap: {
      width: 62,
      height: 62,
      borderRadius: 22,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },

    medalIcon: { width: 44, height: 44, resizeMode: "contain" },

    medalTitle: { fontSize: 16, fontWeight: "900" },
    medalDesc: { marginTop: 2, fontSize: 13.5, fontWeight: "700", lineHeight: 20 },

    tableWrap: {
      marginTop: 12,
      borderRadius: 14,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: UI.stroke,
    },
    tableHead: { flexDirection: "row", paddingVertical: 10, paddingHorizontal: 12 },
    tableHeadCellLeft: { flex: 1, fontWeight: "900", fontSize: 15 },
    tableHeadCellMid: {
      width: 70,
      textAlign: "center",
      fontWeight: "900",
      fontSize: 15,
    },
    tableHeadCellRight: {
      width: 90,
      textAlign: "center",
      fontWeight: "900",
      fontSize: 15,
    },
    tableRow: {
      flexDirection: "row",
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderTopWidth: 1,
    },
    tableCellLeft: { flex: 1, fontWeight: "700", fontSize: 15 },
    tableCellMid: {
      width: 70,
      textAlign: "center",
      fontWeight: "900",
      fontSize: 15,
    },
    tableCellRight: {
      width: 90,
      textAlign: "center",
      fontWeight: "900",
      fontSize: 15,
    },

    iconGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
   iconTile: {
  width: "48%",
  borderWidth: 1,
  borderRadius: 22,
  paddingVertical: 16,
  paddingHorizontal: 12,
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  minHeight: 118,
},
    iconCircle: {
      width: 46,
      height: 46,
      borderRadius: 23,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    iconTileText: {
  fontSize: 14,
  fontWeight: "900",
  textAlign: "center",
  lineHeight: 18,
},

    popupWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 18,
    },
    popupCard: {
      width: "100%",
      borderRadius: 22,
      borderWidth: 1,
      padding: 14,
    },
    popupHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 6,
    },
    popupTitle: {
      flex: 1,
      fontSize: 17,
      fontWeight: "900",
      color: "#0B1220",
    },
    popupX: {
      width: 34,
      height: 34,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#FFD3A8",
    },
    popupText: {
      fontSize: 14,
      fontWeight: "800",
      lineHeight: 19,
      color: "#0B1220",
      marginTop: 4,
    },
    popupBtn: {
      marginTop: 12,
      borderRadius: 14,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#FFC48F",
    },
    popupBtnText: {
      color: "#0B1220",
      fontWeight: "900",
      fontSize: 16,
    },
  });
}