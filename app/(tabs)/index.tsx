import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  acceptSharedChallenge,
  completeSharedChallengeToday,
  getTodayISO as getSharedTodayISO,
  isSharedChallengeActiveOnDate,
  leaveSharedChallenge,
  subscribeSharedChallengeDay,
  subscribeSharedChallengeProgress,
  subscribeSharedChallenges,
  type SharedChallenge,
  type SharedChallengeDayProgress,
} from "../../lib/sharedChallenges";
import { getProfile } from "../../lib/usernames";
import { doc, updateDoc } from "firebase/firestore";
import {
  Animated,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Alert } from "../../lib/appAlert";
import { useTodayISO } from "../../lib/clock";
import { auth, db } from "../../lib/firebase";
import { isPremiumActive, subscribePremium } from "../../lib/premium";
import {
  clearDailyRemindersForChallenge,
  getFreeActiveReminderChallengeId,
  setDailyRemindersForChallenge,
  setRemindersPremiumEnabled,
} from "../../lib/reminders";
import {
  AppState,
  ensureDailyPick,
  loadState,
  purgeChallenge,
  renameChallenge,
  saveState,
  subscribeState,
  updateStatsOnCompleted,
} from "../../lib/storage";
import { useTheme } from "../../lib/theme";
import {
  medalCountsFromChallengeStats,
  tierForBestStreak,
  type MedalTier,
} from "../../lib/medals";
import * as Haptics from "expo-haptics";
import { useI18n } from "../../lib/i18n";

const FLAME_IMG = require("../../assets/images/flame.png");

// 🏅 Medaile (bramborová → ocelová → bronzová → stříbrná → zlatá → diamantová)
const MEDAL_BRAMBORA = require("../../assets/medals/potato_medal.png");
const MEDAL_STEEL = require("../../assets/medals/steel_medal.png");
const MEDAL_BRONZE = require("../../assets/medals/bronze_medal.png");
const MEDAL_SILVER = require("../../assets/medals/silver_medal.png");
const MEDAL_GOLD = require("../../assets/medals/gold_medal.png");
const MEDAL_DIAMOND = require("../../assets/medals/diamond_medal.png");

const FREE_MAX = 2;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function nowHM() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// 0=Po ... 6=Ne
function dowMon0(todayISO: string): number {
  const d = new Date(`${todayISO}T00:00:00`);
  const js = d.getDay(); // 0=Ne..6=So
  return (js + 6) % 7;
}

function diffDaysISO(aISO: string, bISO: string): number {
  const a = new Date(`${aISO}T00:00:00`).getTime();
  const b = new Date(`${bISO}T00:00:00`).getTime();
  return Math.floor((a - b) / 86400000);
}

function addDaysISO(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBetween(aISO: string, bISO: string) {
  const a = new Date(aISO + "T00:00:00").getTime();
  const b = new Date(bISO + "T00:00:00").getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

type DayStatus = "completed" | "skipped" | "free" | "none";

type MedalState = {
  active: {
    brambora: boolean;
    steel: boolean;
    bronze: boolean;
    silver: boolean;
    gold: boolean;
    diamond: boolean;
  };
  counts: {
    brambora: number;
    steel: number;
    bronze: number;
    silver: number;
    gold: number;
    diamond: number;
  };
};

function medalsFromChallengeStats(stats?: any): MedalState {
  const counts = medalCountsFromChallengeStats(stats ?? {});
  const active = {
    brambora: counts.brambora > 0,
    steel: counts.steel > 0,
    bronze: counts.bronze > 0,
    silver: counts.silver > 0,
    gold: counts.gold > 0,
    diamond: counts.diamond > 0,
  };
  return { active, counts };
}

function SparkleBurst({ progress }: { progress: Animated.Value }) {
  const sparkles = useMemo(
    () =>
      Array.from({ length: 12 }).map((_, i) => {
        const left = 18 + (i % 6) * 48 + (i % 2 ? 10 : 0);
        const top = 8 + Math.floor(i / 6) * 26;
        const driftY = -18 - (i % 3) * 10;
        const driftX = (i % 2 ? 1 : -1) * (10 + (i % 4) * 4);
        return { key: String(i), left, top, driftY, driftX };
      }),
    []
  );

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      {sparkles.map((s) => {
        const opacity = progress.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] });
        const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, s.driftY] });
        const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, s.driftX] });
        const scale = progress.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0.4, 1.2, 0.8] });
        return (
          <Animated.View
            key={s.key}
            style={{
              position: "absolute",
              left: s.left,
              top: s.top,
              width: 10,
              height: 10,
              borderRadius: 2,
              backgroundColor: "rgba(255,255,255,0.95)",
              opacity,
              transform: [{ translateX }, { translateY }, { rotate: "45deg" }, { scale }],
            }}
          />
        );
      })}
    </View>
  );
}

function makeStyles(UI: any) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: "transparent" },
    gradient: { ...StyleSheet.absoluteFillObject },

    topWrap: {
      paddingHorizontal: 18,
      paddingBottom: 10,
    },

    premiumRowInner: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

    rowOuter: {
      width: "100%",
      borderRadius: 18,
      marginBottom: 10,
      overflow: "visible",
      zIndex: 1,
    },
    rowInner: {
      borderRadius: 18,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: UI.stroke,
      paddingVertical: 12,
      paddingHorizontal: 14,
      backgroundColor: UI.accentSoft,
      minHeight: 74,
    },

    rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 12 },
    rowDoneBtn: {
      paddingHorizontal: 14,
      height: 40,
      borderRadius: 999,
      backgroundColor: UI.accent,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.18)",
    },
    rowDoneBtnText: { fontSize: 14, fontWeight: "900", color: UI.text },
    rowMain: { flex: 1, minWidth: 0 },

    rowTitle: {
      fontSize: 20,
      fontWeight: "900",
      color: UI.text,
      includeFontPadding: false,
      lineHeight: 22,
      paddingBottom: 0,
    },
    rowDoneSmall: { marginTop: 2, fontSize: 12, fontWeight: "800", color: UI.sub },
    rowStreak: { flexDirection: "row", alignItems: "center", gap: 6 },
    rowBarTrack: { marginTop: 10, height: 8, borderRadius: 99, backgroundColor: UI.stroke, overflow: "hidden" },
    rowBarFill: { height: "100%", borderRadius: 99, backgroundColor: UI.accent },

    reorderHintRow: {
      marginTop: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    reorderChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderWidth: 1,
      borderColor: UI.stroke,
      backgroundColor: UI.card,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 999,
    },
    reorderChipText: { fontSize: 13, fontWeight: "900", color: UI.text },
    reorderDoneBtn: {
      borderWidth: 1,
      borderColor: UI.stroke,
      backgroundColor: UI.card2,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 999,
    },
    reorderDoneText: { fontSize: 13, fontWeight: "900", color: UI.text },

    arrowCol: { flexDirection: "row", alignItems: "center", gap: 8 },
    arrowBtn: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: UI.card2,
      borderWidth: 1,
      borderColor: UI.stroke,
    },
    arrowBtnDisabled: {
      opacity: 0.35,
    },

    welcomeSmall: {
      fontSize: 14,
      fontWeight: "800",
      color: UI.sub,
    },
    welcomeName: {
      marginTop: 2,
      fontSize: 34,
      lineHeight: 38,
      fontWeight: "900",
      color: UI.text,
    },
    premiumRow: {
      marginTop: 8,
      alignItems: "flex-start",
      gap: 8,
    },
    premiumTag: {
      fontSize: 16,
      fontWeight: "900",
      color: UI.sub,
    },
    freeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    upgradeText: {
      fontSize: 16,
      fontWeight: "900",
      color: UI.accent,
    },

    headerRightStack: {
      alignItems: "flex-end",
      justifyContent: "flex-start",
      gap: 6,
    },
    medalsRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 7,
      paddingRight: 2,
      marginTop: 4,
      marginLeft: 6,
    },
    medalItem: {
      width: 36,
      alignItems: "center",
    },
    medalIconBox: {
      width: 36,
      height: 44,
      alignItems: "center",
      justifyContent: "flex-end",
    },
    medalImg: {
      width: 34,
      height: 34,
    },
    medalCount: {
      marginTop: 4,
      height: 14,
      fontSize: 12,
      fontWeight: "900",
      color: UI.text,
      opacity: 0.92,
      lineHeight: 14,
      textAlign: "center",
      includeFontPadding: false,
    },
    medalDim: {
      opacity: 0.22,
    },
    medalCountDim: {
      opacity: 0.22,
    },

    heroCard: {
      marginTop: 14,
      borderRadius: 26,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: UI.stroke,
      minHeight: 155,
    },
    heroGradient: {
      ...StyleSheet.absoluteFillObject,
    },
    heroContent: {
      padding: 18,
      minHeight: 155,
      justifyContent: "center",
    },
    heroTitle: {
      fontSize: 18,
      fontWeight: "900",
      color: "rgba(255,255,255,0.95)",
    },
    heroBig: {
      marginTop: 6,
      fontSize: 54,
      lineHeight: 58,
      fontWeight: "900",
      color: "#fff",
    },
    heroSub: {
      marginTop: -2,
      fontSize: 22,
      fontWeight: "900",
      color: "rgba(255,255,255,0.95)",
    },
    heroQuote: {
      marginTop: 10,
      fontSize: 16,
      fontWeight: "800",
      color: "rgba(255,255,255,0.92)",
    },
    heroPlus: {
      position: "absolute",
      right: 16,
      bottom: 14,
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: "rgba(255,255,255,0.92)",
      alignItems: "center",
      justifyContent: "center",
      elevation: 0,
    },

    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 24,
      backgroundColor: "transparent",
    },

    searchIconWrap: {
      width: 120,
      height: 120,
      borderRadius: 60,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 14,
    },

    emptyTitle: {
      fontSize: 18,
      fontWeight: "900",
      marginBottom: 6,
      textAlign: "center",
      color: UI.text,
    },
    emptyText: { fontSize: 14, color: UI.sub, textAlign: "center" },

    scroll: { paddingTop: 12, paddingBottom: 24 },

    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: UI.backdrop,
    },
    sheet: {
      position: "absolute",
      left: 12,
      right: 12,
      bottom: 12,
      borderRadius: 22,
      backgroundColor: UI.sheetBg,
      borderWidth: 1,
      borderColor: UI.sheetStroke,
      padding: 14,
      maxHeight: "80%",
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 10,
    },
    sheetTitle: { flex: 1, fontSize: 18, fontWeight: "900", color: UI.text },
    closeBtn: {
      borderWidth: 1,
      borderColor: UI.stroke,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: UI.card2,
    },
    closeText: { fontSize: 13, fontWeight: "800", color: UI.text },

    modalRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 14,
      backgroundColor: UI.card,
      borderWidth: 1,
      borderColor: UI.stroke,
      marginTop: 10,
    },
    modalLabel: {
      fontSize: 15,
      fontWeight: "900",
      includeFontPadding: false,
      marginTop: 0,
    },
    countRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    countBtn: {
      width: 36,
      height: 36,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: UI.card2,
      borderWidth: 1,
      borderColor: UI.stroke,
    },
    countValue: { minWidth: 54, textAlign: "center", fontSize: 16, fontWeight: "900" },

    pickerBox: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      marginTop: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 14,
      borderWidth: 1,
    },
    pickerBoxText: { fontSize: 15, fontWeight: "900" },
