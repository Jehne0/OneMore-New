import { Ionicons, MaterialCommunityIcons, Feather  } from "@expo/vector-icons";
import Constants from "expo-constants";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert as NativeAlert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Alert } from "../../lib/appAlert";
import { getSafeModalMetrics } from "../../lib/safeModalLayout";
import { PremiumOfferingFlow } from "../../lib/premiumOfferingFlow";
import {
  canUpgradePremium,
  type PremiumPaywallPhase,
} from "../../lib/premiumOfferingSelection";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  acceptSharedChallenge,
  createSharedChallenge,
  declineSharedChallenge,
  dowMon0,
  isAcceptedSharedChallengeForUid,
  isIncomingSharedChallengeInviteForUid,
  MAX_SHARED_MEMBERS,
  subscribeSharedChallenges,
  type SharedChallenge,
} from "../../lib/sharedChallenges";
import { getCurrentVersionCode } from "../../lib/versionCheck";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getPremiumSubscriptionState,
  getOfferingPackages,
  openCancelSubscription,
  purchasePackage,
  restorePurchases,
  revenueCatLogout,
  subscribePremiumSubscriptionState,
  syncPremiumFromRevenueCat,
  type PremiumSubscriptionState,
} from "../../lib/revenuecat";

import { useTheme } from "../../lib/theme";
import { useI18n } from "../../lib/i18n";
import { getWhatsNewCopy } from "../../lib/whatsNew";
import { isPremiumActive, subscribePremium } from "../../lib/premium";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  loadNotificationSettings,
  saveNotificationSettings,
  type NotificationSettings,
} from "../../lib/notificationSettings";
import {
  cancelScheduledChallengeReminderNotifications,
  refreshScheduledChallengeReminders,
  setRemindersPremiumEnabled,
} from "../../lib/reminders";
import { refreshScheduledSharedReminders } from "../../lib/sharedReminders";
import {
  EmailAuthProvider,
  deleteUser,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
  onAuthStateChanged,
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
import { clearSessionAfterExplicitLogout } from "../../lib/cloudSync";
import { updateAccountDisplayName } from "../../lib/accountSnapshot";

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

const PREMIUM_REQUEST_TIMEOUT_MS = 15_000;
const USERNAME_SAVE_TIMEOUT_MS = 15_000;
const USERNAME_SAVE_TIMEOUT_ERROR = "USERNAME_SAVE_TIMEOUT";

async function withPremiumRequestTimeout<T>(request: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      request,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("PREMIUM_REQUEST_TIMEOUT")),
          PREMIUM_REQUEST_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function withUsernameSaveTimeout<T>(request: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      request,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(USERNAME_SAVE_TIMEOUT_ERROR)),
          USERNAME_SAVE_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

type InfoScreen =
  | "menu"
  | "whatsnew"
  | "support"
  | "streak_medals"
  | "freeprem"
  | "faq"
  | "privacy"
  | "terms"
  | "paywall";

type AccountModalDestination =
  | "password"
  | "username"
  | "premium"
  | "delete"
  | "info";

type FriendsTab = "friends" | "requests" | "invites";

type PendingFriendsAction =
  | { type: "invite"; friendUid: string }
  | { type: "remove"; friendUid: string };

type FriendPreviewStats = {
  bestStreak: number;
  totalMedals: number;
  highestMedal: "none" | "brambora" | "steel" | "bronze" | "silver" | "gold" | "diamond";
  activeChallenges: number;
};

// ✅ veřejné HTML stránky (otevírá se v prohlížeči)
const TEMP_SHARED_INVITE_DIAGNOSTICS = false;

const PRIVACY_URL = "https://desigame.eu/privacy.html";
const TERMS_URL =
  "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

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
medalsIntro: "Sbírej medaile za své ohýnky. Jednou získaná medaile zůstane rozsvícená a stejnou medaili můžeš získat opakovaně, maximálně 10× za jednu výzvu. Každý 90denní cyklus můžeš získat všechny medaile znovu.",
    deleteAccountTitle: "Odstranit účet?",
    deleteAccountText: "Tahle akce je nevratná. Účet bude smazán.",
    enterPassword: "Zadej heslo",
    cancel: "Zrušit",
    deleteAccountAction: "Chci odstranit účet",
    deletingAccount: "Mažu účet…",
    deleteMissingPassword: "Pro odstranění účtu zadej heslo.",
    deleteWrongPassword: "Zadané heslo není správné. Zkus to znovu.",
    deleteNotSignedIn: "Nejsi přihlášený. Přihlas se a zkus to znovu.",
    deleteUnsupportedProvider: "Tento účet nelze ověřit heslem. Přihlas se znovu podporovaným způsobem a potom odstranění zopakuj.",
    deleteNetworkError: "Účet se nepodařilo odstranit kvůli síťové chybě. Zkontroluj připojení a zkus to znovu.",
    deleteGenericError: "Účet se nepodařilo odstranit. Zkus to prosím znovu.",
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
    premiumManagementOpenFailed: "Správu předplatného otevřete v App Store: klepněte na svůj účet vpravo nahoře a potom na Předplatná.",
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
    premiumManage: "Spravovat předplatné",
    premiumChecking: "Kontroluji Premium…",
    premiumOfferLoading: "Načítám nabídku Premium…",
    premiumOpeningAppStore: "Otevírám nákup v App Store…",
    premiumOpeningGooglePlay: "Otevírám nákup v Google Play…",
    premiumProcessingPurchase: "Zpracovávám nákup…",
    premiumPurchaseCancelled: "Nákup byl zrušen.",
    premiumPurchaseActivated: "Premium bylo aktivováno.",
    open: "Otevřít",
    linkTitle: "Odkaz",
    privacyLinkFailed: "Nepodařilo se otevřít Ochranu soukromí.",
    termsLinkFailed: "Nepodařilo se otevřít Podmínky používání.",
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
    addingFriend: "Přidávám…",
    addFriendMissingUsername: "Zadej uživatelské jméno.",
    addFriendSignInRequired: "Pro přidání přítele se nejdřív přihlas.",
    addFriendFreeLimit: "Ve Free verzi můžeš mít jen 1 přítele. Pro více je potřeba Premium.",
    addFriendNotFound: "Uživatel s tímto username nebyl nalezen.",
    addFriendSelf: "Nemůžeš přidat sám sebe 🙂",
    addFriendSent: "Žádost odeslána.",
    addFriendFailed: "Nepodařilo se odeslat žádost.",
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
    homeScreenWidget: "Widget na ploše",
    homeScreenWidgetFree: "1 výzva",
    homeScreenWidgetPremium: "Neomezeně výzev",
    activePremiumInfo: "Premium je aktivní. Můžeš ho kdykoliv zrušit nebo zkusit obnovit stav.",
    unlockPremiumInfo: "Odemkni Premium a získej neomezené výzvy, připomínky a přátele.",
    priceInfo: "Cena: zobrazí se po napojení nabídky (Offering) v RevenueCat.",
    premiumProductName: "OneMore Premium",
    monthlySubscription: "Měsíční předplatné",
    perMonth: "za měsíc",
    privacyPolicyLink: "Zásady ochrany osobních údajů",
    termsEulaLink: "Podmínky použití (EULA)",
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
    medalSteel: "Železná",
    medalBronze: "Bronzová",
    medalSilver: "Stříbrná",
    medalGold: "Zlatá",
    medalDiamond: "Diamantová",
    cancelRequestFailed: "Nepodařilo se zrušit.",
    declineFriendFailed: "Nepodařilo se odmítnout.",
    acceptFriendFailed: "Nepodařilo se přijmout.",
    removeFriendFailed: "Nepodařilo se odebrat.",
    removeFriendConfirm: "Opravdu chceš odebrat přítele {name}?",
    friendActionUnavailable: "Akci se nepodařilo otevřít. Zkus to prosím znovu.",
    freeSharedChallengeLimit: "Ve Free verzi můžeš mít jen 1 společnou výzvu. Pro více je potřeba Premium.",
    medalPotatoDesc: "První série je na světě. Jen tak dál.",
medalSteelDesc: "Držíš tempo a buduješ pevný základ.",
medalBronzeDesc: "Z návyku se začíná stávat rutina.",
medalSilverDesc: "Měsíc za tebou. Tohle už má sílu.",
medalGoldDesc: "60 dní disciplíny. Skvělá práce.",
medalDiamondDesc: "90 dní vytrvalosti. Tohle je úroveň.",
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
medalsIntro: "Earn medals for your streaks. Once earned, a medal stays unlocked, and you can earn the same medal multiple times, up to 10 times per challenge. Every 90-day cycle lets you collect all medals again.",
  deleteAccountTitle: "Delete account?",
  deleteAccountText: "This action is irreversible. Your account will be deleted.",
  enterPassword: "Enter password",
  cancel: "Cancel",
  deleteAccountAction: "Delete my account",
  deletingAccount: "Deleting account…",
  deleteMissingPassword: "Enter your password to delete the account.",
  deleteWrongPassword: "The password is incorrect. Please try again.",
  deleteNotSignedIn: "You are not signed in. Sign in and try again.",
  deleteUnsupportedProvider: "This account cannot be verified with a password. Sign in again using a supported method, then retry deletion.",
  deleteNetworkError: "The account could not be deleted because of a network error. Check your connection and try again.",
  deleteGenericError: "The account could not be deleted. Please try again.",
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
  premiumManagementOpenFailed: "Open subscription management in the App Store: tap your account in the top right, then Subscriptions.",
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
  premiumManage: "Manage subscription",
  premiumChecking: "Checking Premium…",
  premiumOfferLoading: "Loading Premium offer…",
  premiumOpeningAppStore: "Opening App Store purchase…",
  premiumOpeningGooglePlay: "Opening Google Play purchase…",
  premiumProcessingPurchase: "Processing purchase…",
  premiumPurchaseCancelled: "The purchase was cancelled.",
  premiumPurchaseActivated: "Premium has been activated.",
  open: "Open",
  linkTitle: "Link",
  privacyLinkFailed: "Could not open the privacy policy.",
  termsLinkFailed: "Could not open the terms of use.",
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
  addingFriend: "Adding…",
  addFriendMissingUsername: "Enter a username.",
  addFriendSignInRequired: "Sign in before adding a friend.",
  addFriendFreeLimit: "In the Free version you can have only 1 friend. Premium is required for more.",
  addFriendNotFound: "No user with this username was found.",
  addFriendSelf: "You can’t add yourself 🙂",
  addFriendSent: "Request sent.",
  addFriendFailed: "Could not send the request.",
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
  homeScreenWidget: "Home screen widget",
  homeScreenWidgetFree: "1 challenge",
  homeScreenWidgetPremium: "Unlimited challenges",
  activePremiumInfo: "Premium is active. You can cancel it anytime or try restoring the status.",
  unlockPremiumInfo: "Unlock Premium and get unlimited challenges, reminders, and friends.",
  priceInfo: "Price will appear after the RevenueCat offering is connected.",
  premiumProductName: "OneMore Premium",
  monthlySubscription: "Monthly subscription",
  perMonth: "per month",
  privacyPolicyLink: "Privacy Policy",
  termsEulaLink: "Terms of Use (EULA)",
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
  medalSteel: "Iron",
  medalBronze: "Bronze",
  medalSilver: "Silver",
  medalGold: "Gold",
  medalDiamond: "Diamond",
  removeFriendFailed: "Could not remove friend.",
  removeFriendConfirm: "Are you sure you want to remove {name} from your friends?",
  friendActionUnavailable: "The action could not be opened. Please try again.",
  freeSharedChallengeLimit: "In the Free version you can have only 1 shared challenge. Upgrade to Premium for more.",
  acceptFriendFailed: "Could not accept request.",
  declineFriendFailed: "Could not decline request.",
  cancelRequestFailed: "Could not cancel request.",
  medalPotatoDesc: "Your first streak is alive. Keep going.",
medalSteelDesc: "You are building a solid base.",
medalBronzeDesc: "The habit is starting to stick.",
medalSilverDesc: "One month in. That is real progress.",
medalGoldDesc: "60 days of discipline. Strong work.",
medalDiamondDesc: "90 days of consistency. Elite.",
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
historyEmpty: "Brak historii.",
historyCompleted: "Ukończono",
historyMissed: "Niewykonano",
historyFreeDay: "Dzień wolny",
historyArchived: "Archiwalne wyzwanie",
historyActive: "Aktywne wyzwanie",
clearHistory: "Wyczyść historię",
clearHistoryConfirm: "Czy na pewno chcesz usunąć historię?",
  streakFlamesInfo: "Płomień pokazuje, ile dni z rzędu udało Ci się wykonać wyzwanie.\n\nJeśli wyzwanie jest w danym dniu nieaktywne albo ma dzień wolny, seria się nie przerywa.\nSeria resetuje się tylko wtedy, gdy nie wykonasz aktywnego dnia wyzwania. Możesz dezaktywować wyzwanie bez utraty serii.",
medalsIntro: "Zdobywaj medale za swoje serie. Raz zdobyty medal pozostaje odblokowany, a ten sam medal możesz zdobywać wielokrotnie, maksymalnie 10 razy w jednym wyzwaniu. W każdym 90-dniowym cyklu możesz zdobyć wszystkie medale ponownie.",
  deleteAccountTitle: "Usunąć konto?",
  deleteAccountText: "Tej akcji nie można cofnąć. Konto zostanie usunięte.",
  enterPassword: "Wpisz hasło",
  cancel: "Anuluj",
  deleteAccountAction: "Chcę usunąć konto",
  deletingAccount: "Usuwam konto…",
  deleteMissingPassword: "Wpisz hasło, aby usunąć konto.",
  deleteWrongPassword: "Podane hasło jest nieprawidłowe. Spróbuj ponownie.",
  deleteNotSignedIn: "Nie jesteś zalogowany. Zaloguj się i spróbuj ponownie.",
  deleteUnsupportedProvider: "Tego konta nie można zweryfikować hasłem. Zaloguj się ponownie obsługiwaną metodą, a następnie ponów usuwanie.",
  deleteNetworkError: "Nie udało się usunąć konta z powodu błędu sieci. Sprawdź połączenie i spróbuj ponownie.",
  deleteGenericError: "Nie udało się usunąć konta. Spróbuj ponownie.",
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
  premiumManagementOpenFailed: "Zarządzanie subskrypcją otwórz w App Store: stuknij swoje konto w prawym górnym rogu, a następnie Subskrypcje.",
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
  premiumManage: "Zarządzaj subskrypcją",
  premiumChecking: "Sprawdzam Premium…",
  premiumOfferLoading: "Wczytuję ofertę Premium…",
  premiumOpeningAppStore: "Otwieram zakup w App Store…",
  premiumOpeningGooglePlay: "Otwieram zakup w Google Play…",
  premiumProcessingPurchase: "Przetwarzam zakup…",
  premiumPurchaseCancelled: "Zakup został anulowany.",
  premiumPurchaseActivated: "Premium zostało aktywowane.",
  open: "Otwórz",
  linkTitle: "Link",
  privacyLinkFailed: "Nie udało się otworzyć polityki prywatności.",
  termsLinkFailed: "Nie udało się otworzyć warunków korzystania.",
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
  addingFriend: "Dodawanie…",
  addFriendMissingUsername: "Wpisz nazwę użytkownika.",
  addFriendSignInRequired: "Zaloguj się przed dodaniem znajomego.",
  addFriendFreeLimit: "W wersji Free możesz mieć tylko 1 znajomego. Więcej znajomych wymaga Premium.",
  addFriendNotFound: "Nie znaleziono użytkownika o tej nazwie.",
  addFriendSelf: "Nie możesz dodać samego siebie 🙂",
  addFriendSent: "Prośba została wysłana.",
  addFriendFailed: "Nie udało się wysłać prośby.",
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
  homeScreenWidget: "Widżet na ekranie",
  homeScreenWidgetFree: "1 wyzwanie",
  homeScreenWidgetPremium: "Nieograniczone wyzwania",
  activePremiumInfo: "Premium jest aktywne. Możesz je anulować w dowolnym momencie albo spróbować przywrócić status.",
  unlockPremiumInfo: "Odblokuj Premium i zyskaj nieograniczone wyzwania, przypomnienia i znajomych.",
  priceInfo: "Cena pojawi się po podłączeniu oferty w RevenueCat.",
  premiumProductName: "OneMore Premium",
  monthlySubscription: "Subskrypcja miesięczna",
  perMonth: "miesięcznie",
  privacyPolicyLink: "Polityka prywatności",
  termsEulaLink: "Warunki użytkowania (EULA)",
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
  medalSteel: "Żelazny",
  medalBronze: "Brązowy",
  medalSilver: "Srebrny",
  medalGold: "Złoty",
  medalDiamond: "Diamentowy",
  cancelRequestFailed: "Nie udało się anulować.",
  declineFriendFailed: "Nie udało się odrzucić.",
  acceptFriendFailed: "Nie udało się zaakceptować.",
  removeFriendFailed: "Nie udało się usunąć.",
  removeFriendConfirm: "Czy na pewno chcesz usunąć znajomego {name}?",
  friendActionUnavailable: "Nie udało się otworzyć tej akcji. Spróbuj ponownie.",
  freeSharedChallengeLimit: "W wersji Free możesz mieć tylko 1 wspólne wyzwanie. Więcej wymaga Premium.",
  medalPotatoDesc: "Pierwsza seria ruszyła. Idź dalej.",
medalSteelDesc: "Budujesz solidną podstawę.",
medalBronzeDesc: "Nawyk zaczyna się utrwalać.",
medalSilverDesc: "Miesiąc za tobą. To już postęp.",
medalGoldDesc: "60 dni dyscypliny. Mocna robota.",
medalDiamondDesc: "90 dni wytrwałości. To wysoki poziom.",

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
medalsIntro: "Sammle Medaillen für deine Serien. Einmal freigeschaltete Medaillen bleiben erhalten, und du kannst dieselbe Medaille mehrfach sammeln, höchstens 10-mal pro Challenge. In jedem 90-Tage-Zyklus kannst du alle Medaillen erneut gewinnen.",
medalPotatoDesc: "Die erste Serie läuft. Weiter so.",
medalSteelDesc: "Du baust ein starkes Fundament.",
medalBronzeDesc: "Aus dem Ziel wird langsam Routine.",
medalSilverDesc: "Ein Monat geschafft. Das ist echter Fortschritt.",
medalGoldDesc: "60 Tage Disziplin. Stark gemacht.",
medalDiamondDesc: "90 Tage Ausdauer. Top-Leistung.",
  deleteAccountTitle: "Konto löschen?",
  deleteAccountText: "Diese Aktion kann nicht rückgängig gemacht werden. Das Konto wird gelöscht.",
  enterPassword: "Passwort eingeben",
  cancel: "Abbrechen",
  deleteAccountAction: "Konto löschen",
  deletingAccount: "Konto wird gelöscht…",
  deleteMissingPassword: "Gib dein Passwort ein, um das Konto zu löschen.",
  deleteWrongPassword: "Das eingegebene Passwort ist falsch. Bitte versuche es erneut.",
  deleteNotSignedIn: "Du bist nicht angemeldet. Melde dich an und versuche es erneut.",
  deleteUnsupportedProvider: "Dieses Konto kann nicht mit einem Passwort bestätigt werden. Melde dich erneut mit einer unterstützten Methode an und wiederhole das Löschen.",
  deleteNetworkError: "Das Konto konnte wegen eines Netzwerkfehlers nicht gelöscht werden. Prüfe deine Verbindung und versuche es erneut.",
  deleteGenericError: "Das Konto konnte nicht gelöscht werden. Bitte versuche es erneut.",
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
  premiumManagementOpenFailed: "Öffne die Aboverwaltung im App Store: Tippe oben rechts auf deinen Account und dann auf Abonnements.",
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
  premiumManage: "Abo verwalten",
  premiumChecking: "Premium wird geprüft…",
  premiumOfferLoading: "Premium-Angebot wird geladen…",
  premiumOpeningAppStore: "App-Store-Kauf wird geöffnet…",
  premiumOpeningGooglePlay: "Google-Play-Kauf wird geöffnet…",
  premiumProcessingPurchase: "Kauf wird verarbeitet…",
  premiumPurchaseCancelled: "Der Kauf wurde abgebrochen.",
  premiumPurchaseActivated: "Premium wurde aktiviert.",
  open: "Öffnen",
  linkTitle: "Link",
  privacyLinkFailed: "Die Datenschutzerklärung konnte nicht geöffnet werden.",
  termsLinkFailed: "Die Nutzungsbedingungen konnten nicht geöffnet werden.",
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
  addingFriend: "Wird hinzugefügt…",
  addFriendMissingUsername: "Gib einen Benutzernamen ein.",
  addFriendSignInRequired: "Melde dich an, bevor du einen Freund hinzufügst.",
  addFriendFreeLimit: "In der Free-Version kannst du nur 1 Freund haben. Für mehr ist Premium erforderlich.",
  addFriendNotFound: "Kein Benutzer mit diesem Benutzernamen gefunden.",
  addFriendSelf: "Du kannst dich nicht selbst hinzufügen 🙂",
  addFriendSent: "Anfrage gesendet.",
  addFriendFailed: "Die Anfrage konnte nicht gesendet werden.",
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
  homeScreenWidget: "Startbildschirm-Widget",
  homeScreenWidgetFree: "1 Challenge",
  homeScreenWidgetPremium: "Unbegrenzte Challenges",
  activePremiumInfo: "Premium ist aktiv. Du kannst es jederzeit kündigen oder den Status wiederherstellen.",
  unlockPremiumInfo: "Schalte Premium frei und erhalte unbegrenzte Herausforderungen, Erinnerungen und Freunde.",
  priceInfo: "Der Preis erscheint nach dem Verbinden des Offerings in RevenueCat.",
  premiumProductName: "OneMore Premium",
  monthlySubscription: "Monatliches Abonnement",
  perMonth: "pro Monat",
  privacyPolicyLink: "Datenschutzerklärung",
  termsEulaLink: "Nutzungsbedingungen (EULA)",
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
  medalSteel: "Eisen",
  medalBronze: "Bronze",
  medalSilver: "Silber",
  medalGold: "Gold",
  medalDiamond: "Diamant",
  cancelRequestFailed: "Abbrechen fehlgeschlagen.",
  declineFriendFailed: "Ablehnen fehlgeschlagen.",
  acceptFriendFailed: "Annehmen fehlgeschlagen.",
  removeFriendFailed: "Entfernen fehlgeschlagen.",
  removeFriendConfirm: "Möchtest du {name} wirklich als Freund entfernen?",
  friendActionUnavailable: "Die Aktion konnte nicht geöffnet werden. Bitte versuche es erneut.",
  freeSharedChallengeLimit: "In der Free-Version kannst du nur 1 gemeinsame Herausforderung haben. Für mehr brauchst du Premium.",
}

} as const;

