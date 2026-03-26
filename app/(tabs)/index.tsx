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
  subscribeSharedChallengeDay,
  subscribeSharedChallengeProgress,
  subscribeSharedChallenges,
  type SharedChallenge,
  type SharedChallengeDayProgress,
} from "../../lib/sharedChallenges";
import { getProfile } from "../../lib/usernames";
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
import { auth } from "../../lib/firebase";
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
import { medalCountsFromChallengeStats } from "../../lib/medals";
import * as Haptics from "expo-haptics";

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
      gap: 8,
      paddingRight: 2,
      marginTop: 6,
    },
    medalItem: {
      alignItems: "center",
      justifyContent: "center",
    },
    medalImg: {
      width: 34,
      height: 34,
    },
    medalCount: {
      marginTop: 0,
      fontSize: 12,
      fontWeight: "900",
      color: UI.text,
      opacity: 0.92,
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
    },
    pickerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderTopWidth: 1,
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
    sharedPlayersRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 16,
      marginTop: 12,
    },
    sharedPlayerCol: {
      flex: 1,
      minWidth: 0,
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

export default function Index() {
  const router = useRouter();

  const { UI, mode } = useTheme();
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
          "Odemkni Premium",
          `Ve Free verzi můžeš mít maximálně ${FREE_MAX} výzvy. Odemkni Premium pro neomezený počet výzev.`,
          [
            { text: "Zůstat ve Free", style: "cancel" },
            {
              text: "Odemknout Premium",
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
        Alert.alert(
          "Notifikace ve free verzi",
          "Ve free verzi můžeš mít notifikace jen u jedné výzvy. Vypni je nejdřív u jiné výzvy."
        );
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
          "Notifikace v Expo Go nefungují",
          "Od Expo SDK 53 byly notifikace v Expo Go vypnuté. Pro připomínky je potřeba development build (EAS)."
        );
      } else {
        Alert.alert("Notifikace", "Nepodařilo se nastavit notifikace.");
      }
    }
  }, [manageId, manageTarget, manageRemTimes, manageRemCount, manageRemEnabled, premium, appState, persist]);

  const deleteManagedChallenge = useCallback(async () => {
    if (!manageId) return;
    const id = String(manageId);

    Alert.alert("Smazat výzvu?", "Tahle akce nejde vrátit zpět.", [
      { text: "Zrušit", style: "cancel" },
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

  function getSharedOtherUid(item: SharedChallenge): string | null {
    const me = auth.currentUser?.uid ?? "";
    const other = item.memberUids.find((uid) => String(uid) !== String(me));
    return other ? String(other) : null;
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
    if (!me) return;

    if (item.status !== "active") {
      Alert.alert("Společná výzva", "Tato výzva ještě nebyla přijata oběma stranami.");
      return;
    }

    if (!isSharedChallengeActiveOnDate(item, getSharedTodayISO())) {
      Alert.alert("Volný den", "Dnes je podle periody volno. Relaxuj :)");
      return;
    }

    const done = getSharedUserCompletedCount(item, me);
    if (done >= item.targetPerDay) return;

    try {
      await completeSharedChallengeToday(item.id, getSharedTodayISO());
    } catch (e: any) {
      Alert.alert("Společná výzva", e?.message ?? "Nepodařilo se uložit splnění.");
    }
  }

  async function acceptPendingShared(item: SharedChallenge) {
    try {
      await acceptSharedChallenge(item.id);
      Alert.alert("Společná výzva", "Výzva byla přijata.");
    } catch (e: any) {
      Alert.alert("Společná výzva", e?.message ?? "Nepodařilo se přijmout výzvu.");
    }
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

  const medalState = useMemo(() => medalsFromChallengeStats(appState?.challengeStats), [appState?.challengeStats]);

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
      Alert.alert("Volný den", "Dnes je podle periody volno. Relaxuj :)");
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
        <Text style={styles.welcomeSmall}>Vítej zpět</Text>
        <Text style={styles.welcomeName} numberOfLines={1} ellipsizeMode="tail">
          {auth.currentUser?.displayName?.trim() || ""}
        </Text>

        <View style={styles.premiumRow}>
          {premium ? (
            <View style={styles.premiumRowInner}>
              <Text style={styles.premiumTag}>Premium</Text>
            </View>
          ) : (
            <View style={styles.premiumRowInner}>
              <View style={styles.freeRow}>
                <Text style={styles.premiumTag}>Free</Text>

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
                  <Text style={styles.upgradeText}>Upgradovat</Text>
                </Pressable>
              </View>
            </View>
          )}

          <View style={styles.medalsRow}>
            <View style={styles.medalItem}>
              <Image
                source={MEDAL_BRAMBORA}
                style={[styles.medalImg, !medalState.active.brambora && styles.medalDim]}
                resizeMode="contain"
              />
              <Text style={[styles.medalCount, !medalState.active.brambora && styles.medalCountDim]}>
                {medalState.counts.brambora}
              </Text>
            </View>

            <View style={styles.medalItem}>
              <Image
                source={MEDAL_STEEL}
                style={[styles.medalImg, !medalState.active.steel && styles.medalDim]}
                resizeMode="contain"
              />
              <Text style={[styles.medalCount, !medalState.active.steel && styles.medalCountDim]}>
                {medalState.counts.steel}
              </Text>
            </View>

            <View style={styles.medalItem}>
              <Image
                source={MEDAL_BRONZE}
                style={[styles.medalImg, !medalState.active.bronze && styles.medalDim]}
                resizeMode="contain"
              />
              <Text style={[styles.medalCount, !medalState.active.bronze && styles.medalCountDim]}>
                {medalState.counts.bronze}
              </Text>
            </View>

            <View style={styles.medalItem}>
              <Image
                source={MEDAL_SILVER}
                style={[styles.medalImg, !medalState.active.silver && styles.medalDim]}
                resizeMode="contain"
              />
              <Text style={[styles.medalCount, !medalState.active.silver && styles.medalCountDim]}>
                {medalState.counts.silver}
              </Text>
            </View>

            <View style={styles.medalItem}>
              <Image
                source={MEDAL_GOLD}
                style={[styles.medalImg, !medalState.active.gold && styles.medalDim]}
                resizeMode="contain"
              />
              <Text style={[styles.medalCount, !medalState.active.gold && styles.medalCountDim]}>
                {medalState.counts.gold}
              </Text>
            </View>

            <View style={styles.medalItem}>
              <Image
                source={MEDAL_DIAMOND}
                style={[styles.medalImg, !medalState.active.diamond && styles.medalDim]}
                resizeMode="contain"
              />
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
            <Text style={styles.heroTitle}>Držíš se už</Text>
            <Text style={styles.heroBig}>{Math.max(0, bestStreak)}. den</Text>
            <Text style={styles.heroSub}>Nezastavuj!</Text>
            <Text style={styles.heroQuote}>„Malý krok dnes, velká změna zítra“</Text>
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
              <Text style={[styles.sheetTitle, { color: UI.accent }]}>Přidat výzvu</Text>
              <Pressable
                onPress={() => {
                  setAddModalOpen(false);
                  setAddModalText("");
                }}
                style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.88 }]}
              >
                <Text style={styles.closeText}>Zavřít</Text>
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              <TextInput
                value={addModalText}
                onChangeText={setAddModalText}
                placeholder="Název výzvy"
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
                <Text style={styles.primaryBtnText}>Přidat</Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={manageOpen} transparent animationType="fade" onRequestClose={closeManage}>
        <Pressable style={styles.backdrop} onPress={closeManage}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: UI.accent }]}>Správa výzvy</Text>
              <Pressable onPress={closeManage} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.88 }]}>
                <Text style={styles.closeText}>Zavřít</Text>
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              <TextInput
                value={manageRename}
                onChangeText={setManageRename}
                placeholder="Název výzvy"
                placeholderTextColor={UI.sub}
                style={[styles.input, { color: UI.text, borderColor: UI.stroke }]}
              />

              <View style={styles.modalRow}>
                <Text style={[styles.modalLabel, { color: UI.text }]}>Aktivní</Text>
                <Switch
                  value={manageEnabled}
                  onValueChange={(v) => {
                    setManageEnabled(v);
                    void saveBasicsImmediate(v, manageTarget);
                  }}
                />
              </View>

              <View style={styles.modalRow}>
                <Text style={[styles.modalLabel, { color: UI.text }]}>Počet výzev za den</Text>
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
                <Text style={[styles.modalLabel, { color: UI.text }]}>Perioda</Text>
                <Pressable
                  onPress={() => setPeriodPickerOpen(true)}
                  style={({ pressed }) => [styles.pickerBox, { borderColor: UI.stroke, backgroundColor: UI.card2 }, pressed && { opacity: 0.9 }]}
                >
                  <Text style={[styles.pickerBoxText, { color: UI.text }]}>
                    {managePeriod === "daily" ? "Denně" : managePeriod === "every2" ? "Obden" : "Vlastní dny"}
                  </Text>
                  <Ionicons name="chevron-down" size={18} color={UI.text} />
                </Pressable>
              </View>

              {managePeriod === "custom" && (
                <View style={{ marginTop: 8, marginBottom: 2 }}>
                  <Text style={styles.modalHint}>Vyber dny, kdy je výzva aktivní.</Text>
                  <View style={styles.pills}>
                    {[
                      { k: 0, t: "Po" },
                      { k: 1, t: "Út" },
                      { k: 2, t: "St" },
                      { k: 3, t: "Čt" },
                      { k: 4, t: "Pá" },
                      { k: 5, t: "So" },
                      { k: 6, t: "Ne" },
                    ].map((d) => {
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
                <Text style={[styles.modalLabel, { color: UI.text }]}>Notifikace</Text>
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
                    <Text style={styles.primaryBtnText}>Uložit notifikace</Text>
                  </Pressable>
                </>
              )}

              {premium && (
                <Pressable
                  onPress={() => {
                    closeManage();
                    setSelectedId(String(manageId));
                    setHistoryOpen(true);
                  }}
                  style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.88 }]}
                >
                  <Ionicons name="time" size={18} color={UI.text} />
                  <Text style={styles.secondaryBtnText}>Historie výzvy</Text>
                </Pressable>
              )}

              <Pressable onPress={deleteManagedChallenge} style={({ pressed }) => [styles.dangerBtn, pressed && { opacity: 0.88 }]}>
                <Ionicons name="trash" size={18} color="#fff" />
                <Text style={styles.dangerBtnText}>Smazat výzvu</Text>
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
              <View style={[styles.pickerSheet, { borderColor: UI.stroke, backgroundColor: UI.card }]}>
                {[
                  { k: "daily" as const, t: "Denně" },
                  { k: "every2" as const, t: "Obden" },
                  { k: "custom" as const, t: "Vlastní dny" },
                ].map((opt) => {
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
              <Text style={[styles.sheetTitle, { color: UI.accent }]}>Historie výzvy</Text>
              <Pressable
                onPress={() => {
                  setHistoryOpen(false);
                  setSelectedId(null);
                }}
                style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.88 }]}
              >
                <Text style={styles.closeText}>Zavřít</Text>
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              {!selectedId ? (
                <Text style={styles.modalHint}>Vyber výzvu pro zobrazení historie.</Text>
              ) : (
                <>
                  {([...timeline].reverse() as any[]).map((d: any) => (
                    <View key={d.date} style={styles.historyRow}>
                      <Text style={styles.historyDate}>{d.date}</Text>
                      <Text style={styles.historyStatus}>
                        {d.status === "completed"
                          ? `Splněno ${d.done ?? 0}/${d.target ?? 1}${d.time ? ` • ${d.time}` : ""}`
                          : d.status === "skipped"
                            ? "Přeskočeno"
                            : d.status === "free"
                              ? "Volný den"
                              : "Nesplněno"}
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

          <Text style={styles.emptyTitle}>Zatím tu nic není</Text>
          <Text style={styles.emptyText}>Přidej si výzvu a začni dnes.</Text>
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
                    <Text style={styles.sharedSectionTitle}>Společné výzvy</Text>

                    {visibleSharedChallenges.map((item) => {
                      const me = auth.currentUser?.uid ?? "";
                      const otherUid = getSharedOtherUid(item);
                      const otherName = otherUid ? sharedFriendNames[otherUid] || otherUid : "Kamarád";

                      const myDone = getSharedUserCompletedCount(item, me);
                      const otherDone = otherUid ? getSharedUserCompletedCount(item, otherUid) : 0;

                      const myRatio = getSharedUserDoneRatio(item, me);
                      const otherRatio = otherUid ? getSharedUserDoneRatio(item, otherUid) : 0;

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
                                    {pending ? "Čeká na přijetí" : "Společná výzva"}
                                  </Text>
                                </View>

                                <Text style={styles.sharedTitle} numberOfLines={1}>
                                  {item.title}
                                </Text>

                                <Text style={styles.sharedCompactMeta} numberOfLines={1}>
                                  S kamarádem: {otherName}
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
                                        ? "Tuto společnou výzvu ti poslal kamarád. Nejprve ji přijmi."
                                        : "Ty už jsi výzvu přijal. Čeká se na druhou stranu."}
                                    </Text>

                                    {!iAccepted ? (
                                      <Pressable
                                        onPress={() => void acceptPendingShared(item)}
                                        style={({ pressed }) => [
                                          styles.primaryBtn,
                                          pressed && { opacity: 0.9 },
                                        ]}
                                      >
                                        <Text style={styles.primaryBtnText}>Přijmout výzvu</Text>
                                      </Pressable>
                                    ) : (
                                      <View style={[styles.modalRow, { marginTop: 0 }]}>
                                        <Text style={[styles.modalLabel, { color: UI.text }]}>
                                          Čeká se na kamaráda
                                        </Text>
                                      </View>
                                    )}
                                  </View>
                                ) : (
                                  <>
                                    <View style={styles.sharedTopRow}>
                                      <View style={{ flex: 1, minWidth: 0 }}>
                                        <Text style={styles.sharedSubtitle}>
                                          {activeToday ? `Cíl dnes: ${item.targetPerDay}×` : "Dnes je volný den"}
                                        </Text>
                                      </View>

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
                                          {myDoneToday ? "Splněno" : !activeToday ? "Volný den" : "Splnit"}
                                        </Text>
                                      </Pressable>
                                    </View>

                                    <View style={styles.sharedPlayersRow}>
                                      <View style={styles.sharedPlayerCol}>
                                        <Text style={styles.sharedPlayerName}>Ty</Text>
                                        <View style={styles.sharedFlameRow}>
                                          <Text style={styles.sharedFlameNum}>{getSharedUserFlame(item, me)}</Text>
                                          <Image
                                            source={FLAME_IMG}
                                            style={{
                                              width: 42,
                                              height: 42,
                                              marginLeft: -8,
                                              marginTop: -2,
                                              opacity: 1,
                                            }}
                                            resizeMode="contain"
                                          />
                                        </View>
                                        <Text style={styles.sharedPlayerMeta}>
                                          {activeToday ? `Splněno ${myDone}/${item.targetPerDay}` : "Volný den"}
                                        </Text>
                                        <View style={styles.sharedBarTrack}>
                                          <View style={[styles.sharedBarFill, { width: `${Math.round(myRatio * 100)}%` }]} />
                                        </View>
                                      </View>

                                      <View style={styles.sharedPlayerCol}>
                                        <Text style={styles.sharedPlayerName}>{otherName}</Text>
                                        <View style={styles.sharedFlameRow}>
                                          <Text style={styles.sharedFlameNum}>
                                            {otherUid ? getSharedUserFlame(item, otherUid) : 0}
                                          </Text>
                                          <Image
                                            source={FLAME_IMG}
                                            style={{
                                              width: 42,
                                              height: 42,
                                              marginLeft: -8,
                                              marginTop: -2,
                                              opacity: 1,
                                            }}
                                            resizeMode="contain"
                                          />
                                        </View>
                                        <Text style={styles.sharedPlayerMeta}>
                                          {activeToday ? `Splněno ${otherDone}/${item.targetPerDay}` : "Volný den"}
                                        </Text>
                                        <View style={styles.sharedBarTrack}>
                                          <View style={[styles.sharedBarFill, { width: `${Math.round(otherRatio * 100)}%` }]} />
                                        </View>
                                      </View>
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
                              {activeToday ? `Splněno ${done}/${Math.max(1, target)}` : "Relaxuj :)"}
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
                              Alert.alert("Volný den", "Dnes je podle periody volno. Relaxuj :)");
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
                            {isCompleteToday ? "Splněno" : !activeToday ? "Volný den" : "Splnit"}
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