pickerSheet: {
  position: "absolute",
  left: 16,
  right: 16,
  bottom: 24,
  borderRadius: 16,
  borderWidth: 1,
  overflow: "hidden",
  backgroundColor: "#111827",
  borderColor: "#374151",
},
pickerRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingVertical: 14,
  paddingHorizontal: 14,
  borderTopWidth: 1,
  borderTopColor: "#374151",
  backgroundColor: "#1F2937",
},
    pickerRowText: { fontSize: 15, fontWeight: "900" },

    primaryBtn: {
      marginTop: 10,
      borderRadius: 14,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: UI.accent,
    },
    primaryBtnText: { color: "#0B1220", fontWeight: "900", fontSize: 15 },

    secondaryBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      marginTop: 10,
      borderRadius: 14,
      paddingVertical: 12,
      backgroundColor: UI.card2,
      borderWidth: 1,
      borderColor: UI.stroke,
    },
    secondaryBtnText: { color: UI.text, fontWeight: "900", fontSize: 15 },

    dangerBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      marginTop: 14,
      borderRadius: 14,
      paddingVertical: 12,
      backgroundColor: "#D12C2C",
    },
    dangerBtnText: { color: "#fff", fontWeight: "900", fontSize: 15 },

    input: {
      marginTop: 10,
      borderRadius: 14,
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: UI.card,
      fontWeight: "800",
    },

    modalHint: {
      marginTop: 6,
      color: UI.sub,
      fontWeight: "800",
      fontSize: 13,
      lineHeight: 18,
    },

    pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
    pill: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: UI.stroke,
      backgroundColor: UI.card,
    },
    pillActive: { backgroundColor: UI.accent, borderColor: UI.accent },
    pillText: { color: UI.text, fontWeight: "900" },
    pillTextActive: { color: "#0B1220" },

    timeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 8,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 14,
      backgroundColor: UI.card,
      borderWidth: 1,
      borderColor: UI.stroke,
    },
    timeIndex: { fontWeight: "900" },

    historyRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: UI.rowDivider,
    },
    historyDate: {
      fontSize: 13,
      opacity: 0.85,
      fontWeight: "800",
      color: UI.text,
    },
    historyStatus: { fontSize: 13, fontWeight: "900", color: UI.accent },

    streakNum: { fontSize: 17, fontWeight: "900", color: UI.text },
    sharedWrap: {
      paddingHorizontal: 18,
      paddingTop: 2,
      paddingBottom: 10,
    },
    sharedSectionTitle: {
      fontSize: 18,
      fontWeight: "900",
      color: UI.text,
      marginBottom: 10,
    },
    sharedCardOuter: {
      width: "100%",
      borderRadius: 18,
      marginBottom: 10,
      overflow: "visible",
    },
    sharedCardInner: {
      borderRadius: 18,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: UI.stroke,
      paddingVertical: 12,
      paddingHorizontal: 14,
      backgroundColor: UI.card,
      minHeight: 74,
    },
    sharedBadge: {
      alignSelf: "flex-start",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: UI.stroke,
      backgroundColor: UI.card2,
      marginBottom: 10,
    },
    sharedBadgeText: {
      fontSize: 12,
      fontWeight: "900",
      color: UI.text,
    },
    sharedTitle: {
      fontSize: 19,
      fontWeight: "900",
      color: UI.text,
    },
    sharedSubtitle: {
      marginTop: 2,
      fontSize: 12,
      fontWeight: "800",
      color: UI.sub,
    },
    sharedTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
sharedMembersGrid: {
  flexDirection: "row",
  flexWrap: "wrap",
  marginTop: 12,
  borderWidth: 1,
  borderColor: UI.stroke,
  borderRadius: 16,
  overflow: "hidden",
},

sharedMemberCol: {
  width: "20%",
  minWidth: 90,
  borderRightWidth: 1,
  borderBottomWidth: 1,
  borderRightColor: UI.stroke,
  borderBottomColor: UI.stroke,
  paddingHorizontal: 10,
  paddingVertical: 10,
  backgroundColor: UI.card2,
},

sharedMemberColLastInRow: {
  borderRightWidth: 0,
},

sharedMemberTop: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 6,
  marginBottom: 6,
},

sharedMemberCount: {
  marginTop: 2,
  fontSize: 13,
  fontWeight: "900",
  color: UI.text,
},
    sharedPlayerName: {
      fontSize: 13,
      fontWeight: "900",
      color: UI.text,
    },
    sharedPlayerMeta: {
      marginTop: 3,
      fontSize: 12,
      fontWeight: "800",
      color: UI.sub,
    },
    sharedFlameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginTop: 4,
    },
    sharedFlameNum: {
      fontSize: 18,
      fontWeight: "900",
      color: UI.text,
      marginTop: 6,
    },
    sharedBarTrack: {
      marginTop: 10,
      height: 8,
      borderRadius: 99,
      backgroundColor: UI.stroke,
      overflow: "hidden",
    },
    sharedBarFill: {
      height: "100%",
      borderRadius: 99,
      backgroundColor: UI.accent,
    },
    sharedDoneBtn: {
      paddingHorizontal: 14,
      height: 40,
      borderRadius: 999,
      backgroundColor: UI.accent,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.18)",
    },
    sharedDoneBtnText: {
      fontSize: 14,
      fontWeight: "900",
      color: UI.text,
    },
    sharedLeaveBtn: {
      paddingHorizontal: 14,
      height: 40,
      borderRadius: 999,
      backgroundColor: UI.card2,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: UI.stroke,
    },
    sharedLeaveBtnText: {
      fontSize: 14,
      fontWeight: "900",
      color: UI.text,
    },
    sharedActionsRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    sharedCompactRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    sharedCompactLeft: {
      flex: 1,
      minWidth: 0,
    },
    sharedCompactMeta: {
      marginTop: 4,
      fontSize: 12,
      fontWeight: "800",
      color: UI.sub,
    },
    sharedExpandBtn: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: UI.card2,
      borderWidth: 1,
      borderColor: UI.stroke,
    },
    sharedExpandedBlock: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: UI.stroke,
    },
    sharedPendingBox: {
      marginTop: 4,
      gap: 10,
    },
    sharedPendingText: {
      fontSize: 13,
      fontWeight: "800",
      color: UI.sub,
      lineHeight: 18,
    },
  });
}

const MEDAL_OFFSETS = {
  brambora: -5,
  steel: -5,
  bronze: -5,
  silver: 0,
  gold: 0,
  diamond: 0,
};