const PROFILE_RUNTIME_STRINGS: Record<"cs" | "en" | "pl" | "de", Record<string, string>> = {
  cs: { notifications: "Oznámení", newChallenge: "Nová výzva", accepted: "Výzva byla přijata.", acceptFailed: "Výzvu se nepodařilo přijmout.", declined: "Výzva byla odmítnuta.", declineFailed: "Výzvu se nepodařilo odmítnout.", cancelPremium: "Zrušit Premium", cancelPremiumText: "Předplatné se ruší ve Store (Google Play / App Store). Chceš otevřít správu předplatného?", no: "Ne", premiumActive: "Premium je aktivní.", premiumInactive: "Premium není aktivní.", premiumRestoreFailed: "Stav Premium se nepodařilo obnovit.", support: "Podpora", supportMissing: "Vyplň prosím e-mail, předmět i zprávu.", signInRequired: "Musíš být přihlášený/á.", sent: "Odesláno", supportSent: "Díky! Zpráva byla odeslána na podporu.", supportFailed: "Zprávu se nepodařilo odeslat. Zkus to prosím znovu.", permissionDenied: "Nemáš oprávnění odeslat zprávu.", checkFields: "Zkontroluj prosím vyplněné údaje.", error: "Chyba", enterEmail: "Zadej prosím e-mail.", missingEmail: "Chybí e-mail", missingEmailText: "Zadej prosím e-mail a zkus to znovu.", done: "Hotovo", resetSent: "Poslali jsme ti e-mail s odkazem na změnu hesla. Zkontroluj i spam.", emailFailed: "E-mail se nepodařilo odeslat. Zkus to prosím znovu.", invalidEmail: "E-mail není ve správném formátu.", noAccount: "Pro tento e-mail neexistuje účet.", tooMany: "Příliš mnoho pokusů. Zkus to prosím později.", couldNotSend: "Nepodařilo se odeslat", usernameChange: "Změna uživatelského jména", notSignedIn: "Nejsi přihlášený/á.", changeFailed: "Změna se nepovedla.", selectFriend: "Vyber alespoň jednoho přítele.", enterChallenge: "Zadej název výzvy.", selectDay: "Vyber alespoň jeden den.", sharedCreated: "Výzva byla vytvořena pro {count} přátel.", sharedCreateFailed: "Společnou výzvu se nepodařilo vytvořit.", privacy: "Soukromí", privacyFailed: "Nastavení se nepodařilo uložit.", sentFor: "Odesláno pro", waiting: "Čeká na přijetí.", cancel: "Zrušit" },
  en: { notifications: "Notifications", newChallenge: "New challenge", accepted: "Challenge accepted.", acceptFailed: "The challenge could not be accepted.", declined: "Challenge declined.", declineFailed: "The challenge could not be declined.", cancelPremium: "Cancel Premium", cancelPremiumText: "Subscription cancellation is handled in the Store (Google Play / App Store). Open subscription management?", no: "No", premiumActive: "Premium is active.", premiumInactive: "Premium is not active.", premiumRestoreFailed: "Premium status could not be restored.", support: "Support", supportMissing: "Please fill in the email, subject, and message.", signInRequired: "You must be signed in.", sent: "Sent", supportSent: "Thanks! Your message was sent to support.", supportFailed: "The message could not be sent. Please try again.", permissionDenied: "You do not have permission to send the message.", checkFields: "Please check the entered details.", error: "Error", enterEmail: "Please enter your email.", missingEmail: "Missing email", missingEmailText: "Enter your email and try again.", done: "Done", resetSent: "We sent you an email with a password reset link. Check spam too.", emailFailed: "The email could not be sent. Please try again.", invalidEmail: "The email format is invalid.", noAccount: "There is no account for this email.", tooMany: "Too many attempts. Please try again later.", couldNotSend: "Could not send", usernameChange: "Change username", notSignedIn: "You are not signed in.", changeFailed: "Change failed.", selectFriend: "Select at least one friend.", enterChallenge: "Enter a challenge name.", selectDay: "Select at least one day.", sharedCreated: "Challenge created for {count} friends.", sharedCreateFailed: "The shared challenge could not be created.", privacy: "Privacy", privacyFailed: "The settings could not be saved.", sentFor: "Sent to", waiting: "Waiting for acceptance.", cancel: "Cancel" },
  pl: { notifications: "Powiadomienia", newChallenge: "Nowe wyzwanie", accepted: "Wyzwanie zostało zaakceptowane.", acceptFailed: "Nie udało się zaakceptować wyzwania.", declined: "Wyzwanie zostało odrzucone.", declineFailed: "Nie udało się odrzucić wyzwania.", cancelPremium: "Anuluj Premium", cancelPremiumText: "Subskrypcję anulujesz w sklepie Google Play lub App Store. Otworzyć zarządzanie subskrypcją?", no: "Nie", premiumActive: "Premium jest aktywne.", premiumInactive: "Premium nie jest aktywne.", premiumRestoreFailed: "Nie udało się przywrócić statusu Premium.", support: "Pomoc", supportMissing: "Wypełnij e-mail, temat i wiadomość.", signInRequired: "Musisz się zalogować.", sent: "Wysłano", supportSent: "Dziękujemy! Wiadomość została wysłana do pomocy.", supportFailed: "Nie udało się wysłać wiadomości. Spróbuj ponownie.", permissionDenied: "Nie masz uprawnień do wysłania wiadomości.", checkFields: "Sprawdź wprowadzone dane.", error: "Błąd", enterEmail: "Wpisz adres e-mail.", missingEmail: "Brak e-maila", missingEmailText: "Wpisz e-mail i spróbuj ponownie.", done: "Gotowe", resetSent: "Wysłaliśmy e-mail z linkiem do zmiany hasła. Sprawdź też spam.", emailFailed: "Nie udało się wysłać e-maila. Spróbuj ponownie.", invalidEmail: "Format adresu e-mail jest nieprawidłowy.", noAccount: "Nie ma konta dla tego adresu e-mail.", tooMany: "Zbyt wiele prób. Spróbuj ponownie później.", couldNotSend: "Nie udało się wysłać", usernameChange: "Zmiana nazwy użytkownika", notSignedIn: "Nie jesteś zalogowany/a.", changeFailed: "Zmiana nie powiodła się.", selectFriend: "Wybierz co najmniej jednego znajomego.", enterChallenge: "Wpisz nazwę wyzwania.", selectDay: "Wybierz co najmniej jeden dzień.", sharedCreated: "Utworzono wyzwanie dla {count} znajomych.", sharedCreateFailed: "Nie udało się utworzyć wspólnego wyzwania.", privacy: "Prywatność", privacyFailed: "Nie udało się zapisać ustawień.", sentFor: "Wysłano do", waiting: "Oczekuje na akceptację.", cancel: "Anuluj" },
  de: { notifications: "Benachrichtigungen", newChallenge: "Neue Challenge", accepted: "Challenge angenommen.", acceptFailed: "Die Challenge konnte nicht angenommen werden.", declined: "Challenge abgelehnt.", declineFailed: "Die Challenge konnte nicht abgelehnt werden.", cancelPremium: "Premium kündigen", cancelPremiumText: "Das Abo wird im Google Play Store oder App Store gekündigt. Aboverwaltung öffnen?", no: "Nein", premiumActive: "Premium ist aktiv.", premiumInactive: "Premium ist nicht aktiv.", premiumRestoreFailed: "Der Premium-Status konnte nicht wiederhergestellt werden.", support: "Support", supportMissing: "Fülle bitte E-Mail, Betreff und Nachricht aus.", signInRequired: "Du musst angemeldet sein.", sent: "Gesendet", supportSent: "Danke! Deine Nachricht wurde an den Support gesendet.", supportFailed: "Die Nachricht konnte nicht gesendet werden. Bitte versuche es erneut.", permissionDenied: "Du darfst keine Nachricht senden.", checkFields: "Überprüfe bitte deine Eingaben.", error: "Fehler", enterEmail: "Gib bitte deine E-Mail-Adresse ein.", missingEmail: "E-Mail-Adresse fehlt", missingEmailText: "Gib deine E-Mail-Adresse ein und versuche es erneut.", done: "Fertig", resetSent: "Wir haben dir eine E-Mail mit einem Link zum Ändern des Passworts gesendet. Prüfe auch den Spamordner.", emailFailed: "Die E-Mail konnte nicht gesendet werden. Bitte versuche es erneut.", invalidEmail: "Das E-Mail-Format ist ungültig.", noAccount: "Für diese E-Mail-Adresse gibt es kein Konto.", tooMany: "Zu viele Versuche. Bitte versuche es später erneut.", couldNotSend: "Senden fehlgeschlagen", usernameChange: "Benutzernamen ändern", notSignedIn: "Du bist nicht angemeldet.", changeFailed: "Änderung fehlgeschlagen.", selectFriend: "Wähle mindestens einen Freund aus.", enterChallenge: "Gib einen Namen für die Challenge ein.", selectDay: "Wähle mindestens einen Tag aus.", sharedCreated: "Challenge für {count} Freunde erstellt.", sharedCreateFailed: "Die gemeinsame Challenge konnte nicht erstellt werden.", privacy: "Datenschutz", privacyFailed: "Die Einstellungen konnten nicht gespeichert werden.", sentFor: "Gesendet an", waiting: "Wartet auf Annahme.", cancel: "Abbrechen" },
};

