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

export default function ProfileTabScreen() {
  const router = useRouter();
  const { open, t } = useLocalSearchParams<{ open?: string; t?: string }>();
  const insets = useSafeAreaInsets();
  const { UI, isDark, toggle } = useTheme();


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

  // ✅ jazyk (zatím UI-only placeholder)
  const [lang, setLang] = useState<"cs" | "en">("cs");

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
    if (!friendsOpen) return;

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
    if (!friendsOpen) return;

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

        const incomingPending = items.filter((item) => {
          const isPending = item.status === "pending";
          const iAmMember = item.memberUids.includes(uid);
          const iAlreadyAccepted = item.acceptedBy.includes(uid);
          const createdByMe = String(item.createdBy) === String(uid);

          return isPending && iAmMember && !iAlreadyAccepted && !createdByMe;
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
    return "Načítám...";
  };
  const pendingInviteCount = sharedInvites.length;

  const getInviteCreatorName = (challenge: SharedChallenge) => {
    const creatorUid = String(challenge.createdBy ?? "");
    const v = friendNames[creatorUid];
    if (typeof v === "string" && v.trim()) return v.trim();
    return "Kamarád";
  };

  const medalLabel = (tier: FriendPreviewStats["highestMedal"]) => {
    switch (tier) {
      case "brambora":
        return "Bramborová";
      case "steel":
        return "Ocelová";
      case "bronze":
        return "Bronzová";
      case "silver":
        return "Stříbrná";
      case "gold":
        return "Zlatá";
      case "diamond":
        return "Diamantová";
      default:
        return "Žádná";
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
      return "Načítám...";
    });

    if (!names.length) return "Společná výzva";
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]}, ${names[1]}`;
    return `${names[0]}, ${names[1]} +${names.length - 2}`;
  };

  async function acceptSharedInviteFromFriends(challengeId: string) {
    try {
      setFriendsBusy(true);
      await acceptSharedChallenge(challengeId);
      showPwdPopup("success", "Výzva", "Výzva byla přijata.");
    } catch (e: any) {
      showPwdPopup(
        "error",
        "Výzva",
        e?.message ?? "Nepodařilo se přijmout výzvu."
      );
    } finally {
      setFriendsBusy(false);
    }
  }

async function declineSharedInviteFromFriends(challengeId: string) {
  try {
    setFriendsBusy(true);
    await declineSharedChallenge(challengeId);
    showPwdPopup("success", "Výzva", "Výzva byla odmítnuta.");
  } catch (e: any) {
    showPwdPopup(
      "error",
      "Výzva",
      e?.message ?? "Nepodařilo se odmítnout výzvu."
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
          "Premium",
          "Balíčky Premium nejsou dostupné. (V Test Store se ujisti, že máš nastavené Offering/Package v RevenueCat.)"
        );
        return;
      }
      await purchasePackage(pkgs[0]);
      Alert.alert("Premium", "Premium aktivováno.");
    } catch {
      Alert.alert("Premium", "Nepodařilo se aktivovat Premium.");
    } finally {
      setPremiumBusy(false);
    }
  };

  const cancelPremiumNow = async () => {
    if (premiumBusy) return;
    Alert.alert(
      "Zrušit Premium",
      "Zrušení předplatného se provádí ve Store (Google Play / App Store). Chceš otevřít správu předplatného?",
      [
        { text: "Ne", style: "cancel" },
        {
          text: "Otevřít",
          style: "default",
          onPress: async () => {
            setPremiumBusy(true);
            try {
              await openCancelSubscription();
            } catch {
              Alert.alert(
                "Premium",
                "Nepodařilo se otevřít správu předplatného."
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
      Alert.alert("Premium", v ? "Premium je aktivní." : "Premium není aktivní.");
    } catch {
      Alert.alert("Premium", "Nepodařilo se obnovit stav Premium.");
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
      showPwdPopup("error", "Nelze smazat účet", "Nejsi přihlášený.");
      setDeleteOpen(false);
      return;
    }

    const pwd = deletePassword.trim();
    if (!pwd) {
      showPwdPopup(
        "error",
        "Chybí heslo",
        "Pro smazání účtu zadej heslo (kvůli bezpečnosti Firebase)."
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
          "Špatné heslo",
          "Zadal jsi špatné heslo. Zkus to znovu."
        );
        return;
      }

      if (code.includes("auth/requires-recent-login")) {
        setDeleteOpen(false);
        showPwdPopup(
          "error",
          "Vyžadováno znovu přihlášení",
          "Z bezpečnostních důvodů se musíš znovu přihlásit a pak smazání zopakovat. Odhlásím tě teď."
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
        "Smazání se nepovedlo",
        "Nepodařilo se smazat účet. Zkus to prosím znovu."
      );
    } finally {
      setDeleteWorking(false);
    }
  };

  const openPrivacyLink = async () => {
    const url = PRIVACY_URL;
    const ok = await Linking.canOpenURL(url);
    if (!ok) {
      Alert.alert("Odkaz", "Nepodařilo se otevřít Ochranu soukromí.");
      return;
    }
    await Linking.openURL(url);
  };

  const openTermsLink = async () => {
    const url = TERMS_URL;
    const ok = await Linking.canOpenURL(url);
    if (!ok) {
      Alert.alert("Odkaz", "Nepodařilo se otevřít Podmínky používání.");
      return;
    }
    await Linking.openURL(url);
  };

  const sendSupport = async () => {
    const e = supportEmail.trim();
    const s = supportSubject.trim();
    const m = supportMessage.trim();

    if (!e || !s || !m) {
      showPwdPopup("error", "Podpora", "Vyplň prosím e-mail, předmět i zprávu.");
      return;
    }

    if (!auth.currentUser) {
      showPwdPopup("error", "Podpora", "Musíš být přihlášený/á.");
      return;
    }

    setSupportSending(true);
    try {
      const call = httpsCallable(functions, "sendSupportEmail");
      await call({ email: e, subject: s, message: m });

      setSupportSubject("");
      setSupportMessage("");

      // ✅ místo bílého Alert.alert použijeme tvůj oranžový popup
      showPwdPopup("success", "Odesláno", "Díky! Zpráva byla odeslána na podporu.");

      setInfoScreen("menu");
    } catch (err: any) {
      const code = String(err?.code ?? "");
      const msg0 = String(err?.message ?? "");

      let msg = "Nepodařilo se odeslat zprávu. Zkus to prosím znovu.";
      if (code.includes("unauthenticated")) msg = "Musíš být přihlášený/á.";
      else if (code.includes("permission-denied"))
        msg = "Nemáš oprávnění odeslat zprávu.";
      else if (code.includes("invalid-argument"))
        msg = "Zkontroluj prosím vyplněné údaje.";
      else if (msg0) msg = msg0;

      showPwdPopup("error", "Chyba", msg);
    } finally {
      setSupportSending(false);
    }
  };

  const requestPasswordReset = async () => {
    const e = pwdEmail.trim();
    if (!e) {
      setPwdError("Zadej prosím e-mail.");
      showPwdPopup("error", "Chybí e-mail", "Zadej prosím e-mail a zkus to znovu.");
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
        "Hotovo",
        "Poslali jsme ti e-mail s odkazem na změnu hesla. Zkontroluj i spam."
      );
    } catch (err: any) {
      const code = String(err?.code ?? "");
      let msg = "Nepodařilo se odeslat e-mail. Zkus to prosím znovu.";

      if (code.includes("auth/invalid-email"))
        msg = "E-mail není ve správném formátu.";
      else if (code.includes("auth/user-not-found"))
        msg = "Pro tento e-mail neexistuje účet.";
      else if (code.includes("auth/too-many-requests"))
        msg = "Příliš mnoho pokusů. Zkus to prosím později.";

      setPwdError(msg);
      showPwdPopup("error", "Nepodařilo se odeslat", msg);
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
    if (!premium) {
      Alert.alert(
        "Premium",
        "Společné výzvy s přáteli jsou dostupné jen v Premium verzi."
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
      if (!premium) {
        showPwdPopup(
          "error",
          "Premium",
          "Společné výzvy s přáteli jsou dostupné jen v Premium verzi."
        );
        return;
      }

      const friendUids = Array.from(
        new Set(
          (challengeInviteFriendUids ?? [])
            .map((x) => String(x ?? "").trim())
            .filter(Boolean)
        )
      ).slice(0, MAX_SHARED_MEMBERS - 1);

      const title = challengeInviteTitle.trim();

      if (!friendUids.length) {
        showPwdPopup("error", "Společná výzva", "Vyber aspoň jednoho přítele.");
        return;
      }

      if (!title) {
        showPwdPopup("error", "Společná výzva", "Zadej název výzvy.");
        return;
      }

      if (challengeInvitePeriod === "custom" && challengeInviteCustomDays.length === 0) {
        showPwdPopup("error", "Společná výzva", "Vyber aspoň jeden den.");
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
        "Společná výzva",
        `Výzva byla vytvořena pro ${friendUids.length} ${friendUids.length === 1 ? "přítele" : friendUids.length >= 2 && friendUids.length <= 4 ? "přátele" : "přátel"}.`
      );
    } catch (e: any) {
      showPwdPopup(
        "error",
        "Společná výzva",
        e?.message ?? "Nepodařilo se vytvořit společnou výzvu."
      );
    } finally {
      setChallengeInviteBusy(false);
    }
  }

  const infoTitle = useMemo(() => {
    switch (infoScreen) {
      case "menu":
        return "Informace";
      case "support":
        return "Poslat dotaz";
      case "streak_medals":
        return "Ohýnky & medaile";
      case "freeprem":
        return "Free & Premium";
      case "paywall":
        return "Premium";
      case "privacy":
        return "Ochrana soukromí";
      case "terms":
        return "Podmínky používání";
      default:
        return "Informace";
    }
  }, [infoScreen]);

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
              <Text style={styles.popupTitle}>Odstranit účet?</Text>

              <Pressable
                onPress={() => !deleteWorking && setDeleteOpen(false)}
                hitSlop={10}
                style={({ pressed }) => [styles.popupX, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name="close" size={20} color={"#0B1220"} />
              </Pressable>
            </View>

            <Text style={styles.popupText}>
              Tahle akce je nevratná. Účet bude smazán.
            </Text>

            <Text style={[styles.smallLabel, { color: "#0B1220", marginTop: 10 }]}>
              Zadej heslo
            </Text>
            <TextInput
              value={deletePassword}
              onChangeText={setDeletePassword}
              placeholder="heslo"
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
              <Text style={styles.popupBtnText}>Zrušit</Text>
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
                {deleteWorking ? "Mažu účet…" : "Chci odstranit účet"}
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
              Změna hesla
            </Text>

            <Pressable
              onPress={() => setPwdOpen(false)}
              style={({ pressed }) => [
                styles.closeBtn,
                { borderColor: UI.stroke, backgroundColor: UI.card2 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.closeText, { color: UI.text }]}>Zavřít</Text>
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 10 }}
          >
            <Text style={[styles.infoText, { color: UI.sub }]}>
              Pošleme ti e-mail s odkazem na změnu hesla.
            </Text>

            <Text style={[styles.smallLabel, { color: UI.sub, marginTop: 10 }]}>
              E-mail
            </Text>
            <TextInput
              value={pwdEmail}
              onChangeText={setPwdEmail}
              placeholder="tvuj@email.cz"
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
                {pwdSending ? "Odesílám…" : "Poslat odkaz"}
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
              Změna uživatelského jména
            </Text>

            <Pressable
              onPress={() => !usernameBusy && setUsernameOpen(false)}
              style={({ pressed }) => [
                styles.closeBtn,
                { borderColor: UI.stroke, backgroundColor: UI.card2 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.closeText, { color: UI.text }]}>Zavřít</Text>
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 10 }}
          >
            <Text style={[styles.smallLabel, { color: UI.sub, marginTop: 10 }]}>
              Nové uživatelské jméno
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
                      "Změna username",
                      "Zadej prosím nové uživatelské jméno."
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

                  showPwdPopup("success", "Hotovo", "Uživatelské jméno bylo změněno.");
                } catch (e: any) {
                  showPwdPopup(
                    "error",
                    "Změna username",
                    e?.message ?? "Změna se nepovedla."
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
                {usernameBusy ? "Ukládám…" : "Uložit změnu"}
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
            <Text style={[styles.sheetTitle, { color: UI.text }]}>Účet</Text>

            <Pressable
              onPress={() => setAccountOpen(false)}
              style={({ pressed }) => [
                styles.closeBtn,
                { borderColor: UI.stroke, backgroundColor: UI.card2 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.closeText, { color: UI.text }]}>Zavřít</Text>
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
                Tmavý režim
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
                Sdílet s přáteli své úspěchy
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
                    showPwdPopup("error", "Soukromí", "Nepodařilo se uložit nastavení.");
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
              <Text style={[styles.modalLabel, { color: UI.text }]}>Jazyk</Text>
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
                Změna hesla
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
                Změna uživatelského jména
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
                  Spravovat Premium
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
              <Text style={styles.dangerText}>Odhlásit se</Text>
            </Pressable>

            <Pressable
              onPress={requestDeleteAccount}
              style={({ pressed }) => [styles.dangerOutline, pressed && { opacity: 0.92 }]}
            >
              <Text style={styles.dangerOutlineText}>Odstranit účet</Text>
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
              <Text style={[styles.closeText, { color: UI.text }]}>Zavřít</Text>
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
                    Limity & výhody
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
                    Ohýnky & medaile
                  </Text>
                  <Text style={{ color: UI.sub, fontWeight: "700", fontSize: 13 }}>
                    Série & odměny
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
                    Ochrana soukromí
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
    Historie výzev
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
    Přehled plnění a série
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
                    Podmínky používání
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
                    Poslat dotaz
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
                  <Text style={[styles.infoTitle, { color: UI.text }]}>Ohýnky</Text>
                  <Text style={[styles.infoText, { color: UI.sub }]}>
                    Ohýnek ukazuje, kolik dní po sobě máš splněno (série).
                    {"\n\n"}
                    Pokud je výzva v daný den neaktivní nebo má volný den, série se
                    neruší.
                    {"\n"}
                    Série se resetuje jen tehdy, když nesplníš aktivní den výzvy. Výzvu můžeš deaktivovat (série se ti neruší).
                  </Text>

                  <Text style={[styles.infoTitle, { color: UI.text, marginTop: 16 }]}>
                    Medaile
                  </Text>
                  <Text style={[styles.infoText, { color: UI.sub, marginTop: 6 }]}>
                    Každá výzva si počítá medaile podle tvé nejdelší série:
                  </Text>

                  <View style={styles.medalsGrid}>
                    {[
                      {
                        key: "brambora",
                        days: 10,
                        title: "Brambora",
                        desc: "Začátek. 10 dní držíš směr.",
                        img: require("../../assets/medals/potato_medal.png"),
                      },
                      {
                        key: "steel",
                        days: 30,
                        title: "Ocel",
                        desc: "30 dní. Pevný základ. Jdeš dál.",
                        img: require("../../assets/medals/steel_medal.png"),
                      },
                      {
                        key: "bronze",
                        days: 45,
                        title: "Bronz",
                        desc: "45 dní. Už to nabírá tvar rutiny.",
                        img: require("../../assets/medals/bronze_medal.png"),
                      },
                      {
                        key: "silver",
                        days: 90,
                        title: "Stříbro",
                        desc: "Tři měsíce. Návyky jsou součást dne.",
                        img: require("../../assets/medals/silver_medal.png"),
                      },
                      {
                        key: "gold",
                        days: 180,
                        title: "Zlato",
                        desc: "Půl roku. Top disciplína.",
                        img: require("../../assets/medals/gold_medal.png"),
                      },
                      {
                        key: "diamond",
                        days: 365,
                        title: "Diamant",
                        desc: "Celý rok. To už je životní styl.",
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
                            {m.days} dní – {m.title}
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
          {premium ? "Premium je aktivní." : "OneMore zdarma. Premium bez limitů."}
        </Text>

        <Text
          {...noScaleText}
          style={[
            styles.pmHeroText,
            !isDark && { color: "#8A5A1F" },
          ]}
        >
          {premium
            ? "Spravuj své předplatné"
            : "Odemkni více výzev, připomínek, přátel a společných výzev."}
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
            Základní verze zdarma
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
            Výzvy
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
            Připomínky
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
            Historie výzev
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
            Přátelé
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
            Společné výzvy
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
          NEJLEPŠÍ VOLBA
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
            Pro maximální výsledky
          </Text>
        </View>
      </View>

      <View style={styles.pmFeatureList}>
        <View style={styles.pmFeatureRow}>
          <Ionicons name="checkmark-circle" size={18} color="#FFD166" />
          <Text {...noScaleText} style={styles.pmFeatureText}>
            Neomezené výzvy
          </Text>
        </View>

        <View style={styles.pmFeatureRow}>
          <Ionicons name="checkmark-circle" size={18} color="#FFD166" />
          <Text {...noScaleText} style={styles.pmFeatureText}>
            Neomezené připomínky
          </Text>
        </View>

        <View style={styles.pmFeatureRow}>
          <Ionicons name="checkmark-circle" size={18} color="#FFD166" />
          <Text {...noScaleText} style={styles.pmFeatureText}>
            Plná historie výzev
          </Text>
        </View>

        <View style={styles.pmFeatureRow}>
          <Ionicons name="checkmark-circle" size={18} color="#FFD166" />
          <Text {...noScaleText} style={styles.pmFeatureText}>
            Neomezeně přátel
          </Text>
        </View>

        <View style={styles.pmFeatureRow}>
          <Ionicons name="checkmark-circle" size={18} color="#FFD166" />
          <Text {...noScaleText} style={styles.pmFeatureText}>
            Neomezené společné výzvy
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
        {premium ? "Spravovat Premium" : "Získat Premium"}
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
          Bezpečná platba
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
          Zrušení kdykoliv
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
          Podporuješ vývoj
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
                  <Text style={[styles.infoTitle, { color: UI.text }]}>Premium</Text>
                  <Text style={[styles.infoText, { color: UI.sub }]}>
                    {premium
                      ? "Premium je aktivní. Můžeš ho kdykoliv zrušit nebo zkusit obnovit stav."
                      : "Odemkni Premium a získej neomezené výzvy, připomínky a přátele."}
                  </Text>

                  <View style={{ marginTop: 12, gap: 8 }}>
                    {[
                      "Neomezené výzvy",
                      "Neomezené připomínky (notifikace)",
                      "Neomezené propojení s přáteli",
                      "Další odměny a drobné vychytávky (postupně)",
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
                      Cena: zobrazí se po napojení nabídky (Offering) v RevenueCat.
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
                        <Text style={styles.primaryBtnText}>Koupit Premium</Text>
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
                      <Text style={styles.dangerText}>Zrušit předplatné</Text>
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
                    Ochrana soukromí
                  </Text>

                  <Pressable
                    onPress={openPrivacyLink}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      { marginTop: 10 },
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text style={styles.primaryBtnText}>Otevřít</Text>
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
                    Podmínky používání
                  </Text>

                  <Pressable
                    onPress={openTermsLink}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      { marginTop: 10 },
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text style={styles.primaryBtnText}>Otevřít</Text>
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
                  <Text style={[styles.infoTitle, { color: UI.text }]}>
                    Poslat dotaz
                  </Text>

                  <Text style={[styles.smallLabel, { color: UI.sub }]}>
                    E-mail pro odpověď
                  </Text>
                  <TextInput
                    value={supportEmail}
                    onChangeText={setSupportEmail}
                    placeholder="tvuj@email.cz"
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

                  <Text style={[styles.smallLabel, { color: UI.sub }]}>Předmět</Text>
                  <TextInput
                    value={supportSubject}
                    onChangeText={setSupportSubject}
                    placeholder="Např. Problém s notifikacemi"
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

                  <Text style={[styles.smallLabel, { color: UI.sub }]}>Zpráva</Text>
                  <TextInput
                    value={supportMessage}
                    onChangeText={setSupportMessage}
                    placeholder="Popiš prosím svůj dotaz…"
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
                        <Text style={styles.primaryBtnText}>Odesílám…</Text>
                      </View>
                    ) : (
                      <Text style={styles.primaryBtnText}>Odeslat</Text>
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
        Přátelé
      </Text>
    </Pressable>

    <Pressable
      onPress={() => setFriendsTab("requests")}
      style={({ pressed }) => [
        styles.closeBtn,
        {
          borderColor: friendsTab === "requests" ? UI.accent : UI.stroke,
          backgroundColor: friendsTab === "requests" ? UI.accent : UI.card2,
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
        Žádosti
      </Text>
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
        Výzvy
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
    <Text style={[styles.closeText, { color: UI.text }]}>Zavřít</Text>
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
    Moji přátelé
  </Text>

  <Pressable
    onPress={() => setAddFriendOpen(true)}
    style={({ pressed }) => [
      styles.smallBtn,
      pressed && { opacity: 0.9 },
    ]}
  >
    <Text style={styles.smallBtnText}>+ Přidat</Text>
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
              !premium && { opacity: 0.55 },
              pressed && { opacity: 0.9 },
            ]}
          >
            <Text style={styles.smallBtnText}>Vyzvat</Text>
          </Pressable>

          <Pressable
            onPress={async () => {
              try {
                setFriendsBusy(true);
                await removeFriend(e.otherUid);
              } catch (err: any) {
                Alert.alert(
                  "Přátelé",
                  err?.message ?? "Nepodařilo se odebrat."
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
            <Text style={styles.smallBtnGhostText}>Odebrat</Text>
          </Pressable>
        </View>
      </View>
    ))}
  </>
)}


                      </View>

                      {!!incoming.length && (
                        <View
                          style={[
                            styles.infoCard,
                            { borderColor: UI.stroke, backgroundColor: UI.card },
                          ]}
                        >
                          <Text style={[styles.infoTitle, { color: UI.text }]}>
                            Příchozí žádosti
                          </Text>
                          {incoming.map((e) => (
                            <View
                              key={"in_" + e.otherUid}
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginTop: 10,
                              }}
                            >
                              <Text
                                style={{ color: UI.text, fontWeight: "900", flex: 1 }}
                                numberOfLines={1}
                              >
                                {getShownFriendName(e.otherUid)}
                              </Text>
                              <View style={{ flexDirection: "row", gap: 10 }}>
                                <Pressable
                                  onPress={async () => {
                                    try {
                                      const acceptedCount = friendEdges.filter(
                                        (x) => x.status === "accepted"
                                      ).length;
                                      if (!premium && acceptedCount >= 1) {
                                        Alert.alert(
                                          "Přátelé",
                                          "Ve Free verzi můžeš mít jen 1 přítele. Pro více je potřeba Premium."
                                        );
                                        return;
                                      }
                                      setFriendsBusy(true);
                                      await acceptFriend(e.otherUid);
                                    } catch (err: any) {
                                      Alert.alert(
                                        "Přátelé",
                                        err?.message ?? "Nepodařilo se přijmout."
                                      );
                                    } finally {
                                      setFriendsBusy(false);
                                    }
                                  }}
                                  style={({ pressed }) => [
                                    styles.smallBtn,
                                    pressed && { opacity: 0.9 },
                                  ]}
                                >
                                  <Text style={styles.smallBtnText}>Přijmout</Text>
                                </Pressable>
                                <Pressable
                                  onPress={async () => {
                                    try {
                                      setFriendsBusy(true);
                                      await declineFriend(e.otherUid);
                                    } catch (err: any) {
                                      Alert.alert(
                                        "Přátelé",
                                        err?.message ?? "Nepodařilo se odmítnout."
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
                                  <Text style={styles.smallBtnGhostText}>Odmítnout</Text>
                                </Pressable>
                              </View>
                            </View>
                          ))}
                        </View>
                      )}

                      {!!outgoing.length && (
                        <View
                          style={[
                            styles.infoCard,
                            { borderColor: UI.stroke, backgroundColor: UI.card },
                          ]}
                        >
                          <Text style={[styles.infoTitle, { color: UI.text }]}>
                            Odeslané žádosti
                          </Text>
                          {outgoing.map((e) => (
                            <View
                              key={"out_" + e.otherUid}
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginTop: 10,
                              }}
                            >
                              <Text
                                style={{ color: UI.sub, fontWeight: "900", flex: 1 }}
                                numberOfLines={1}
                              >
                                {getShownFriendName(e.otherUid)}
                              </Text>
                              <Pressable
                                onPress={async () => {
                                  try {
                                    setFriendsBusy(true);
                                    await declineFriend(e.otherUid);
                                  } catch (err: any) {
                                    Alert.alert(
                                      "Přátelé",
                                      err?.message ?? "Nepodařilo se zrušit."
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
                                <Text style={styles.smallBtnGhostText}>Zrušit</Text>
                              </Pressable>
                            </View>
                          ))}
                        </View>
                      )}

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
                {!sharedInvites.length ? (
                  <View
                    style={[
                      styles.infoCard,
                      { borderColor: UI.stroke, backgroundColor: UI.card },
                    ]}
                  >
                    <Text style={[styles.infoTitle, { color: UI.text }]}>
                      Výzvy
                    </Text>
                    <Text style={[styles.infoText, { color: UI.sub }]}>
                      Zatím tu nemáš žádné nepřijaté společné výzvy.
                    </Text>
                  </View>
                ) : (
                  sharedInvites.map((item) => (
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
                          ? "denně"
                          : item.period === "every2"
                            ? "obden"
                            : "ve vybrané dny"}
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
                          <Text style={styles.smallBtnText}>Přijmout</Text>
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
  <Text style={styles.smallBtnGhostText}>Odmítnout</Text>
</Pressable>
                      </View>
                    </View>
                  ))
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
              <Text style={[styles.closeText, { color: UI.text }]}>Zavřít</Text>
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
                  placeholder="username"
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
                        Alert.alert("Přátelé", "Zadej uživatelské jméno.");
                        return;
                      }

                      const acceptedCount = friendEdges.filter(
                        (e) => e.status === "accepted"
                      ).length;
                      if (!premium && acceptedCount >= 1) {
                        Alert.alert(
                          "Přátelé",
                          "Ve Free verzi můžeš mít jen 1 přítele. Pro více je potřeba Premium."
                        );
                        return;
                      }

                      setFriendsBusy(true);
                      const otherUid = await resolveUidByUsername(username);
                      if (!otherUid) {
                        Alert.alert(
                          "Přátelé",
                          "Uživatel s tímto username nebyl nalezen."
                        );
                        return;
                      }
                      if (otherUid === me) {
                        Alert.alert("Přátelé", "Nemůžeš přidat sám sebe 🙂");
                        return;
                      }
                      await sendFriendRequest(otherUid);
                  setAddUsername("");
setAddFriendOpen(false);
showPwdPopup("success", "Přátelé", "Žádost odeslána.");
                    } catch (e: any) {
                      Alert.alert(
                        "Přátelé",
                        e?.message ?? "Nepodařilo se odeslat žádost."
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
                  <Text style={styles.smallBtnText}>Přidat</Text>
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
              Nová společná výzva
            </Text>

            <Pressable
              onPress={closeChallengeInvite}
              style={({ pressed }) => [
                styles.closeBtn,
                { borderColor: UI.stroke, backgroundColor: UI.card2 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.closeText, { color: UI.text }]}>Zavřít</Text>
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
                Společná výzva
              </Text>

              <Text style={[styles.infoText, { color: UI.sub, marginTop: -2 }]}>
                Vyber až {MAX_SHARED_MEMBERS - 1} přátel do jedné výzvy.
              </Text>

              <Text style={[styles.smallLabel, { color: UI.sub, marginTop: 12 }]}>
                Přátelé
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
                Název výzvy
              </Text>
              <TextInput
                value={challengeInviteTitle}
                onChangeText={setChallengeInviteTitle}
                placeholder="Např. Kliky"
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
                Počet za den
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
                Perioda
              </Text>
              <View style={styles.challengePills}>
                {[
                  { key: "daily", label: "Denně" },
                  { key: "every2", label: "Obden" },
                  { key: "custom", label: "Vlastní dny" },
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
                      { k: 0, t: "Po" },
                      { k: 1, t: "Út" },
                      { k: 2, t: "St" },
                      { k: 3, t: "Čt" },
                      { k: 4, t: "Pá" },
                      { k: 5, t: "So" },
                      { k: 6, t: "Ne" },
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
                  {challengeInviteBusy ? "Odesílám…" : "Odeslat"}
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
              <Text style={[styles.closeText, { color: UI.text }]}>Zavřít</Text>
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
                { borderColor: UI.stroke, backgroundColor: UI.card },
              ]}
            >
              <Text style={[styles.versionChipText, { color: UI.text }]}>
                {premium ? "Premium" : "Free"}
              </Text>
            </View>

            {!premium && (
              <Pressable
                onPress={openPayments}
                style={({ pressed }) => [styles.upgradeChip, pressed && { opacity: 0.92 }]}
              >
                <Text style={styles.upgradeChipText}>Upgradovat</Text>
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
          <Text style={[styles.bigItemText, { color: UI.text }]}>Účet</Text>
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
          <Text style={[styles.bigItemText, { color: UI.text }]}>Informace</Text>
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
          <Text style={[styles.bigItemText, { color: UI.text }]}>Přátelé</Text>
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
              <Text style={styles.popupBtnText}>OK</Text>
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
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      minWidth: 56,
      alignItems: "center",
    },
    langPillText: { fontSize: 14, fontWeight: "900" },

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