export default function Index() {
  const router = useRouter();

  const { UI, mode } = useTheme();
  const { lang } = useI18n();
  const TXT = useMemo(
    () =>
      lang === "en"
        ? {
            welcomeBack: "Welcome back",
            premium: "Premium",
            free: "Free",
            upgrade: "Upgrade",
            keepsGoing: "You’ve been going for",
            dontStop: "Don’t stop!",
            quote: "A small step today, a Big change",
            addTitle: "Add challenge",
            close: "Close",
            namePlaceholder: "Challenge name",
            add: "Add",
            manageTitle: "Manage challenge",
            active: "Active",
            perDayCount: "Count per day",
            period: "Period",
            daily: "Daily",
            every2: "Every other day",
            customDays: "Custom days",
            chooseDaysHint: "Choose the days when the challenge is active.",
            notifications: "Notifications",
            saveNotifications: "Save notifications",
            challengeHistory: "Challenge history",
            deleteChallenge: "Delete challenge",
            historyOfChallenge: "Challenge history",
            currentMedal: "Current medal",
            bestStreakOfChallenge: "Best streak of this challenge",
            completed: "Completed",
            skipped: "Skipped",
            freeDay: "Free day",
            notCompleted: "Not completed",
            nothingHereYet: "Nothing here yet",
            addChallengeAndStart: "Add a challenge and start today.",
            sharedChallenges: "Shared challenges",
            waitingForAccept: "Waiting for acceptance",
            sharedChallenge: "Shared challenge",
            withFriend: "With friend",
            withFriends: "With friends",
            todayTarget: "Today's target",
            todayIsFree: "Today is a free day",
            leave: "Leave",
            done: "Done",
            complete: "Complete",
            acceptChallenge: "Accept challenge",
            waitingForOthers: "Waiting for other members",
            loadingSharedPrompt: "This shared challenge was sent to you by a friend. Accept it first.",
            alreadyAcceptedWaiting: "You have already accepted this challenge. Waiting for the others",
            accountNotLogged: "You are not signed in.",
            challengeNotAccepted: "This challenge has not been accepted by all members yet.",
            couldNotSaveCompletion: "Could not save completion.",
            challengeAccepted: "Challenge accepted.",
            couldNotAcceptChallenge: "Could not accept challenge.",
            leaveQuestion: "Leave challenge?",
            reallyLeave: "Do you really want to leave?",
            yes: "Yes",
            no: "No",
            couldNotLeave: "Could not leave challenge.",
            freeVersionMaxChallengesTitle: "Unlock Premium",
            freeVersionMaxChallenges: "In the Free version you can have a maximum of 2 challenges. Unlock Premium for unlimited challenges.",
            stayFree: "Stay Free",
            unlockPremium: "Unlock Premium",
            notificationFreeLimit: "In the free version, you can only have notifications for one challenge. Turn them off on another challenge first.",
            expoGoNotifications: "Notifications do not work in Expo Go. Since Expo SDK 53, notifications are disabled in Expo Go. A development build (EAS) is required.",
            notificationsFailed: "Could not set notifications.",
            deleteQuestion: "Delete challenge?",
            deleteQuestionText: "This action cannot be undone.",
            delete: "Delete",
            freeRelax: "Relax :)",
            addTodayCount: "Completed",
          }
        : {
            welcomeBack: "Vítej zpět",
            premium: "Premium",
            free: "Free",
            upgrade: "Upgradovat",
            keepsGoing: "Držíš se už",
            dontStop: "Nezastavuj!",
            quote: "Malý krok dnes, velká změna zítra",
            addTitle: "Přidat výzvu",
            close: "Zavřít",
            namePlaceholder: "Název výzvy",
            add: "Přidat",
            manageTitle: "Správa výzvy",
            active: "Aktivní",
            perDayCount: "Počet výzev za den",
            period: "Perioda",
            daily: "Denně",
            every2: "Obden",
            customDays: "Vlastní dny",
            chooseDaysHint: "Vyber dny, kdy je výzva aktivní.",
            notifications: "Notifikace",
            saveNotifications: "Uložit notifikace",
            challengeHistory: "Historie výzvy",
            deleteChallenge: "Smazat výzvu",
            historyOfChallenge: "Historie výzvy",
            currentMedal: "Aktuální medaile",
            bestStreakOfChallenge: "Nejlepší streak této výzvy",
            completed: "Splněno",
            skipped: "Přeskočeno",
            freeDay: "Volný den",
            notCompleted: "Nesplněno",
            nothingHereYet: "Zatím tu nic není",
            addChallengeAndStart: "Přidej si výzvu a začni dnes.",
            sharedChallenges: "Společné výzvy",
            waitingForAccept: "Čeká na přijetí",
            sharedChallenge: "Společná výzva",
            withFriend: "S kamarádem",
            withFriends: "S přáteli",
            todayTarget: "Cíl dnes",
            todayIsFree: "Dnes je volný den",
            leave: "Odejít",
            done: "Splněno",
            complete: "Splnit",
            acceptChallenge: "Přijmout výzvu",
            waitingForOthers: "Čeká se na ostatní členy",
            loadingSharedPrompt: "Tuto společnou výzvu ti poslal kamarád. Nejprve ji přijmi.",
            alreadyAcceptedWaiting: "Ty už jsi výzvu přijal. Čeká se na ostatní",
            accountNotLogged: "Nejsi přihlášený.",
            challengeNotAccepted: "Tato výzva ještě nebyla přijata všemi členy.",
            couldNotSaveCompletion: "Nepodařilo se uložit splnění.",
            challengeAccepted: "Výzva byla přijata.",
            couldNotAcceptChallenge: "Nepodařilo se přijmout výzvu.",
            leaveQuestion: "Odejít z výzvy?",
            reallyLeave: "Opravdu odejít?",
            yes: "Ano",
            no: "Ne",
            couldNotLeave: "Nepodařilo se odejít z výzvy.",
            freeVersionMaxChallengesTitle: "Odemkni Premium",
            freeVersionMaxChallenges: "Ve Free verzi můžeš mít maximálně 2 výzvy. Odemkni Premium pro neomezený počet výzev.",
            stayFree: "Zůstat ve Free",
            unlockPremium: "Odemknout Premium",
            notificationFreeLimit: "Ve free verzi můžeš mít notifikace jen u jedné výzvy. Vypni je nejdřív u jiné výzvy.",
            expoGoNotifications: "Notifikace v Expo Go nefungují. Od Expo SDK 53 byly notifikace v Expo Go vypnuté. Je potřeba development build (EAS).",
            notificationsFailed: "Nepodařilo se nastavit notifikace.",
            deleteQuestion: "Smazat výzvu?",
            deleteQuestionText: "Tahle akce nejde vrátit zpět.",
            delete: "Smazat",
            freeRelax: "Relaxuj :)",
            addTodayCount: "Splněno",
          },
    [lang]
  );
  const styles = useMemo(() => makeStyles(UI), [UI]);
  const insets = useSafeAreaInsets();

  const todayISO = useTodayISO();

  const isChallengeActiveOnDate = useCallback(
    (c: any, dateISO: string): boolean => {
      if (!c) return false;
      if (c.enabled === false) return false;
      if (c.deletedAt) return false;

      const period = c.period === "every2" || c.period === "custom" ? c.period : "daily";
      if (period === "daily") return true;

      if (period === "every2") {
        const anchor =
          typeof c.periodAnchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.periodAnchor) ? c.periodAnchor : dateISO;
        const diff = diffDaysISO(dateISO, anchor);
        return Math.abs(diff) % 2 === 0;
      }

      const days: number[] = Array.isArray(c.customDays)
        ? c.customDays
            .map((n: any) => Number(n))
            .filter((n: number) => Number.isFinite(n) && n >= 0 && n <= 6)
            .map((n: number) => Math.floor(n))
        : [];
      const dow = dowMon0(dateISO);
      return days.includes(dow);
    },
    []
  );

  const isChallengeActiveToday = useCallback((c: any): boolean => isChallengeActiveOnDate(c, todayISO), [isChallengeActiveOnDate, todayISO]);

  const [premium, setPremium] = useState(false);
  const [appState, setAppState] = useState<AppState | null>(null);
  const [sharedChallenges, setSharedChallenges] = useState<SharedChallenge[]>([]);
  const [sharedTodayMap, setSharedTodayMap] = useState<Record<string, SharedChallengeDayProgress | null>>({});
  const [sharedFriendNames, setSharedFriendNames] = useState<Record<string, string>>({});
  const [sharedProgressMap, setSharedProgressMap] = useState<Record<string, SharedChallengeDayProgress[]>>({});

  useEffect(() => {
    return subscribeState((next) => {
      setAppState(next);
    });
  }, []);

  

  useEffect(() => {
    let mounted = true;

    let unsubDays: Array<() => void> = [];
    let unsubProgress: Array<() => void> = [];

    const unsubShared = subscribeSharedChallenges(
      async (items) => {
        if (!mounted) return;

        setSharedChallenges(items);

        unsubDays.forEach((u) => u());
        unsubDays = [];

        unsubProgress.forEach((u) => u());
        unsubProgress = [];

        const today = getSharedTodayISO();

        items.forEach((item) => {
          if (item.status === "active") {
            const unsub = subscribeSharedChallengeDay(
              item.id,
              today,
              (data) => {
                setSharedTodayMap((prev) => ({
                  ...prev,
                  [item.id]: data,
                }));
              },
              () => {
                setSharedTodayMap((prev) => ({
                  ...prev,
                  [item.id]: null,
                }));
              }
            );
            unsubDays.push(unsub);

            const unsubAll = subscribeSharedChallengeProgress(
              item.id,
              (rows) => {
                setSharedProgressMap((prev) => ({
                  ...prev,
                  [item.id]: rows,
                }));
              },
              () => {
                setSharedProgressMap((prev) => ({
                  ...prev,
                  [item.id]: [],
                }));
              }
            );
            unsubProgress.push(unsubAll);
          } else {
            setSharedTodayMap((prev) => ({
              ...prev,
              [item.id]: null,
            }));
            setSharedProgressMap((prev) => ({
              ...prev,
              [item.id]: [],
            }));
          }
        });

        const allOtherUids = Array.from(
          new Set(
            items.flatMap((x) => x.memberUids).filter((uid) => uid !== auth.currentUser?.uid)
          )
        );

        const nextNames: Record<string, string> = {};
        for (const uid of allOtherUids) {
          try {
            const p = await getProfile(uid);
            nextNames[uid] =
              typeof p?.username === "string" && p.username.trim()
                ? p.username.trim()
                : uid;
          } catch {
            nextNames[uid] = uid;
          }
        }

        if (mounted) {
          setSharedFriendNames(nextNames);
        }
      },
      () => {
        if (!mounted) return;
        setSharedChallenges([]);
        setSharedTodayMap({});
        setSharedProgressMap({});
        setSharedFriendNames({});
      }
    );

    return () => {
      mounted = false;
      unsubShared?.();
      unsubDays.forEach((u) => u());
      unsubProgress.forEach((u) => u());
    };
  }, []);

  

  useEffect(() => {
    let mounted = true;
    isPremiumActive().then((p) => mounted && setPremium(!!p));
    const unsub = subscribePremium((p) => mounted && setPremium(!!p));
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [manageOpen, setManageOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalText, setAddModalText] = useState("");
  const [manageId, setManageId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [reorderMode, setReorderMode] = useState(false);
  const [expandedSharedId, setExpandedSharedId] = useState<string | null>(null);

  const managed = useMemo(() => {
    if (!manageId) return null;
    return (appState?.challenges ?? []).find((c: any) => String(c.id) === String(manageId)) as any;
  }, [appState?.challenges, manageId]);

  const [manageEnabled, setManageEnabled] = useState(true);
  const [manageTarget, setManageTarget] = useState(1);
  const [managePeriod, setManagePeriod] = useState<"daily" | "every2" | "custom">("daily");
  const [manageCustomDays, setManageCustomDays] = useState<number[]>([]);
  const [managePeriodAnchor, setManagePeriodAnchor] = useState<string | null>(null);
  const [periodPickerOpen, setPeriodPickerOpen] = useState(false);
  const [manageRemEnabled, setManageRemEnabled] = useState(false);
  const [manageRemCount, setManageRemCount] = useState(1);
  const [manageRemTimes, setManageRemTimes] = useState<string[]>([]);
  const [manageRename, setManageRename] = useState("");

  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [timePickerIndex, setTimePickerIndex] = useState(0);
  const [timePickerValue, setTimePickerValue] = useState(new Date());

  const openManage = useCallback(
    (id: string) => {
      const c = (appState?.challenges ?? []).find((x: any) => String(x.id) === String(id)) as any;
      if (!c) return;

      const enabled = (c as any).enabled !== false;
      const target = clamp(Number((c as any).targetPerDay ?? 1) || 1, 1, 20);

      const rawPeriod = String((c as any).period ?? "daily");
      const period: "daily" | "every2" | "custom" = rawPeriod === "every2" || rawPeriod === "custom" ? (rawPeriod as any) : "daily";
      const customDays: number[] = Array.isArray((c as any).customDays)
        ? (c as any).customDays
            .map((n: any) => Number(n))
            .filter((n: number) => Number.isFinite(n) && n >= 0 && n <= 6)
            .map((n: number) => Math.floor(n))
        : [];
      const uniqueDays = Array.from(new Set(customDays)).sort((a, b) => a - b);
      const anchor = typeof (c as any).periodAnchor === "string" ? String((c as any).periodAnchor) : null;

      const remEnabled = !!(c as any).reminderEnabled;
      const times = Array.isArray((c as any).reminderTimes) ? ((c as any).reminderTimes as string[]) : [];
      const safeTimes = times.filter((t) => typeof t === "string" && /^\d{2}:\d{2}$/.test(t));

      setManageId(String(id));
      setManageEnabled(enabled);
      setManageTarget(target);
      setManagePeriod(period);
      setManageCustomDays(uniqueDays);
      setManagePeriodAnchor(anchor);
      setManageRemEnabled(remEnabled);
      setManageRemTimes(remEnabled ? safeTimes : []);
      setManageRemCount(clamp((remEnabled ? safeTimes.length : 1) || 1, 1, Math.min(10, target)));
      setManageRename(String((c as any).text ?? ""));
      setManageOpen(true);
    },
    [appState?.challenges]
  );

  const closeManage = useCallback(() => {
    Keyboard.dismiss();
    setManageOpen(false);
    setManageId(null);
  }, []);

  const persist = useCallback(async (updater: (latest: AppState) => AppState) => {
    const latest = (await loadState()) as AppState;
    const next = updater(latest);
    await saveState(next);
  }, []);

  const addChallengeFromHero = useCallback(async () => {
    const trimmed = addModalText.trim();
    if (!trimmed) return;
    if (!premium) {
      const total = (appState?.challenges ?? []).length;
      if (total >= FREE_MAX) {
        Alert.alert(
          TXT.freeVersionMaxChallengesTitle,
          TXT.freeVersionMaxChallenges,
          [
            { text: TXT.stayFree, style: "cancel" },
            {
              text: TXT.unlockPremium,
              onPress: () => {
                setAddModalOpen(false);
                setAddModalText("");
                router.push("/(tabs)/profile" as any);
              },
            },
          ]
        );
        return;
      }
    }
    Keyboard.dismiss();
    setAddModalText("");
    await persist((latest2) => {
      const newId = String(Date.now());
      return {
        ...latest2,
        challenges: [{ id: newId, text: trimmed, enabled: true }, ...(latest2.challenges ?? [])],
      };
    });
    setAddModalOpen(false);
  }, [addModalText, persist, premium, appState?.challenges, router]);

  const saveBasicsImmediate = useCallback(
    async (nextEnabled: boolean, nextTarget: number) => {
      if (!manageId) return;
      const id = String(manageId);
      const target = clamp(Number(nextTarget) || 1, 1, 20);

      await persist((latest) => {
        const list = [...(latest.challenges ?? [])];
        const idx = list.findIndex((c: any) => String(c.id) === id);
        if (idx === -1) return latest as any;

        const prevItem = list[idx] as any;
        const prevEnabled = prevItem?.enabled !== false;
        const willEnabled = !!nextEnabled;

        const item = { ...prevItem, enabled: willEnabled, targetPerDay: target };

        if (prevEnabled === willEnabled) {
          list[idx] = item;
          return { ...(latest as any), challenges: list } as any;
        }

        list.splice(idx, 1);

        if (item.enabled) {
          const firstDisabled = list.findIndex((c: any) => (c as any).enabled === false);
          const insertAt = firstDisabled === -1 ? list.length : firstDisabled;
          list.splice(insertAt, 0, item);
        } else {
          list.push(item);
        }

        return { ...(latest as any), challenges: list } as any;
      });

      const maxN = Math.min(10, target);
      if (manageRemEnabled) {
        setManageRemCount((n) => clamp(n, 1, maxN));
        setManageRemTimes((arr) => (Array.isArray(arr) ? arr.slice(0, clamp(manageRemCount, 1, maxN)) : []));
      }
    },
    [manageId, manageRemCount, manageRemEnabled, persist]
  );

  const savePeriodImmediate = useCallback(
    async (nextPeriod: "daily" | "every2" | "custom", nextCustomDays?: number[]) => {
      if (!manageId) return;
      const id = String(manageId);

      const rawDays = Array.isArray(nextCustomDays) ? nextCustomDays : manageCustomDays;

      let uniqueDays = Array.from(new Set(rawDays))
        .map((n: any) => Number(n))
        .filter((n: number) => Number.isFinite(n) && n >= 0 && n <= 6)
        .map((n: number) => Math.floor(n))
        .sort((a, b) => a - b);

      if (nextPeriod === "custom" && uniqueDays.length === 0) {
        uniqueDays = [dowMon0(todayISO)];
      }

      const anchor = nextPeriod === "every2" ? (managePeriodAnchor ?? todayISO) : null;

      await persist((latest) => {
        const list = [...(latest.challenges ?? [])];
        const idx = list.findIndex((c: any) => String(c.id) === id);
        if (idx === -1) return latest as any;

        const prevItem = list[idx] as any;
        list[idx] = {
          ...prevItem,
          period: nextPeriod,
          customDays: nextPeriod === "custom" ? uniqueDays : [],
          periodAnchor: nextPeriod === "every2" ? String(anchor) : undefined,
        };
        return { ...(latest as any), challenges: list } as any;
      });

      setManagePeriod(nextPeriod);
      setManageCustomDays(nextPeriod === "custom" ? uniqueDays : []);
      setManagePeriodAnchor(nextPeriod === "every2" ? String(anchor) : null);
    },
    [manageId, manageCustomDays, managePeriodAnchor, persist, todayISO]
  );

  const saveRenameImmediate = useCallback(async () => {
    if (!manageId) return;
    const v = manageRename.trim();
    if (!v) return;
    const next = await renameChallenge(String(manageId), v);
    await saveState(next);
  }, [manageId, manageRename]);

  const renameTimer = useRef<any>(null);
  useEffect(() => {
    if (!manageOpen) return;
    if (!manageId) return;
    if ((managed?.text ?? "") === manageRename) return;

    if (renameTimer.current) clearTimeout(renameTimer.current);
    renameTimer.current = setTimeout(() => {
      void saveRenameImmediate();
    }, 600);

    return () => {
      if (renameTimer.current) clearTimeout(renameTimer.current);
    };
  }, [manageOpen, manageId, managed?.text, manageRename, saveRenameImmediate]);

  const applyManageReminders = useCallback(async () => {
    if (!manageId) return;
    const id = String(manageId);

    const target = clamp(Number(manageTarget) || 1, 1, 20);
    const maxN = Math.min(10, target);
    const times = (manageRemTimes ?? []).slice(0, clamp(manageRemCount, 1, maxN));

    if (!premium && manageRemEnabled) {
      const activeId = getFreeActiveReminderChallengeId(appState as any);
      if (activeId && String(activeId) !== id) {
        Alert.alert(TXT.notifications, TXT.notificationFreeLimit);
        return;
      }
    }

    await persist((latest) => {
      const nextChallenges = (latest.challenges ?? []).map((c: any) => {
        if (String(c.id) !== id) return c;
        return {
          ...c,
          reminderEnabled: !!manageRemEnabled,
          reminderTimes: manageRemEnabled ? times : [],
        };
      });
      return { ...latest, challenges: nextChallenges } as any;
    });

    try {
      if (manageRemEnabled && times.length) {
        const latest = await loadState();
        const c = (latest.challenges ?? []).find((x: any) => String(x.id) === id) as any;
        await setDailyRemindersForChallenge(id, String(c?.text ?? "OneMore"), times);
      } else {
        await clearDailyRemindersForChallenge(id);
      }
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.includes("NOTIFICATIONS_EXPO_GO_UNSUPPORTED")) {
        Alert.alert(
          TXT.notifications,
          TXT.expoGoNotifications
        );
      } else {
        Alert.alert(TXT.notifications, TXT.notificationsFailed);
      }
    }
  }, [manageId, manageTarget, manageRemTimes, manageRemCount, manageRemEnabled, premium, appState, persist]);

  const deleteManagedChallenge = useCallback(async () => {
    if (!manageId) return;
    const id = String(manageId);

    Alert.alert(TXT.deleteQuestion, TXT.deleteQuestionText, [
      { text: TXT.close, style: "cancel" },
      {
        text: "Smazat",
        style: "destructive",
        onPress: async () => {
          try {
            await clearDailyRemindersForChallenge(id);
          } catch {}

          const next = await purgeChallenge(id);
          await saveState(next);

          closeManage();
        },
      },
    ]);
  }, [closeManage, manageId]);

  useEffect(() => {
    setRemindersPremiumEnabled(!!premium);
  }, [premium]);

  const heroPulse = useRef(new Animated.Value(0)).current;
  const sparkle = useRef(new Animated.Value(0)).current;

  const heroScale = useMemo(
    () =>
      heroPulse.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 1.035],
      }),
    [heroPulse]
  );

  const reload = useCallback(async () => {
    let s = await ensureDailyPick();
    if (!Array.isArray((s as any).history)) (s as any).history = [];

    const tdy = todayISO;

    const pickedId = s.dailyIds?.[0] != null ? String(s.dailyIds[0]) : null;

    if (s.lastCompletedDate === tdy && pickedId) {
      const hasPickedCompletedToday = (s.history ?? []).some(
        (h) =>
          String((h as any)?.challengeId ?? "") === String(pickedId) &&
          (h as any)?.date === tdy &&
          (h as any)?.status === "completed"
      );

      if (!hasPickedCompletedToday) {
        const ch = (s.challenges ?? []).find((c) => String(c.id) === String(pickedId));
        const entry = {
          date: tdy,
          time: nowHM(),
          atISO: new Date().toISOString(),
          challengeId: String(pickedId),
          challengeText: ch?.text ?? "(smazaná výzva)",
          status: "completed" as const,
        };

        const filtered = (s.history ?? []).filter(
          (h) => !(String((h as any)?.challengeId ?? "") === String(pickedId) && (h as any)?.date === tdy)
        );

        const ever = new Set<string>((s.everCompletedKeys ?? []).map(String));
        ever.add(`id:${String(pickedId)}`);

        s = {
          ...s,
          history: [entry, ...filtered],
          everCompletedKeys: Array.from(ever),
        };

        await saveState(s);
      }
    }

    setAppState(s);
  }, [todayISO]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  const tdy = todayISO;
  const historyEntries = appState?.history ?? [];

  const visibleChallenges = useMemo(() => {
    const all = appState?.challenges ?? [];
    return premium ? all : all.slice(0, FREE_MAX);
  }, [appState?.challenges, premium]);

  const [listData, setListData] = useState<any[]>([]);
  useEffect(() => {
    setListData(visibleChallenges as any[]);
  }, [visibleChallenges]);

  const count = visibleChallenges.length;
  const sidePadding = 18;
  const visibleSharedChallenges = useMemo(() => {
    return sharedChallenges.filter((x) => x.enabled !== false);
  }, [sharedChallenges]);

  const dayIndex = useMemo(() => {
    const byChallenge = new Map<string, Map<string, { completed: number; skipped: boolean; lastTime?: string }>>();
    const startDate = new Map<string, string>();

    for (const h of historyEntries as any[]) {
      const cid = String(h?.challengeId ?? "");
      const date = String(h?.date ?? "");
      if (!cid || !date) continue;

      let byDate = byChallenge.get(cid);
      if (!byDate) {
        byDate = new Map();
        byChallenge.set(cid, byDate);
      }

      const cur = byDate.get(date) ?? { completed: 0, skipped: false, lastTime: undefined };

      if (h?.status === "completed") {
        cur.completed += 1;
        const t = String(h?.time ?? "");
        if (t) cur.lastTime = t;
      } else if (h?.status === "skipped") {
        cur.skipped = true;
      }

      byDate.set(date, cur);

      const prev = startDate.get(cid);
      if (!prev || date < prev) startDate.set(cid, date);
    }

    return { byChallenge, startDate };
  }, [historyEntries]);

  function getDaySummary(challengeId: string, date: string) {
    return dayIndex.byChallenge.get(String(challengeId))?.get(String(date));
  }

  function getStartDateForChallenge(challengeId: string): string {
    return dayIndex.startDate.get(String(challengeId)) ?? tdy;
  }

  function targetForChallenge(challengeId: string): number {
    const c = (visibleChallenges as any[]).find((x) => String(x.id) === String(challengeId));
    const t = Number((c as any)?.targetPerDay ?? 1);
    return Number.isFinite(t) && t > 0 ? Math.floor(t) : 1;
  }

  function completedTodayCount(challengeId: string): number {
    const raw = getDaySummary(challengeId, tdy)?.completed ?? 0;
    const target = Math.max(1, targetForChallenge(challengeId));
    return Math.min(raw, target);
  }

  function progressRatioForCell(challengeId: string): number {
    const done = completedTodayCount(challengeId);
    const target = targetForChallenge(challengeId);
    return Math.max(0, Math.min(1, done / Math.max(1, target)));
  }

  function getSharedOtherUids(item: SharedChallenge): string[] {
    const me = auth.currentUser?.uid ?? "";
    return item.memberUids
      .filter((uid) => String(uid) !== String(me))
      .map((uid) => String(uid));
  }

  function getSharedDisplayName(uid: string): string {
    const me = auth.currentUser?.uid ?? "";
    if (String(uid) === String(me)) return "Ty";
    return sharedFriendNames[String(uid)] || String(uid);
  }

  function getSharedCompactLabel(item: SharedChallenge): string {
    const otherNames = getSharedOtherUids(item).map((uid) => sharedFriendNames[uid] || uid);

    if (!otherNames.length) return "Společná výzva";
    if (otherNames.length === 1) return `${TXT.withFriend}: ${otherNames[0]}`;
    if (otherNames.length === 2) return `${TXT.withFriends}: ${otherNames[0]}, ${otherNames[1]}`;

    return `${TXT.withFriends}: ${otherNames.slice(0, 2).join(", ")} +${otherNames.length - 2}`;
  }

  function getSharedUserCompletedCount(item: SharedChallenge, uid: string): number {
    const day = sharedTodayMap[item.id];
    const raw = Number(day?.users?.[uid]?.completedCount ?? 0);
    return Math.max(0, Math.min(item.targetPerDay, Math.floor(raw || 0)));
  }

  function getSharedUserDoneRatio(item: SharedChallenge, uid: string): number {
    const done = getSharedUserCompletedCount(item, uid);
    return Math.max(0, Math.min(1, done / Math.max(1, item.targetPerDay)));
  }

  function getSharedUserFlame(item: SharedChallenge, uid: string): number {
    const rows = sharedProgressMap[item.id] ?? [];

    let total = 0;

    for (const row of rows) {
      const user = row.users?.[uid];
      const completedCount = Number(user?.completedCount ?? 0);
      const completed = !!user?.completed;

      if (completed || completedCount >= item.targetPerDay) {
        total += 1;
      }
    }

    return total;
  }

  async function markSharedDoneToday(item: SharedChallenge) {
    const me = auth.currentUser?.uid;
    if (!me) {
      Alert.alert(TXT.sharedChallenge, TXT.accountNotLogged);
      return;
    }

    if (item.status !== "active") {
      Alert.alert(TXT.sharedChallenge, TXT.challengeNotAccepted);
      return;
    }

    if (!isSharedChallengeActiveOnDate(item, getSharedTodayISO())) {
      Alert.alert(TXT.freeDay, TXT.freeRelax);
      return;
    }

    const done = getSharedUserCompletedCount(item, me);
    if (done >= item.targetPerDay) return;

    try {
      const nextCount = await completeSharedChallengeToday(item.id, getSharedTodayISO());

      setSharedTodayMap((prev) => {
        const prevDay = prev[item.id];
        const prevUsers = prevDay?.users ?? {};
        return {
          ...prev,
          [item.id]: {
            date: getSharedTodayISO(),
            users: {
              ...prevUsers,
              [me]: {
                completedCount: nextCount,
                completed: nextCount >= item.targetPerDay,
                updatedAt: new Date(),
              },
            },
            updatedAt: new Date(),
          },
        };
      });

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e: any) {
      Alert.alert(TXT.sharedChallenge, e?.message ?? TXT.couldNotSaveCompletion);
    }
  }

  async function acceptPendingShared(item: SharedChallenge) {
    try {
      await acceptSharedChallenge(item.id);
      Alert.alert(TXT.sharedChallenge, TXT.challengeAccepted);
    } catch (e: any) {
      Alert.alert(TXT.sharedChallenge, e?.message ?? TXT.couldNotAcceptChallenge);
    }
  }

  function confirmLeaveShared(item: SharedChallenge) {
    Alert.alert(TXT.leaveQuestion, TXT.reallyLeave, [
      { text: TXT.no, style: "cancel" },
      {
        text: TXT.yes,
        style: "destructive",
        onPress: async () => {
          try {
            await leaveSharedChallenge(item.id);
            if (expandedSharedId === item.id) {
              setExpandedSharedId(null);
            }
          } catch (e: any) {
            Alert.alert(TXT.sharedChallenge, e?.message ?? TXT.couldNotLeave);
          }
        },
      },
    ]);
  }

  function dayStatus(challengeId: string, date: string): DayStatus {
    const s = getDaySummary(challengeId, date);
    if (s) {
      const target = targetForChallenge(challengeId);
      if ((s.completed ?? 0) >= Math.max(1, target)) return "completed";
      if (s.skipped) return "skipped";
      return "none";
    }

    const c = (visibleChallenges as any[]).find((x) => String(x.id) === String(challengeId)) as any;
    if (c && !isChallengeActiveOnDate(c, date)) return "free";

    return "none";
  }

  function streakForChallenge(challengeId: string) {
    const todaySum = getDaySummary(challengeId, tdy);
    if (todaySum?.skipped && (todaySum?.completed ?? 0) === 0) return 0;

    const stats = appState?.challengeStats?.[String(challengeId)];
    const s = Number((stats as any)?.currentStreak ?? 0);
    return Number.isFinite(s) ? s : 0;
  }

  const bestStreak = useMemo(() => {
    const challenges = (appState?.challenges ?? []) as any[];
    let max = 0;

    for (const ch of challenges) {
      if (!ch || !ch.enabled || ch.deletedAt) continue;
      const id = String(ch.id);
      const stats = appState?.challengeStats?.[id] as any;
      const v = Number(stats?.currentStreak ?? 0);
      if (Number.isFinite(v)) max = Math.max(max, Math.floor(v));
    }

    return max;
  }, [appState?.challenges, appState?.challengeStats]);

  const medalState = useMemo(
    () => medalsFromChallengeStats(appState?.challengeStats),
    [appState?.challengeStats]
  );

const highestMedalForFriends = useMemo(() => {
  if (medalState.counts.diamond > 0) return "diamond";
  if (medalState.counts.gold > 0) return "gold";
  if (medalState.counts.silver > 0) return "silver";
  if (medalState.counts.bronze > 0) return "bronze";
  if (medalState.counts.steel > 0) return "steel";
  if (medalState.counts.brambora > 0) return "brambora";
  return "none";
}, [medalState]);

const totalMedalsForFriends = useMemo(() => {
  return (
    medalState.counts.brambora +
    medalState.counts.steel +
    medalState.counts.bronze +
    medalState.counts.silver +
    medalState.counts.gold +
    medalState.counts.diamond
  );
}, [medalState]);

const bestStreakForFriends = useMemo(() => {
  const stats = appState?.challengeStats ?? {};
  let best = 0;

  for (const value of Object.values(stats as Record<string, any>)) {
    const n = Number((value as any)?.bestStreak ?? 0);
    if (Number.isFinite(n)) best = Math.max(best, Math.floor(n));
  }

  return best;
}, [appState?.challengeStats]);

const activeChallengesForFriends = useMemo(() => {
  const list = (appState?.challenges ?? []) as any[];
  return list.filter((c) => c && c.enabled !== false && !c.deletedAt).length;
}, [appState?.challenges]);

useEffect(() => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  if (!appState) return;

  void updateDoc(doc(db, "users", uid), {
    "profile.friendStats": {
      bestStreak: bestStreakForFriends,
      totalMedals: totalMedalsForFriends,
      highestMedal: highestMedalForFriends,
      activeChallenges: activeChallengesForFriends,
      updatedAtISO: new Date().toISOString(),
    },
  }).catch(() => {});
}, [
  appState,
  bestStreakForFriends,
  totalMedalsForFriends,
  highestMedalForFriends,
  activeChallengesForFriends,
]);

  function medalLabel(tier: MedalTier): string {
    switch (tier) {
      case "brambora":
        return "Brambora";
      case "steel":
        return "Ocel";
      case "bronze":
        return "Bronz";
      case "silver":
        return "Stříbro";
      case "gold":
        return "Zlato";
      case "diamond":
        return "Diamant";
      default:
        return "Žádná";
    }
  }

  const selectedChallengeMedal = useMemo(() => {
    if (!selectedId) return "none" as MedalTier;
    const stats = appState?.challengeStats?.[String(selectedId)];
    const bestStreak = Number(stats?.bestStreak ?? 0);
    return tierForBestStreak(bestStreak);
  }, [appState?.challengeStats, selectedId]);

  const selectedChallengeBestStreak = useMemo(() => {
    if (!selectedId) return 0;
    const stats = appState?.challengeStats?.[String(selectedId)];
    return Number(stats?.bestStreak ?? 0);
  }, [appState?.challengeStats, selectedId]);

  const timeline = useMemo(() => {
    if (!selectedId) return [];

    const start = getStartDateForChallenge(selectedId);
    const totalDays = Math.max(0, daysBetween(start, tdy));

    const days: { date: string; status: DayStatus; time?: string; done?: number; target?: number }[] = [];
    const target = targetForChallenge(selectedId);

    for (let i = 0; i <= totalDays; i++) {
      const d = addDaysISO(start, i);
      const sum = getDaySummary(selectedId, d);
      const st = dayStatus(selectedId, d);
      days.push({
        date: d,
        status: st,
        time: sum?.lastTime,
        done: sum?.completed ?? 0,
        target,
      });
    }

    days.reverse();
    return days;
  }, [selectedId, tdy, dayIndex]);

  async function markDoneToday(challengeId: string) {
    if (!appState) return;

    const challenge = (appState.challenges ?? []).find((c) => String(c.id) === String(challengeId));
    if (challenge && !isChallengeActiveToday(challenge)) {
      Alert.alert(TXT.freeDay, TXT.freeRelax);
      return;
    }
    const target = Number((challenge as any)?.targetPerDay ?? 1);
    const targetSafe = Number.isFinite(target) && target > 0 ? Math.floor(target) : 1;

    const todayDone = (appState.history ?? []).filter(
      (h: any) => String(h?.challengeId) === String(challengeId) && h?.date === tdy && h?.status === "completed"
    ).length;

    if (todayDone >= targetSafe) return;

    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const cleaned = (appState.history ?? []).filter(
      (h: any) => !(String(h?.challengeId) === String(challengeId) && h?.date === tdy && h?.status === "skipped")
    );

    const ever = new Set<string>((appState.everCompletedKeys ?? []).map(String));
    ever.add(`id:${String(challengeId)}`);

    const next: AppState = {
      ...appState,
      challengeStats: updateStatsOnCompleted(appState, String(challengeId), tdy),
      history: [
        {
          date: tdy,
          time: hhmm,
          atISO: now.toISOString(),
          challengeId,
          challengeText: challenge?.text ?? "(smazaná výzva)",
          status: "completed",
        },
        ...cleaned,
      ],
      everCompletedKeys: Array.from(ever),
    };

    setAppState(next);
    await saveState(next);

    const isDayCompleteNext = (() => {
      const enabled = (next.challenges ?? []).filter((c: any) => c.enabled !== false);
      const visible = premium ? enabled : enabled.slice(0, FREE_MAX);

      for (const c of visible as any[]) {
        const cid = String(c?.id ?? "");
        if (!cid) continue;
        const t = Number(c?.targetPerDay ?? 1);
        const target = Number.isFinite(t) && t > 0 ? Math.floor(t) : 1;

        const completed = (next.history ?? []).filter(
          (h: any) => String(h?.challengeId) === cid && h?.date === tdy && h?.status === "completed"
        ).length;

        if (completed < target) return false;
      }
      return visible.length > 0;
    })();

    if (isDayCompleteNext) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      heroPulse.setValue(0);
      sparkle.setValue(0);
      Animated.parallel([
        Animated.sequence([
          Animated.timing(heroPulse, { toValue: 1, duration: 220, useNativeDriver: true }),
          Animated.timing(heroPulse, { toValue: 0, duration: 320, useNativeDriver: true }),
        ]),
        Animated.timing(sparkle, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]).start(() => {
        sparkle.setValue(0);
      });
    }
  }

  const persistOrderOptimistic = useCallback((nextOrderedVisible: any[]) => {
    setListData(nextOrderedVisible);

    void (async () => {
      const latest = (await loadState()) as any;

      const ordered = nextOrderedVisible;
      const orderedIds = new Set<string>(ordered.map((c) => String(c?.id ?? "")));

      const latestList = [...(latest?.challenges ?? [])];
      const rest = latestList.filter((c: any) => !orderedIds.has(String(c?.id ?? "")));

      const merged = [...ordered, ...rest];

      const act = merged.filter((c) => (c as any).enabled !== false);
      const dis = merged.filter((c) => (c as any).enabled === false);

      await saveState({ ...(latest ?? {}), challenges: [...act, ...dis] } as any);
    })();
  }, []);

  const moveItem = useCallback(
    (id: string, dir: "up" | "down") => {
      setListData((prev) => {
        const arr = [...(prev ?? [])];
        const i = arr.findIndex((x) => String(x?.id) === String(id));
        if (i < 0) return prev;

        const j = dir === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= arr.length) return prev;

        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;

        persistOrderOptimistic(arr);
        return arr;
      });
    },
    [persistOrderOptimistic]
  );

  return (
    <View style={styles.screen}>
      {mode === "light" ? (
        <LinearGradient
          colors={[UI.accent, UI.bg, UI.bg, UI.accent]}
          locations={[0, 0.3, 0.7, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.gradient}
        />
      ) : (
        <View style={[styles.gradient, { backgroundColor: UI.bg }]} />
      )}

      <View style={[styles.topWrap, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.welcomeSmall}>{TXT.welcomeBack}</Text>
        <Text style={styles.welcomeName} numberOfLines={1} ellipsizeMode="tail">
          {auth.currentUser?.displayName?.trim() || ""}
        </Text>

        <View style={styles.premiumRow}>
          {premium ? (
            <View style={styles.premiumRowInner}>
              <Text style={styles.premiumTag}>{TXT.premium}</Text>
            </View>
          ) : (
            <View style={styles.premiumRowInner}>
              <View style={styles.freeRow}>
                <Text style={styles.premiumTag}>{TXT.free}</Text>

                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: "/(tabs)/profile",
                      params: { open: "paywall", t: String(Date.now()) },
                    } as any)
                  }
                  hitSlop={10}
                  style={({ pressed }) => [pressed && { opacity: 0.85 }]}
                >
                  <Text style={styles.upgradeText}>{TXT.upgrade}</Text>
                </Pressable>
              </View>
            </View>
          )}

          <View style={styles.medalsRow}>
            <View style={styles.medalItem}>
              <View style={styles.medalIconBox}>
                <Image
                  source={MEDAL_BRAMBORA}
                  style={[
                    styles.medalImg,
                    { marginLeft: -5, marginTop: 0 },
                    !medalState.active.brambora && styles.medalDim,
                  ]}
                  resizeMode="contain"
                />
              </View>
              <Text style={[styles.medalCount, !medalState.active.brambora && styles.medalCountDim]}>
                {medalState.counts.brambora}
              </Text>
            </View>

            <View style={styles.medalItem}>
              <View style={styles.medalIconBox}>
                <Image
                  source={MEDAL_STEEL}
                  style={[
                    styles.medalImg,
                    { marginLeft: 1, marginTop: 2 },
                    !medalState.active.steel && styles.medalDim,
                  ]}
                  resizeMode="contain"
                />
              </View>
              <Text style={[styles.medalCount, !medalState.active.steel && styles.medalCountDim]}>
                {medalState.counts.steel}
              </Text>
            </View>

            <View style={styles.medalItem}>
              <View style={styles.medalIconBox}>
                <Image
                  source={MEDAL_BRONZE}
                  style={[
                    styles.medalImg,
                    { marginLeft: 5, marginTop: 1 },
                    !medalState.active.bronze && styles.medalDim,
                  ]}
                  resizeMode="contain"
                />
              </View>
              <Text style={[styles.medalCount, !medalState.active.bronze && styles.medalCountDim]}>
                {medalState.counts.bronze}
              </Text>
            </View>

            <View style={styles.medalItem}>
              <View style={styles.medalIconBox}>
                <Image
                  source={MEDAL_SILVER}
                  style={[
                    styles.medalImg,
                    { marginLeft: -5, marginTop: 0 },
                    !medalState.active.silver && styles.medalDim,
                  ]}
                  resizeMode="contain"
                />
              </View>
              <Text style={[styles.medalCount, !medalState.active.silver && styles.medalCountDim]}>
                {medalState.counts.silver}
              </Text>
            </View>

            <View style={styles.medalItem}>
              <View style={styles.medalIconBox}>
                <Image
                  source={MEDAL_GOLD}
                  style={[
                    styles.medalImg,
                    { marginLeft: 1, marginTop: 0 },
                    !medalState.active.gold && styles.medalDim,
                  ]}
                  resizeMode="contain"
                />
              </View>
              <Text style={[styles.medalCount, !medalState.active.gold && styles.medalCountDim]}>
                {medalState.counts.gold}
              </Text>
            </View>

            <View style={styles.medalItem}>
              <View style={styles.medalIconBox}>
                <Image
                  source={MEDAL_DIAMOND}
                  style={[
                    styles.medalImg,
                    { marginLeft: 5, marginTop: -1 },
                    !medalState.active.diamond && styles.medalDim,
                  ]}
                  resizeMode="contain"
                />
              </View>
              <Text style={[styles.medalCount, !medalState.active.diamond && styles.medalCountDim]}>
                {medalState.counts.diamond}
              </Text>
            </View>
          </View>
        </View>

        <Animated.View style={[styles.heroCard, { transform: [{ scale: heroScale }] }]}>
          <LinearGradient
            colors={["#FF8A1F", "#FF7A00", "#FF6A00"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroGradient}
          />
          <View style={styles.heroContent}>
            <Text style={styles.heroTitle}>{TXT.keepsGoing}</Text>
         <Text style={styles.heroBig}>
  {bestStreak}. {lang === "en" ? "day" : "den"}
</Text>
            <Text style={styles.heroSub}>{TXT.dontStop}</Text>
            <Text style={styles.heroQuote}>„{TXT.quote}“</Text>
          </View>

          <Pressable onPress={() => setAddModalOpen(true)} style={({ pressed }) => [styles.heroPlus, pressed && { opacity: 0.9 }]}>
            <Ionicons name="add" size={26} color="#0B1220" />
          </Pressable>

          <SparkleBurst progress={sparkle} />
        </Animated.View>

        {reorderMode && (
          <View style={styles.reorderHintRow}>
            <View style={styles.reorderChip}>
              <Ionicons name="swap-vertical" size={16} color={UI.text} />
              <Text style={styles.reorderChipText}></Text>
            </View>

            <Pressable onPress={() => setReorderMode(false)} style={({ pressed }) => [styles.reorderDoneBtn, pressed && { opacity: 0.88 }]}>
              <Text style={styles.reorderDoneText}>Hotovo</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Modal
        visible={addModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setAddModalOpen(false);
          setAddModalText("");
        }}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => {
            setAddModalOpen(false);
            setAddModalText("");
          }}
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: UI.accent }]}>{TXT.addTitle}</Text>
              <Pressable
                onPress={() => {
                  setAddModalOpen(false);
                  setAddModalText("");
                }}
                style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.88 }]}
              >
                <Text style={styles.closeText}>{TXT.close}</Text>
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              <TextInput
                value={addModalText}
                onChangeText={setAddModalText}
                placeholder={TXT.namePlaceholder}
                placeholderTextColor={UI.sub}
                style={[styles.input, { color: UI.text, borderColor: UI.stroke }]}
                autoCapitalize="sentences"
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (addModalText.trim()) void addChallengeFromHero();
                }}
              />

              <Pressable
                onPress={() => void addChallengeFromHero()}
                disabled={!addModalText.trim()}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  !addModalText.trim() && { opacity: 0.5 },
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Text style={styles.primaryBtnText}>{TXT.add}</Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={manageOpen} transparent animationType="fade" onRequestClose={closeManage}>
        <Pressable style={styles.backdrop} onPress={closeManage}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: UI.accent }]}>{TXT.manageTitle}</Text>
              <Pressable onPress={closeManage} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.88 }]}>
                <Text style={styles.closeText}>{TXT.close}</Text>
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              <TextInput
                value={manageRename}
                onChangeText={setManageRename}
                placeholder={TXT.namePlaceholder}
                placeholderTextColor={UI.sub}
                style={[styles.input, { color: UI.text, borderColor: UI.stroke }]}
              />

              <View style={styles.modalRow}>
                <Text style={[styles.modalLabel, { color: UI.text }]}>{TXT.active}</Text>
                <Switch
                  value={manageEnabled}
                  onValueChange={(v) => {
                    setManageEnabled(v);
                    void saveBasicsImmediate(v, manageTarget);
                  }}
                />
              </View>

              <View style={styles.modalRow}>
                <Text style={[styles.modalLabel, { color: UI.text }]}>{TXT.perDayCount}</Text>
                <View style={styles.countRow}>
                  <Pressable
                    onPress={() => {
                      const next = clamp(manageTarget - 1, 1, 20);
                      setManageTarget(next);
                      void saveBasicsImmediate(manageEnabled, next);
                    }}
                    style={({ pressed }) => [styles.countBtn, pressed && { opacity: 0.88 }]}
                  >
                    <Ionicons name="remove" size={18} color={UI.text} />
                  </Pressable>
                  <Text style={[styles.countValue, { color: UI.text }]}>{manageTarget}×</Text>
                  <Pressable
                    onPress={() => {
                      const next = clamp(manageTarget + 1, 1, 20);
                      setManageTarget(next);
                      void saveBasicsImmediate(manageEnabled, next);
                    }}
                    style={({ pressed }) => [styles.countBtn, pressed && { opacity: 0.88 }]}
                  >
                    <Ionicons name="add" size={18} color={UI.text} />
                  </Pressable>
                </View>
              </View>

              <View style={styles.modalRow}>
                <Text style={[styles.modalLabel, { color: UI.text }]}>{TXT.period}</Text>
                <Pressable
                  onPress={() => setPeriodPickerOpen(true)}
                  style={({ pressed }) => [styles.pickerBox, { borderColor: UI.stroke, backgroundColor: UI.card2 }, pressed && { opacity: 0.9 }]}
                >
                  <Text style={[styles.pickerBoxText, { color: UI.text }]}>
                    {managePeriod === "daily" ? TXT.daily : managePeriod === "every2" ? TXT.every2 : TXT.customDays}
                  </Text>
                  <Ionicons name="chevron-down" size={18} color={UI.text} />
                </Pressable>
              </View>

              {managePeriod === "custom" && (
                <View style={{ marginTop: 8, marginBottom: 2 }}>
                  <Text style={styles.modalHint}>{TXT.chooseDaysHint}</Text>
                  <View style={styles.pills}>
                    {[
  { k: 0, t: lang === "en" ? "Mon" : "Po" },
  { k: 1, t: lang === "en" ? "Tue" : "Út" },
  { k: 2, t: lang === "en" ? "Wed" : "St" },
  { k: 3, t: lang === "en" ? "Thu" : "Čt" },
  { k: 4, t: lang === "en" ? "Fri" : "Pá" },
  { k: 5, t: lang === "en" ? "Sat" : "So" },
  { k: 6, t: lang === "en" ? "Sun" : "Ne" },
]
.map((d) => {
                      const active = manageCustomDays.includes(d.k);
                      return (
                        <Pressable
                          key={d.k}
                          onPress={() => {
                            const next = active
                              ? manageCustomDays.filter((x) => x !== d.k)
                              : [...manageCustomDays, d.k];
                            void savePeriodImmediate("custom", next);
                          }}
                          style={({ pressed }) => [styles.pill, active && styles.pillActive, pressed && { opacity: 0.9 }]}
                        >
                          <Text style={[styles.pillText, active && styles.pillTextActive]}>{d.t}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}

              <View style={styles.modalRow}>
                <Text style={[styles.modalLabel, { color: UI.text }]}>{TXT.notifications}</Text>
                <Switch
                  value={manageRemEnabled}
                  onValueChange={(v) => {
                    setManageRemEnabled(v);
                    if (!v) {
                      setManageRemCount(1);
                      setManageRemTimes([]);
                    } else {
                      const maxN = Math.min(20, manageTarget);
                      setManageRemCount((n) => clamp(n || 1, 1, maxN));
                    }
                  }}
                />
              </View>

              {manageRemEnabled && (
                <>
                  <Text style={styles.modalHint}>Počet notifikací: max {Math.min(20, manageTarget)}</Text>

                  <View style={styles.pills}>
                    {Array.from({ length: Math.min(20, manageTarget) }, (_, i) => i + 1).map((n) => {
                      const active = n === manageRemCount;
                      return (
                        <Pressable
                          key={n}
                          onPress={() => {
                            setManageRemCount(n);
                            setManageRemTimes((prev) => {
                              const next = Array.isArray(prev) ? [...prev] : [];
                              while (next.length < n) next.push(nowHM());
                              return next.slice(0, n);
                            });
                          }}
                          style={({ pressed }) => [styles.pill, active && styles.pillActive, pressed && { opacity: 0.9 }]}
                        >
                          <Text style={[styles.pillText, active && styles.pillTextActive]}>#{n}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {Array.from({ length: manageRemCount }, (_, i) => i).map((i) => {
                    const value = manageRemTimes?.[i] ?? nowHM();
                    return (
                      <Pressable
                        key={i}
                        onPress={() => {
                          setTimePickerIndex(i);
                          const [hh, mm] = String(value).split(":").map(Number);
                          const d = new Date();
                          if (Number.isFinite(hh)) d.setHours(hh);
                          if (Number.isFinite(mm)) d.setMinutes(mm);
                          setTimePickerValue(d);
                          setTimePickerOpen(true);
                        }}
                        style={({ pressed }) => [styles.timeRow, pressed && { opacity: 0.9 }]}
                      >
                        <Text style={[styles.timeIndex, { color: UI.text }]}>#{i + 1}</Text>
                        <Text style={{ color: UI.text, fontWeight: "900" }}>{value}</Text>
                        <Ionicons name="time" size={18} color={UI.text} />
                      </Pressable>
                    );
                  })}

                  <Pressable onPress={() => void applyManageReminders()} style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }]}>
                    <Text style={styles.primaryBtnText}>{TXT.saveNotifications}</Text>
                  </Pressable>
                </>
              )}

              {premium && (
                <Pressable
                  onPress={() => {
                    if (!premium) {
                      closeManage();
                      router.push({
                        pathname: "/(tabs)/profile",
                        params: { open: "paywall", t: String(Date.now()) },
                      } as any);
                      return;
                    }

                    closeManage();
                    setSelectedId(String(manageId));
                    setHistoryOpen(true);
                  }}
                  style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.88 }]}
                >
                  <Ionicons name="time" size={18} color={UI.text} />
                  <Text style={styles.secondaryBtnText}>{TXT.challengeHistory}</Text>
                </Pressable>
              )}

              <Pressable onPress={deleteManagedChallenge} style={({ pressed }) => [styles.dangerBtn, pressed && { opacity: 0.88 }]}>
                <Ionicons name="trash" size={18} color="#fff" />
                <Text style={styles.dangerBtnText}>{TXT.deleteChallenge}</Text>
              </Pressable>
            </ScrollView>

            <Modal
              visible={periodPickerOpen}
              transparent
              animationType="fade"
              onRequestClose={() => setPeriodPickerOpen(false)}
            >
              <Pressable
                style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.5)" }]}
                onPress={() => setPeriodPickerOpen(false)}
              />
              <View style={styles.pickerSheet}>
                {[
  { k: "daily" as const, t: TXT.daily },
  { k: "every2" as const, t: TXT.every2 },
  { k: "custom" as const, t: TXT.customDays },
]
                .map((opt) => {
                  const active = managePeriod === opt.k;
                  return (
                    <Pressable
                      key={opt.k}
                      onPress={() => {
                        setPeriodPickerOpen(false);
                        if (opt.k === "custom") {
                          const fallback = manageCustomDays.length ? manageCustomDays : [dowMon0(todayISO)];
                          void savePeriodImmediate("custom", fallback);
                          return;
                        }
                        void savePeriodImmediate(opt.k);
                      }}
                      style={({ pressed }) => [
                        styles.pickerRow,
                        { borderTopColor: UI.stroke, backgroundColor: UI.card },
                        active && { backgroundColor: UI.card2 },
                        pressed && { opacity: 0.92 },
                      ]}
                    >
                      <Text style={[styles.pickerRowText, { color: UI.text }]}>{opt.t}</Text>
                      {active && <Ionicons name="checkmark" size={20} color={UI.accent} />}
                    </Pressable>
                  );
                })}
              </View>
            </Modal>

            {timePickerOpen && (
              <DateTimePicker
                value={timePickerValue}
                mode="time"
                is24Hour
                display="spinner"
                onChange={(e: DateTimePickerEvent, date?: Date) => {
                  if (e.type === "dismissed") {
                    setTimePickerOpen(false);
                    return;
                  }
                  const d = date ?? timePickerValue;
                  const hh = pad2(d.getHours());
                  const mm = pad2(d.getMinutes());
                  setManageRemTimes((prev) => {
                    const next = Array.isArray(prev) ? [...prev] : [];
                    while (next.length <= timePickerIndex) next.push(nowHM());
                    next[timePickerIndex] = `${hh}:${mm}`;
                    return next;
                  });
                  setTimePickerOpen(false);
                }}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={historyOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setHistoryOpen(false);
          setSelectedId(null);
        }}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => {
            setHistoryOpen(false);
            setSelectedId(null);
          }}
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: UI.accent }]}>{TXT.historyOfChallenge}</Text>
              <Pressable
                onPress={() => {
                  setHistoryOpen(false);
                  setSelectedId(null);
                }}
                style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.88 }]}
              >
                <Text style={styles.closeText}>{TXT.close}</Text>
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              {!selectedId ? (
                <Text style={styles.modalHint}>Vyber výzvu pro zobrazení historie.</Text>
              ) : (
                <>
                  <View style={styles.modalRow}>
                    <Text style={[styles.modalLabel, { color: UI.text }]}>
                      Aktuální medaile
                    </Text>

                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      {selectedChallengeMedal === "none" ? (
                        <View
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 9,
                            borderWidth: 2,
                            borderColor: UI.sub,
                          }}
                        />
                      ) : (
                        <>
                          <View
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 9,
                              borderWidth: 2,
                              borderColor: UI.text,
                              backgroundColor: "transparent",
                            }}
                          />
                          <Text style={[styles.modalLabel, { color: UI.accent }]}>
                            {medalLabel(selectedChallengeMedal)}
                          </Text>
                        </>
                      )}
                    </View>
                  </View>

                  <Text style={styles.modalHint}>
                    Nejlepší streak této výzvy: {selectedChallengeBestStreak} dní
                  </Text>

                  {([...timeline].reverse() as any[]).map((d: any) => (
                    <View key={d.date} style={styles.historyRow}>
                      <Text style={styles.historyDate}>{d.date}</Text>
                      <Text style={styles.historyStatus}>
                        {d.status === "completed"
                          ? `${TXT.completed} ${d.done ?? 0}/${d.target ?? 1}${d.time ? ` • ${d.time}` : ""}`
                          : d.status === "skipped"
                            ? TXT.skipped
                            : d.status === "free"
                              ? TXT.freeDay
                              : TXT.notCompleted}
                      </Text>
                    </View>
                  ))}
                </>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {count === 0 && visibleSharedChallenges.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.searchIconWrap}>
            <LinearGradient
              colors={[UI.accent, "#FF8A1F", "#FF7A00"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
            <Ionicons name="search" size={54} color="#FFFFFF" />
          </View>

          <Text style={styles.emptyTitle}>{TXT.nothingHereYet}</Text>
          <Text style={styles.emptyText}>{TXT.addChallengeAndStart}</Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <FlatList
            data={listData}
            keyExtractor={(item) => String((item as any).id)}
            contentContainerStyle={[styles.scroll, { paddingHorizontal: sidePadding, paddingBottom: 24 }]}
            removeClippedSubviews={false}
            ListFooterComponent={
              <>
                {!!visibleSharedChallenges.length && (
                  <View style={styles.sharedWrap}>
                    <Text style={styles.sharedSectionTitle}>{TXT.sharedChallenges}</Text>

                    {visibleSharedChallenges.map((item) => {
                      const me = auth.currentUser?.uid ?? "";
                      const memberRows = item.memberUids.map((uid) => {
                        const safeUid = String(uid);
                        return {
                          uid: safeUid,
                          isMe: safeUid === me,
                          name: getSharedDisplayName(safeUid),
                          done: getSharedUserCompletedCount(item, safeUid),
                          ratio: getSharedUserDoneRatio(item, safeUid),
                          flame: getSharedUserFlame(item, safeUid),
                        };
                      });

                      const myDone = getSharedUserCompletedCount(item, me);
                      const activeToday = isSharedChallengeActiveOnDate(item, getSharedTodayISO());
                      const myDoneToday = myDone >= item.targetPerDay;
                      const expanded = expandedSharedId === item.id;
                      const iAccepted = item.acceptedBy.includes(me);
                      const pending = item.status === "pending";

                      return (
                        <View key={item.id} style={styles.sharedCardOuter}>
                          <View style={styles.sharedCardInner}>
                            <View style={styles.sharedCompactRow}>
                              <View style={styles.sharedCompactLeft}>
                                <View style={styles.sharedBadge}>
                                  <Text style={styles.sharedBadgeText}>
                                    {pending ? TXT.waitingForAccept : TXT.sharedChallenge}
                                  </Text>
                                </View>

                                <Text style={styles.sharedTitle} numberOfLines={1}>
                                  {item.title}
                                </Text>

                                <Text style={styles.sharedCompactMeta} numberOfLines={1}>
                                  {getSharedCompactLabel(item)}
                                </Text>
                              </View>

                              <Pressable
                                onPress={() =>
                                  setExpandedSharedId((prev) => (prev === item.id ? null : item.id))
                                }
                                style={({ pressed }) => [
                                  styles.sharedExpandBtn,
                                  pressed && { opacity: 0.88 },
                                ]}
                              >
                                <Ionicons
                                  name={expanded ? "chevron-up" : "chevron-down"}
                                  size={18}
                                  color={UI.text}
                                />
                              </Pressable>
                            </View>

                            {expanded && (
                              <View style={styles.sharedExpandedBlock}>
                                {pending ? (
                                  <View style={styles.sharedPendingBox}>
                                    <Text style={styles.sharedPendingText}>
                                      {!iAccepted
                                        ? TXT.loadingSharedPrompt
                                        : `${TXT.alreadyAcceptedWaiting} (${item.acceptedBy.length}/${item.memberUids.length}).`}
                                    </Text>

                                    {!iAccepted ? (
                                      <Pressable
                                        onPress={() => void acceptPendingShared(item)}
                                        style={({ pressed }) => [
                                          styles.primaryBtn,
                                          pressed && { opacity: 0.9 },
                                        ]}
                                      >
                                        <Text style={styles.primaryBtnText}>{TXT.acceptChallenge}</Text>
                                      </Pressable>
                                    ) : (
                                      <View style={[styles.modalRow, { marginTop: 0 }]}>
                                        <Text style={[styles.modalLabel, { color: UI.text }]}>
                                          {TXT.waitingForOthers}
                                        </Text>
                                      </View>
                                    )}
                                  </View>
                                ) : (
                                  <>
                                    <View style={styles.sharedTopRow}>
                                      <View style={{ flex: 1, minWidth: 0 }}>
                                        <Text style={styles.sharedSubtitle}>
                                          {activeToday ? `${TXT.todayTarget}: ${item.targetPerDay}×` : TXT.todayIsFree}
                                        </Text>
                                      </View>

                                      <View style={styles.sharedActionsRow}>
                                        <Pressable
                                          onPress={() => confirmLeaveShared(item)}
                                          style={({ pressed }) => [
                                            styles.sharedLeaveBtn,
                                            pressed && { opacity: 0.9 },
                                          ]}
                                        >
                                          <Text style={styles.sharedLeaveBtnText}>{TXT.leave}</Text>
                                        </Pressable>

                                        <Pressable
                                          onPress={() => void markSharedDoneToday(item)}
                                          style={({ pressed }) => [
                                            styles.sharedDoneBtn,
                                            myDoneToday && {
                                              backgroundColor: UI.card2,
                                              borderColor: UI.stroke,
                                              opacity: 0.78,
                                            },
                                            !activeToday && {
                                              backgroundColor: UI.card2,
                                              borderColor: UI.stroke,
                                              opacity: 0.78,
                                            },
                                            pressed && !myDoneToday && activeToday && { opacity: 0.9 },
                                          ]}
                                        >
                                          <Text
                                            style={[
                                              styles.sharedDoneBtnText,
                                              (myDoneToday || !activeToday) && { color: UI.sub },
                                            ]}
                                          >
                                            {myDoneToday ? TXT.done : !activeToday ? TXT.freeDay : TXT.complete}
                                          </Text>
                                        </Pressable>
                                      </View>
                                    </View>

     <View style={styles.sharedMembersGrid}>
  {memberRows.map((member, memberIndex) => {
    const colIndex = memberIndex % 5;
    const isLastInRow = colIndex === 4;

    return (
      <View
        key={member.uid}
        style={[
          styles.sharedMemberCol,
          isLastInRow && styles.sharedMemberColLastInRow,
        ]}
      >
       <View style={styles.sharedMemberTop}>
  <Text style={styles.sharedPlayerName} numberOfLines={1}>
    {member.name}
  </Text>
</View>

        <View style={styles.sharedFlameRow}>
          <Text style={styles.sharedFlameNum}>{member.flame}</Text>
          <Image
            source={FLAME_IMG}
            style={{
              width: 34,
              height: 34,
              marginLeft: -6,
              marginTop: -1,
              opacity: 1,
            }}
            resizeMode="contain"
          />
        </View>

        <Text style={styles.sharedMemberCount}>
          {activeToday ? `${member.done}/${item.targetPerDay}` : TXT.freeDay}
        </Text>

        <View style={styles.sharedBarTrack}>
          <View
            style={[
              styles.sharedBarFill,
              { width: `${Math.round(member.ratio * 100)}%` },
            ]}
          />
        </View>
      </View>
    );
  })}
</View>
                                  </>
                                )}
                              </View>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </>
            }
            renderItem={({ item, index }) => {
              const id = String(item.id);
              const ratio = progressRatioForCell(id);
              const streak = streakForChallenge(id);
              const done = completedTodayCount(id);
              const target = targetForChallenge(id);
              const medalTier = tierForBestStreak(
                Number(appState?.challengeStats?.[id]?.bestStreak ?? 0)
              );

              const activeToday = isChallengeActiveToday(item as any);

              const isCompleteToday = done >= Math.max(1, target);

              const canUp = reorderMode && index > 0;
              const canDown = reorderMode && index < listData.length - 1;

              return (
                <Pressable
                  onLongPress={() => {
                    setReorderMode(true);
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  delayLongPress={700}
                  style={[styles.rowOuter, item.enabled === false && { opacity: 0.35 }]}
                >
                  <View style={styles.rowInner}>
                    <View style={styles.rowTop}>
                      <Pressable
                        onLongPress={() => {
                          setReorderMode(true);
                          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }}
                        delayLongPress={180}
                        onPress={() => {
                          if (reorderMode) return;
                          openManage(String(id));
                        }}
                        style={{ flex: 1, minWidth: 0 }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                          <View style={styles.rowStreak}>
                            <Text style={[styles.streakNum, streak === 0 && { color: UI.sub }, { marginTop: 8 }]}>
                              {streak}
                            </Text>
                            <View>
                              <Image
                                source={FLAME_IMG}
                                style={{
                                  width: 50,
                                  height: 50,
                                  marginLeft: -10,
                                  marginTop: -2,
                                  opacity: streak > 0 ? 1 : 0.35,
                                }}
                                resizeMode="contain"
                              />
                            </View>
                          </View>

                          <View style={styles.rowMain}>
                            <Text style={styles.rowTitle} numberOfLines={1}>
                              {item.text}
                            </Text>

                            <Text style={styles.rowDoneSmall}>
                              {activeToday ? `${TXT.addTodayCount} ${done}/${Math.max(1, target)}` : TXT.freeRelax}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.rowBarTrack}>
                          <View style={[styles.rowBarFill, { width: `${Math.round(clamp(ratio, 0, 1) * 100)}%` }]} />
                        </View>
                      </Pressable>

                      {reorderMode ? (
                        <View style={styles.arrowCol}>
                          <Pressable
                            disabled={!canUp}
                            onPress={() => moveItem(id, "up")}
                            style={({ pressed }) => [
                              styles.arrowBtn,
                              !canUp && styles.arrowBtnDisabled,
                              pressed && canUp && { opacity: 0.88 },
                            ]}
                            hitSlop={10}
                          >
                            <Ionicons name="arrow-up" size={18} color={UI.text} />
                          </Pressable>
                          <Pressable
                            disabled={!canDown}
                            onPress={() => moveItem(id, "down")}
                            style={({ pressed }) => [
                              styles.arrowBtn,
                              !canDown && styles.arrowBtnDisabled,
                              pressed && canDown && { opacity: 0.88 },
                            ]}
                            hitSlop={10}
                          >
                            <Ionicons name="arrow-down" size={18} color={UI.text} />
                          </Pressable>
                        </View>
                      ) : (
                        <Pressable
                          onPress={() => {
                            if (item.enabled === false) return;
                            if (!activeToday) {
                              Alert.alert(TXT.freeDay, TXT.freeRelax);
                              return;
                            }
                            if (isCompleteToday) return;
                            void markDoneToday(id);
                          }}
                          style={({ pressed }) => [
                            styles.rowDoneBtn,
                            item.enabled === false && { opacity: 0.35 },

                            isCompleteToday && {
                              backgroundColor: UI.card2,
                              borderColor: UI.stroke,
                              opacity: 0.78,
                              transform: [{ scale: 1 }],
                            },

                            !activeToday && {
                              backgroundColor: UI.card2,
                              borderColor: UI.stroke,
                              opacity: 0.78,
                              transform: [{ scale: 1 }],
                            },

                            !isCompleteToday &&
                              item.enabled !== false && {
                                opacity: pressed ? 0.88 : 1,
                                transform: [{ scale: pressed ? 0.98 : 1 }],
                              },
                          ]}
                          hitSlop={10}
                        >
                          <Text
                            style={[styles.rowDoneBtnText, (isCompleteToday || !activeToday) && { color: UI.sub }]}
                          >
                            {isCompleteToday ? TXT.done : !activeToday ? TXT.freeDay : TXT.complete}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                </Pressable>
              );
            }}
          />
        </View>
      )}
    </View>
  );
}