const PROFILE_ACCOUNT_STRINGS: Record<"cs" | "en" | "pl" | "de", Record<string, string>> = {
  cs: { enterUsername: "Zadej prosím nové uživatelské jméno.", usernameChanged: "Uživatelské jméno bylo změněno.", saveTimeout: "Ukládání trvá příliš dlouho. Zkontroluj připojení a zkus to znovu.", friendLocked: "Tento přítel je ve Free verzi zamčený. Obnov Premium a znovu se odemkne.", lockedFree: "Zamčeno ve Free verzi" },
  en: { enterUsername: "Please enter a new username.", usernameChanged: "Username has been changed.", saveTimeout: "Saving is taking too long. Check your connection and try again.", friendLocked: "This friend is locked in the Free version. Restore Premium to unlock them again.", lockedFree: "Locked in the Free version" },
  pl: { enterUsername: "Wpisz nową nazwę użytkownika.", usernameChanged: "Nazwa użytkownika została zmieniona.", saveTimeout: "Zapisywanie trwa zbyt długo. Sprawdź połączenie i spróbuj ponownie.", friendLocked: "Ten znajomy jest zablokowany w wersji Free. Przywróć Premium, aby go odblokować.", lockedFree: "Zablokowano w wersji Free" },
  de: { enterUsername: "Gib einen neuen Benutzernamen ein.", usernameChanged: "Der Benutzername wurde geändert.", saveTimeout: "Das Speichern dauert zu lange. Prüfe deine Verbindung und versuche es erneut.", friendLocked: "Dieser Freund ist in der Free-Version gesperrt. Stelle Premium wieder her, um ihn zu entsperren.", lockedFree: "In der Free-Version gesperrt" },
};

const PROFILE_ACCESS_STRINGS: Record<"cs" | "en" | "pl" | "de", Record<string, string>> = {
  cs: { notificationSaveFailed: "Nastavení oznámení se nepodařilo uložit.", newInvite: "Máš novou pozvánku do společné výzvy.", sharedLimit: "Ve Free verzi můžeš mít jen jednu společnou výzvu. Pro více je potřeba Premium.", acceptFailed: "Výzvu se nepodařilo přijmout.", historyPremium: "Historie výzev je dostupná v Premium. Tvoje historie se nemaže, jen je ve Free verzi zamčená.", lockedFree: "Zamčeno ve Free verzi" },
  en: { notificationSaveFailed: "Notification settings could not be saved.", newInvite: "You have a new shared challenge invitation.", sharedLimit: "The Free version allows one shared challenge. Upgrade to Premium for more.", acceptFailed: "The challenge could not be accepted.", historyPremium: "Challenge history is available with Premium. Your history is not deleted; it is only locked in the Free version.", lockedFree: "Locked in the Free version" },
  pl: { notificationSaveFailed: "Nie udało się zapisać ustawień powiadomień.", newInvite: "Masz nowe zaproszenie do wspólnego wyzwania.", sharedLimit: "W wersji Free możesz mieć jedno wspólne wyzwanie. Więcej wymaga Premium.", acceptFailed: "Nie udało się zaakceptować wyzwania.", historyPremium: "Historia wyzwań jest dostępna w Premium. Twoja historia nie jest usuwana — w wersji Free pozostaje tylko zablokowana.", lockedFree: "Zablokowano w wersji Free" },
  de: { notificationSaveFailed: "Die Benachrichtigungseinstellungen konnten nicht gespeichert werden.", newInvite: "Du hast eine neue Einladung zu einer gemeinsamen Challenge.", sharedLimit: "In der Free-Version ist eine gemeinsame Challenge möglich. Für weitere benötigst du Premium.", acceptFailed: "Die Challenge konnte nicht angenommen werden.", historyPremium: "Der Challenge-Verlauf ist mit Premium verfügbar. Dein Verlauf wird nicht gelöscht, sondern ist in der Free-Version nur gesperrt.", lockedFree: "In der Free-Version gesperrt" },
};

function getIncomingSharedChallengeInvitesForUid(
  sharedChallenges: SharedChallenge[],
  uid: string
) {
  return sharedChallenges.filter((challenge) =>
    isIncomingSharedChallengeInviteForUid(challenge, uid)
  );
}

function getIncomingSharedChallengeInviteExclusionReason(
  challenge: SharedChallenge,
  uid: string
) {
  if (!uid) return "missing-current-user-uid";
  if (!Array.isArray(challenge.pendingInviteUids)) return "pendingInviteUids-not-array";
  if (!challenge.pendingInviteUids.includes(uid)) return "current-user-not-in-pendingInviteUids";
  return null;
}

function getCurrentVersionNameForDiagnostics() {
  const c = Constants as any;
  return String(
    c?.nativeAppVersion ??
      c?.expoConfig?.version ??
      c?.manifest?.version ??
      c?.manifest2?.extra?.expoClient?.version ??
      "unknown"
  );
}

function logProfileSharedChallengeInviteDiagnostics(
  sharedChallenges: SharedChallenge[],
  incomingSharedChallengeInvites: SharedChallenge[],
  uid: string
) {
  if (!__DEV__) return;

  const incomingBeforeFilters = sharedChallenges.filter((challenge) =>
    isIncomingSharedChallengeInviteForUid(challenge, uid)
  ).length;

  console.log("[DEV][profile/friends/shared-invites] currentUser.uid", uid);
  console.log(
    "[DEV][profile/friends/shared-invites] sharedChallenges total count received by Profile",
    sharedChallenges.length
  );
  console.log(
    "[DEV][profile/friends/shared-invites] incoming shared challenge invites count before filters",
    incomingBeforeFilters
  );
  console.log(
    "[DEV][profile/friends/shared-invites] incoming shared challenge invites count after filters",
    incomingSharedChallengeInvites.length
  );

  sharedChallenges.forEach((challenge) => {
    const pendingInviteUids = Array.isArray(challenge.pendingInviteUids)
      ? challenge.pendingInviteUids
      : [];
    const memberUids = Array.isArray(challenge.memberUids) ? challenge.memberUids : [];
    const acceptedBy = Array.isArray(challenge.acceptedBy) ? challenge.acceptedBy : [];
    const leftBy = Array.isArray(challenge.leftBy) ? challenge.leftBy : [];
    const included = incomingSharedChallengeInvites.some(
      (item) => String(item.id) === String(challenge.id)
    );

    console.log("[DEV][profile/friends/shared-invites] shared challenge", {
      challengeId: challenge.id,
      title: challenge.title,
      name: null,
      pendingInviteUids,
      memberUids,
      acceptedBy,
      leftBy,
      enabled: challenge.enabled,
      status: challenge.status,
      isCurrentUserPending: pendingInviteUids.includes(uid),
      isCurrentUserMember: memberUids.includes(uid),
      isCurrentUserAccepted: acceptedBy.includes(uid),
      isCurrentUserLeft: leftBy.includes(uid),
      includedInIncomingInvites: included,
      excludedReason: included
        ? null
        : getIncomingSharedChallengeInviteExclusionReason(challenge, uid),
    });
  });
}

export default function ProfileTabScreen() {
  const router = useRouter();
  const { open, t } = useLocalSearchParams<{ open?: string; t?: string }>();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { UI, isDark, toggle } = useTheme();
  const { lang, setLang } = useI18n();
  const whatsNew = getWhatsNewCopy(lang);
const profileLang =
  lang === "cs" || lang === "en" || lang === "pl" || lang === "de"
    ? lang
    : "en";

const p = PROFILE_STRINGS[profileLang];
const runtimeText = PROFILE_RUNTIME_STRINGS[profileLang];
const accountText = PROFILE_ACCOUNT_STRINGS[profileLang];
const accessText = PROFILE_ACCESS_STRINGS[profileLang];
const [currentUserUid, setCurrentUserUid] = useState(auth.currentUser?.uid ?? "");

useEffect(() => onAuthStateChanged(auth, (user) => {
  setCurrentUserUid(user?.uid ?? "");
  if (user?.displayName) setMyUsername((current) => current || user.displayName || "");
}), []);

const medalDayUnit =
  profileLang === "cs"
    ? "dní"
    : profileLang === "pl"
      ? "dni"
      : profileLang === "de"
        ? "Tage"
        : "days";

const loadingUserText =
  profileLang === "cs"
    ? "Načítám…"
    : profileLang === "pl"
      ? "Ładowanie…"
      : profileLang === "de"
        ? "Wird geladen…"
        : "Loading…";

const unknownUserText =
  profileLang === "cs"
    ? "Uživatel"
    : profileLang === "pl"
      ? "Użytkownik"
      : profileLang === "de"
        ? "Benutzer"
        : "User";

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
  const [premiumSubscription, setPremiumSubscription] =
    useState<PremiumSubscriptionState>(() => getPremiumSubscriptionState());
  const [premiumBusy, setPremiumBusy] = useState(false);
  const [premiumPaywallPhase, setPremiumPaywallPhase] =
    useState<PremiumPaywallPhase>("idle");
  const [premiumPaywallPackage, setPremiumPaywallPackage] =
    useState<Awaited<ReturnType<typeof getOfferingPackages>>[number] | null>(null);
  const [premiumPurchaseStatus, setPremiumPurchaseStatus] =
    useState<"opening" | "processing" | null>(null);
  const premiumOfferingFlowRef = useRef(
    new PremiumOfferingFlow<Awaited<ReturnType<typeof getOfferingPackages>>[number]>()
  );
  const premiumPackagesRef = useRef<Awaited<ReturnType<typeof getOfferingPackages>>>([]);
  const premiumPackageUidRef = useRef<string | null>(null);
  const lastPremiumAuthUidRef = useRef<string | null>(currentUserUid || null);
  const premiumPurchaseGuardRef = useRef(false);
  const selectedPremiumPackage = premiumPaywallPackage;
  const premiumOfferLoading =
    premiumPaywallPhase === "waitingForAuth" ||
    premiumPaywallPhase === "loadingOffering";
  const premiumSubscriptionPeriodText =
    selectedPremiumPackage?.product.subscriptionPeriod === "P1M" ||
    selectedPremiumPackage?.packageType === "MONTHLY"
      ? p.monthlySubscription
      : null;

  useEffect(() => {
    const uid = currentUserUid || null;
    if (lastPremiumAuthUidRef.current === uid) return;
    lastPremiumAuthUidRef.current = uid;
    premiumPackagesRef.current = [];
    premiumPackageUidRef.current = null;
    setPremiumPaywallPackage(null);
    if (!uid) setPremiumPaywallPhase("waitingForAuth");
  }, [currentUserUid]);

  // ✅ Modaly – všechno schované
  const [accountOpen, setAccountOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [addFriendOpen, setAddFriendOpen] = useState(false);
  const accountModalVisibleRef = useRef(false);
  const pendingAccountDestinationRef =
    useRef<AccountModalDestination | null>(null);

  // ✅ Přátelé (Firestore)
  const [friendEdges, setFriendEdges] = useState<FriendEdge[]>([]);
  const [friendNames, setFriendNames] = useState<Record<string, string>>({});
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [addUsername, setAddUsername] = useState("");
  const [friendsBusy, setFriendsBusy] = useState(false);
  const friendsModalVisibleRef = useRef(false);
  const pendingFriendsActionRef = useRef<PendingFriendsAction | null>(null);
  const removeFriendBusyRef = useRef(false);
  const declineFriendBusyRef = useRef(false);

// ✅ Přátelé modal – Přátelé / Výzvy
const [friendsTab, setFriendsTab] = useState<FriendsTab>("friends");
const [sharedInvites, setSharedInvites] = useState<SharedChallenge[]>([]);
const [sentSharedInvites, setSentSharedInvites] = useState<SharedChallenge[]>([]);
const [sharedChallenges, setSharedChallenges] = useState<SharedChallenge[]>([]);
const [sharedInvitesLoading, setSharedInvitesLoading] = useState(false);
const [pendingInviteQueryError, setPendingInviteQueryError] = useState<string | null>(null);

const [shareAchievementsWithFriends, setShareAchievementsWithFriends] = useState(true);
const [notificationsOpen, setNotificationsOpen] = useState(false);
const [notificationSettings, setNotificationSettings] =
  useState<NotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS);

  const [friendStatsOpen, setFriendStatsOpen] = useState(false);
  const [selectedFriendName, setSelectedFriendName] = useState("");
  const [selectedFriendLoading, setSelectedFriendLoading] = useState(false);
  const [selectedFriendShares, setSelectedFriendShares] = useState(true);
  const [selectedFriendStats, setSelectedFriendStats] = useState<FriendPreviewStats | null>(null);

  // ✅ delete účet modal (oranžové okno)
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteWorking, setDeleteWorking] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ✅ Info vnitřní navigace (menu jen ikonky)
  const [infoScreen, setInfoScreen] = useState<InfoScreen>("menu");
  const [expandedFaqIndex, setExpandedFaqIndex] = useState<number | null>(null);

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
  let cancelled = false;

  (async () => {
    const settings = await loadNotificationSettings();
    if (!cancelled) {
      setNotificationSettings(settings);
    }
  })();

  return () => {
    cancelled = true;
  };
}, []);

const updateNotificationSetting = async (
  key: keyof NotificationSettings,
  value: boolean
) => {
  const next = {
    ...notificationSettings,
    [key]: value,
  };

  setNotificationSettings(next);

  try {
    await saveNotificationSettings(next);

    if (key === "challengeReminders") {
      setRemindersPremiumEnabled(!!premium);
      if (value) {
        await refreshScheduledChallengeReminders();
        await refreshScheduledSharedReminders(sharedChallenges);
      } else {
        await cancelScheduledChallengeReminderNotifications();
      }
    }
  } catch {
    showPwdPopup(
      "error",
      runtimeText.notifications,
      accessText.notificationSaveFailed
    );
  }
};

  useEffect(() => {
    let mounted = true;
    isPremiumActive().then((p) => mounted && setPremium(!!p));
    const unsub = subscribePremium((p) => mounted && setPremium(!!p));
    const unsubSubscription = subscribePremiumSubscriptionState((state) => {
      if (mounted) setPremiumSubscription(state);
    });
    return () => {
      mounted = false;
      unsub?.();
      unsubSubscription();
    };
  }, []);
useEffect(() => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  (async () => {
    try {
      await withPremiumRequestTimeout(syncPremiumFromRevenueCat());
    } catch (e: any) {
      if (__DEV__) {
        console.log("[RevenueCat] sync error from profile screen", String(e?.code ?? ""));
      }
    }
  })();
}, [auth.currentUser?.uid]);

  // ✅ Načíst můj username do headeru (z profilu)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const uid = currentUserUid;
      if (!uid) return;
      const profileNameKey = `onemore_profile_name:${uid}`;
      try {
        const cachedName = (await AsyncStorage.getItem(profileNameKey))?.trim();
        if (!cancelled && cachedName) setMyUsername(cachedName);
        const profile = await getProfile(uid);
        const freshName = (profile?.username ?? "").trim();
        if (freshName) {
          await AsyncStorage.setItem(profileNameKey, freshName);
          await updateAccountDisplayName(uid, freshName).catch(() => {});
          if (!cancelled) setMyUsername(freshName);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUserUid]);

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

      setFriendEdges(edges);
      setFriendsLoading(false);

      const uids = [...new Set(edges.map((e) => e.otherUid))];
    const nextNames: Record<string, string> = {};

await Promise.all(
  uids.map(async (otherUid) => {
    try {
      const p = await getProfile(otherUid);

      const shownName =
        typeof p?.username === "string" && p.username.trim()
          ? p.username.trim()
          : "";

      if (shownName && shownName !== String(otherUid)) {
        nextNames[otherUid] = shownName;
      }
    } catch {
      if (__DEV__) {
        console.log("PROFILE CHECK ERROR");
      }
    }
  })
);

      if (cancelled) return;

      setFriendNames((prev) => ({
        ...prev,
        ...nextNames,
      }));
    });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [friendsOpen]);
  
const seenIncomingInviteIdsRef = useRef<string[]>([]);
const sharedInvitesInitializedRef = useRef(false);

    // ✅ Nepřijaté společné výzvy pro mě
  useEffect(() => {
   
    const uid = currentUserUid;
    if (!uid) {
      setSharedInvites([]);
      setSentSharedInvites([]);
      setSharedChallenges([]);
      setSharedInvitesLoading(false);
      setPendingInviteQueryError(null);
      seenIncomingInviteIdsRef.current = [];
      sharedInvitesInitializedRef.current = false;
      return;
    }

    let cancelled = false;
    setSharedInvitesLoading(true);

    const unsub = subscribeSharedChallenges(
      async (items) => {
        if (cancelled) return;

        setSharedChallenges(items);
    
        const incomingSharedChallengeInvites =
          getIncomingSharedChallengeInvitesForUid(items, uid);

        logProfileSharedChallengeInviteDiagnostics(
          items,
          incomingSharedChallengeInvites,
          uid
        );

        const outgoingPending = items.filter((item) => {
  const isPending = item.status === "pending";
  const createdByMe = String(item.createdBy) === String(uid);

  return isPending && createdByMe;
});

        const extraUids = Array.from(
          new Set(
            incomingSharedChallengeInvites.flatMap((item) => item.memberUids)
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

      if (shownName && shownName !== String(otherUid)) {
        nextNames[otherUid] = shownName;
      }
    } catch {
      nextNames[otherUid] = unknownUserText;
    }
  })
);

        if (cancelled) return;

        setFriendNames((prev) => ({
          ...prev,
          ...nextNames,
        }));

   const nextIncomingIds = incomingSharedChallengeInvites.map((item) => String(item.id));

if (sharedInvitesInitializedRef.current) {
  const hasNewInvite = nextIncomingIds.some(
    (id) => !seenIncomingInviteIdsRef.current.includes(id)
  );

  if (hasNewInvite) {
    showPwdPopup(
      "success",
      runtimeText.newChallenge,
      accessText.newInvite
    );
  }
} else {
  sharedInvitesInitializedRef.current = true;
}

seenIncomingInviteIdsRef.current = nextIncomingIds;

setSharedInvites(incomingSharedChallengeInvites);
setSentSharedInvites(outgoingPending);
setSharedInvitesLoading(false);
      },
      (e) => {
        if (__DEV__) {
          console.log("[shared-invites/profile] subscribe error", e);
        }
        if (cancelled) return;
        setSharedInvites([]);
        setSharedInvitesLoading(false);
      },
      (debug) => {
        if (cancelled || debug.queryName !== "pendingInviteUids") return;

        if (debug.error) {
          const code = String(debug.error?.code ?? "").trim();
          const message = String(debug.error?.message ?? debug.error ?? "").trim();
          setPendingInviteQueryError(
            [code, message].filter(Boolean).join(": ") || "unknown pendingInviteUids query error"
          );
          return;
        }

        setPendingInviteQueryError(null);
      }
    );

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [accessText.newInvite, currentUserUid, friendsOpen, lang, runtimeText.newChallenge, unknownUserText]);

  const email = (auth.currentUser?.email ?? "").trim();

 const getShownFriendName = (uid: string) => {
  const v = friendNames[uid];
  if (typeof v === "string" && v.trim() && v.trim() !== String(uid)) return v.trim();
  return lang === "cs"
    ? "Přítel"
    : lang === "pl"
      ? "Znajomy"
      : lang === "de"
        ? "Freund"
        : "Friend";
};

const incomingSharedChallengeInvites = sharedInvites;
const pendingInviteCount = incomingSharedChallengeInvites.length;
const sharedInviteDiagnosticsVersionName = getCurrentVersionNameForDiagnostics();
const sharedInviteDiagnosticsBuild = getCurrentVersionCode();
const sharedInviteDiagnosticsRows = sharedChallenges.map((challenge) => {
  const pendingInviteUids = Array.isArray(challenge.pendingInviteUids)
    ? challenge.pendingInviteUids
    : [];
  const memberUids = Array.isArray(challenge.memberUids) ? challenge.memberUids : [];
  const acceptedBy = Array.isArray(challenge.acceptedBy) ? challenge.acceptedBy : [];
  const leftBy = Array.isArray(challenge.leftBy) ? challenge.leftBy : [];
  const included = incomingSharedChallengeInvites.some(
    (item) => String(item.id) === String(challenge.id)
  );

  return {
    challenge,
    pendingInviteUids,
    memberUids,
    acceptedBy,
    leftBy,
    included,
    excludedReason: included
      ? null
      : getIncomingSharedChallengeInviteExclusionReason(challenge, currentUserUid),
    isCurrentUserPending: pendingInviteUids.includes(currentUserUid),
    isCurrentUserMember: memberUids.includes(currentUserUid),
    isCurrentUserAccepted: acceptedBy.includes(currentUserUid),
    isCurrentUserLeft: leftBy.includes(currentUserUid),
  };
});
const sharedChallengeInvitationsTitle =
  lang === "cs"
    ? "Pozvánky do společných výzev"
    : lang === "pl"
      ? "Zaproszenia do wspólnych wyzwań"
      : lang === "de"
        ? "Einladungen zu gemeinsamen Challenges"
        : "Shared challenge invitations";
const noNewSharedInvitationsText =
  lang === "cs"
    ? "Nemáte žádné nové pozvánky."
    : lang === "pl"
      ? "Nie masz nowych zaproszeń."
      : lang === "de"
        ? "Du hast keine neuen Einladungen."
        : "You have no new invitations.";

const myUid = auth.currentUser?.uid ?? "";

const acceptedSharedChallengesForLimit = sharedChallenges.filter((item) =>
  isAcceptedSharedChallengeForUid(item, myUid)
);
const sharedChallengeLimitCount = acceptedSharedChallengesForLimit.length;

if (__DEV__) {
  const countedIds = acceptedSharedChallengesForLimit.map((item) => String(item.id));
  const excluded = sharedChallenges
    .filter((item) => !countedIds.includes(String(item.id)))
    .map((item) => {
      const pendingInviteUids = Array.isArray(item.pendingInviteUids) ? item.pendingInviteUids : [];
      const memberUids = Array.isArray(item.memberUids) ? item.memberUids : [];
      const acceptedBy = Array.isArray(item.acceptedBy) ? item.acceptedBy : [];
      const leftBy = Array.isArray(item.leftBy) ? item.leftBy : [];
      let reason = "not-current-user-member";

      if (!myUid) reason = "missing-current-user-uid";
      else if (!memberUids.includes(myUid)) reason = "current-user-not-in-memberUids";
      else if (!acceptedBy.includes(myUid)) reason = "current-user-not-in-acceptedBy";
      else if (pendingInviteUids.includes(myUid)) reason = "current-user-still-pending-invite";
      else if (leftBy.includes(myUid)) reason = "current-user-left";
      else if (item.enabled === false) reason = "disabled";
      else if (item.status === "declined") reason = "declined";
      else if (item.status === "pending" && String(item.createdBy) === String(myUid)) {
        reason = "outgoing-pending-invite";
      }

      return { id: item.id, reason };
    });

  console.log("[DEV][profile/shared-limit]", {
    currentUid: myUid,
    totalLoadedSharedChallenges: sharedChallenges.length,
    acceptedSharedChallengeCount: sharedChallengeLimitCount,
    pendingIncomingInviteCount: incomingSharedChallengeInvites.length,
    countedIds,
    excluded,
  });
}

const freeSharedLimitReached =
  !premium && sharedChallengeLimitCount >= 1;

  const FREE_ACTIVE_FRIENDS_LIMIT = 1;

function isFriendLockedInFree(index: number) {
  return !premium && index >= FREE_ACTIVE_FRIENDS_LIMIT;
}

function showPremiumLock(message?: string) {
  Alert.alert(
    p.premium,
    message ??
      (lang === "cs"
        ? "Tahle položka je uložená, ale ve Free verzi je zamčená. Obnov Premium a znovu se odemkne."
        : "This item is saved, but locked in the Free version. Restore Premium to unlock it again.")
  );
}

const me = auth.currentUser?.uid ?? "";

const pendingFriendRequestCount = friendEdges.filter(
  (e) =>
    e.status === "pending" &&
    String(e.initiatedBy) !== String(me)
).length;

const getInviteCreatorName = (challenge: SharedChallenge) => {
  const creatorUid = String(challenge.createdBy ?? "");
  const v = friendNames[creatorUid];
  if (typeof v === "string" && v.trim() && v.trim() !== creatorUid) return v.trim();
  return loadingUserText;
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
      if (typeof v === "string" && v.trim() && v.trim() !== String(uid)) return v.trim();
      return loadingUserText;
    });

    if (!names.length) return p.sharedChallenge;
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]}, ${names[1]}`;
    return `${names[0]}, ${names[1]} +${names.length - 2}`;
  };

  function getSharedInviteActionErrorMessage(e: any, fallback: string) {
    const code = String(e?.code ?? "").toLowerCase();
    const message = String(e?.message ?? "").toLowerCase();

    if (
      code.includes("not-found") ||
      message === "not-found" ||
      message.includes("not found") ||
      message.includes("nebyla nalezena") ||
      message.includes("nepodařilo se najít")
    ) {
      if (lang === "en") return "The invitation could not be found. It may have been cancelled or expired.";
      if (lang === "pl") return "Nie udało się znaleźć zaproszenia. Mogło zostać anulowane lub wygasło.";
      if (lang === "de") return "Die Einladung konnte nicht gefunden werden. Sie wurde möglicherweise abgebrochen oder ist abgelaufen.";
      return "Pozvánku se nepodařilo najít. Možná už byla zrušena nebo vypršela.";
    }

    return e?.message ?? fallback;
  }

async function acceptSharedInviteFromFriends(challengeId: string) {
  const blockingCountExceptThis = sharedChallenges.filter((item) => {
    const isSameChallenge = String(item.id) === String(challengeId);
    return !isSameChallenge && isAcceptedSharedChallengeForUid(item, myUid);
  }).length;

  if (!premium && blockingCountExceptThis >= 1) {
    Alert.alert(
      p.premium,
      accessText.sharedLimit
    );
    return;
  }

  try {
    setFriendsBusy(true);
    await acceptSharedChallenge(challengeId);
    showPwdPopup(
      "success",
      p.challenges,
      runtimeText.accepted
    );
  } catch (e: any) {
    showPwdPopup(
      "error",
      p.challenges,
      getSharedInviteActionErrorMessage(
        e,
        accessText.acceptFailed
      )
    );
  } finally {
    setFriendsBusy(false);
  }
}

async function declineSharedInviteFromFriends(challengeId: string) {
  try {
    setFriendsBusy(true);
    await declineSharedChallenge(challengeId);
    showPwdPopup("success", p.challenges, runtimeText.declined);
  } catch (e: any) {
    showPwdPopup(
      "error",
      p.challenges,
      getSharedInviteActionErrorMessage(
        e,
        runtimeText.declineFailed
      )
    );
  } finally {
    setFriendsBusy(false);
  }
}

  const styles = useMemo(
    () => makeStyles(UI, insets.top, insets.bottom, windowHeight),
    [UI, insets.top, insets.bottom, windowHeight]
  );
const noScaleText = {
  allowFontScaling: false as const,
  maxFontSizeMultiplier: 1,
};
const faqTitle =
  lang === "cs"
    ? "Časté dotazy"
    : lang === "pl"
      ? "Najczęstsze pytania"
      : lang === "de"
        ? "Häufige Fragen"
        : "FAQ";

const faqItems = useMemo(() => {
  if (lang === "en") {
    return [
      {
        q: "What happens if I miss one day?",
        a: "Each challenge has its own free day. After a 10-day streak, you get one free day. If you forget one day, your streak does not reset and the free day is used. Free days do not stack, so you can always have at most one. The missed day still does not count as completed.",
      },
      {
        q: "What happens when Premium ends?",
        a: "Your challenges, friends, history and shared challenges are not deleted. Items above the Free limits are only locked. If you restore Premium, they unlock again.",
      },
      {
        q: "What are the Free limits?",
        a: "In the Free version you can actively use 2 challenges, 1 friend, 1 shared challenge and notifications for 1 challenge. Challenge history is a Premium feature.",
      },
      {
        q: "How do I choose which challenges stay active in Free?",
        a: "The first 2 challenges in your list stay active. You can reorder challenges and move the ones you want to use into the first two positions.",
      },
      {
        q: "How do notifications work in the Free version?",
        a: "Free users can have notifications enabled for only one challenge. To use notifications for another challenge, first turn them off on the current one and save the change.",
      },
      {
        q: "Why are my notifications not arriving?",
        a: "Android may limit apps to save battery. Open Phone Settings → Apps → OneMore → Battery and set OneMore to Unrestricted, or disable battery optimization. Also check that notifications are allowed.",
      },
      {
        q: "How do shared challenges work?",
        a: "Shared challenges let you complete a goal with friends and see everyone’s progress. In Free, only one shared challenge can be active or pending.",
      },
      {
        q: "What is Easy Mode?",
        a: "Easy Mode is a fun mode. A challenge in Easy Mode does not lose fire streaks when you miss a day. However, it does not count toward the total streak and does not earn new medals. Once Easy Mode is enabled, it cannot be turned off. Challenge history remains visible so you can see which days you completed and which days you missed.",
      },
      {
        q: "How do I cancel Premium?",
        a: "Premium is managed by Google Play or the App Store. Open the Premium section in OneMore and use the subscription management button.",
      },
    ];
  }

  if (lang === "pl") {
    return [
      {
        q: "Co się stanie, jeśli opuszczę jeden dzień?",
        a: "Każde wyzwanie ma własny wolny dzień. Po 10 dniach serii dostajesz jeden wolny dzień. Jeśli jednego dnia zapomnisz, seria się nie zerwie, a wolny dzień zostanie użyty. Wolne dni się nie kumulują, więc zawsze możesz mieć maksymalnie jeden. Opuszczony dzień nie liczy się jednak jako ukończony.",
      },
      {
        q: "Co się stanie, gdy Premium się skończy?",
        a: "Twoje wyzwania, znajomi, historia i wspólne wyzwania nie zostaną usunięte. Elementy ponad limity Free będą tylko zablokowane. Po odnowieniu Premium odblokują się ponownie.",
      },
      {
        q: "Jakie są limity wersji Free?",
        a: "W wersji Free możesz aktywnie używać 2 wyzwań, 1 znajomego, 1 wspólnego wyzwania i powiadomień dla 1 wyzwania. Historia wyzwań jest funkcją Premium.",
      },
      {
        q: "Jak wybrać, które wyzwania zostaną aktywne we Free?",
        a: "Aktywne zostają pierwsze 2 wyzwania na liście. Możesz zmienić kolejność i przesunąć wybrane wyzwania na pierwsze dwie pozycje.",
      },
      {
        q: "Jak działają powiadomienia w wersji Free?",
        a: "W wersji Free możesz mieć powiadomienia tylko dla jednego wyzwania. Jeśli chcesz użyć ich przy innym wyzwaniu, najpierw wyłącz je przy obecnym i zapisz zmianę.",
      },
      {
        q: "Dlaczego powiadomienia nie przychodzą?",
        a: "Android może ograniczać aplikacje, aby oszczędzać baterię. Otwórz Ustawienia telefonu → Aplikacje → OneMore → Bateria i ustaw Bez ograniczeń albo wyłącz optymalizację baterii. Sprawdź też, czy powiadomienia są dozwolone.",
      },
      {
        q: "Jak działają wspólne wyzwania?",
        a: "Wspólne wyzwania pozwalają realizować cel ze znajomymi i śledzić postęp wszystkich osób. W wersji Free aktywne lub oczekujące może być tylko jedno wspólne wyzwanie.",
      },
      {
        q: "Czym jest tryb easy?",
        a: "Tryb easy to tryb dla zabawy. Wyzwanie w trybie easy nie traci płomieni, gdy opuścisz dzień. Jednocześnie nie liczy się do ogólnej serii i nie zdobywa nowych medali. Po włączeniu trybu easy nie można go wyłączyć. Historia wyzwania pozostaje widoczna, aby było widać, które dni zostały wykonane, a które pominięte.",
      },
      {
        q: "Jak anulować Premium?",
        a: "Premium jest zarządzane przez Google Play albo App Store. Otwórz sekcję Premium w OneMore i użyj przycisku zarządzania subskrypcją.",
      },
    ];
  }

  if (lang === "de") {
    return [
      {
        q: "Was passiert, wenn ich einen Tag auslasse?",
        a: "Jede Challenge hat ihren eigenen freien Tag. Nach einer 10-Tage-Serie bekommst du einen freien Tag. Wenn du einen Tag vergisst, wird deine Serie nicht zurückgesetzt und der freie Tag wird verwendet. Freie Tage sammeln sich nicht an, du kannst also immer höchstens einen haben. Der ausgelassene Tag zählt aber nicht als erledigt.",
      },
      {
        q: "Was passiert, wenn Premium endet?",
        a: "Deine Challenges, Freunde, der Verlauf und gemeinsame Challenges werden nicht gelöscht. Elemente über den Free-Limits werden nur gesperrt. Wenn du Premium wieder aktivierst, werden sie erneut freigeschaltet.",
      },
      {
        q: "Welche Limits hat die Free-Version?",
        a: "In der Free-Version kannst du 2 Challenges, 1 Freund, 1 gemeinsame Challenge und Benachrichtigungen für 1 Challenge aktiv nutzen. Der Challenge-Verlauf ist eine Premium-Funktion.",
      },
      {
        q: "Wie wähle ich, welche Challenges in Free aktiv bleiben?",
        a: "Die ersten 2 Challenges in deiner Liste bleiben aktiv. Du kannst die Reihenfolge ändern und die gewünschten Challenges nach oben verschieben.",
      },
      {
        q: "Wie funktionieren Benachrichtigungen in Free?",
        a: "Free-Nutzer können Benachrichtigungen nur für eine Challenge aktiv haben. Wenn du sie für eine andere Challenge nutzen möchtest, deaktiviere sie zuerst bei der aktuellen Challenge und speichere die Änderung.",
      },
      {
        q: "Warum kommen meine Benachrichtigungen nicht an?",
        a: "Android kann Apps einschränken, um Akku zu sparen. Öffne Einstellungen → Apps → OneMore → Akku und stelle OneMore auf Uneingeschränkt oder deaktiviere die Akku-Optimierung. Prüfe auch, ob Benachrichtigungen erlaubt sind.",
      },
      {
        q: "Wie funktionieren gemeinsame Challenges?",
        a: "Gemeinsame Challenges ermöglichen es dir, ein Ziel zusammen mit Freunden zu erfüllen und den Fortschritt aller zu sehen. In Free kann nur eine gemeinsame Challenge aktiv oder ausstehend sein.",
      },
      {
        q: "Was ist der Easy Mode?",
        a: "Der Easy Mode ist ein Spaßmodus. Eine Challenge im Easy Mode verliert keine Feuer-Serie, wenn du einen Tag auslässt. Gleichzeitig zählt sie nicht zum Gesamt-Streak und sammelt keine neuen Medaillen. Sobald der Easy Mode aktiviert ist, kann er nicht mehr deaktiviert werden. Der Challenge-Verlauf bleibt sichtbar, damit du sehen kannst, welche Tage du geschafft und welche du verpasst hast.",
      },
      {
        q: "Wie kündige ich Premium?",
        a: "Premium wird über Google Play oder den App Store verwaltet. Öffne den Premium-Bereich in OneMore und nutze den Button zur Abo-Verwaltung.",
      },
    ];
  }

  return [
    {
      q: "Co se stane, když jeden den vynechám?",
      a: "Každá výzva má vlastní volný den. Po 10 dnech streaku získáš jeden volný den. Když jeden den zapomeneš, streak se ti nezruší a volný den se použije. Volné dny se nekumulují, takže můžeš mít vždy maximálně jeden. Vynechaný den se ale nepočítá jako splněný.",
    },
    {
      q: "Co se stane, když mi skončí Premium?",
      a: "Tvoje výzvy, přátelé, historie ani společné výzvy se nesmažou. Položky nad limitem Free verze se jen zamknou. Po obnovení Premium se znovu odemknou.",
    },
    {
      q: "Jaké jsou limity Free verze?",
      a: "Ve Free verzi můžeš aktivně používat 2 výzvy, 1 přítele, 1 společnou výzvu a notifikace u 1 výzvy. Historie výzev je Premium funkce.",
    },
    {
      q: "Jak vyberu, které výzvy budou ve Free aktivní?",
      a: "Aktivní jsou první 2 výzvy v seznamu. Výzvy si můžeš přesunout a dát nahoru ty, které chceš ve Free používat.",
    },
    {
      q: "Jak fungují notifikace ve Free verzi?",
      a: "Ve Free verzi můžeš mít aktivní notifikace jen u jedné výzvy. Pokud chceš notifikace u jiné výzvy, nejdřív je vypni u původní výzvy a změnu ulož.",
    },
    {
      q: "Proč mi nechodí notifikace?",
      a: "Android může aplikaci omezovat kvůli baterii. Otevři Nastavení telefonu → Aplikace → OneMore → Baterie a nastav Bez omezení, případně vypni optimalizaci baterie. Zkontroluj také, že jsou oznámení povolená.",
    },
    {
      q: "Jak fungují společné výzvy?",
      a: "Společné výzvy ti umožní plnit cíl s přáteli a sledovat pokrok všech členů. Ve Free verzi může být aktivní nebo rozpracovaná jen jedna společná výzva.",
    },
    {
      q: "Co je Easy mode?",
      a: "Easy mode je režim pro zábavu. Výzva v Easy mode neztrácí ohýnky, když některý den vynecháte. Zároveň se ale nepočítá do celkového streaku a nesbírá nové medaile. Jakmile Easy mode zapnete, nejde ho vypnout. Historie výzvy zůstává viditelná, abyste viděli, které dny jste splnili a které ne.",
    },
    {
      q: "Jak zruším Premium?",
      a: "Premium se spravuje přes Google Play nebo App Store. V OneMore otevři sekci Premium a použij tlačítko pro správu předplatného.",
    },
  ];
}, [lang]);
  // ✅ víc oranžové pozadí v light režimu
  const gradientColors = isDark
    ? [UI.bg, UI.bg]
    : [UI.accent, UI.bg, UI.bg, UI.accent];

  const gradientLocations = isDark ? [0, 1] : [0, 0.3, 0.7, 1];

  const showAccountDestination = (
    destination: AccountModalDestination
  ) => {
    if (destination === "password") {
      setPwdOpen(true);
      return;
    }

    if (destination === "username") {
      setNewUsername("");
      setUsernameOpen(true);
      return;
    }

    if (destination === "delete") {
      setDeletePassword("");
      setDeleteError(null);
      setDeleteOpen(true);
      return;
    }

    setInfoScreen(destination === "premium" ? "paywall" : "menu");
    setInfoOpen(true);
  };

  const openAccountDestination = (
    destination: AccountModalDestination
  ) => {
    if (Platform.OS === "ios" && accountModalVisibleRef.current) {
      pendingAccountDestinationRef.current = destination;
      setAccountOpen(false);
      return;
    }

    setAccountOpen(false);
    showAccountDestination(destination);
  };

  const handleAccountModalDismiss = () => {
    accountModalVisibleRef.current = false;
    const destination = pendingAccountDestinationRef.current;
    pendingAccountDestinationRef.current = null;
    if (destination) showAccountDestination(destination);
  };

  const openPayments = () => {
    openAccountDestination("premium");
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

  useEffect(() => {
    if (infoScreen !== "faq") {
      setExpandedFaqIndex(null);
    }
  }, [infoScreen]);

  const loadPremiumPackages = async () => {
    const uid = auth.currentUser?.uid ?? null;
    if (!uid) {
      setPremiumPaywallPackage(null);
      setPremiumPaywallPhase("waitingForAuth");
      return null;
    }
    setPremiumPaywallPhase("loadingOffering");

    try {
      if (__DEV__) console.log("[RevenueCat Paywall] offering load started", { firebaseUidReady: !!auth.currentUser?.uid });
      const outcome = await premiumOfferingFlowRef.current.load(async (attempt) => {
        if (__DEV__) console.log("[RevenueCat Paywall] offering attempt", { attempt: attempt + 1, firebaseUidReady: !!auth.currentUser?.uid });
        return withPremiumRequestTimeout(getOfferingPackages(attempt > 0));
      }, 2);
      if (outcome.status === "stale") {
        if (__DEV__) console.log("[RevenueCat Paywall] ignored stale offering result", { requestId: outcome.requestId });
        return null;
      }
      if (outcome.status === "cached") {
        premiumPackagesRef.current = outcome.packages;
        premiumPackageUidRef.current = uid;
        setPremiumPaywallPackage(outcome.packages[0] ?? null);
        setPremiumPaywallPhase(outcome.packages[0] ? "ready" : "unavailable");
        if (__DEV__) console.log("[RevenueCat Paywall] refresh failed; retained valid package", { packageCount: outcome.packages.length });
        return outcome.packages;
      }
      const packages = outcome.status === "ready" ? outcome.packages : [];

      if (!packages.length) {
        premiumPackagesRef.current = [];
        premiumPackageUidRef.current = uid;
        setPremiumPaywallPackage(null);
        setPremiumPaywallPhase("unavailable");
        return null;
      }

      premiumPackagesRef.current = packages;
      premiumPackageUidRef.current = uid;
      setPremiumPaywallPackage(packages[0]);
      setPremiumPaywallPhase("ready");
      if (__DEV__) console.log("[RevenueCat Paywall] package ready", { packageCount: packages.length, packageType: packages[0]?.packageType ?? null });
      return packages;
    } catch (error) {
      if (premiumPackageUidRef.current === uid && premiumPackagesRef.current.length) {
        setPremiumPaywallPackage(premiumPackagesRef.current[0]);
        setPremiumPaywallPhase("ready");
        return premiumPackagesRef.current;
      }
      setPremiumPaywallPackage(null);
      setPremiumPaywallPhase("unavailable");
      if (__DEV__) console.log("[RevenueCat] offering request failed", String((error as any)?.code ?? (error as any)?.message ?? error));
      return null;
    }
  };

  useEffect(() => {
    if (!infoOpen || infoScreen !== "paywall" || premium) return;

    const offeringFlow = premiumOfferingFlowRef.current;
    const uid = auth.currentUser?.uid ?? null;
    const cachedPackages = premiumPackageUidRef.current === uid
      ? premiumPackagesRef.current
      : [];
    if (!cachedPackages.length) {
      premiumPackagesRef.current = [];
      setPremiumPaywallPackage(null);
    }
    offeringFlow.beginOpen(cachedPackages);
    setPremiumPaywallPhase(uid ? "loadingOffering" : "waitingForAuth");
    setPremiumPurchaseStatus(null);
    void loadPremiumPackages();
    return () => {
      offeringFlow.close();
      setPremiumPaywallPhase("idle");
    };
  }, [infoOpen, infoScreen, premium, currentUserUid]);

const buyPremium = async () => {
  if (
    premium ||
    premiumBusy ||
    premiumOfferLoading ||
    !canUpgradePremium(premiumPaywallPhase, premiumPaywallPackage) ||
    premiumPurchaseGuardRef.current
  ) {
    return;
  }

  premiumPurchaseGuardRef.current = true;
  setPremiumBusy(true);

  try {
    const selectedPackage = premiumPaywallPackage;
    if (!selectedPackage) return;

    if (__DEV__) console.log("[RevenueCat Paywall] purchase started", { packageIdentifier: selectedPackage.identifier, packageType: selectedPackage.packageType, productIdentifier: selectedPackage.product.identifier });
    setPremiumPaywallPhase("purchasing");
    setPremiumPurchaseStatus("opening");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    await purchasePackage(selectedPackage, {
      onStorePurchaseCompleted: () =>
        setPremiumPurchaseStatus("processing"),
    });

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    Alert.alert(p.premium, p.premiumPurchaseActivated);
   } catch (error: any) {
    const originalError = error?.originalError ?? error;
    const errorCode = String(originalError?.code ?? "");
    const readableErrorCode = String(
      originalError?.readableErrorCode ??
      originalError?.userInfo?.readableErrorCode ??
      ""
    ).toLowerCase();
    const wasCancelled =
      originalError?.userCancelled === true ||
      errorCode === "1" ||
      readableErrorCode.includes("purchase_cancelled");

    if (__DEV__) console.log("[RevenueCat Paywall] purchase failed", { cancelled: wasCancelled, code: errorCode || readableErrorCode || "unknown" });

    setPremiumPaywallPhase(wasCancelled ? "purchaseCancelled" : "purchaseFailed");

    Alert.alert(
      p.premium,
      wasCancelled
        ? p.premiumPurchaseCancelled
        : lang === "cs"
        ? "Nákup se nepodařilo dokončit. Zkus to prosím znovu."
        : lang === "pl"
        ? "Nie udało się dokończyć zakupu. Spróbuj ponownie."
        : lang === "de"
        ? "Der Kauf konnte nicht abgeschlossen werden. Bitte versuche es erneut."
        : "The purchase could not be completed. Please try again."
    );
  } finally {
    premiumPurchaseGuardRef.current = false;
    setPremiumPurchaseStatus(null);
    setPremiumBusy(false);
  }
};

  const openPremiumManagement = async () => {
    if (premiumBusy) return;
    setPremiumBusy(true);
    try {
      await withPremiumRequestTimeout(
        openCancelSubscription(premiumSubscription.managementURL)
      );
    } catch {
      Alert.alert(p.premium, p.premiumManagementOpenFailed);
    } finally {
      setPremiumBusy(false);
    }
  };

  const managePremiumNow = async () => {
    if (premiumBusy) return;

    if (premiumSubscription.willRenew !== true) {
      await openPremiumManagement();
      return;
    }

    Alert.alert(
      runtimeText.cancelPremium,
      runtimeText.cancelPremiumText,
      [
        { text: runtimeText.no, style: "cancel" },
        {
          text: p.open,
          style: "default",
          onPress: openPremiumManagement,
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
      Alert.alert(p.premium, v ? runtimeText.premiumActive : runtimeText.premiumInactive);
    } catch {
      Alert.alert(p.premium, runtimeText.premiumRestoreFailed);
    } finally {
      setPremiumBusy(false);
    }
  };

  const closeDeleteAccountModal = () => {
    if (deleteWorking) return;
    Keyboard.dismiss();
    setDeletePassword("");
    setDeleteError(null);
    setDeleteOpen(false);
  };

  const requestDeleteAccount = () => {
    openAccountDestination("delete");
  };

  // ✅ REÁLNÉ smazání účtu (Firestore + usernames + Firebase Auth)
  const performDeleteAccount = async () => {
    if (deleteWorking) return;

    const user = auth.currentUser;
    if (!user) {
      setDeleteError(p.deleteNotSignedIn);
      return;
    }

    const canReauthenticateWithPassword =
      !!user.email &&
      user.providerData.some((provider) => provider.providerId === "password");

    if (!canReauthenticateWithPassword || !user.email) {
      setDeleteError(p.deleteUnsupportedProvider);
      return;
    }

    const pwd = deletePassword;
    if (!pwd) {
      setDeleteError(p.deleteMissingPassword);
      return;
    }

    Keyboard.dismiss();
    setDeleteError(null);
    setDeleteWorking(true);

    try {
      const credential = EmailAuthProvider.credential(user.email, pwd);
      await reauthenticateWithCredential(user, credential);
      await user.getIdToken(true);

      // Existing trusted backend cleanup removes the Auth user together with
      // users/{uid}, usernames/{usernameLower}, publicProfiles/{uid},
      // friend edges and push tokens.
      const deleteAccount = httpsCallable(functions, "deleteMyAccount");
      await deleteAccount();

      try {
        await revenueCatLogout();
      } catch {
        // Account deletion must not fail because optional local cleanup failed.
      }

      try {
        await clearSessionAfterExplicitLogout();
        await signOut(auth);
      } catch {
        // The backend already removed the Firebase Auth user.
      }

      await clearOneMoreStorage();
      setDeletePassword("");
      setDeleteError(null);
      setDeleteOpen(false);
      setAccountOpen(false);
      router.replace("/login");
    } catch (err: any) {
      const code = String(err?.code ?? "").toLowerCase();
      if (__DEV__) {
        console.log("performDeleteAccount error", code);
      }

      if (
        code.includes("auth/wrong-password") ||
        code.includes("auth/invalid-credential") ||
        code.includes("auth/invalid-login-credentials")
      ) {
        setDeleteError(p.deleteWrongPassword);
        return;
      }

      if (
        code.includes("auth/network-request-failed") ||
        code.includes("functions/unavailable") ||
        code.includes("functions/deadline-exceeded")
      ) {
        setDeleteError(p.deleteNetworkError);
        return;
      }

      if (
        code.includes("auth/requires-recent-login") ||
        code.includes("functions/failed-precondition") ||
        code.includes("failed-precondition")
      ) {
        setDeleteError(p.deleteUnsupportedProvider);
        return;
      }

      if (
        code.includes("auth/user-mismatch") ||
        code.includes("auth/operation-not-allowed")
      ) {
        setDeleteError(p.deleteUnsupportedProvider);
        return;
      }

      if (
        code.includes("auth/user-not-found") ||
        code.includes("functions/unauthenticated") ||
        code.includes("unauthenticated")
      ) {
        setDeleteError(p.deleteNotSignedIn);
        return;
      }

      setDeleteError(p.deleteGenericError);
    } finally {
      setDeleteWorking(false);
    }
  };

  const openExternalLink = async (url: string, errorMessage: string) => {
    try {
      const ok = await Linking.canOpenURL(url);
      if (!ok) throw new Error("LINK_NOT_SUPPORTED");
      await Linking.openURL(url);
    } catch {
      Alert.alert(p.linkTitle, errorMessage);
    }
  };

  const openPrivacyLink = () =>
    openExternalLink(PRIVACY_URL, p.privacyLinkFailed);

  const openTermsLink = () =>
    openExternalLink(TERMS_URL, p.termsLinkFailed);

  const sendSupport = async () => {
    const e = supportEmail.trim();
    const s = supportSubject.trim();
    const m = supportMessage.trim();

    if (!e || !s || !m) {
      showPwdPopup("error", runtimeText.support, runtimeText.supportMissing);
      return;
    }

    if (!auth.currentUser) {
      showPwdPopup("error", runtimeText.support, runtimeText.signInRequired);
      return;
    }

    setSupportSending(true);
    try {
      const call = httpsCallable(functions, "sendSupportEmail");
      await call({ email: e, subject: s, message: m });

      setSupportSubject("");
      setSupportMessage("");

      // ✅ místo bílého Alert.alert použijeme tvůj oranžový popup
      showPwdPopup("success", runtimeText.sent, runtimeText.supportSent);

      setInfoScreen("menu");
    } catch (err: any) {
      const code = String(err?.code ?? "");
      const msg0 = String(err?.message ?? "");

      let msg = runtimeText.supportFailed;
      if (code.includes("unauthenticated")) msg = runtimeText.signInRequired;
      else if (code.includes("permission-denied"))
        msg = runtimeText.permissionDenied;
      else if (code.includes("invalid-argument"))
        msg = runtimeText.checkFields;
      else if (msg0) msg = msg0;

      showPwdPopup("error", runtimeText.error, msg);
    } finally {
      setSupportSending(false);
    }
  };

  const requestPasswordReset = async () => {
    const e = pwdEmail.trim();
    if (!e) {
      setPwdError(runtimeText.enterEmail);
      showPwdPopup("error", runtimeText.missingEmail, runtimeText.missingEmailText);
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
        runtimeText.done,
        runtimeText.resetSent
      );
    } catch (err: any) {
      const code = String(err?.code ?? "");
      let msg = runtimeText.emailFailed;

      if (code.includes("auth/invalid-email"))
        msg = runtimeText.invalidEmail;
      else if (code.includes("auth/user-not-found"))
        msg = runtimeText.noAccount;
      else if (code.includes("auth/too-many-requests"))
        msg = runtimeText.tooMany;

      setPwdError(msg);
      showPwdPopup("error", runtimeText.couldNotSend, msg);
    } finally {
      setPwdSending(false);
    }
  };

  const saveUsername = async () => {
    if (usernameBusy) return;

    const username = newUsername.trim();
    if (!username) {
      showPwdPopup(
        "error",
        runtimeText.usernameChange,
        accountText.enterUsername
      );
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      showPwdPopup(
        "error",
        runtimeText.usernameChange,
        runtimeText.notSignedIn
      );
      return;
    }

    setUsernameBusy(true);
    try {
      await withUsernameSaveTimeout(changeUsername(user.uid, username));

      setMyUsername(username);
      setUsernameOpen(false);
      setNewUsername("");

      void withUsernameSaveTimeout(
        updateProfile(user, { displayName: username })
      ).catch((error) => {
        if (__DEV__) {
          console.log("[Username] Firebase Auth profile update failed", error);
        }
      });

      showPwdPopup(
        "success",
        runtimeText.done,
        accountText.usernameChanged
      );
    } catch (error: any) {
      const message =
        error?.message === USERNAME_SAVE_TIMEOUT_ERROR
          ? accountText.saveTimeout
          : error?.message ?? runtimeText.changeFailed;

      showPwdPopup(
        "error",
        runtimeText.usernameChange,
        message
      );
    } finally {
      setUsernameBusy(false);
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

  async function removeFriendWithFeedback(friendUid: string) {
    if (removeFriendBusyRef.current) return;

    removeFriendBusyRef.current = true;
    setFriendsBusy(true);

    try {
      await removeFriend(friendUid);
      if (__DEV__) {
        console.log("[DEV][friends] remove friend success", { friendUid });
      }
    } catch (error: any) {
      if (__DEV__) {
        console.log("[DEV][friends] remove friend error", {
          friendUid,
          code: String(error?.code ?? "unknown"),
        });
      }
      NativeAlert.alert(p.friends, p.removeFriendFailed);
    } finally {
      removeFriendBusyRef.current = false;
      setFriendsBusy(false);
    }
  }

  function openRemoveFriendConfirm(friendUid: string) {
    if (__DEV__) {
      console.log("[DEV][friends] opening remove friend confirm", {
        friendUid,
      });
    }

    NativeAlert.alert(
      p.remove,
      p.removeFriendConfirm.replace("{name}", getShownFriendName(friendUid)),
      [
        { text: p.cancel, style: "cancel" },
        {
          text: p.remove,
          style: "destructive",
          onPress: () => void removeFriendWithFeedback(friendUid),
        },
      ]
    );
  }

  function runPendingFriendsAction(action: PendingFriendsAction) {
    if (action.type === "invite") {
      if (__DEV__) {
        console.log("[DEV][friends] opening shared challenge flow", {
          friendUid: action.friendUid,
        });
      }
      openChallengeInvite(action.friendUid);
      return;
    }

    openRemoveFriendConfirm(action.friendUid);
  }

  function queueFriendsAction(action: PendingFriendsAction) {
    if (
      Platform.OS === "ios" &&
      (friendsModalVisibleRef.current || friendsOpen)
    ) {
      pendingFriendsActionRef.current = action;
      setAddFriendOpen(false);
      setFriendsOpen(false);
      return;
    }

    runPendingFriendsAction(action);
  }

  function requestChallengeInvite(friendUidValue: unknown) {
    const friendUid = String(friendUidValue ?? "").trim();

    if (__DEV__) {
      console.log("[DEV][friends] friend invite button pressed", { friendUid });
    }

    if (!friendUid) {
      NativeAlert.alert(p.friends, p.friendActionUnavailable);
      return;
    }

    if (freeSharedLimitReached) {
      NativeAlert.alert(p.premium, p.freeSharedChallengeLimit);
      return;
    }

    queueFriendsAction({ type: "invite", friendUid });
  }

  function requestRemoveFriend(friendUidValue: unknown) {
    const friendUid = String(friendUidValue ?? "").trim();

    if (__DEV__) {
      console.log("[DEV][friends] friend remove button pressed", { friendUid });
    }

    if (!friendUid) {
      NativeAlert.alert(p.friends, p.friendActionUnavailable);
      return;
    }

    queueFriendsAction({ type: "remove", friendUid });
  }

  function handleFriendsModalDismiss() {
    friendsModalVisibleRef.current = false;
    const action = pendingFriendsActionRef.current;
    pendingFriendsActionRef.current = null;
    if (action) runPendingFriendsAction(action);
  }

  async function declineFriendWithFeedback(
    friendUid: string,
    errorMessage: string
  ) {
    if (declineFriendBusyRef.current) return;

    declineFriendBusyRef.current = true;
    setFriendsBusy(true);

    try {
      await declineFriend(friendUid);
      if (__DEV__) {
        console.log("[DEV][friends] decline friend success", { friendUid });
      }
    } catch (error: any) {
      if (__DEV__) {
        console.log("[DEV][friends] decline friend error", {
          friendUid,
          code: String(error?.code ?? "unknown"),
        });
      }
      NativeAlert.alert(p.friends, errorMessage);
    } finally {
      declineFriendBusyRef.current = false;
      setFriendsBusy(false);
    }
  }

function openChallengeInvite(friendUid: string) {
    if (freeSharedLimitReached) {
      NativeAlert.alert(p.premium, p.freeSharedChallengeLimit);
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
        showPwdPopup("error", p.sharedChallenge, runtimeText.selectFriend);
        return;
      }

      if (!title) {
        showPwdPopup("error", p.sharedChallenge, runtimeText.enterChallenge);
        return;
      }

      if (challengeInvitePeriod === "custom" && challengeInviteCustomDays.length === 0) {
        showPwdPopup("error", p.sharedChallenge, runtimeText.selectDay);
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
        runtimeText.sharedCreated.replace("{count}", String(friendUids.length))
      );
    } catch (e: any) {
      showPwdPopup(
        "error",
        p.sharedChallenge,
        e?.message ?? runtimeText.sharedCreateFailed
      );
    } finally {
      setChallengeInviteBusy(false);
    }
  }

  function logFriendRequestBlocked(
    reason: string,
    friendUid?: string | null
  ) {
    if (__DEV__) {
      console.log("[DEV][friends] request friend blocked", {
        reason,
        ...(friendUid ? { friendUid } : {}),
      });
    }
  }

  async function submitFriendRequest() {
    if (friendsBusy) {
      logFriendRequestBlocked("friends-busy");
      return;
    }

    const friendAlert = Platform.OS === "ios" ? NativeAlert : Alert;
    const me = auth.currentUser?.uid;
    const username = addUsername.trim();

    if (!me) {
      logFriendRequestBlocked("not-signed-in");
      friendAlert.alert(p.addFriend, p.addFriendSignInRequired);
      return;
    }

    if (!username) {
      logFriendRequestBlocked("missing-username");
      friendAlert.alert(p.addFriend, p.addFriendMissingUsername);
      return;
    }

    const acceptedCount = friendEdges.filter(
      (edge) => edge.status === "accepted"
    ).length;

    if (!premium && acceptedCount >= 1) {
      logFriendRequestBlocked("free-friends-limit");
      friendAlert.alert(p.addFriend, p.addFriendFreeLimit);
      return;
    }

    setFriendsBusy(true);
    Keyboard.dismiss();
    let resolvedFriendUid: string | null = null;

    try {
      const otherUid = await resolveUidByUsername(username);
      resolvedFriendUid = otherUid;

      if (!otherUid) {
        logFriendRequestBlocked("username-not-found");
        friendAlert.alert(p.addFriend, p.addFriendNotFound);
        return;
      }

      if (otherUid === me) {
        logFriendRequestBlocked("self-request", otherUid);
        friendAlert.alert(p.addFriend, p.addFriendSelf);
        return;
      }

      await sendFriendRequest(otherUid);
      setAddUsername("");
      setAddFriendOpen(false);
      setFriendsOpen(false);
      setTimeout(() => {
        showPwdPopup("success", p.friends, p.addFriendSent);
      }, 300);
    } catch (error: any) {
      logFriendRequestBlocked(
        String(error?.code ?? "request-failed"),
        resolvedFriendUid
      );
      friendAlert.alert(
        p.addFriend,
        error?.message ?? p.addFriendFailed
      );
    } finally {
      setFriendsBusy(false);
    }
  }

  const infoTitle = useMemo(() => {
    switch (infoScreen) {
      case "menu":
        return p.info;
      case "support":
        return p.sendQuestion;
      case "whatsnew":
        return whatsNew.title;
      case "streak_medals":
        return p.streaksMedals;
      case "freeprem":
        return p.freePremium;
        case "faq":
  return lang === "cs"
    ? "Časté dotazy"
    : lang === "pl"
      ? "Najczęstsze pytania"
      : lang === "de"
        ? "Häufige Fragen"
        : "FAQ";
      case "paywall":
        return p.premium;
      case "privacy":
        return p.privacy;
      case "terms":
        return p.terms;
      default:
        return p.info;
    }
  }, [infoScreen, whatsNew.title]);

const incomingCount = friendEdges.filter(
  (e) =>
    e.status === "pending" &&
    String(e.initiatedBy) !== String(myUid)
).length;
const friendsBadgeCount = incomingCount + pendingInviteCount;

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
        onRequestClose={closeDeleteAccountModal}
      >
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: UI.backdrop }]}
          onPress={closeDeleteAccountModal}
        />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.deleteModalContent}
          >
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
                onPress={closeDeleteAccountModal}
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
              onChangeText={(value) => {
                setDeletePassword(value);
                if (deleteError) setDeleteError(null);
              }}
              placeholder={p.passwordPlaceholder}
              placeholderTextColor={"rgba(11,18,32,0.55)"}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!deleteWorking}
              returnKeyType="done"
              onSubmitEditing={() => void performDeleteAccount()}
              style={[
                styles.input,
                {
                  color: "#0B1220",
                  borderColor: "rgba(255,138,31,0.55)",
                  backgroundColor: "#FFD3A8",
                },
              ]}
            />

            {!!deleteError && (
              <Text style={styles.deleteAccountError}>{deleteError}</Text>
            )}

            <Pressable
              disabled={deleteWorking}
              onPress={closeDeleteAccountModal}
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
          </ScrollView>
        </KeyboardAvoidingView>
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
            automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
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
            automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
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
              onPress={saveUsername}
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
        onShow={() => {
          accountModalVisibleRef.current = true;
        }}
        onDismiss={handleAccountModalDismiss}
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
                    showPwdPopup("error", runtimeText.privacy, runtimeText.privacyFailed);
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
              onPress={() => openAccountDestination("password")}
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
              onPress={() => openAccountDestination("username")}
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

            <Pressable
              onPress={premium ? openPremiumManagement : openPayments}
              style={({ pressed }) => [
                styles.modalLinkRow,
                { borderColor: UI.stroke, backgroundColor: UI.card },
                pressed && { opacity: 0.88 },
              ]}
            >
              <Text style={[styles.modalLinkText, { color: UI.text }]}>
                {premium ? p.managePremium : p.getPremium}
              </Text>
              <Text style={[styles.chevron, { color: UI.text }]}>›</Text>
            </Pressable>

            <Pressable
              onPress={async () => {
                try {
                  await clearSessionAfterExplicitLogout();
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

            {/* ✅ MODAL – Oznámení */}
      <Modal
        visible={notificationsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setNotificationsOpen(false)}
      >
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: UI.backdrop }]}
          onPress={() => setNotificationsOpen(false)}
        />

        <View
          style={[
            styles.sheet,
            {
              height: "58%",
              backgroundColor: isDark ? UI.sheetBg : "#FFE0C2",
              borderColor: isDark ? UI.sheetStroke : "#FF8A1F",
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: UI.text }]}>
              {runtimeText.notifications}
            </Text>

            <Pressable
              onPress={() => setNotificationsOpen(false)}
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
            contentContainerStyle={{
              paddingBottom: Math.max(12, insets.bottom + 12),
            }}
          >
            <View
              style={[
                styles.infoCard,
                { borderColor: UI.stroke, backgroundColor: UI.card },
              ]}
            >
            {[
              {
                key: "challengeReminders" as const,
                title:
                  lang === "cs"
                    ? "Notifikace výzev"
                    : lang === "pl"
                    ? "Powiadomienia o wyzwaniach"
                    : lang === "de"
                    ? "Challenge-Benachrichtigungen"
                    : "Challenge notifications",
              },
              {
                key: "sharedChallenges" as const,
                title:
                  lang === "cs"
                    ? "Notifikace společných výzev"
                    : lang === "pl"
                    ? "Powiadomienia o wspólnych wyzwaniach"
                    : lang === "de"
                    ? "Benachrichtigungen zu gemeinsamen Challenges"
                    : "Shared challenge notifications",
              },
              {
                key: "friendRequests" as const,
                title:
                  lang === "cs"
                    ? "Žádosti o přátelství"
                    : lang === "pl"
                    ? "Prośby o dodanie do znajomych"
                    : lang === "de"
                    ? "Freundschaftsanfragen"
                    : "Friend requests",
              },
              {
                key: "incomingChallenges" as const,
                title:
                  lang === "cs"
                    ? "Když mě někdo vyzve"
                    : lang === "pl"
                    ? "Gdy ktoś mnie wyzwie"
                    : lang === "de"
                    ? "Wenn mich jemand herausfordert"
                    : "When someone challenges me",
              },
              {
                key: "friendCompletedSharedChallenge" as const,
                title:
                  lang === "cs"
                    ? "Když kamarád splní společnou výzvu"
                    : lang === "pl"
                    ? "Gdy znajomy ukończy wspólne wyzwanie"
                    : lang === "de"
                    ? "Wenn ein Freund eine gemeinsame Challenge abschließt"
                    : "When a friend completes a shared challenge",
              },
            ].map((item) => (
              <View
                key={item.key}
                style={[
                  styles.modalRow,
                  { borderColor: UI.stroke, backgroundColor: UI.card2 },
                ]}
              >
                <Text style={[styles.modalLabel, { color: UI.text, flex: 1 }]}>
                  {item.title}
                </Text>

                <Switch
                  value={notificationSettings[item.key]}
                  onValueChange={(v) => updateNotificationSetting(item.key, v)}
                />
              </View>
            ))}
            </View>
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
  <ScrollView
    style={{ flex: 1 }}
    keyboardShouldPersistTaps="handled"
    showsVerticalScrollIndicator={true}
    contentContainerStyle={{ paddingBottom: 90 }}
  >
              <View style={{ marginBottom: 14 }}>
                <Text style={[styles.infoTitle, { color: UI.text, fontSize: 22 }]} />
                <Text style={[styles.infoText, { color: UI.sub }]} />
              </View>

              <View style={styles.iconGrid}>
  <Pressable
    onPress={() => {
      if (!premium) {
        Alert.alert(
          p.premium,
          accessText.historyPremium
        );
        return;
      }

      setInfoOpen(false);
      router.push("/history");
    }}
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
      <Ionicons name="time-outline" size={24} color={UI.accent} />
    </View>

    <Text style={[styles.iconTileText, { color: UI.text, fontSize: 16 }]}>
      {!premium ? "🔒 " : ""}
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
      {!premium
        ? accessText.lockedFree
        : p.historySubtitle}
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
    onPress={() => setInfoScreen("faq")}
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
      <Ionicons name="help-circle-outline" size={24} color={UI.accent} />
    </View>

    <Text style={[styles.iconTileText, { color: UI.text, fontSize: 16 }]}>
      {faqTitle}
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
      {lang === "cs"
        ? "Limity, Premium a notifikace"
        : lang === "pl"
          ? "Limity, Premium i powiadomienia"
          : lang === "de"
            ? "Limits, Premium und Benachrichtigungen"
            : "Limits, Premium and notifications"}
    </Text>
  </Pressable>

  <Pressable
    onPress={() => setInfoScreen("privacy")}
    style={({ pressed }) => [
      styles.iconTile,
      { borderColor: UI.stroke, backgroundColor: UI.card },
      pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
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
  {lang === "cs"
    ? "Soukromí"
    : lang === "pl"
      ? "Prywatność"
      : lang === "de"
        ? "Datenschutz"
        : "Privacy"}
</Text>
  </Pressable>

  <Pressable
    onPress={() => setInfoScreen("terms")}
    style={({ pressed }) => [
      styles.iconTile,
      { borderColor: UI.stroke, backgroundColor: UI.card },
      pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
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
      pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
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

  <Pressable
    testID="whats-new-tile"
    onPress={() => setInfoScreen("whatsnew")}
    style={({ pressed }) => [
      styles.iconTile,
      { borderColor: UI.stroke, backgroundColor: UI.card },
      pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
    ]}
  >
    <View style={[styles.iconCircle, { backgroundColor: UI.card2, borderColor: UI.stroke }]}>
      <Ionicons name="sparkles-outline" size={24} color={UI.accent} />
    </View>
    <Text style={[styles.iconTileText, { color: UI.text }]}>{whatsNew.title}</Text>
    <Text style={[styles.iconTileSubtitle, { color: UI.sub }]}>{whatsNew.menuSubtitle}</Text>
  </Pressable>
</View>
</ScrollView>
) : (
            <ScrollView
              style={{ flex: 1 }}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
              showsVerticalScrollIndicator={true}
              persistentScrollbar={
                Platform.OS === "android" && infoScreen === "streak_medals"
              }
              contentContainerStyle={{
                paddingBottom:
                  infoScreen === "streak_medals"
                    ? Math.max(64, insets.bottom + 64)
                    : 12,
              }}
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
  {p.medals}
</Text>
<Text style={[styles.infoText, { color: UI.sub, marginTop: 6 }]}>
  {p.medalsIntro}
</Text>

                  <View style={styles.medalsGrid}>
                    {[
                      {
                        key: "brambora",
                        days: 5,
                        title: p.medalPotato,
                        desc: p.medalPotatoDesc,
                        img: require("../../assets/medals/potato_medal.png"),
                      },
                      {
                        key: "steel",
                        days: 10,
                        title: p.medalSteel,
                       desc: p.medalSteelDesc,
                        img: require("../../assets/medals/steel_medal.png"),
                      },
                      {
                        key: "bronze",
                        days: 20,
                        title: p.medalBronze,
                       desc: p.medalBronzeDesc,
                        img: require("../../assets/medals/bronze_medal.png"),
                      },
                      {
                        key: "silver",
                        days: 30,
                       title: p.medalSilver,
                       desc: p.medalSilverDesc,
                        img: require("../../assets/medals/silver_medal.png"),
                      },
                      {
                        key: "gold",
                        days: 60,
                        title: p.medalGold,
                        desc: p.medalGoldDesc,
                        img: require("../../assets/medals/gold_medal.png"),
                      },
                      {
                        key: "diamond",
                        days: 90,
                        title: p.medalDiamond,
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
                            {`${m.days} ${medalDayUnit} – ${m.title}`}
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

              {infoScreen === "whatsnew" && (
                <View testID="whats-new-list" style={styles.whatsNewList}>
                  {whatsNew.entries.map((entry) => (
                    <View key={entry.id} style={[styles.infoCard, { borderColor: UI.stroke, backgroundColor: UI.card }]}>
                      <Text style={[styles.whatsNewDate, { color: UI.accent }]}>{entry.date}</Text>
                      <Text style={[styles.infoTitle, { color: UI.text }]}>{entry.title}</Text>
                      <View style={styles.whatsNewBullets}>
                        {entry.bullets.map((bullet) => (
                          <View key={bullet} style={styles.whatsNewBulletRow}>
                            <View style={[styles.whatsNewDot, { backgroundColor: UI.accent }]} />
                            <Text style={[styles.whatsNewBulletText, { color: UI.sub }]}>{bullet}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ))}
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

        <View style={Platform.OS === "android" ? styles.pmListRow : styles.pmListRowLast}>
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
        {Platform.OS === "android" && (
          <View style={styles.pmListRowLast}>
            <Text
              {...noScaleText}
              style={[
                styles.pmListLabel,
                styles.pmWidgetLabel,
                { color: UI.text },
                !isDark && { color: "#1E293B" },
              ]}
            >
              {p.homeScreenWidget}
            </Text>
            <Text
              {...noScaleText}
              style={[
                styles.pmListValue,
                styles.pmValueFlexible,
                { color: UI.text },
                !isDark && { color: "#0F172A" },
              ]}
            >
              {p.homeScreenWidgetFree}
            </Text>
          </View>
        )}
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

        {Platform.OS === "android" && (
          <View style={styles.pmFeatureRow}>
            <Ionicons name="checkmark-circle" size={18} color="#FFD166" />
            <Text {...noScaleText} style={styles.pmFeatureText}>{p.homeScreenWidget}</Text>
            <Text {...noScaleText} style={[styles.pmListValue, styles.pmPremiumWidgetValue]}>{p.homeScreenWidgetPremium}</Text>
          </View>
        )}
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
{infoScreen === "faq" && (
  <View
    style={[
      styles.infoCard,
      { borderColor: UI.stroke, backgroundColor: UI.card },
    ]}
  >
    {faqItems.map((item, index) => {
      const expanded = expandedFaqIndex === index;

      return (
        <View
          key={item.q}
          style={{
            paddingTop: index === 0 ? 0 : 14,
            marginTop: index === 0 ? 0 : 14,
            borderTopWidth: index === 0 ? 0 : 1,
            borderTopColor: UI.stroke,
          }}
        >
          <Pressable
            onPress={() =>
              setExpandedFaqIndex(expanded ? null : index)
            }
            style={({ pressed }) => [
              {
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
              },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={[styles.infoTitle, { color: UI.text, flex: 1 }]}>
              {item.q}
            </Text>
            <Ionicons
              name={expanded ? "chevron-up" : "chevron-down"}
              size={20}
              color={UI.sub}
            />
          </Pressable>

          {expanded && (
            <Text style={[styles.infoText, { color: UI.sub, marginTop: 6 }]}>
              {item.a}
            </Text>
          )}
        </View>
      );
    })}
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

                  {!premium ? (
                    <>
                      {(premiumOfferLoading || premiumPurchaseStatus) && (
                        <View style={styles.premiumPurchaseStatus}>
                          <ActivityIndicator size="small" color={UI.accent} />
                          <Text style={[styles.premiumPurchaseStatusText, { color: UI.text }]}>
                            {premiumOfferLoading
                              ? p.premiumOfferLoading
                              : premiumPurchaseStatus === "opening"
                              ? Platform.OS === "ios"
                                ? p.premiumOpeningAppStore
                                : p.premiumOpeningGooglePlay
                              : p.premiumProcessingPurchase}
                          </Text>
                        </View>
                      )}

                      {selectedPremiumPackage ? (
                        <View
                          style={[
                            styles.premiumPlanDetails,
                            { borderColor: UI.stroke, backgroundColor: UI.card2 },
                          ]}
                        >
                          <Text style={[styles.premiumPlanName, { color: UI.text }]}>
                            {selectedPremiumPackage.product.title || p.premiumProductName}
                          </Text>
                          <Text style={[styles.premiumPlanPeriod, { color: UI.sub }]}>
                            {premiumSubscriptionPeriodText ?? selectedPremiumPackage.product.subscriptionPeriod}
                          </Text>
                          <Text style={[styles.premiumPlanPrice, { color: UI.text }]}>
                            {selectedPremiumPackage.product.priceString} {p.perMonth}
                          </Text>
                        </View>
                      ) : premiumOfferLoading ? null : (
                        <View style={[styles.premiumPlanDetails, { borderColor: UI.stroke, backgroundColor: UI.card2 }]}>
                          <Text style={[styles.premiumPurchaseStatusText, { color: UI.text }]}>
                            {lang === "cs"
                              ? "Měsíční produkt Premium momentálně není dostupný."
                              : lang === "pl"
                              ? "Miesięczny produkt Premium jest obecnie niedostępny."
                              : lang === "de"
                              ? "Das monatliche Premium-Produkt ist derzeit nicht verfügbar."
                              : "The monthly Premium product is currently unavailable."}
                          </Text>
                          <Pressable
                            onPress={() => void loadPremiumPackages()}
                            style={({ pressed }) => [styles.primaryBtn, { marginTop: 12 }, pressed && { opacity: 0.9 }]}
                          >
                            <Text style={styles.primaryBtnText}>
                              {lang === "cs" ? "Zkusit znovu" : lang === "pl" ? "Spróbuj ponownie" : lang === "de" ? "Erneut versuchen" : "Try again"}
                            </Text>
                          </Pressable>
                        </View>
                      )}

                      <Pressable
                        disabled={
                          premiumBusy ||
                          premiumOfferLoading ||
                          !selectedPremiumPackage
                        }
                        onPress={buyPremium}
                        style={({ pressed }) => [
                          styles.primaryBtn,
                          {
                            marginTop: 14,
                            opacity:
                              premiumBusy ||
                              premiumOfferLoading ||
                              !selectedPremiumPackage
                                ? 0.6
                                : 1,
                          },
                          pressed &&
                            !premiumBusy &&
                            !premiumOfferLoading &&
                            selectedPremiumPackage && { opacity: 0.9 },
                        ]}
                      >
                        <Text style={styles.primaryBtnText}>
                          {premiumOfferLoading
                            ? p.premiumOfferLoading
                            : premiumPurchaseStatus === "opening"
                            ? Platform.OS === "ios"
                              ? p.premiumOpeningAppStore
                              : p.premiumOpeningGooglePlay
                            : premiumPurchaseStatus === "processing"
                            ? p.premiumProcessingPurchase
                            : p.upgrade}
                        </Text>
                      </Pressable>
                    </>
                  ) : (
                    <Pressable
                      disabled={premiumBusy}
                      onPress={managePremiumNow}
                      style={({ pressed }) => [
                        styles.dangerBtn,
                        {
                          marginTop: 14,
                          opacity: premiumBusy ? 0.6 : 1,
                        },
                        pressed && !premiumBusy && { opacity: 0.9 },
                      ]}
                    >
                      <Text style={styles.dangerText}>
                        {premiumBusy
                          ? p.premiumChecking
                          : premiumSubscription.willRenew === true
                          ? p.premiumCancel
                          : p.premiumManage}
                      </Text>
                    </Pressable>
                  )}

                  <View style={styles.premiumLegalLinks}>
                    <Pressable
                      accessibilityRole="link"
                      onPress={openPrivacyLink}
                      style={({ pressed }) => pressed && { opacity: 0.7 }}
                    >
                      <Text style={[styles.premiumLegalLink, { color: UI.accent }]}>
                        {p.privacyPolicyLink}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="link"
                      onPress={openTermsLink}
                      style={({ pressed }) => pressed && { opacity: 0.7 }}
                    >
                      <Text style={[styles.premiumLegalLink, { color: UI.accent }]}>
                        {p.termsEulaLink}
                      </Text>
                    </Pressable>
                  </View>

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
        onShow={() => {
          friendsModalVisibleRef.current = true;
        }}
        onDismiss={handleFriendsModalDismiss}
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
                  {p.loadingFriends}
                </Text>
              </View>
            ) : (
              <ScrollView
                contentContainerStyle={{ paddingBottom: 18 }}
                keyboardShouldPersistTaps="always"
                automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
              >
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

{addFriendOpen && (
  <View
    style={[
      styles.infoCard,
      { borderColor: UI.stroke, backgroundColor: UI.card },
    ]}
  >
    <View style={styles.sheetHeader}>
      <Text style={[styles.infoTitle, { color: UI.text, marginBottom: 0 }]}>
        {p.addFriend}
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

    <Text style={[styles.infoTitle, { color: UI.text, marginTop: 12 }]}>
      {p.addByUsername}
    </Text>
    <Text style={[styles.infoText, { color: UI.sub, marginTop: 8 }]}>
      {p.addByUsernameHelp}
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
        returnKeyType="send"
        onSubmitEditing={() => void submitFriendRequest()}
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
        onPress={() => void submitFriendRequest()}
        style={({ pressed }) => [
          styles.smallBtn,
          pressed && { opacity: 0.9 },
          friendsBusy && { opacity: 0.6 },
        ]}
      >
        {friendsBusy ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ActivityIndicator size="small" color="#0B1220" />
            <Text style={styles.smallBtnText}>{p.addingFriend}</Text>
          </View>
        ) : (
          <Text style={styles.smallBtnText}>{p.add}</Text>
        )}
      </Pressable>
    </View>
  </View>
)}

{!accepted.length ? (
  <Text style={[styles.infoText, { color: UI.sub, marginTop: 4 }]}>
    {p.noFriendsYet}
  </Text>
) : (
  <>
  {accepted.map((e, index) => {
  const lockedByFree = !premium && index >= 1;

  return (
    <View
      key={"acc_" + e.otherUid}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 10,
        gap: 12,
        opacity: lockedByFree ? 0.55 : 1,
      }}
    >
      <Pressable
        onPress={() => {
          if (lockedByFree) {
            Alert.alert(
              p.premium,
              accountText.friendLocked
            );
            return;
          }

          void openFriendStats(e.otherUid);
        }}
        style={({ pressed }) => [
          { flex: 1, marginRight: 8 },
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text
          style={{ color: UI.text, fontWeight: "900" }}
          numberOfLines={1}
        >
          {lockedByFree ? "🔒 " : ""}
          {getShownFriendName(e.otherUid)}
        </Text>

        {lockedByFree && (
          <Text
            style={{
              color: UI.sub,
              fontWeight: "800",
              fontSize: 12,
              marginTop: 2,
            }}
            numberOfLines={1}
          >
            {accountText.lockedFree}
          </Text>
        )}
      </Pressable>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable
          onPress={() => {
            if (lockedByFree) {
              NativeAlert.alert(p.premium, p.freeFriendsLimit);
              return;
            }

            requestChallengeInvite(e.otherUid);
          }}
          style={({ pressed }) => [
            styles.smallBtn,
            (lockedByFree || freeSharedLimitReached) && { opacity: 0.55 },
            pressed && { opacity: 0.9 },
          ]}
        >
          <Text style={styles.smallBtnText}>
            {lockedByFree ? p.premium : p.invite}
          </Text>
        </Pressable>

        <Pressable
          disabled={friendsBusy}
          onPress={() => requestRemoveFriend(e.otherUid)}
          style={({ pressed }) => [
            styles.smallBtnGhost,
            friendsBusy && { opacity: 0.6 },
            pressed && !friendsBusy && { opacity: 0.9 },
          ]}
        >
          <Text style={styles.smallBtnGhostText}>{p.remove}</Text>
        </Pressable>
      </View>
    </View>
  );
})}
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
                      disabled={friendsBusy}
                      onPress={() =>
                        void declineFriendWithFeedback(
                          e.otherUid,
                          p.declineFriendFailed
                        )
                      }
                      style={({ pressed }) => [
                        styles.smallBtnGhost,
                        friendsBusy && { opacity: 0.6 },
                        pressed && { opacity: 0.9 },
                      ]}
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
                    disabled={friendsBusy}
                    onPress={() =>
                      void declineFriendWithFeedback(
                        e.otherUid,
                        p.cancelRequestFailed
                      )
                    }
                    style={({ pressed }) => [
                      styles.smallBtnGhost,
                      friendsBusy && { opacity: 0.6 },
                      pressed && { opacity: 0.9 },
                    ]}
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
             {!incomingSharedChallengeInvites.length && !sentSharedInvites.length ? (
  <View
    style={[
      styles.infoCard,
      { borderColor: UI.stroke, backgroundColor: UI.card },
    ]}
  >
    <Text style={[styles.infoTitle, { color: UI.text }]}>
      {sharedChallengeInvitationsTitle}
    </Text>
    <Text style={[styles.infoText, { color: UI.sub }]}>
      {noNewSharedInvitationsText}
    </Text>
  </View>
) : (
  <>
    {!!incomingSharedChallengeInvites.length && (
      <Text style={[styles.infoTitle, { color: UI.text }]}>
        {sharedChallengeInvitationsTitle}
      </Text>
    )}

    {incomingSharedChallengeInvites.map((item) => (
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
          {runtimeText.sentFor}: {getInviteMembersLabel(item)}
        </Text>

        <Text style={[styles.infoText, { color: UI.sub, marginTop: 4 }]}>
          {runtimeText.waiting}
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
              {runtimeText.cancel}
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
            automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
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
  .map((e, index) => {
    const uid = String(e.otherUid);
    const active = challengeInviteFriendUids.includes(uid);
    const lockedByFree = isFriendLockedInFree(index);

    const disabled =
      lockedByFree ||
      (!active && challengeInviteFriendUids.length >= MAX_SHARED_MEMBERS - 1);

    return (
      <Pressable
        key={uid}
        onPress={() => {
          if (lockedByFree) {
            showPremiumLock(p.freeFriendsLimit);
            return;
          }

          if (disabled) return;

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
          {lockedByFree ? "🔒 " : ""}
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
          onPress={() => openAccountDestination("info")}
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
  onPress={() => setNotificationsOpen(true)}
  style={({ pressed }) => [
    styles.bigItem,
    { borderColor: UI.stroke, backgroundColor: UI.card },
    pressed && { opacity: 0.88 },
  ]}
>
  <Text style={[styles.bigItemText, { color: UI.text }]}>
    {runtimeText.notifications}
  </Text>
  <Text style={[styles.chevron, { color: UI.text }]}>›</Text>
</Pressable>

               <Pressable
          onPress={() => {
            setFriendsTab(pendingInviteCount > 0 ? "invites" : incomingCount > 0 ? "requests" : "friends");
            setFriendsOpen(true);
          }}
          style={({ pressed }) => [
            styles.bigItem,
            { borderColor: UI.stroke, backgroundColor: UI.card },
            pressed && { opacity: 0.88 },
          ]}
        >
          <Text style={[styles.bigItemText, { color: UI.text, flex: 1 }]} numberOfLines={1}>
            {p.friendsLabel}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {friendsBadgeCount > 0 && (
              <View
                style={{
                  minWidth: 24,
                  height: 24,
                  borderRadius: 12,
                  paddingHorizontal: 7,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: UI.accent,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "900", color: "#0B1220" }}>
                  +{friendsBadgeCount}
                </Text>
              </View>
            )}
            <Text style={[styles.chevron, { color: UI.text }]}>›</Text>
          </View>
        </Pressable>

        {TEMP_SHARED_INVITE_DIAGNOSTICS && (
          <View
            style={[
              styles.infoCard,
              { borderColor: UI.stroke, backgroundColor: UI.card },
            ]}
          >
            <Text style={[styles.infoTitle, { color: UI.text }]}>
              TEMP shared invite diagnostics
            </Text>
            <Text style={[styles.infoText, { color: UI.sub }]}>
              versionName: {sharedInviteDiagnosticsVersionName}
            </Text>
            <Text style={[styles.infoText, { color: UI.sub }]}>
              native build/versionCode: {sharedInviteDiagnosticsBuild || "unknown"}
            </Text>
            <Text style={[styles.infoText, { color: UI.sub }]}>
              Firebase UID: {currentUserUid || "none"}
            </Text>
            <Text style={[styles.infoText, { color: UI.sub }]}>
              sharedChallenges received: {sharedChallenges.length}
            </Text>
            <Text style={[styles.infoText, { color: UI.sub }]}>
              incomingSharedChallengeInvites: {incomingSharedChallengeInvites.length}
            </Text>
            <Text style={[styles.infoText, { color: pendingInviteQueryError ? "#B42318" : UI.sub }]}>
              pending invite query error: {pendingInviteQueryError ?? "none"}
            </Text>

            {sharedInviteDiagnosticsRows.map((row) => (
              <View
                key={`shared_invite_diag_${row.challenge.id}`}
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTopWidth: 1,
                  borderTopColor: UI.stroke,
                  gap: 3,
                }}
              >
                <Text style={[styles.infoText, { color: UI.text, fontWeight: "900" }]}>
                  id: {row.challenge.id}
                </Text>
                <Text style={[styles.infoText, { color: UI.sub }]}>
                  title/name: {row.challenge.title || "(empty)"}
                </Text>
                <Text style={[styles.infoText, { color: UI.sub }]}>
                  pendingInviteUids: {JSON.stringify(row.pendingInviteUids)}
                </Text>
                <Text style={[styles.infoText, { color: UI.sub }]}>
                  memberUids: {JSON.stringify(row.memberUids)}
                </Text>
                <Text style={[styles.infoText, { color: UI.sub }]}>
                  acceptedBy: {JSON.stringify(row.acceptedBy)}
                </Text>
                <Text style={[styles.infoText, { color: UI.sub }]}>
                  leftBy: {JSON.stringify(row.leftBy)}
                </Text>
                <Text style={[styles.infoText, { color: UI.sub }]}>
                  createdBy: {row.challenge.createdBy}
                </Text>
                <Text style={[styles.infoText, { color: UI.sub }]}>
                  status: {row.challenge.status}
                </Text>
                <Text style={[styles.infoText, { color: UI.sub }]}>
                  enabled: {String(row.challenge.enabled)}
                </Text>
                <Text style={[styles.infoText, { color: UI.sub }]}>
                  current user pending: {row.isCurrentUserPending ? "yes" : "no"}
                </Text>
                <Text style={[styles.infoText, { color: UI.sub }]}>
                  current user member: {row.isCurrentUserMember ? "yes" : "no"}
                </Text>
                <Text style={[styles.infoText, { color: UI.sub }]}>
                  current user accepted: {row.isCurrentUserAccepted ? "yes" : "no"}
                </Text>
                <Text style={[styles.infoText, { color: UI.sub }]}>
                  current user left: {row.isCurrentUserLeft ? "yes" : "no"}
                </Text>
                <Text style={[styles.infoText, { color: row.included ? UI.sub : "#B42318" }]}>
                  included in incoming invites: {row.included ? "yes" : "no"}
                </Text>
                <Text style={[styles.infoText, { color: row.excludedReason ? "#B42318" : UI.sub }]}>
                  excluded reason: {row.excludedReason ?? "none"}
                </Text>
              </View>
            ))}
          </View>
        )}
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

function makeStyles(UI: any, topInset: number, bottomInset: number, windowHeight: number) {
  const safeModal = getSafeModalMetrics({ windowHeight, topInset, bottomInset });
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
      bottom: safeModal.bottom,
      maxHeight: safeModal.maxHeight,
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

pmWidgetLabel: {
  flexShrink: 1,
  paddingVertical: 10,
},

pmValueFlexible: {
  maxWidth: "48%",
  flexShrink: 1,
  marginLeft: 12,
  paddingVertical: 10,
  textAlign: "right",
},

pmPremiumWidgetValue: {
  maxWidth: "48%",
  flexShrink: 1,
  color: "#FFF7EF",
  textAlign: "right",
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
    premiumPurchaseStatus: {
      marginTop: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    premiumPurchaseStatusText: {
      flex: 1,
      fontSize: 14,
      fontWeight: "800",
      lineHeight: 19,
    },
    premiumPlanDetails: {
      marginTop: 14,
      borderWidth: 1,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
      alignItems: "center",
    },
    premiumPlanName: {
      fontSize: 18,
      fontWeight: "900",
      textAlign: "center",
    },
    premiumPlanPeriod: {
      marginTop: 4,
      fontSize: 14,
      fontWeight: "700",
      lineHeight: 20,
      textAlign: "center",
    },
    premiumPlanPrice: {
      marginTop: 6,
      fontSize: 17,
      fontWeight: "900",
      lineHeight: 23,
      textAlign: "center",
    },
    premiumLegalLinks: {
      marginTop: 14,
      alignItems: "center",
      gap: 10,
    },
    premiumLegalLink: {
      paddingVertical: 2,
      paddingHorizontal: 4,
      fontSize: 14,
      fontWeight: "800",
      lineHeight: 20,
      textAlign: "center",
      textDecorationLine: "underline",
    },

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
    iconTileSubtitle: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "700",
      textAlign: "center",
    },
    whatsNewList: { gap: 12 },
    whatsNewDate: { fontSize: 12, lineHeight: 17, fontWeight: "900", marginBottom: 5 },
    whatsNewBullets: { marginTop: 10, gap: 9 },
    whatsNewBulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
    whatsNewDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
    whatsNewBulletText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "700" },

    popupWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 18,
    },
    deleteModalContent: {
      flexGrow: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 18,
      paddingTop: safeModal.paddingTop,
      paddingBottom: safeModal.paddingBottom,
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
    deleteAccountError: {
      marginTop: 10,
      color: "#B42318",
      fontSize: 13,
      fontWeight: "800",
      lineHeight: 18,
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
