import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  acceptSharedChallenge,
  completeSharedChallengeToday,
  getTodayISO as getSharedTodayISO,
  inviteSharedChallengeMember,
  isAcceptedSharedChallengeForUid,
  isSharedChallengeActiveOnDate,
  leaveSharedChallenge,
  MAX_SHARED_MEMBERS,
  subscribeSharedChallengeDay,
  subscribeSharedChallengeProgress,
  subscribeSharedChallenges,
  type SharedChallenge,
  type SharedChallengeDayProgress,
} from "../../lib/sharedChallenges";
import { canInviteSharedChallengeMembers } from "../../lib/sharedChallengePermissions";
import { subscribeFriends, type FriendEdge } from "../../lib/friends";
import { getProfile } from "../../lib/usernames";
import { doc, updateDoc } from "firebase/firestore";
import {
  Animated,
  AppState as RNAppState,
  Alert as NativeAlert,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Alert } from "../../lib/appAlert";
import { getSafeModalMetrics } from "../../lib/safeModalLayout";
import { useTodayISO } from "../../lib/useTodayISO";
import { auth, db } from "../../lib/firebase";
import { isPremiumActive, subscribePremium } from "../../lib/premium";
import { FREE_MAX_CHALLENGES } from "../../lib/plan";
import {
  DEFAULT_SHARED_NOTIFICATION_SETTING,
  hasAnyActiveSharedNotification,
  hasOtherActiveSharedNotification,
  loadSharedNotificationSetting,
  saveSharedNotificationSetting,
  type SharedNotificationSetting,
} from "../../lib/sharedNotificationSettings";
import {
  clearDailyRemindersForChallenge,
  getFreeActiveReminderChallengeId,
  isFlexibleReminderRowSelectionValid,
  prepareChallengeReminders,
  refreshScheduledChallengeReminders,
  reminderScheduleForChallenge,
  setDailyRemindersForChallenge,
  setRemindersPremiumEnabled,
} from "../../lib/reminders";
import {
  flexibleReminderRowTime,
  migrateFlexibleWeeklyReminderRows,
  normalizeFlexibleWeeklyReminderRows,
  type FlexibleWeeklyReminderRow,
} from "../../lib/flexibleReminderRows";
import {
  clearSharedRemindersForChallenge,
  refreshScheduledSharedReminders,
  setSharedRemindersForChallenge,
} from "../../lib/sharedReminders";
import {
  AppState,
  challengeDisplayText,
  ensureDailyPick,
  getCachedState,
  isChallengeActiveOnDate as isStoredChallengeActiveOnDate,
  isChallengeEasyMode,
  loadState,
  purgeChallenge,
  renameChallenge,
  saveState,
  subscribeState,
  transitionChallengeEnabled,
  updateStatsOnCompleted,
} from "../../lib/storage";
import { useTheme } from "../../lib/theme";
import {
  type EarnedMedalTier,
  type MedalTier,
} from "../../lib/medals";
import * as Haptics from "expo-haptics";
import { useI18n } from "../../lib/i18n";
import { completeChallengeForUid } from "../../lib/challengeCompletion";
import {
  FLEXIBLE_WEEKLY_PERIOD,
  clampFlexibleWeeklyTarget,
  flexibleWeeklyProgress,
  localDayMon0,
  scheduleFlexibleWeeklySettings,
} from "../../lib/flexibleWeekly";
import { newestChallengeTimelineFirst } from "../../lib/challengeHistoryTimeline";
import { formatFlexibleWeeklyMissedLabel } from "../../lib/flexibleWeeklyPresentation";
import { MAX_MEDAL_COUNT_PER_CHALLENGE } from "../../lib/medalCollectionFromHistory";
import { medalDisplaySummaryFromHistory } from "../../lib/statisticsMedalSummary";
import { updateAllOneMoreWidgets } from "../../widgets/widgetService";
import { useCloudAccess } from "../../lib/cloudAccessGate";
import { commitPreparedNotificationChange, createEditorConfirmationController, createEditorDraft } from "../../lib/notificationSaveFlow";
import {
  cacheSharedChallenges,
  cacheSharedProgress,
  cacheSharedProgressHistory,
  completeSharedChallengeForUid,
  replaySharedCompletionsForCurrentUser,
  readSharedCache,
} from "../../lib/sharedCompletion";

const FLAME_IMG = require("../../assets/images/flame.png");

// 🏅 Medaile (bramborová → ocelová → bronzová → stříbrná → zlatá → diamantová)
const MEDAL_BRAMBORA = require("../../assets/medals/potato_medal.png");
const MEDAL_STEEL = require("../../assets/medals/steel_medal.png");
const MEDAL_BRONZE = require("../../assets/medals/bronze_medal.png");
const MEDAL_SILVER = require("../../assets/medals/silver_medal.png");
const MEDAL_GOLD = require("../../assets/medals/gold_medal.png");
const MEDAL_DIAMOND = require("../../assets/medals/diamond_medal.png");

const MEDAL_OVERVIEW_TIERS: {
  tier: EarnedMedalTier;
  days: number;
  image: any;
}[] = [
  { tier: "brambora", days: 5, image: MEDAL_BRAMBORA },
  { tier: "steel", days: 10, image: MEDAL_STEEL },
  { tier: "bronze", days: 20, image: MEDAL_BRONZE },
  { tier: "silver", days: 30, image: MEDAL_SILVER },
  { tier: "gold", days: 60, image: MEDAL_GOLD },
  { tier: "diamond", days: 90, image: MEDAL_DIAMOND },
];

const FREE_MAX = FREE_MAX_CHALLENGES;
const FREE_SHARED_MAX = 1;

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

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseLocalDateKey(dateISO: string): Date | null {
  if (!DATE_KEY_RE.test(dateISO)) return null;
  const [yearRaw, monthRaw, dayRaw] = dateISO.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateKeyOrdinal(dateISO: string): number | null {
  if (!DATE_KEY_RE.test(dateISO)) return null;
  const [yearRaw, monthRaw, dayRaw] = dateISO.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

// 0=Po ... 6=Ne
function dowMon0(todayISO: string): number {
  const d = parseLocalDateKey(todayISO);
  if (!d) return 0;
  const js = d.getDay(); // 0=Ne..6=So
  return (js + 6) % 7;
}

function addDaysISO(iso: string, days: number) {
  const d = parseLocalDateKey(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}

function daysBetween(aISO: string, bISO: string) {
  const a = dateKeyOrdinal(aISO);
  const b = dateKeyOrdinal(bISO);
  if (a == null || b == null) return 0;
  return b - a;
}

function getUserChallengesForPlan(state?: AppState | null): any[] {
  const archivedIds = new Set(
    (((state as any)?.archivedChallenges ?? []) as any[]).map((a) => String(a?.id ?? "")).filter(Boolean)
  );
  return (((state as any)?.challenges ?? []) as any[]).filter(
    (c) => c && !c.deletedAt && !archivedIds.has(String(c.id))
  );
}

type DayStatus = "completed" | "skipped" | "weeklyGoalMissed" | "free" | "none";

function safeBestStreak(value: unknown): number {
  const streak = Number(value);
  return Math.max(0, Math.floor(Number.isFinite(streak) ? streak : 0));
}

function highestEarnedMedalForBestStreak(value: unknown): MedalTier {
  const bestStreak = safeBestStreak(value);

  for (let index = MEDAL_OVERVIEW_TIERS.length - 1; index >= 0; index -= 1) {
    const medal = MEDAL_OVERVIEW_TIERS[index];
    if (bestStreak >= medal.days) return medal.tier;
  }

  return "none";
}

function medalBadgeCount(count: number): number {
  return Math.min(
    Math.max(0, count),
    MAX_MEDAL_COUNT_PER_CHALLENGE
  );
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

function makeStyles(UI: any, topInset: number, bottomInset: number, windowHeight: number) {
  const safeModal = getSafeModalMetrics({ windowHeight, topInset, bottomInset });
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
    medalOverviewTier: {
      padding: 12,
      borderRadius: 16,
      backgroundColor: UI.card,
      borderWidth: 1,
      borderColor: UI.stroke,
      marginBottom: 10,
    },
    medalOverviewHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    medalOverviewIconWrap: {
      position: "relative",
    },
    medalOverviewIcon: {
      width: 38,
      height: 38,
      resizeMode: "contain",
    },
    medalOverviewBadge: {
      position: "absolute",
      right: -8,
      bottom: -4,
      minWidth: 24,
      height: 18,
      paddingHorizontal: 5,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: UI.accent,
      borderWidth: 1,
      borderColor: UI.card,
    },
    medalOverviewBadgeText: {
      color: "#0B1220",
      fontSize: 10,
      lineHeight: 12,
      fontWeight: "900",
    },
    medalOverviewHint: {
      marginBottom: 10,
      color: UI.sub,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "700",
    },
    medalOverviewTitle: {
      flex: 1,
      fontSize: 15,
      fontWeight: "900",
      color: UI.text,
    },
    medalOverviewChallenge: {
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: UI.stroke,
      fontSize: 13,
      fontWeight: "700",
      lineHeight: 19,
      color: UI.sub,
    },
    medalOverviewEmpty: {
      marginTop: 8,
      fontSize: 13,
      fontWeight: "700",
      color: UI.sub,
      opacity: 0.65,
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
      top: 18,
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
      bottom: safeModal.bottom,
      borderRadius: 22,
      backgroundColor: UI.sheetBg,
      borderWidth: 1,
      borderColor: UI.sheetStroke,
      padding: 14,
      maxHeight: safeModal.maxHeight,
    },
    keyboardBackdrop: {
      flex: 1,
      justifyContent: "flex-end",
      paddingHorizontal: 12,
      paddingBottom: safeModal.bottom,
      backgroundColor: UI.backdrop,
    },
    keyboardSheet: {
      position: "relative",
      left: undefined,
      right: undefined,
      bottom: undefined,
      width: "100%",
      minHeight: 0,
      flexShrink: 1,
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
bottom: safeModal.bottom,
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
    saveConfirmation: {
      marginTop: 10,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      textAlign: "center",
      overflow: "hidden",
      color: "#0B1220",
      backgroundColor: "#86EFAC",
      fontWeight: "900",
    },

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
    flexibleReminderRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
    flexibleReminderDay: { flex: 1, minWidth: 0 },
    flexibleReminderTime: { minWidth: 88 },
    flexibleReminderRemove: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },

    historyScroll: { flexShrink: 1 },
    historyScrollContent: { paddingBottom: 8 },
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

sharedMemberColCompact: {
  width: 0,
  minWidth: 0,
  flexBasis: 0,
  flexGrow: 1,
  borderBottomWidth: 0,
  paddingHorizontal: 8,
  paddingVertical: 8,
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
      minWidth: 0,
      flexShrink: 1,
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
      justifyContent: "flex-end",
      flexShrink: 0,
      gap: 8,
    },
    sharedCompactRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
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
    sharedFriendLine: {
      marginTop: 4,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minWidth: 0,
      maxWidth: "100%",
      alignSelf: "flex-start",
    },
    sharedFriendLineText: {
      flexShrink: 1,
      minWidth: 0,
      fontSize: 12,
      fontWeight: "800",
      color: UI.sub,
    },
    sharedInviteMiniBtn: {
      width: 24,
      height: 24,
      borderRadius: 12,
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: UI.accent,
      borderWidth: 1,
      borderColor: UI.accent,
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
  const { allowed: cloudAllowed, sessionEpoch: cloudSessionEpoch } = useCloudAccess();

  const { UI, mode } = useTheme();
  const { lang, t } = useI18n();
const TXT = useMemo(() => {
  if (lang === "en") {
    return {
      sharedNotificationsSaved: "Notifications for shared challenge saved.",
sharedNotificationsOff: "Notifications for shared challenge turned off.",
notificationCount: "Number of notifications",
      welcomeBack: "Welcome back",
      premium: "Premium",
      free: "Free",
      upgrade: "Upgrade",
       keepsGoing: "You're on",
  dayWord: "day",
  dontStop: "Don't stop!",
      quote: "A small step today, a big change tomorrow",
      addTitle: "Add challenge",
      close: "Close",
      invite: "Invite",
      inviteFriend: "Invite friend",
      invitationSent: "Invitation sent",
      noFriendsToInvite: "No accepted friends available to invite.",
      couldNotInvite: "Could not send invitation.",
      sharedInviteNotFound: "The invitation could not be found. It may have been cancelled or expired.",
      sharedInviteFailed: "The invitation could not be sent. Please try again.",
      sharedInviteAlreadyMember: "This friend is already part of this shared challenge.",
      sharedInviteGeneric: "Something went wrong. Please try again.",
      namePlaceholder: "Challenge name",
      add: "Add",
      manageTitle: "Manage challenge",
      active: "Active",
      easyMode: "Easy mode",
      easyModeActive: "Easy Mode active",
      easyModeConfirmTitle: "Turn on Easy Mode?",
      easyModeConfirmMessage: "Easy Mode is permanent. This challenge will not lose fire streaks, but it will not count toward the total streak or earn new medals. Do you want to continue?",
      easyModeConfirm: "Turn on",
      easyModeCancel: "Cancel",
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
      medalOverviewTitle: "Medal overview",
      medalOverviewHint: "The ×N count shows how many times the medal was earned, up to 10 times per challenge.",
      medalBestStreak: "best streak",
      medalNoChallenges: "No challenge yet",
      medalChallengeFallback: "Challenge",
      medalDays: "days",
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
      loadingUser: "Loading…",
      unknownUser: "User",
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
      notificationsSaved: "Notification saved.",
      saving: "Saving…",
      notificationsDisabled: "Notifications were turned off.",
      doneAction: "Done",
      chooseHistoryChallenge: "Choose a challenge to view its history.",
      notificationPermissionDenied: "Notifications are off in system settings. Enable them to turn on reminders.",
      deleteQuestion: "Delete challenge?",
      deleteQuestionText: "This action cannot be undone.",
      delete: "Delete",
      freeRelax: "Relax :)",
      addTodayCount: "Completed",
      inactive: "Inactive",
      challengeOff: "Challenge is turned off",
    };
  }

  if (lang === "pl") {
    return {
      sharedNotificationsSaved: "Powiadomienia dla wspólnego wyzwania zapisane.",
sharedNotificationsOff: "Powiadomienia dla wspólnego wyzwania wyłączone.",
notificationCount: "Liczba powiadomień",
      welcomeBack: "Witaj z powrotem",
      premium: "Premium",
      free: "Free",
      upgrade: "Ulepsz",
      keepsGoing: "Jesteś już na",
  dayWord: "dzień",
  dontStop: "Nie przestawaj!",
      quote: "Mały krok dziś, wielka zmiana jutro",
      addTitle: "Dodaj wyzwanie",
      close: "Zamknij",
      invite: "Zaproś",
      inviteFriend: "Zaproś znajomego",
      invitationSent: "Zaproszenie wysłane",
      noFriendsToInvite: "Brak zaakceptowanych znajomych do zaproszenia.",
      couldNotInvite: "Nie udało się wysłać zaproszenia.",
      sharedInviteNotFound: "Nie udało się znaleźć zaproszenia. Mogło zostać anulowane lub wygasło.",
      sharedInviteFailed: "Nie udało się wysłać zaproszenia. Spróbuj ponownie.",
      sharedInviteAlreadyMember: "Ten znajomy jest już częścią tego wspólnego wyzwania.",
      sharedInviteGeneric: "Coś poszło nie tak. Spróbuj ponownie.",
      namePlaceholder: "Nazwa wyzwania",
      add: "Dodaj",
      manageTitle: "Zarządzaj wyzwaniem",
      active: "Aktywne",
      easyMode: "Tryb easy",
      easyModeActive: "Tryb easy aktywny",
      easyModeConfirmTitle: "Włączyć tryb easy?",
      easyModeConfirmMessage: "Tryb easy jest nieodwracalny. Wyzwanie nie będzie tracić płomieni, ale nie będzie liczyć się do ogólnej serii ani zdobywać nowych medali. Czy chcesz kontynuować?",
      easyModeConfirm: "Włącz",
      easyModeCancel: "Anuluj",
      perDayCount: "Liczba dziennie",
      period: "Okres",
      daily: "Codziennie",
      every2: "Co drugi dzień",
      customDays: "Własne dni",
      chooseDaysHint: "Wybierz dni, w których wyzwanie jest aktywne.",
      notifications: "Powiadomienia",
      saveNotifications: "Zapisz powiadomienia",
      challengeHistory: "Historia wyzwania",
      deleteChallenge: "Usuń wyzwanie",
      historyOfChallenge: "Historia wyzwania",
      currentMedal: "Aktualny medal",
      bestStreakOfChallenge: "Najlepsza seria tego wyzwania",
      medalOverviewTitle: "Przegląd medali",
      medalOverviewHint: "Liczba ×N pokazuje, ile razy medal został zdobyty, maksymalnie 10 razy w jednym wyzwaniu.",
      medalBestStreak: "najlepsza seria",
      medalNoChallenges: "Na razie brak wyzwań",
      medalChallengeFallback: "Wyzwanie",
      medalDays: "dni",
      completed: "Ukończono",
      skipped: "Pominięto",
      freeDay: "Dzień wolny",
      notCompleted: "Nieukończone",
      nothingHereYet: "Jeszcze nic tu nie ma",
      addChallengeAndStart: "Dodaj wyzwanie i zacznij dziś.",
      sharedChallenges: "Wspólne wyzwania",
      waitingForAccept: "Czeka na akceptację",
      sharedChallenge: "Wspólne wyzwanie",
      withFriend: "Ze znajomym",
      withFriends: "Ze znajomymi",
      loadingUser: "Ładowanie…",
      unknownUser: "Użytkownik",
      todayTarget: "Cel na dziś",
      todayIsFree: "Dziś jest dzień wolny",
      leave: "Opuść",
      done: "Gotowe",
      complete: "Wykonaj",
      acceptChallenge: "Przyjmij wyzwanie",
      waitingForOthers: "Czekanie na pozostałych członków",
      loadingSharedPrompt: "To wspólne wyzwanie wysłał Ci znajomy. Najpierw je zaakceptuj.",
      alreadyAcceptedWaiting: "Już zaakceptowałeś to wyzwanie. Czekamy na pozostałych",
      accountNotLogged: "Nie jesteś zalogowany.",
      challengeNotAccepted: "To wyzwanie nie zostało jeszcze zaakceptowane przez wszystkich członków.",
      couldNotSaveCompletion: "Nie udało się zapisać wykonania.",
      challengeAccepted: "Wyzwanie zaakceptowane.",
      couldNotAcceptChallenge: "Nie udało się zaakceptować wyzwania.",
      leaveQuestion: "Opuścić wyzwanie?",
      reallyLeave: "Czy na pewno chcesz opuścić?",
      yes: "Tak",
      no: "Nie",
      couldNotLeave: "Nie udało się opuścić wyzwania.",
      freeVersionMaxChallengesTitle: "Odblokuj Premium",
      freeVersionMaxChallenges: "W wersji Free możesz mieć maksymalnie 2 wyzwania. Odblokuj Premium, aby mieć nielimitowaną liczbę wyzwań.",
      stayFree: "Zostań przy Free",
      unlockPremium: "Odblokuj Premium",
      notificationFreeLimit: "W wersji Free możesz mieć powiadomienia tylko dla jednego wyzwania. Najpierw wyłącz je przy innym wyzwaniu.",
      expoGoNotifications: "Powiadomienia nie działają w Expo Go. Od Expo SDK 53 powiadomienia w Expo Go są wyłączone. Wymagany jest development build (EAS).",
      notificationsFailed: "Nie udało się ustawić powiadomień.",
      notificationsSaved: "Powiadomienie zostało zapisane.",
      saving: "Zapisywanie…",
      notificationsDisabled: "Powiadomienia zostały wyłączone.",
      doneAction: "Gotowe",
      chooseHistoryChallenge: "Wybierz wyzwanie, aby wyświetlić jego historię.",
      notificationPermissionDenied: "Powiadomienia są wyłączone w ustawieniach systemu. Włącz je, aby korzystać z przypomnień.",
      deleteQuestion: "Usunąć wyzwanie?",
      deleteQuestionText: "Tej akcji nie można cofnąć.",
      delete: "Usuń",
      freeRelax: "Odpocznij :)",
      addTodayCount: "Ukończono",
      inactive: "Nieaktywne",
      challengeOff: "Wyzwanie jest wyłączone",
    };
  }

  if (lang === "de") {
    return {
      sharedNotificationsSaved: "Benachrichtigungen für gemeinsame Challenge gespeichert.",
sharedNotificationsOff: "Benachrichtigungen für gemeinsame Challenge deaktiviert.",
notificationCount: "Anzahl der Benachrichtigungen",
      welcomeBack: "Willkommen zurück",
      premium: "Premium",
      free: "Free",
      upgrade: "Upgrade",
        keepsGoing: "Du bist schon bei",
  dayWord: "Tag",
  dontStop: "Bleib dran!",

      quote: "Ein kleiner Schritt heute, eine große Veränderung morgen",
      addTitle: "Challenge hinzufügen",
      close: "Schließen",
      invite: "Einladen",
      inviteFriend: "Freund einladen",
      invitationSent: "Einladung gesendet",
      noFriendsToInvite: "Keine angenommenen Freunde zum Einladen verfügbar.",
      couldNotInvite: "Einladung konnte nicht gesendet werden.",
      sharedInviteNotFound: "Die Einladung konnte nicht gefunden werden. Sie wurde möglicherweise abgebrochen oder ist abgelaufen.",
      sharedInviteFailed: "Die Einladung konnte nicht gesendet werden. Bitte versuche es erneut.",
      sharedInviteAlreadyMember: "Dieser Freund ist bereits Teil dieser gemeinsamen Challenge.",
      sharedInviteGeneric: "Etwas ist schiefgelaufen. Bitte versuche es erneut.",
      namePlaceholder: "Name der Challenge",
      add: "Hinzufügen",
      manageTitle: "Challenge verwalten",
      active: "Aktiv",
      easyMode: "Easy Mode",
      easyModeActive: "Easy Mode aktiv",
      easyModeConfirmTitle: "Easy Mode aktivieren?",
      easyModeConfirmMessage: "Der Easy Mode ist dauerhaft. Diese Challenge verliert keine Feuer-Serie, zählt aber nicht zum Gesamt-Streak und sammelt keine neuen Medaillen. Möchtest du fortfahren?",
      easyModeConfirm: "Aktivieren",
      easyModeCancel: "Abbrechen",
      perDayCount: "Anzahl pro Tag",
      period: "Zeitraum",
      daily: "Täglich",
      every2: "Jeden zweiten Tag",
      customDays: "Eigene Tage",
      chooseDaysHint: "Wähle die Tage, an denen die Challenge aktiv ist.",
      notifications: "Benachrichtigungen",
      saveNotifications: "Benachrichtigungen speichern",
      challengeHistory: "Challenge-Verlauf",
      deleteChallenge: "Challenge löschen",
      historyOfChallenge: "Challenge-Verlauf",
      currentMedal: "Aktuelle Medaille",
      bestStreakOfChallenge: "Beste Serie dieser Challenge",
      medalOverviewTitle: "Medaillenübersicht",
      medalOverviewHint: "Die Zahl ×N zeigt, wie oft die Medaille gesammelt wurde, höchstens 10-mal pro Challenge.",
      medalBestStreak: "beste Serie",
      medalNoChallenges: "Noch keine Challenge",
      medalChallengeFallback: "Challenge",
      medalDays: "Tage",
      completed: "Erledigt",
      skipped: "Übersprungen",
      freeDay: "Freier Tag",
      notCompleted: "Nicht erledigt",
      nothingHereYet: "Hier ist noch nichts",
      addChallengeAndStart: "Füge eine Challenge hinzu und starte heute.",
      sharedChallenges: "Gemeinsame Challenges",
      waitingForAccept: "Wartet auf Annahme",
      sharedChallenge: "Gemeinsame Challenge",
      withFriend: "Mit Freund",
      withFriends: "Mit Freunden",
      loadingUser: "Wird geladen…",
      unknownUser: "Benutzer",
      todayTarget: "Heutiges Ziel",
      todayIsFree: "Heute ist ein freier Tag",
      leave: "Verlassen",
      done: "Fertig",
      complete: "Erledigen",
      acceptChallenge: "Challenge annehmen",
      waitingForOthers: "Warten auf andere Mitglieder",
      loadingSharedPrompt: "Diese gemeinsame Challenge wurde dir von einem Freund gesendet. Nimm sie zuerst an.",
      alreadyAcceptedWaiting: "Du hast diese Challenge bereits angenommen. Wir warten auf die anderen",
      accountNotLogged: "Du bist nicht angemeldet.",
      challengeNotAccepted: "Diese Challenge wurde noch nicht von allen Mitgliedern angenommen.",
      couldNotSaveCompletion: "Erledigung konnte nicht gespeichert werden.",
      challengeAccepted: "Challenge angenommen.",
      couldNotAcceptChallenge: "Challenge konnte nicht angenommen werden.",
      leaveQuestion: "Challenge verlassen?",
      reallyLeave: "Möchtest du wirklich verlassen?",
      yes: "Ja",
      no: "Nein",
      couldNotLeave: "Challenge konnte nicht verlassen werden.",
      freeVersionMaxChallengesTitle: "Premium freischalten",
      freeVersionMaxChallenges: "In der Free-Version kannst du maximal 2 Challenges haben. Schalte Premium für unbegrenzte Challenges frei.",
      stayFree: "Free behalten",
      unlockPremium: "Premium freischalten",
      notificationFreeLimit: "In der Free-Version kannst du Benachrichtigungen nur für eine Challenge haben. Schalte sie zuerst bei einer anderen Challenge aus.",
      expoGoNotifications: "Benachrichtigungen funktionieren in Expo Go nicht. Seit Expo SDK 53 sind Benachrichtigungen in Expo Go deaktiviert. Ein Development Build (EAS) ist erforderlich.",
      notificationsFailed: "Benachrichtigungen konnten nicht eingestellt werden.",
      notificationsSaved: "Benachrichtigung gespeichert.",
      saving: "Wird gespeichert…",
      notificationsDisabled: "Benachrichtigungen wurden deaktiviert.",
      doneAction: "Fertig",
      chooseHistoryChallenge: "Wähle eine Challenge aus, um ihren Verlauf anzuzeigen.",
      notificationPermissionDenied: "Mitteilungen sind in den Systemeinstellungen deaktiviert. Aktiviere sie, um Erinnerungen einzuschalten.",
      deleteQuestion: "Challenge löschen?",
      deleteQuestionText: "Diese Aktion kann nicht rückgängig gemacht werden.",
      delete: "Löschen",
      freeRelax: "Entspann dich :)",
      addTodayCount: "Erledigt",
      inactive: "Inaktiv",
      challengeOff: "Challenge ist deaktiviert",
    };
  }

  return {
    sharedNotificationsSaved: "Notifikace pro společnou výzvu byly uloženy.",
sharedNotificationsOff: "Notifikace pro společnou výzvu byly vypnuty.",
notificationCount: "Počet notifikací",
    welcomeBack: "Vítej zpět",
    premium: "Premium",
    free: "Free",
    upgrade: "Upgradovat",
    keepsGoing: "Držíš se už",
  dayWord: "den",
  dontStop: "Nepřestávej!",
    quote: "Malý krok dnes, velká změna zítra",
    addTitle: "Přidat výzvu",
    close: "Zavřít",
    invite: "Pozvat",
    inviteFriend: "Pozvat přítele",
    invitationSent: "Pozvánka odeslána",
    noFriendsToInvite: "Žádní přijatí přátelé k pozvání.",
    couldNotInvite: "Nepodařilo se odeslat pozvánku.",
    sharedInviteNotFound: "Pozvánku se nepodařilo najít. Možná už byla zrušena nebo vypršela.",
    sharedInviteFailed: "Pozvánku se nepodařilo odeslat. Zkuste to prosím znovu.",
    sharedInviteAlreadyMember: "Tento přítel už je v této společné výzvě.",
    sharedInviteGeneric: "Něco se nepodařilo. Zkuste to prosím znovu.",
    namePlaceholder: "Název výzvy",
    add: "Přidat",
    manageTitle: "Správa výzvy",
    active: "Aktivní",
    easyMode: "Easy mode",
    easyModeActive: "Easy mode aktivní",
    easyModeConfirmTitle: "Zapnout Easy mode?",
    easyModeConfirmMessage: "Easy mode je nevratný. Výzva nebude ztrácet ohýnky, ale nebude se počítat do celkového streaku ani sbírat nové medaile. Chcete pokračovat?",
    easyModeConfirm: "Zapnout",
    easyModeCancel: "Zrušit",
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
    medalOverviewTitle: "Přehled medailí",
    medalOverviewHint: "Počet ×N ukazuje, kolikrát byla medaile získána, maximálně 10× za jednu výzvu.",
    medalBestStreak: "nejlepší série",
    medalNoChallenges: "Zatím žádná výzva",
    medalChallengeFallback: "Výzva",
    medalDays: "dní",
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
    loadingUser: "Načítám…",
    unknownUser: "Uživatel",
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
    notificationFreeLimit: "Ve Free verzi můžeš mít notifikace jen u jedné výzvy. Vypni je nejdřív u jiné výzvy.",
    expoGoNotifications: "Notifikace v Expo Go nefungují. Od Expo SDK 53 byly notifikace v Expo Go vypnuté. Je potřeba development build (EAS).",
    notificationsFailed: "Nepodařilo se nastavit notifikace.",
    notificationsSaved: "Notifikace byla uložena.",
    saving: "Ukládám…",
    notificationsDisabled: "Notifikace byly vypnuty.",
    doneAction: "Hotovo",
    chooseHistoryChallenge: "Vyber výzvu pro zobrazení historie.",
    notificationPermissionDenied: "Oznámení jsou vypnutá v nastavení telefonu. Pro zapnutí připomínek je povol.",
    deleteQuestion: "Smazat výzvu?",
    deleteQuestionText: "Tahle akce nejde vrátit zpět.",
    delete: "Smazat",
    freeRelax: "Relaxuj :)",
    addTodayCount: "Splněno",
    inactive: "Neaktivní",
    challengeOff: "Výzva je vypnutá",
  };
}, [lang]);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const styles = useMemo(
    () => makeStyles(UI, insets.top, insets.bottom, windowHeight),
    [UI, insets.top, insets.bottom, windowHeight]
  );

  const todayISO = useTodayISO();

  const isChallengeActiveOnDate = useCallback(
    (c: any, dateISO: string): boolean => !!c && isStoredChallengeActiveOnDate(c, dateISO),
    []
  );

  const isChallengeActiveToday = useCallback((c: any): boolean => isChallengeActiveOnDate(c, todayISO), [isChallengeActiveOnDate, todayISO]);

  const [premium, setPremium] = useState(false);
  const [appState, setAppState] = useState<AppState | null>(() => getCachedState());
  const [sharedChallenges, setSharedChallenges] = useState<SharedChallenge[]>([]);
  const [sharedChallengesLoaded, setSharedChallengesLoaded] = useState(false);
  const [sharedRefreshEpoch, setSharedRefreshEpoch] = useState(0);
  const [sharedTodayMap, setSharedTodayMap] = useState<Record<string, SharedChallengeDayProgress | null>>({});
  const [sharedFriendNames, setSharedFriendNames] = useState<Record<string, string>>({});
  const [sharedProgressMap, setSharedProgressMap] = useState<Record<string, SharedChallengeDayProgress[]>>({});
  const [sharedCompletingMap, setSharedCompletingMap] = useState<Record<string, boolean>>({});
  const [friendEdges, setFriendEdges] = useState<FriendEdge[]>([]);
  const [sharedInviteOpen, setSharedInviteOpen] = useState(false);
  const [selectedSharedInvite, setSelectedSharedInvite] = useState<SharedChallenge | null>(null);
  const [sharedInviteSendingUid, setSharedInviteSendingUid] = useState<string | null>(null);
  const [sharedInviteStatus, setSharedInviteStatus] = useState("");
  const [localSharedInviteUids, setLocalSharedInviteUids] = useState<Record<string, string[]>>({});
  const [premiumReady, setPremiumReady] = useState(false);

  useEffect(() => {
    const subscription = RNAppState.addEventListener("change", (next) => {
      if (next === "active") setSharedRefreshEpoch((value) => value + 1);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const cached = getCachedState();
    if (cached) setAppState(cached);
    return subscribeState((next) => {
      setAppState(next);
    });
  }, []);

  useEffect(() => {
    if (!cloudAllowed) {
      setFriendEdges([]);
      return;
    }
    if (!auth.currentUser?.uid) {
      setFriendEdges([]);
      return;
    }

    return subscribeFriends(
      (edges) => setFriendEdges(edges),
      () => setFriendEdges([])
    );
  }, [cloudAllowed, cloudSessionEpoch]);

  useEffect(() => {
    if (!cloudAllowed) return;
    let mounted = true;
    const acceptedFriendUids = Array.from(
      new Set(
        friendEdges
          .filter((edge) => edge.status === "accepted")
          .map((edge) => String(edge.otherUid))
          .filter(Boolean)
      )
    );

    if (!acceptedFriendUids.length) return;

    void (async () => {
      const nextNames: Record<string, string> = {};

      for (const uid of acceptedFriendUids) {
        if (sharedFriendNames[uid] && sharedFriendNames[uid] !== TXT.unknownUser) continue;

        try {
          const p = await getProfile(uid);
          const loadedName = typeof p?.username === "string" ? p.username.trim() : "";
          nextNames[uid] = loadedName && loadedName !== uid ? loadedName : TXT.unknownUser;
        } catch {
          nextNames[uid] = TXT.unknownUser;
        }
      }

      if (!mounted || !Object.keys(nextNames).length) return;

      setSharedFriendNames((prev) => ({
        ...prev,
        ...nextNames,
      }));
    })();

    return () => {
      mounted = false;
    };
  }, [cloudAllowed, cloudSessionEpoch, friendEdges, sharedFriendNames, TXT.unknownUser]);

  

  useEffect(() => {
    let mounted = true;

    let unsubDays: Array<() => void> = [];
    let unsubProgress: Array<() => void> = [];

    if (!cloudAllowed || !auth.currentUser?.uid) {
      setSharedChallenges([]);
      setSharedChallengesLoaded(true);
      setSharedTodayMap({});
      setSharedProgressMap({});
      return () => {
        mounted = false;
      };
    }

    const uid = auth.currentUser.uid;
    void readSharedCache(uid).then((cached) => {
      if (!mounted || cached.length === 0) return;
      setSharedChallenges((current) => current.length > 0 ? current : cached);
      setSharedChallengesLoaded(true);
      if (__DEV__) console.log("[shared-challenges] restored cache", { count: cached.length });
    });

    const unsubShared = subscribeSharedChallenges(
      async (items) => {
        if (!mounted) return;

        setSharedChallenges(items);
        setSharedChallengesLoaded(true);
        const cacheUid = auth.currentUser?.uid;
        if (cacheUid) {
          await cacheSharedChallenges(cacheUid, items);
          void replaySharedCompletionsForCurrentUser(cacheUid).catch(() => {});
        }
        setLocalSharedInviteUids((prev) => {
          const next: Record<string, string[]> = {};

          for (const item of items) {
            const local = prev[item.id] ?? [];
            if (!local.length) continue;

            const serverPending = new Set((item.pendingInviteUids ?? []).map((uid) => String(uid)));
            const stillPending = local.filter((uid) => serverPending.has(String(uid)));
            if (stillPending.length) next[item.id] = stillPending;
          }

          return next;
        });

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
                const currentUid = auth.currentUser?.uid;
                const count = currentUid ? Number(data?.users?.[currentUid]?.completedCount ?? 0) : 0;
                if (currentUid) void cacheSharedProgress(currentUid, item.id, today, count);
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
                const currentUid = auth.currentUser?.uid;
                if (currentUid) {
                  void cacheSharedProgressHistory(currentUid, item.id, rows.map((row) => ({
                    date: row.date,
                    completedCount: Number(row.users?.[currentUid]?.completedCount ?? 0),
                  })));
                }
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
          const safeUid = String(uid);
          try {
            const p = await getProfile(uid);
            const loadedName = typeof p?.username === "string" ? p.username.trim() : "";
            if (loadedName && loadedName !== safeUid) {
              nextNames[safeUid] = loadedName;
            } else {
              nextNames[safeUid] = TXT.unknownUser;
            }
          } catch {
            nextNames[safeUid] = TXT.unknownUser;
          }
        }

        if (mounted) {
          setSharedFriendNames((prev) => {
            const merged = { ...prev };
            for (const [uid, name] of Object.entries(nextNames)) {
              const previous = String(merged[uid] ?? "").trim();
              if (name === TXT.unknownUser && previous && previous !== TXT.unknownUser) continue;
              merged[uid] = name;
            }
            return merged;
          });
        }
      },
      () => {
        if (!mounted) return;
        // A listener error is not a valid empty cloud state. Keep the last
        // successful in-memory/cache snapshot; foreground will re-subscribe.
        if (__DEV__) console.log("[shared-challenges] cloud request failed; preserving last valid data");
      }
    );

    return () => {
      mounted = false;
      unsubShared?.();
      unsubDays.forEach((u) => u());
      unsubProgress.forEach((u) => u());
    };
  }, [TXT.unknownUser, cloudAllowed, cloudSessionEpoch, sharedRefreshEpoch]);

  

  useEffect(() => {
    let mounted = true;
    isPremiumActive().then((p) => {
      if (!mounted) return;
      setPremium(!!p);
      setPremiumReady(true);
    }).catch(() => {
      if (!mounted) return;
      setPremium(false);
      setPremiumReady(true);
    });
    const unsub = subscribePremium((p) => {
      if (!mounted) return;
      setPremium(!!p);
      setPremiumReady(true);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!premiumReady || !appState || refreshedChallengeReminders.current) return;
    refreshedChallengeReminders.current = true;
    setRemindersPremiumEnabled(!!premium);
    void refreshScheduledChallengeReminders();
  }, [appState, premium, premiumReady]);

  useEffect(() => {
    if (!premiumReady || !sharedChallengesLoaded || refreshedSharedReminders.current) return;
    refreshedSharedReminders.current = true;
    setRemindersPremiumEnabled(!!premium);
    void refreshScheduledSharedReminders(sharedChallenges);
  }, [premium, premiumReady, sharedChallenges, sharedChallengesLoaded]);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [manageOpen, setManageOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [medalsOverviewOpen, setMedalsOverviewOpen] = useState(false);
  const [addModalText, setAddModalText] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const addSaveLock = useRef(false);
  const [manageId, setManageId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [reorderMode, setReorderMode] = useState(false);
  const [expandedSharedId, setExpandedSharedId] = useState<string | null>(null);

  const [sharedMenuOpen, setSharedMenuOpen] = useState(false);
const [selectedSharedMenu, setSelectedSharedMenu] =
  useState<SharedChallenge | null>(null);

const [sharedNotificationOpen, setSharedNotificationOpen] = useState(false);
const [sharedNotificationSetting, setSharedNotificationSetting] =
  useState<SharedNotificationSetting>(DEFAULT_SHARED_NOTIFICATION_SETTING);
const refreshedChallengeReminders = useRef(false);
const refreshedSharedReminders = useRef(false);

function openSharedMenu(item: SharedChallenge) {
  setSelectedSharedMenu(item);
  setSharedMenuOpen(true);
}

function closeSharedMenu() {
  setSharedMenuOpen(false);
  setSelectedSharedMenu(null);
}

async function openSharedNotificationSettings() {
  if (!selectedSharedMenu?.id) return;

  const setting = await loadSharedNotificationSetting(selectedSharedMenu.id);
  setSharedNotificationSetting(setting);
  setSharedNotificationOpen(true);
}

  const managed = useMemo(() => {
    if (!manageId) return null;
    return (appState?.challenges ?? []).find((c: any) => String(c.id) === String(manageId)) as any;
  }, [appState?.challenges, manageId]);

  const [manageEnabled, setManageEnabled] = useState(true);
  const [manageEasyMode, setManageEasyMode] = useState(false);
  const [manageTarget, setManageTarget] = useState(1);
  const [managePeriod, setManagePeriod] = useState<"daily" | "every2" | "custom" | "flexibleWeekly">("daily");
  const [manageCustomDays, setManageCustomDays] = useState<number[]>([]);
  const [managePeriodAnchor, setManagePeriodAnchor] = useState<string | null>(null);
  const [manageFlexibleStartDay, setManageFlexibleStartDay] = useState(0);
  const [periodPickerOpen, setPeriodPickerOpen] = useState(false);
  const [manageRemEnabled, setManageRemEnabled] = useState(false);
  const [manageRemCount, setManageRemCount] = useState(1);
  const [manageRemTimes, setManageRemTimes] = useState<string[]>([]);
  const [manageReminderRows, setManageReminderRows] = useState<FlexibleWeeklyReminderRow[]>([]);
  const [manageReminderDayPickerIndex, setManageReminderDayPickerIndex] = useState<number | null>(null);
  const [manageRename, setManageRename] = useState("");
  const [manageSaving, setManageSaving] = useState(false);
  const [manageSaveConfirmation, setManageSaveConfirmation] = useState("");
  const manageSaveLock = useRef(false);
  const manageRenameDraft = useRef(createEditorDraft());
  const manageEditorSession = useRef(0);
  const manageConfirmation = useRef(createEditorConfirmationController());
  const manageScrollRef = useRef<ScrollView>(null);
  const addScrollRef = useRef<ScrollView>(null);

  useEffect(() => () => manageConfirmation.current.cancelSession(), []);

  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [timePickerIndex, setTimePickerIndex] = useState(0);
  const [timePickerValue, setTimePickerValue] = useState(new Date());

  const [sharedTimePickerOpen, setSharedTimePickerOpen] = useState(false);
const [sharedTimePickerIndex, setSharedTimePickerIndex] = useState(0);
const [sharedTimePickerValue, setSharedTimePickerValue] = useState(new Date());

  const openManage = useCallback(
    (id: string) => {
      const c = (appState?.challenges ?? []).find((x: any) => String(x.id) === String(id)) as any;
      if (!c) return;

      const enabled = (c as any).enabled !== false;
      const target = clamp(Number((c as any).targetPerDay ?? 1) || 1, 1, 20);

      const rawPeriod = String((c as any).period ?? "daily");
      const period: "daily" | "every2" | "custom" | "flexibleWeekly" = rawPeriod === FLEXIBLE_WEEKLY_PERIOD || rawPeriod === "every2" || rawPeriod === "custom" ? (rawPeriod as any) : "daily";
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
      setManageEasyMode(isChallengeEasyMode(c));
      setManageTarget(period === FLEXIBLE_WEEKLY_PERIOD ? clampFlexibleWeeklyTarget((c as any).flexibleWeeklyPending?.target ?? (c as any).flexibleWeeklyTarget ?? target) : target);
      setManagePeriod(period);
      setManageCustomDays(uniqueDays);
      setManagePeriodAnchor(anchor);
      setManageFlexibleStartDay(Number((c as any).flexibleWeeklyPending?.startDay ?? (c as any).flexibleWeeklyStartDay ?? localDayMon0(todayISO)));
      setManageRemEnabled(remEnabled);
      setManageRemTimes(remEnabled ? safeTimes : []);
      setManageReminderRows(migrateFlexibleWeeklyReminderRows(
        (c as any).flexibleReminderRows,
        (c as any).reminderDays,
        safeTimes,
      ));
      setManageReminderDayPickerIndex(null);
      setManageRemCount(clamp(
        (remEnabled ? safeTimes.length : 1) || 1,
        1,
        period === FLEXIBLE_WEEKLY_PERIOD ? 7 : Math.min(10, target),
      ));
      const currentName = String((c as any).text ?? "");
      manageRenameDraft.current.set(currentName);
      setManageRename(currentName);
      setManageSaveConfirmation("");
      manageSaveLock.current = false;
      setManageSaving(false);
      manageEditorSession.current = manageConfirmation.current.beginSession();
      setManageOpen(true);
    },
    [appState?.challenges, todayISO]
  );

  const closeManage = useCallback(() => {
    manageConfirmation.current.cancelSession();
    Keyboard.dismiss();
    setManageOpen(false);
    setManageId(null);
    setManageEasyMode(false);
    setManageSaveConfirmation("");
    manageSaveLock.current = false;
    setManageSaving(false);
  }, []);

  const persist = useCallback(async (updater: (latest: AppState) => AppState) => {
    const latest = (await loadState()) as AppState;
    const next = updater(latest);
    await saveState(next);
  }, []);

  const addChallengeFromHero = useCallback(async () => {
    if (addSaveLock.current) return;
    const trimmed = addModalText.trim();
    if (!trimmed) return;
    addSaveLock.current = true;
    setAddSaving(true);
    try {
    if (!premium) {
      const latest = await loadState();
      const total = getUserChallengesForPlan(latest).length;
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
        challenges: [{ id: newId, text: trimmed, enabled: true, createdDate: todayISO }, ...(latest2.challenges ?? [])],
      };
    });
    setAddModalOpen(false);
    } finally {
      addSaveLock.current = false;
      setAddSaving(false);
    }
  }, [addModalText, persist, premium, router, todayISO]);

  const saveBasicsImmediate = useCallback(
    async (nextEnabled: boolean, nextTarget: number) => {
      if (!manageId) return;
      const id = String(manageId);
      const target = managePeriod === FLEXIBLE_WEEKLY_PERIOD
        ? clampFlexibleWeeklyTarget(nextTarget)
        : clamp(Number(nextTarget) || 1, 1, 20);

      await persist((latest) => {
        const list = [...(latest.challenges ?? [])];
        const idx = list.findIndex((c: any) => String(c.id) === id);
        if (idx === -1) return latest as any;

        const prevItem = list[idx] as any;
        const prevEnabled = prevItem?.enabled !== false;
        const willEnabled = !!nextEnabled;

        const transitioned = transitionChallengeEnabled(prevItem, willEnabled, todayISO);
        const hasFlexibleHistory = (latest.history ?? []).some((entry) => String(entry.challengeId ?? "") === id);
        const mayConfigureImmediately = prevItem.period === FLEXIBLE_WEEKLY_PERIOD && !hasFlexibleHistory &&
          !prevItem.flexibleWeeklyLastEvaluatedPeriodStart && String(prevItem.flexibleWeeklyFirstPeriodStart ?? todayISO) >= todayISO;
        const item = managePeriod === FLEXIBLE_WEEKLY_PERIOD
          ? scheduleFlexibleWeeklySettings(transitioned, target, manageFlexibleStartDay, todayISO, mayConfigureImmediately)
          : { ...transitioned, targetPerDay: target };

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

      try {
        const latest = await loadState();
        const c = (latest.challenges ?? []).find((x: any) => String(x.id) === id) as any;
        const times = Array.isArray(c?.reminderTimes) ? (c.reminderTimes as string[]) : [];
        const filled = times.filter((t) => String(t ?? "").trim());
        if (c?.reminderEnabled && c?.enabled !== false && filled.length) {
          await setDailyRemindersForChallenge(id, String(c?.text ?? "OneMore"), filled);
        } else {
          await clearDailyRemindersForChallenge(id);
        }
      } catch {}

      const maxN = managePeriod === FLEXIBLE_WEEKLY_PERIOD ? 7 : Math.min(10, target);
      if (manageRemEnabled) {
        setManageRemCount((n) => clamp(n, 1, maxN));
        setManageRemTimes((arr) => (Array.isArray(arr) ? arr.slice(0, clamp(manageRemCount, 1, maxN)) : []));
      }
    },
    [manageFlexibleStartDay, manageId, managePeriod, manageRemCount, manageRemEnabled, persist, todayISO]
  );

  const enableEasyMode = useCallback(async () => {
    if (!manageId) return;
    const id = String(manageId);

    await persist((latest) => ({
      ...(latest as any),
      easyModeChallengeIds: Array.from(
        new Set([...(latest.easyModeChallengeIds ?? []).map(String), id])
      ),
      challenges: (latest.challenges ?? []).map((c: any) =>
        String(c.id) === id ? { ...c, easyMode: true } : c
      ),
    }) as any);

    setManageEasyMode(true);
  }, [manageId, persist]);

  const confirmEnableEasyMode = useCallback(() => {
    if (manageEasyMode) return;

    const easyModeAlert = Platform.OS === "ios" ? NativeAlert : Alert;
    easyModeAlert.alert(TXT.easyModeConfirmTitle, TXT.easyModeConfirmMessage, [
      { text: TXT.easyModeCancel, style: "cancel" },
      {
        text: TXT.easyModeConfirm,
        style: "destructive",
        onPress: () => void enableEasyMode(),
      },
    ]);
  }, [enableEasyMode, manageEasyMode, TXT.easyModeCancel, TXT.easyModeConfirm, TXT.easyModeConfirmMessage, TXT.easyModeConfirmTitle]);

  const savePeriodImmediate = useCallback(
    async (nextPeriod: "daily" | "every2" | "custom" | "flexibleWeekly", nextCustomDays?: number[]) => {
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
        list[idx] = nextPeriod === FLEXIBLE_WEEKLY_PERIOD
          ? scheduleFlexibleWeeklySettings(prevItem, manageTarget, manageFlexibleStartDay, todayISO)
          : {
              ...prevItem,
              period: nextPeriod,
              customDays: nextPeriod === "custom" ? uniqueDays : [],
              periodAnchor: nextPeriod === "every2" ? String(anchor) : undefined,
            };
        return { ...(latest as any), challenges: list } as any;
      });

      try {
        const latest = await loadState();
        const c = (latest.challenges ?? []).find((x: any) => String(x.id) === id) as any;
        const times = Array.isArray(c?.reminderTimes) ? (c.reminderTimes as string[]) : [];
        const filled = times.filter((t) => String(t ?? "").trim());
        if (c?.reminderEnabled && c?.enabled !== false && filled.length) {
          await setDailyRemindersForChallenge(id, String(c?.text ?? "OneMore"), filled);
        } else {
          await clearDailyRemindersForChallenge(id);
        }
      } catch {}

      setManagePeriod(nextPeriod);
      setManageCustomDays(nextPeriod === "custom" ? uniqueDays : []);
      setManagePeriodAnchor(nextPeriod === "every2" ? String(anchor) : null);
    },
    [manageFlexibleStartDay, manageId, manageCustomDays, managePeriodAnchor, manageTarget, persist, todayISO]
  );

  const saveFlexibleStartDayImmediate = useCallback(async (startDay: number) => {
    if (!manageId) return;
    const id = String(manageId);
    const normalizedDay = Math.min(6, Math.max(0, Math.floor(startDay)));
    setManageFlexibleStartDay(normalizedDay);
    await persist((latest) => ({
      ...latest,
      challenges: (latest.challenges ?? []).map((challenge) => {
        if (String(challenge.id) !== id) return challenge;
        const hasFlexibleHistory = (latest.history ?? []).some((entry) => String(entry.challengeId ?? "") === id);
        const mayConfigureImmediately = !hasFlexibleHistory && !challenge.flexibleWeeklyLastEvaluatedPeriodStart &&
          String(challenge.flexibleWeeklyFirstPeriodStart ?? todayISO) >= todayISO;
        return scheduleFlexibleWeeklySettings(challenge, manageTarget, normalizedDay, todayISO, mayConfigureImmediately);
      }),
    }));
  }, [manageId, manageTarget, persist, todayISO]);

  const saveRenameImmediate = useCallback(async () => {
    if (!manageId) return;
    const v = manageRenameDraft.current.readTrimmed();
    if (!v) return;
    const next = await renameChallenge(String(manageId), v);
    await saveState(next);
  }, [manageId]);

  const renameTimer = useRef<any>(null);
  const renameInFlight = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!manageOpen || manageSaving) return;
    if (!manageId) return;
    if ((managed?.text ?? "") === manageRename) return;

    if (renameTimer.current) clearTimeout(renameTimer.current);
    renameTimer.current = setTimeout(() => {
      renameTimer.current = null;
      renameInFlight.current = saveRenameImmediate();
    }, 600);

    return () => {
      if (renameTimer.current) clearTimeout(renameTimer.current);
    };
  }, [manageOpen, manageSaving, manageId, managed?.text, manageRename, saveRenameImmediate]);

 const applyManageReminders = useCallback(async () => {
  if (!manageId || manageSaveLock.current) return;
  manageSaveLock.current = true;
  setManageSaving(true);
  setManageSaveConfirmation("");

  const id = String(manageId);
  const editorSession = manageEditorSession.current;
  const wantsEnabled = !!manageRemEnabled;

  const target = clamp(Number(manageTarget) || 1, 1, 20);
  const maxN = managePeriod === FLEXIBLE_WEEKLY_PERIOD ? 7 : Math.min(10, target);
  const wantedCount = clamp(Number(manageRemCount) || 1, 1, maxN);
  const reminderRows = normalizeFlexibleWeeklyReminderRows(manageReminderRows);

  let times = Array.isArray(manageRemTimes)
    ? manageRemTimes
        .filter((t) => typeof t === "string" && /^\d{2}:\d{2}$/.test(t))
        .slice(0, wantedCount)
    : [];

  if (wantsEnabled && managePeriod !== FLEXIBLE_WEEKLY_PERIOD && times.length === 0) {
    times = [nowHM()];
  }
  if (managePeriod === FLEXIBLE_WEEKLY_PERIOD) {
    times = reminderRows.map(flexibleReminderRowTime);
  }

  try {
    const name = manageRenameDraft.current.readTrimmed();
    if (!name) {
      Alert.alert(TXT.manageTitle, TXT.namePlaceholder);
      return;
    }
    if (!isFlexibleReminderRowSelectionValid(managePeriod, wantsEnabled, reminderRows)) {
      Alert.alert(
        t.flexibleWeekly.notificationDayRequiredTitle,
        t.flexibleWeekly.notificationDayRequired,
      );
      return;
    }
    if (!premium && wantsEnabled) {
      const activeId = getFreeActiveReminderChallengeId(appState as any);
      const anySharedActive = await hasAnyActiveSharedNotification();
      if ((activeId && String(activeId) !== id) || anySharedActive) {
        Alert.alert(TXT.notifications, TXT.notificationFreeLimit);
        return;
      }
    }

    if (renameTimer.current) clearTimeout(renameTimer.current);
    renameTimer.current = null;
    await renameInFlight.current.catch(() => undefined);

    const configureChallenge = (challenge: any) => {
      const enabledChallenge = transitionChallengeEnabled(challenge, manageEnabled, todayISO);
      const configured = managePeriod === FLEXIBLE_WEEKLY_PERIOD
        ? scheduleFlexibleWeeklySettings(enabledChallenge, manageTarget, manageFlexibleStartDay, todayISO)
        : {
            ...enabledChallenge,
            targetPerDay: clamp(manageTarget, 1, 20),
            period: managePeriod,
            customDays: managePeriod === "custom" ? manageCustomDays : [],
            periodAnchor: managePeriod === "every2" ? (managePeriodAnchor ?? todayISO) : undefined,
          };
      return { ...configured, text: name };
    };
    const preview = configureChallenge(managed);
    const reminderSchedule = reminderScheduleForChallenge(
      preview,
      managePeriod === FLEXIBLE_WEEKLY_PERIOD ? reminderRows : undefined,
    );
    const prepared = await prepareChallengeReminders(
      id,
      name,
      times,
      wantsEnabled,
      reminderSchedule,
    );

    await commitPreparedNotificationChange({
      persist: () => persist((latest) =>
        prepared.applyToState(latest, (challenge) => configureChallenge(challenge))
      ),
      restore: prepared.restoreOriginalState,
      rollback: prepared.rollback,
      finalize: prepared.finalize,
    });

    if (wantsEnabled) {
      times = prepared.times;
      setManageRemTimes(times);
      setManageRemCount(times.length);
      if (managePeriod === FLEXIBLE_WEEKLY_PERIOD) {
        setManageReminderRows(prepared.reminderRows);
      }
    } else {
      setManageRemTimes([]);
      setManageRemCount(1);
      setManageReminderRows([]);
    }
    await manageConfirmation.current.confirm({
      session: editorSession,
      message: TXT.notificationsSaved,
      showConfirmation: setManageSaveConfirmation,
      closeEditor: closeManage,
    });
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    if (__DEV__) console.error("[PersonalReminders] save failed", { code: msg || "unknown", period: managePeriod });

    if (msg.includes("NOTIFICATIONS_EXPO_GO_UNSUPPORTED")) {
      Alert.alert(TXT.notifications, TXT.expoGoNotifications);
    } else if (msg.includes("NOTIFICATIONS_PERMISSION_DENIED")) {
      Alert.alert(TXT.notifications, TXT.notificationPermissionDenied);
    } else {
      Alert.alert(TXT.notifications, t.flexibleWeekly.notificationSaveFailed);
    }
  } finally {
    manageSaveLock.current = false;
    setManageSaving(false);
  }
}, [
  manageId,
  manageTarget,
  manageRemTimes,
  manageRemCount,
  manageRemEnabled,
  manageReminderRows,
  manageEnabled,
  managePeriod,
  manageCustomDays,
  managePeriodAnchor,
  manageFlexibleStartDay,
  managed,
  premium,
  appState,
  persist,
  todayISO,
  closeManage,
  TXT.manageTitle,
  TXT.namePlaceholder,
  TXT.notifications,
  TXT.notificationFreeLimit,
  TXT.expoGoNotifications,
  TXT.notificationPermissionDenied,
  TXT.notificationsSaved,
  t.flexibleWeekly.notificationDayRequired,
  t.flexibleWeekly.notificationDayRequiredTitle,
  t.flexibleWeekly.notificationSaveFailed,
]);

  const deleteManagedChallenge = useCallback(async () => {
    if (!manageId) return;
    const id = String(manageId);

    Alert.alert(TXT.deleteQuestion, TXT.deleteQuestionText, [
      { text: TXT.close, style: "cancel" },
      {
        text: TXT.delete,
        style: "destructive",
        onPress: async () => {
          try {
            await clearDailyRemindersForChallenge(id);
          } catch {}

          const next = await purgeChallenge(id);
          await saveState(next);
          await updateAllOneMoreWidgets();

          closeManage();
        },
      },
    ]);
  }, [closeManage, manageId, TXT.close, TXT.delete, TXT.deleteQuestion, TXT.deleteQuestionText]);

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

  useEffect(() => {
    const subscription = RNAppState.addEventListener("change", (next) => {
      if (next === "active") {
        void reload();
        void updateAllOneMoreWidgets();
      }
    });
    return () => subscription.remove();
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  const tdy = todayISO;
  const historyEntries = useMemo(() => appState?.history ?? [], [appState?.history]);

const visibleChallenges = useMemo(() => {
  return appState?.challenges ?? [];
}, [appState?.challenges]);

  const [listData, setListData] = useState<any[]>([]);
  useEffect(() => {
    setListData(visibleChallenges as any[]);
  }, [visibleChallenges]);

const visibleSharedChallenges = useMemo(() => {
  const me = auth.currentUser?.uid ?? "";
  return sharedChallenges.filter(
    (x) => x.status === "active" && isAcceptedSharedChallengeForUid(x, me)
  );
  
}, [sharedChallenges]);

const count = visibleChallenges.length;
const sidePadding = 18;

  const dayIndex = useMemo(() => {
    const byChallenge = new Map<string, Map<string, { completed: number; skipped: boolean; weeklyGoalMissed?: boolean; weeklyDone?: number; weeklyTarget?: number; weeklyPeriodStart?: string; weeklyPeriodEnd?: string; protectedByFreeze?: boolean; lastTime?: string }>>();
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
        if (t && (!cur.lastTime || t > cur.lastTime)) cur.lastTime = t;
      } else if (h?.status === "skipped") {
        if (h?.eventType === "weeklyGoalMissed") {
          cur.weeklyGoalMissed = true;
          cur.weeklyDone = Math.max(0, Number(h?.flexibleWeeklyDone ?? 0));
          cur.weeklyTarget = Math.max(1, Number(h?.flexibleWeeklyTarget ?? 1));
          cur.weeklyPeriodStart = String(h?.flexibleWeeklyPeriodStart ?? date);
          cur.weeklyPeriodEnd = date;
        } else {
          cur.skipped = true;
        }
        if (h?.protectedByFreeze === true) cur.protectedByFreeze = true;
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
    if (c?.period === FLEXIBLE_WEEKLY_PERIOD) {
      return flexibleWeeklyProgress(c, historyEntries, tdy).target;
    }
    const t = Number((c as any)?.targetPerDay ?? 1);
    return Number.isFinite(t) && t > 0 ? Math.floor(t) : 1;
  }

  function getChallengeById(challengeId: string) {
    return (visibleChallenges as any[]).find((x) => String(x.id) === String(challengeId)) as any;
  }

  function completedTodayCount(challengeId: string): number {
    const challenge = getChallengeById(challengeId);
    if (challenge?.period === FLEXIBLE_WEEKLY_PERIOD) {
      return flexibleWeeklyProgress(challenge, historyEntries, tdy).done;
    }
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
    const safeUid = String(uid);
    if (!safeUid) return TXT.unknownUser;
    if (safeUid === String(me)) return "Ty";
    const loadedName = sharedFriendNames[safeUid];
    if (typeof loadedName === "string" && loadedName.trim()) {
      const trimmed = loadedName.trim();
      return trimmed === safeUid ? TXT.unknownUser : trimmed;
    }
    return TXT.loadingUser;
  }

  function getSharedCompactLabel(item: SharedChallenge): string {
    const otherNames = getSharedOtherUids(item).map((uid) => getSharedDisplayName(uid));

    if (!otherNames.length) return "Společná výzva";
    if (otherNames.length === 1) return `${TXT.withFriend}: ${otherNames[0]}`;
    if (otherNames.length === 2) return `${TXT.withFriends}: ${otherNames[0]}, ${otherNames[1]}`;

    return `${TXT.withFriends}: ${otherNames.slice(0, 2).join(", ")} +${otherNames.length - 2}`;
  }

  function getPendingSharedInviteUids(item: SharedChallenge): string[] {
    const local = localSharedInviteUids[item.id] ?? [];
    return Array.from(
      new Set([...(item.pendingInviteUids ?? []), ...local].map((uid) => String(uid)).filter(Boolean))
    );
  }

  function canInviteToSharedChallenge(item: SharedChallenge): boolean {
    return canInviteSharedChallengeMembers(item, auth.currentUser?.uid ?? "");
  }

  function getEligibleSharedInviteFriends(item: SharedChallenge | null): FriendEdge[] {
    if (!item || !canInviteToSharedChallenge(item)) return [];

    const me = auth.currentUser?.uid ?? "";
    const pendingInviteUids = getPendingSharedInviteUids(item);
    const pendingSet = new Set(pendingInviteUids);
    const acceptedSet = new Set((item.acceptedBy ?? []).map((uid) => String(uid)));
    const leftSet = new Set((item.leftBy ?? []).map((uid) => String(uid)));
    const memberSet = new Set(item.memberUids.map((uid) => String(uid)));
    const occupiedUids = new Set([...item.memberUids, ...pendingInviteUids].map((uid) => String(uid)));

    return friendEdges.filter((edge) => {
      const uid = String(edge.otherUid);
      const alreadyAccepted = acceptedSet.has(uid) && !leftSet.has(uid);
      const wouldIncreaseMemberCount = !memberSet.has(uid) && !pendingSet.has(uid);

      return (
        edge.status === "accepted" &&
        uid &&
        uid !== me &&
        !pendingSet.has(uid) &&
        !alreadyAccepted &&
        (!wouldIncreaseMemberCount || occupiedUids.size < MAX_SHARED_MEMBERS)
      );
    });
  }

  function openSharedInviteModal(item: SharedChallenge) {
    if (!canInviteToSharedChallenge(item)) {
      Alert.alert(TXT.sharedChallenge, TXT.challengeNotAccepted);
      return;
    }

    setSelectedSharedInvite(item);
    setSharedInviteStatus("");
    setSharedInviteSendingUid(null);
    setSharedInviteOpen(true);
  }

  function closeSharedInviteModal() {
    setSharedInviteOpen(false);
    setSelectedSharedInvite(null);
    setSharedInviteSendingUid(null);
    setSharedInviteStatus("");
  }

  function getSharedInviteErrorMessage(e: any): string {
    const code = String(e?.code ?? "").toLowerCase();
    const message = String(e?.message ?? "").toLowerCase();

    if (
      code.includes("not-found") ||
      message === "not-found" ||
      message.includes("not found") ||
      message.includes("nebyla nalezena")
    ) {
      return TXT.sharedInviteNotFound;
    }

    if (
      code.includes("already-exists") ||
      code.includes("already") ||
      message.includes("already") ||
      message.includes("už je") ||
      message.includes("uz je")
    ) {
      return TXT.sharedInviteAlreadyMember;
    }

    if (
      code.includes("unavailable") ||
      code.includes("deadline-exceeded") ||
      code.includes("failed-precondition") ||
      code.includes("internal")
    ) {
      return TXT.sharedInviteFailed;
    }

    return TXT.sharedInviteGeneric;
  }

  function getSharedInviteClientBlockReason(item: SharedChallenge | null, friendUid: string): string | null {
    const challengeId = String(item?.id ?? "").trim();
    const safeFriendUid = String(friendUid ?? "").trim();

    if (!challengeId) return "missing challengeId";
    if (!safeFriendUid) return "missing friendUid";

    const me = auth.currentUser?.uid ?? "";
    const pendingSet = new Set(getPendingSharedInviteUids(item as SharedChallenge));
    const acceptedSet = new Set((item?.acceptedBy ?? []).map((uid) => String(uid)));
    const leftSet = new Set((item?.leftBy ?? []).map((uid) => String(uid)));
    const memberSet = new Set((item?.memberUids ?? []).map((uid) => String(uid)));
    const occupiedUids = new Set([...(item?.memberUids ?? []), ...Array.from(pendingSet)].map((uid) => String(uid)));
    const friendEdge = friendEdges.find((edge) => String(edge.otherUid) === safeFriendUid);

    if (!canInviteToSharedChallenge(item as SharedChallenge)) return "permission denied";
    if (!friendEdge || friendEdge.status !== "accepted") return "not friends";
    if (pendingSet.has(safeFriendUid)) return "friend already pending";
    if (acceptedSet.has(safeFriendUid) && !leftSet.has(safeFriendUid)) return "friend already accepted";
    if (safeFriendUid === me) return "permission denied";
    if (!memberSet.has(safeFriendUid) && occupiedUids.size >= MAX_SHARED_MEMBERS) {
      return "max members reached";
    }

    return null;
  }

  function getSharedInviteCallableFailureReason(e: any): string {
    const code = String(e?.code ?? "").trim();
    const message = String(e?.message ?? "").trim();
    const lower = `${code} ${message}`.toLowerCase();

    if (lower.includes("challengeid")) return "missing challengeId";
    if (lower.includes("frienduid")) return "missing friendUid";
    if (lower.includes("pozvanku") || lower.includes("ma pozv") || lower.includes("pending")) {
      return "friend already pending";
    }
    if (lower.includes("ucastnik") || lower.includes("already")) return "friend already accepted";
    if (lower.includes("maximalni") || lower.includes("maximum") || lower.includes("max")) {
      return "max members reached";
    }
    if (lower.includes("pritele") || lower.includes("friend")) return "not friends";
    if (lower.includes("permission-denied") || lower.includes("permission")) return "permission denied";

    return `callable error code/message: ${[code, message].filter(Boolean).join(" / ") || "unknown"}`;
  }

  function showSharedInviteFailure(message: string, reason: string, details?: any) {
    if (__DEV__) {
      console.log("[shared-invite/member] failed", { reason, details });
      Alert.alert(TXT.sharedChallenge, `${message}\n\n${reason}`);
      return;
    }

    Alert.alert(TXT.sharedChallenge, message);
  }

  async function sendSharedMemberInvite(friendUid: string) {
    if (sharedInviteSendingUid) return;

    const clientBlockReason = getSharedInviteClientBlockReason(selectedSharedInvite, friendUid);
    if (clientBlockReason) {
      showSharedInviteFailure(TXT.sharedInviteGeneric, clientBlockReason, {
        challengeId: selectedSharedInvite?.id,
        friendUid,
      });
      return;
    }

    if (!selectedSharedInvite) return;

    try {
      setSharedInviteSendingUid(friendUid);
      await inviteSharedChallengeMember(selectedSharedInvite.id, friendUid);
      setLocalSharedInviteUids((prev) => {
        const current = prev[selectedSharedInvite.id] ?? [];
        return {
          ...prev,
          [selectedSharedInvite.id]: Array.from(new Set([...current, friendUid])),
        };
      });
      setSharedInviteStatus(TXT.invitationSent);
    } catch (e: any) {
      showSharedInviteFailure(getSharedInviteErrorMessage(e), getSharedInviteCallableFailureReason(e), e);
    } finally {
      setSharedInviteSendingUid(null);
    }
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

  function applySharedCompletionLocally(item: SharedChallenge, uid: string, completedCount: number, dateISO: string) {
    const safeCount = Math.max(0, Math.min(item.targetPerDay, Math.floor(Number(completedCount) || 0)));
    const userProgress = {
      completedCount: safeCount,
      completed: safeCount >= item.targetPerDay,
      updatedAt: new Date(),
    };

    setSharedTodayMap((prev) => {
      const prevDay = prev[item.id];
      const prevUsers = prevDay?.users ?? {};
      return {
        ...prev,
        [item.id]: {
          date: dateISO,
          users: {
            ...prevUsers,
            [uid]: userProgress,
          },
          updatedAt: new Date(),
        },
      };
    });

    setSharedProgressMap((prev) => {
      const rows = prev[item.id] ?? [];
      const index = rows.findIndex((row) => String(row.date) === String(dateISO));
      const prevRow = index >= 0 ? rows[index] : null;
      const nextRow: SharedChallengeDayProgress = {
        date: dateISO,
        users: {
          ...(prevRow?.users ?? {}),
          [uid]: userProgress,
        },
        updatedAt: new Date(),
      };

      const nextRows = index >= 0 ? [...rows.slice(0, index), nextRow, ...rows.slice(index + 1)] : [...rows, nextRow];
      nextRows.sort((a, b) => String(a.date).localeCompare(String(b.date)));

      return {
        ...prev,
        [item.id]: nextRows,
      };
    });
  }

  async function markSharedDoneToday(item: SharedChallenge) {
    const me = auth.currentUser?.uid;
    if (!me) {
      Alert.alert(TXT.sharedChallenge, TXT.accountNotLogged);
      return;
    }

    const sharedDate = getSharedTodayISO();
    setSharedCompletingMap((prev) => ({ ...prev, [item.id]: true }));
    try {
      const status = await completeSharedChallengeForUid(me, item.id, sharedDate);
      if (status === "completed") {
        const cachedCount = Math.min(item.targetPerDay, getSharedUserCompletedCount(item, me) + 1);
        applySharedCompletionLocally(item, me, cachedCount, sharedDate);
        await updateAllOneMoreWidgets();
        void replaySharedCompletionsForCurrentUser(me).catch(() => {});
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } finally {
      setSharedCompletingMap((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
    if (me) return;

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

    if (sharedCompletingMap[item.id]) return;

    const today = getSharedTodayISO();
    const previousToday = sharedTodayMap[item.id];
    const previousProgress = sharedProgressMap[item.id];
    const hadProgress = Object.prototype.hasOwnProperty.call(sharedProgressMap, item.id);
    const optimisticCount = Math.min(item.targetPerDay, done + 1);

    setSharedCompletingMap((prev) => ({ ...prev, [item.id]: true }));
    applySharedCompletionLocally(item, me, optimisticCount, today);

    try {
      const nextCount = await completeSharedChallengeToday(item.id, today);
      applySharedCompletionLocally(item, me, nextCount, today);

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e: any) {
      setSharedTodayMap((prev) => ({
        ...prev,
        [item.id]: previousToday ?? null,
      }));
      setSharedProgressMap((prev) => {
        if (hadProgress) {
          return {
            ...prev,
            [item.id]: previousProgress ?? [],
          };
        }

        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      Alert.alert(TXT.sharedChallenge, e?.message ?? TXT.couldNotSaveCompletion);
    } finally {
      setSharedCompletingMap((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
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
    const challenge = getChallengeById(challengeId);
    if (s) {
      if (challenge?.period === FLEXIBLE_WEEKLY_PERIOD) {
        if (s.weeklyGoalMissed) return "weeklyGoalMissed";
        if ((s.completed ?? 0) > 0) return "completed";
        if (s.skipped) return "skipped";
        return "none";
      }
      const target = targetForChallenge(challengeId);
      if ((s.completed ?? 0) >= Math.max(1, target)) return "completed";
      if (s.skipped) return "skipped";
      return "none";
    }

    const c = challenge;
    if (c?.enabled === false || c?.deletedAt) return "none";
    if (c && !isChallengeActiveOnDate(c, date)) return "free";

    return "none";
  }

  const medalSummary = useMemo(
    () => medalDisplaySummaryFromHistory(appState, isChallengeActiveOnDate, tdy),
    [appState, isChallengeActiveOnDate, tdy]
  );
  const medalCollection = medalSummary.collection;
  const medalState = medalCollection.state;
  const bestStreak = medalSummary.currentStreak;

  function streakForChallenge(challengeId: string): number {
    return medalCollection.streaksByChallenge.get(String(challengeId))?.currentStreak ?? 0;
  }

  const medalOverview = useMemo(() => {
    const names = new Map<string, string>();

    for (const challenge of appState?.challenges ?? []) {
      names.set(String(challenge.id), String(challenge.text ?? "").trim());
    }
    for (const challenge of appState?.archivedChallenges ?? []) {
      if (!names.get(String(challenge.id))) {
        names.set(String(challenge.id), String(challenge.text ?? "").trim());
      }
    }
    for (const entry of appState?.history ?? []) {
      const id = String(entry.challengeId ?? "");
      if (id && !names.get(id)) {
        names.set(id, String(entry.challengeText ?? "").trim());
      }
    }

    const grouped = new Map<EarnedMedalTier, {
      challengeId: string;
      name: string;
      bestStreak: number;
      earnedCount: number;
    }[]>();

    for (const [challengeId, earned] of medalCollection.earnedByChallenge) {
      const bestStreak = medalCollection.streaksByChallenge.get(challengeId)?.bestStreak ?? 0;

      for (const medal of MEDAL_OVERVIEW_TIERS) {
        const earnedCount = earned[medal.tier];
        if (earnedCount < 1) continue;

        const list = grouped.get(medal.tier) ?? [];
        list.push({
          challengeId,
          name: names.get(challengeId) || TXT.medalChallengeFallback,
          bestStreak,
          earnedCount,
        });
        grouped.set(medal.tier, list);
      }
    }

    for (const list of grouped.values()) {
      list.sort((a, b) => b.bestStreak - a.bestStreak || a.name.localeCompare(b.name));
    }

    return grouped;
  }, [
    appState?.archivedChallenges,
    appState?.challenges,
    appState?.history,
    medalCollection.earnedByChallenge,
    medalCollection.streaksByChallenge,
    TXT.medalChallengeFallback,
  ]);

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
  return Object.values(medalState.counts).reduce((total, count) => total + count, 0);
}, [medalState.counts]);

const bestStreakForFriends = medalSummary.bestStreak;

const activeChallengesForFriends = useMemo(() => {
  const list = (appState?.challenges ?? []) as any[];
  return list.filter((c) => c && c.enabled !== false && !c.deletedAt).length;
}, [appState?.challenges]);

useEffect(() => {
  const uid = auth.currentUser?.uid;
  if (!cloudAllowed || !uid) return;
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
  cloudAllowed,
  cloudSessionEpoch,
]);

  function medalLabel(tier: MedalTier): string {
    const labels: Record<string, Record<MedalTier, string>> = {
      cs: {
        none: "Žádná",
        brambora: "Bramborová",
        steel: "Železná",
        bronze: "Bronzová",
        silver: "Stříbrná",
        gold: "Zlatá",
        diamond: "Diamantová",
      },
      en: {
        none: "None",
        brambora: "Potato",
        steel: "Iron",
        bronze: "Bronze",
        silver: "Silver",
        gold: "Gold",
        diamond: "Diamond",
      },
      pl: {
        none: "Brak",
        brambora: "Ziemniaczany",
        steel: "Żelazny",
        bronze: "Brązowy",
        silver: "Srebrny",
        gold: "Złoty",
        diamond: "Diamentowy",
      },
      de: {
        none: "Keine",
        brambora: "Kartoffel",
        steel: "Eisen",
        bronze: "Bronze",
        silver: "Silber",
        gold: "Gold",
        diamond: "Diamant",
      },
    };
    const byLang = labels[lang] ?? labels.cs;
    return byLang[tier] ?? byLang.none;
  }

  const selectedChallengeMedal: MedalTier = selectedId
    ? highestEarnedMedalForBestStreak(
        medalCollection.streaksByChallenge.get(String(selectedId))?.bestStreak ?? 0
      )
    : "none";

  const selectedChallengeBestStreak = useMemo(() => {
    if (!selectedId) return 0;
    return medalCollection.streaksByChallenge.get(String(selectedId))?.bestStreak ?? 0;
  }, [medalCollection.streaksByChallenge, selectedId]);

  const timeline = useMemo(() => {
    if (!selectedId) return [];

    const start = getStartDateForChallenge(selectedId);
    const totalDays = Math.max(0, daysBetween(start, tdy));

    const days: { date: string; status: DayStatus; time?: string; done?: number; target?: number; periodStart?: string; periodEnd?: string }[] = [];
    const target = targetForChallenge(selectedId);

    for (let i = 0; i <= totalDays; i++) {
      const d = addDaysISO(start, i);
      const sum = getDaySummary(selectedId, d);
      const st = dayStatus(selectedId, d);
      days.push({
        date: d,
        status: st,
        time: sum?.lastTime,
        done: sum?.weeklyGoalMissed
          ? sum.weeklyDone
          : getChallengeById(selectedId)?.period === FLEXIBLE_WEEKLY_PERIOD
          ? flexibleWeeklyProgress(getChallengeById(selectedId), historyEntries, d).done
          : sum?.completed ?? 0,
        target: sum?.weeklyGoalMissed
          ? sum.weeklyTarget
          : getChallengeById(selectedId)?.period === FLEXIBLE_WEEKLY_PERIOD
          ? flexibleWeeklyProgress(getChallengeById(selectedId), historyEntries, d).target
          : target,
        periodStart: sum?.weeklyPeriodStart,
        periodEnd: sum?.weeklyPeriodEnd,
      });
    }

    return newestChallengeTimelineFirst(days);
  }, [selectedId, tdy, dayIndex, appState?.challenges]);

 async function markDoneToday(challengeId: string) {
  const uid = auth.currentUser?.uid;
  if (uid) {
    const result = await completeChallengeForUid(uid, challengeId, tdy);
    if (result.status === "inactive") {
      Alert.alert(TXT.freeDay, TXT.freeRelax);
      return;
    }
    if (result.status === "completed") {
      setAppState(result.state);
      await updateAllOneMoreWidgets();
      const allVisible = (result.state.challenges ?? [])
        .filter((challenge) => challenge.enabled !== false && !isChallengeEasyMode(challenge));
      const visible = premium ? allVisible : allVisible.slice(0, FREE_MAX);
      const dayComplete = visible.length > 0 && visible
        .filter((challenge) => isChallengeActiveOnDate(challenge, tdy))
        .every((challenge) => {
          const target = Math.max(1, Math.floor(Number(challenge.targetPerDay ?? 1)) || 1);
          return result.state.history.filter((entry) =>
            entry.date === tdy && entry.status === "completed" &&
            String(entry.challengeId) === String(challenge.id)
          ).length >= target;
        });
      if (dayComplete) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        heroPulse.setValue(0);
        sparkle.setValue(0);
        Animated.parallel([
          Animated.sequence([
            Animated.timing(heroPulse, { toValue: 1, duration: 220, useNativeDriver: true }),
            Animated.timing(heroPulse, { toValue: 0, duration: 320, useNativeDriver: true }),
          ]),
          Animated.timing(sparkle, { toValue: 1, duration: 900, useNativeDriver: true }),
        ]).start(() => sparkle.setValue(0));
      }
    }
    return;
  }
  if (!uid) return;
  if (!appState) return;

  const challenge = (appState.challenges ?? []).find(
    (c) => String(c.id) === String(challengeId)
  );
  const challengeEasyMode = isChallengeEasyMode(challenge as any);

  if (challenge && !isChallengeActiveToday(challenge)) {
    Alert.alert(TXT.freeDay, TXT.freeRelax);
    return;
  }

  const target = Number((challenge as any)?.targetPerDay ?? 1);
  const targetSafe = Number.isFinite(target) && target > 0 ? Math.floor(target) : 1;

  const todayDone = (appState.history ?? []).filter(
    (h: any) =>
      String(h?.challengeId) === String(challengeId) &&
      h?.date === tdy &&
      h?.status === "completed"
  ).length;

  if (todayDone >= targetSafe) return;

  const nextDone = todayDone + 1;
  const completesDay = nextDone >= targetSafe;

  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;

  const cleaned = (appState.history ?? []).filter(
    (h: any) =>
      !(
        String(h?.challengeId) === String(challengeId) &&
        h?.date === tdy &&
        h?.status === "skipped"
      )
  );

  const ever = new Set<string>((appState.everCompletedKeys ?? []).map(String));

  // Důležité:
  // 1/3 a 2/3 jsou jen dílčí splnění.
  // Ohýnek, medaile a "držím se 1. den" se započítají až při 3/3.
  if (completesDay) {
    ever.add(`id:${String(challengeId)}`);
  }
  
  const next: AppState = {
    ...appState,

    // Streak/statistiky upravíme až ve chvíli, kdy je splněný celý den.
    challengeStats: completesDay
      ? updateStatsOnCompleted(appState, String(challengeId), tdy)
      : appState.challengeStats,

    history: [
      {
        date: tdy,
        time: hhmm,
        atISO: now.toISOString(),
        challengeId,
        challengeText: challenge?.text ?? "(smazaná výzva)",
        status: "completed",
        partial: !completesDay,
      },
      ...cleaned,
    ],

    // Kvůli starší kompatibilitě nastavujeme lastCompletedDate až při úplném dokončení dne.
    lastCompletedDate: completesDay && !challengeEasyMode ? tdy : appState.lastCompletedDate,

    everCompletedKeys: Array.from(ever),
  };

  setAppState(next);
  await saveState(next);

  const isDayCompleteNext = (() => {
    const enabled = (next.challenges ?? []).filter((c: any) => c.enabled !== false && !isChallengeEasyMode(c));
    const visible = premium ? enabled : enabled.slice(0, FREE_MAX);

    for (const c of visible as any[]) {
      const cid = String(c?.id ?? "");
      if (!cid) continue;

      if (!isChallengeActiveOnDate(c, tdy)) continue;

      const t = Number(c?.targetPerDay ?? 1);
      const target = Number.isFinite(t) && t > 0 ? Math.floor(t) : 1;

      const completed = (next.history ?? []).filter(
        (h: any) =>
          String(h?.challengeId) === cid &&
          h?.date === tdy &&
          h?.status === "completed"
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
        Animated.timing(heroPulse, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(heroPulse, {
          toValue: 0,
          duration: 320,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(sparkle, {
        toValue: 1,
        duration: 900,
        useNativeDriver: true,
      }),
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

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={TXT.medalOverviewTitle}
            onPress={() => setMedalsOverviewOpen(true)}
            style={({ pressed }) => [styles.medalsRow, pressed && { opacity: 0.78 }]}
          >
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
                {medalBadgeCount(medalState.counts.brambora) > 1
                  ? `×${medalBadgeCount(medalState.counts.brambora)}`
                  : ""}
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
                {medalBadgeCount(medalState.counts.steel) > 1
                  ? `×${medalBadgeCount(medalState.counts.steel)}`
                  : ""}
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
                {medalBadgeCount(medalState.counts.bronze) > 1
                  ? `×${medalBadgeCount(medalState.counts.bronze)}`
                  : ""}
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
                {medalBadgeCount(medalState.counts.silver) > 1
                  ? `×${medalBadgeCount(medalState.counts.silver)}`
                  : ""}
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
                {medalBadgeCount(medalState.counts.gold) > 1
                  ? `×${medalBadgeCount(medalState.counts.gold)}`
                  : ""}
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
                {medalBadgeCount(medalState.counts.diamond) > 1
                  ? `×${medalBadgeCount(medalState.counts.diamond)}`
                  : ""}
              </Text>
            </View>
          </Pressable>
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
{bestStreak}. {TXT.dayWord}
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
              <Text style={styles.reorderDoneText}>{TXT.doneAction}</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Modal
        visible={medalsOverviewOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMedalsOverviewOpen(false)}
      >
        <View style={styles.backdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setMedalsOverviewOpen(false)}
          />
          <View
            style={[
              styles.sheet,
              {
                bottom: Math.max(12, insets.bottom + 12),
                maxHeight: Math.min(
                  windowHeight * 0.8,
                  windowHeight - insets.top - insets.bottom - 24
                ),
              },
            ]}
          >
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: UI.accent }]}>
                {TXT.medalOverviewTitle}
              </Text>
              <Pressable
                onPress={() => setMedalsOverviewOpen(false)}
                style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.88 }]}
              >
                <Text style={styles.closeText}>{TXT.close}</Text>
              </Pressable>
            </View>

            <Text style={styles.medalOverviewHint}>
              {TXT.medalOverviewHint}
            </Text>

            <ScrollView
              style={{ flexShrink: 1, minHeight: 0 }}
              nestedScrollEnabled={true}
              scrollEnabled={true}
              showsVerticalScrollIndicator={true}
              persistentScrollbar={true}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                paddingBottom: Math.max(96, insets.bottom + 96),
              }}
            >
              {MEDAL_OVERVIEW_TIERS.map((medal) => {
                const challenges = medalOverview.get(medal.tier) ?? [];

                return (
                  <View key={medal.tier} style={styles.medalOverviewTier}>
                    <View style={styles.medalOverviewHeader}>
                      <View style={styles.medalOverviewIconWrap}>
                        <Image source={medal.image} style={styles.medalOverviewIcon} />
                        {medalBadgeCount(medalState.counts[medal.tier]) > 1 && (
                          <View style={styles.medalOverviewBadge}>
                            <Text style={styles.medalOverviewBadgeText}>
                              {`×${medalBadgeCount(medalState.counts[medal.tier])}`}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.medalOverviewTitle}>
                        {`${medal.days} ${TXT.medalDays} — ${medalLabel(medal.tier)}`}
                      </Text>
                    </View>

                    {challenges.length ? (
                      challenges.map((challenge) => (
                        <Text
                          key={challenge.challengeId}
                          style={styles.medalOverviewChallenge}
                        >
                          {`${challenge.name}${medalBadgeCount(challenge.earnedCount) > 1 ? ` ×${medalBadgeCount(challenge.earnedCount)}` : ""} — ${TXT.medalBestStreak} ${challenge.bestStreak} ${TXT.medalDays}`}
                        </Text>
                      ))
                    ) : (
                      <Text style={styles.medalOverviewEmpty}>
                        {TXT.medalNoChallenges}
                      </Text>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

   <Modal
  visible={addModalOpen}
  transparent
  animationType="fade"
  onRequestClose={() => {
    setAddModalOpen(false);
    setAddModalText("");
  }}
>
  <KeyboardAvoidingView
    style={{ flex: 1 }}
    behavior="height"
    keyboardVerticalOffset={0}
  >
    <Pressable style={styles.keyboardBackdrop}>
          <Pressable style={[styles.sheet, styles.keyboardSheet]} onPress={() => {}}>
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

            <ScrollView
              ref={addScrollRef}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets={false}
            >
              <TextInput
                value={addModalText}
                onChangeText={setAddModalText}
                placeholder={TXT.namePlaceholder}
                placeholderTextColor={UI.sub}
                style={[styles.input, { color: UI.text, borderColor: UI.stroke }]}
                onFocus={() => requestAnimationFrame(() => addScrollRef.current?.scrollTo({ y: 0, animated: true }))}
                autoCapitalize="sentences"
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (addModalText.trim() && !addSaving) void addChallengeFromHero();
                }}
              />

              <Pressable
                onPress={() => void addChallengeFromHero()}
                disabled={!addModalText.trim() || addSaving}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  (!addModalText.trim() || addSaving) && { opacity: 0.5 },
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Text style={styles.primaryBtnText}>{TXT.add}</Text>
              </Pressable>
            </ScrollView>
          </Pressable>
           </Pressable>
  </KeyboardAvoidingView>
</Modal>

      <Modal visible={manageOpen} transparent animationType="fade" onRequestClose={manageSaving ? () => {} : closeManage}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior="height"
          keyboardVerticalOffset={0}
        >
        <Pressable style={styles.keyboardBackdrop} onPress={manageSaving ? () => {} : closeManage}>
          <Pressable style={[styles.sheet, styles.keyboardSheet]} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: UI.accent }]}>{TXT.manageTitle}</Text>
              <Pressable disabled={manageSaving} onPress={closeManage} style={({ pressed }) => [styles.closeBtn, manageSaving && { opacity: 0.5 }, pressed && { opacity: 0.88 }]}>
                <Text style={styles.closeText}>{TXT.close}</Text>
              </Pressable>
            </View>

            <ScrollView
              ref={manageScrollRef}
              pointerEvents={manageSaving ? "none" : "auto"}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets={false}
              contentContainerStyle={{ paddingBottom: Math.max(32, insets.bottom + 20) }}
            >
              <TextInput
                value={manageRename}
                onChangeText={(value) => {
                  manageRenameDraft.current.set(value);
                  setManageRename(value);
                }}
                editable={!manageSaving}
                placeholder={TXT.namePlaceholder}
                placeholderTextColor={UI.sub}
                style={[styles.input, { color: UI.text, borderColor: UI.stroke }]}
                onFocus={() => requestAnimationFrame(() => manageScrollRef.current?.scrollTo({ y: 0, animated: true }))}
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
                <Text style={[styles.modalLabel, { color: UI.text }]}>{TXT.easyMode}</Text>
                {manageEasyMode ? (
                  <Text style={[styles.modalLabel, { color: UI.accent }]}>
                    {TXT.easyModeActive}
                  </Text>
                ) : (
                  <Switch
  value={manageEasyMode}
  disabled={manageEasyMode}
  onValueChange={(v) => {
    if (!v || manageEasyMode) {
      return;
    }

    setTimeout(() => {
      confirmEnableEasyMode();
    }, 80);
  }}
/>
                )}
              </View>

              <View style={styles.modalRow}>
                <Text style={[styles.modalLabel, { color: UI.text }]}>
                  {managePeriod === FLEXIBLE_WEEKLY_PERIOD ? t.flexibleWeekly.weeklyCount : TXT.perDayCount}
                </Text>
                <View style={styles.countRow}>
                  <Pressable
                    onPress={() => {
                      const next = managePeriod === FLEXIBLE_WEEKLY_PERIOD
                        ? clampFlexibleWeeklyTarget(manageTarget - 1)
                        : clamp(manageTarget - 1, 1, 20);
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
                      const next = managePeriod === FLEXIBLE_WEEKLY_PERIOD
                        ? Math.min(7, manageTarget + 1)
                        : clamp(manageTarget + 1, 1, 20);
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
                    {managePeriod === "daily" ? TXT.daily : managePeriod === "every2" ? TXT.every2 : managePeriod === FLEXIBLE_WEEKLY_PERIOD ? t.flexibleWeekly.label : TXT.customDays}
                  </Text>
                  <Ionicons name="chevron-down" size={18} color={UI.text} />
                </Pressable>
              </View>

              {managePeriod === "custom" && (
                <View style={{ marginTop: 8, marginBottom: 2 }}>
                  <Text style={styles.modalHint}>{TXT.chooseDaysHint}</Text>
                  <View style={styles.pills}>
                    {[
  {
    k: 0,
    t:
      lang === "en" ? "Mon" :
      lang === "pl" ? "Pn" :
      lang === "de" ? "Mo" :
      "Po",
  },
  {
    k: 1,
    t:
      lang === "en" ? "Tue" :
      lang === "pl" ? "Wt" :
      lang === "de" ? "Di" :
      "Út",
  },
  {
    k: 2,
    t:
      lang === "en" ? "Wed" :
      lang === "pl" ? "Śr" :
      lang === "de" ? "Mi" :
      "St",
  },
  {
    k: 3,
    t:
      lang === "en" ? "Thu" :
      lang === "pl" ? "Cz" :
      lang === "de" ? "Do" :
      "Čt",
  },
  {
    k: 4,
    t:
      lang === "en" ? "Fri" :
      lang === "pl" ? "Pt" :
      lang === "de" ? "Fr" :
      "Pá",
  },
  {
    k: 5,
    t:
      lang === "en" ? "Sat" :
      lang === "pl" ? "So" :
      lang === "de" ? "Sa" :
      "So",
  },
  {
    k: 6,
    t:
      lang === "en" ? "Sun" :
      lang === "pl" ? "Nd" :
      lang === "de" ? "So" :
      "Ne",
  },
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

              {managePeriod === FLEXIBLE_WEEKLY_PERIOD && (
                <View style={{ marginTop: 8, marginBottom: 2 }}>
                  <Text style={[styles.modalLabel, { color: UI.text }]}>{t.flexibleWeekly.firstPeriodDay}</Text>
                  <Text style={styles.modalHint}>{t.flexibleWeekly.chooseFirstDayHint}</Text>
                  <View style={styles.pills}>
                    {[
                      lang === "en" ? "Mon" : lang === "pl" ? "Pn" : lang === "de" ? "Mo" : "Po",
                      lang === "en" ? "Tue" : lang === "pl" ? "Wt" : lang === "de" ? "Di" : "Út",
                      lang === "en" ? "Wed" : lang === "pl" ? "Śr" : lang === "de" ? "Mi" : "St",
                      lang === "en" ? "Thu" : lang === "pl" ? "Cz" : lang === "de" ? "Do" : "Čt",
                      lang === "en" ? "Fri" : lang === "pl" ? "Pt" : lang === "de" ? "Fr" : "Pá",
                      lang === "en" ? "Sat" : lang === "pl" ? "So" : lang === "de" ? "Sa" : "So",
                      lang === "en" ? "Sun" : lang === "pl" ? "Nd" : lang === "de" ? "So" : "Ne",
                    ].map((label, day) => {
                      const active = manageFlexibleStartDay === day;
                      return (
                        <Pressable
                          key={day}
                          onPress={() => void saveFlexibleStartDayImmediate(day)}
                          style={({ pressed }) => [styles.pill, active && styles.pillActive, pressed && { opacity: 0.9 }]}
                        >
                          <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {!!managed?.flexibleWeeklyPending?.effectiveFrom && (
                    <Text style={styles.modalHint}>
                      {t.flexibleWeekly.changeAppliesFrom.replace("{date}", String(managed.flexibleWeeklyPending.effectiveFrom))}
                    </Text>
                  )}
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
      setManageReminderRows([]);
      return;
    }

    const maxN = managePeriod === FLEXIBLE_WEEKLY_PERIOD ? 7 : Math.min(10, manageTarget);

    setManageRemCount((n) => clamp(n || 1, 1, maxN));

    setManageRemTimes((prev) => {
      const safe = Array.isArray(prev)
        ? prev.filter((t) => typeof t === "string" && /^\d{2}:\d{2}$/.test(t))
        : [];

      if (safe.length > 0) return safe.slice(0, maxN);

      return [nowHM()];
    });
  }}
/>
              </View>

              {manageRemEnabled && (
                <>
                  {managePeriod === FLEXIBLE_WEEKLY_PERIOD && (
                    <View style={{ marginTop: 8 }}>
                      <Text style={[styles.modalLabel, { color: UI.text }]}>
                        {t.flexibleWeekly.notificationDays}
                      </Text>
                      <Text style={styles.modalHint}>{t.flexibleWeekly.notificationRowsHint}</Text>
                      {manageReminderRows.map((row, index) => (
                        <View key={`${row.weekday}-${index}`}>
                          <View style={styles.flexibleReminderRow}>
                            <Pressable
                              accessibilityLabel={t.flexibleWeekly.notificationDay}
                              onPress={() => setManageReminderDayPickerIndex((current) => current === index ? null : index)}
                              style={({ pressed }) => [styles.timeRow, styles.flexibleReminderDay, { marginTop: 0 }, pressed && { opacity: 0.9 }]}
                            >
                              <Text style={{ color: UI.text, fontWeight: "900" }}>{t.flexibleWeekly.weekdays[row.weekday - 1]}</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => {
                                setTimePickerIndex(index);
                                const d = new Date();
                                d.setHours(row.hour, row.minute, 0, 0);
                                setTimePickerValue(d);
                                setTimePickerOpen(true);
                                requestAnimationFrame(() => manageScrollRef.current?.scrollToEnd({ animated: true }));
                              }}
                              style={({ pressed }) => [styles.timeRow, styles.flexibleReminderTime, { marginTop: 0 }, pressed && { opacity: 0.9 }]}
                            >
                              <Text style={{ color: UI.text, fontWeight: "900" }}>{flexibleReminderRowTime(row)}</Text>
                              <Ionicons name="time" size={18} color={UI.text} />
                            </Pressable>
                            <Pressable
                              accessibilityLabel={t.flexibleWeekly.removeNotificationRow}
                              onPress={() => setManageReminderRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                              style={({ pressed }) => [styles.flexibleReminderRemove, pressed && { opacity: 0.6 }]}
                            >
                              <Ionicons name="trash-outline" size={20} color={UI.text} />
                            </Pressable>
                          </View>
                          {manageReminderDayPickerIndex === index && (
                            <View style={styles.pills}>
                              {t.flexibleWeekly.weekdays.map((label, weekdayIndex) => {
                                const weekday = weekdayIndex + 1;
                                const used = manageReminderRows.some((candidate, candidateIndex) => candidateIndex !== index && candidate.weekday === weekday);
                                return (
                                  <Pressable
                                    key={weekday}
                                    disabled={used}
                                    onPress={() => {
                                      setManageReminderRows((current) => current.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, weekday } : candidate));
                                      setManageReminderDayPickerIndex(null);
                                    }}
                                    style={[styles.pill, row.weekday === weekday && styles.pillActive, used && { opacity: 0.35 }]}
                                  >
                                    <Text style={[styles.pillText, row.weekday === weekday && styles.pillTextActive]}>{label}</Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          )}
                        </View>
                      ))}
                      {manageReminderRows.length < 7 && (
                        <Pressable
                          onPress={() => {
                            const now = new Date();
                            setManageReminderRows((current) => {
                              const weekday = [1, 2, 3, 4, 5, 6, 7].find((value) => !current.some((row) => row.weekday === value));
                              return weekday ? [...current, { weekday, hour: now.getHours(), minute: now.getMinutes() }] : current;
                            });
                            setManageReminderDayPickerIndex(null);
                          }}
                          style={({ pressed }) => [styles.secondaryBtn, { alignSelf: "flex-start", marginTop: 10 }, pressed && { opacity: 0.88 }]}
                        >
                          <Text style={styles.secondaryBtnText}>{t.flexibleWeekly.addNotificationRow}</Text>
                        </Pressable>
                      )}
                    </View>
                  )}

                  {managePeriod !== FLEXIBLE_WEEKLY_PERIOD && (
                    <>
                      <Text style={styles.modalHint}>{TXT.notificationCount}: max {Math.min(10, manageTarget)}</Text>

                      <View style={styles.pills}>
                        {Array.from({ length: Math.min(10, manageTarget) }, (_, i) => i + 1).map((n) => {
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
                    </>
                  )}

                  {managePeriod !== FLEXIBLE_WEEKLY_PERIOD && Array.from({ length: manageRemCount }, (_, i) => i).map((i) => {
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

                         <Pressable disabled={manageSaving} onPress={() => void applyManageReminders()} style={({ pressed }) => [styles.primaryBtn, manageSaving && { opacity: 0.55 }, pressed && { opacity: 0.9 }]}>
                    <Text style={styles.primaryBtnText}>{manageSaving ? TXT.saving : TXT.saveNotifications}</Text>
                  </Pressable>
                </>
              )}

              {!manageRemEnabled && (
                <Pressable
                  onPress={() => void applyManageReminders()}
                  disabled={manageSaving}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    manageSaving && { opacity: 0.55 },
                    pressed && { opacity: 0.9 },
                  ]}
                >
                  <Text style={styles.primaryBtnText}>{manageSaving ? TXT.saving : TXT.saveNotifications}</Text>
                </Pressable>
              )}

              {!!manageSaveConfirmation && (
                <Text style={styles.saveConfirmation}>{manageSaveConfirmation}</Text>
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
  { k: FLEXIBLE_WEEKLY_PERIOD, t: t.flexibleWeekly.label },
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
                        if (opt.k === FLEXIBLE_WEEKLY_PERIOD) {
                          const nextTarget = clampFlexibleWeeklyTarget(manageTarget);
                          setManageTarget(nextTarget);
                          void savePeriodImmediate(FLEXIBLE_WEEKLY_PERIOD);
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
                  if (managePeriod === FLEXIBLE_WEEKLY_PERIOD) {
                    setManageReminderRows((prev) => prev.map((row, index) =>
                      index === timePickerIndex ? { ...row, hour: Number(hh), minute: Number(mm) } : row));
                  }
                  setTimePickerOpen(false);
                }}
              />
            )}
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

{sharedTimePickerOpen && (
  <DateTimePicker
    value={sharedTimePickerValue}
    mode="time"
    is24Hour
    display="spinner"
    onChange={(e: DateTimePickerEvent, date?: Date) => {
      if (e.type === "dismissed") {
        setSharedTimePickerOpen(false);
        return;
      }

      const d = date ?? sharedTimePickerValue;
      const hh = pad2(d.getHours());
      const mm = pad2(d.getMinutes());

      setSharedNotificationSetting((prev) => {
        const nextTimes = Array.isArray(prev.times) ? [...prev.times] : [];

        while (nextTimes.length <= sharedTimePickerIndex) {
          nextTimes.push(nowHM());
        }

        nextTimes[sharedTimePickerIndex] = `${hh}:${mm}`;

        return {
          ...prev,
          times: nextTimes,
        };
      });

      setSharedTimePickerOpen(false);
    }}
  />
)}
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

            <ScrollView
              style={styles.historyScroll}
              contentContainerStyle={styles.historyScrollContent}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {!selectedId ? (
                <Text style={styles.modalHint}>{TXT.chooseHistoryChallenge}</Text>
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

                  {(timeline as any[]).map((d: any) => (
                    <View key={d.date} style={styles.historyRow}>
                      <Text style={styles.historyDate}>{d.date}</Text>
                      <Text style={styles.historyStatus}>
                        {d.status === "completed"
                          ? `${TXT.completed} ${d.done ?? 0}/${d.target ?? 1}${d.time ? ` • ${d.time}` : ""}`
                          : d.status === "weeklyGoalMissed"
                            ? formatFlexibleWeeklyMissedLabel({
                                template: t.flexibleWeekly.weeklyGoalMissed,
                                lang,
                                start: String(d.periodStart ?? d.date),
                                end: String(d.periodEnd ?? d.date),
                                done: Number(d.done ?? 0),
                                target: Number(d.target ?? 1),
                              })
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

      <Modal
        visible={sharedMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={closeSharedMenu}
      >
        <Pressable style={styles.backdrop} onPress={closeSharedMenu}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: UI.accent }]}>
                {selectedSharedMenu?.title ?? TXT.sharedChallenge}
              </Text>

              <Pressable
                onPress={closeSharedMenu}
                style={({ pressed }) => [
                  styles.closeBtn,
                  pressed && { opacity: 0.88 },
                ]}
              >
                <Text style={styles.closeText}>{TXT.close}</Text>
              </Pressable>
            </View>

            <Pressable
  onPress={() => {
    setSharedMenuOpen(false);
    setTimeout(() => {
      openSharedNotificationSettings();
    }, 200);
  }}
              style={({ pressed }) => [
                styles.secondaryBtn,
                pressed && { opacity: 0.88 },
              ]}
            >
              <Ionicons name="notifications" size={18} color={UI.text} />
              <Text style={styles.secondaryBtnText}>{TXT.notifications}</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                const item = selectedSharedMenu;
                closeSharedMenu();
                if (item) confirmLeaveShared(item);
              }}
              style={({ pressed }) => [
                styles.dangerBtn,
                pressed && { opacity: 0.88 },
              ]}
            >
              <Ionicons name="exit-outline" size={18} color="#fff" />
              <Text style={styles.dangerBtnText}>{TXT.leave}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={
          sharedInviteOpen &&
          !!selectedSharedInvite &&
          canInviteToSharedChallenge(selectedSharedInvite)
        }
        transparent
        animationType="fade"
        onRequestClose={closeSharedInviteModal}
      >
        <Pressable style={styles.backdrop} onPress={closeSharedInviteModal}>
          <Pressable
            style={[
              styles.sheet,
              { bottom: Math.max(28, insets.bottom + 28), maxHeight: "72%" },
            ]}
            onPress={() => {}}
          >
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: UI.accent }]}>
                {TXT.inviteFriend}
              </Text>

              <Pressable
                onPress={closeSharedInviteModal}
                style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.88 }]}
              >
                <Text style={styles.closeText}>{TXT.close}</Text>
              </Pressable>
            </View>

            {!!sharedInviteStatus && (
              <Text style={[styles.modalHint, { color: UI.accent }]}>
                {sharedInviteStatus}
              </Text>
            )}

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: Math.max(24, insets.bottom + 24) }}
            >
              {getEligibleSharedInviteFriends(selectedSharedInvite).length ? (
                getEligibleSharedInviteFriends(selectedSharedInvite).map((edge) => {
                  const uid = String(edge.otherUid);
                  const sending = sharedInviteSendingUid === uid;
                  const busy = !!sharedInviteSendingUid;

                  return (
                    <View key={uid} style={styles.modalRow}>
                      <Text style={[styles.modalLabel, { color: UI.text, flex: 1 }]} numberOfLines={1}>
                        {getSharedDisplayName(uid)}
                      </Text>

                      <Pressable
                        disabled={busy}
                        onPress={() => void sendSharedMemberInvite(uid)}
                        style={({ pressed }) => [
                          styles.sharedDoneBtn,
                          busy && { opacity: 0.55 },
                          pressed && !busy && { opacity: 0.9 },
                        ]}
                      >
                        <Text style={styles.sharedDoneBtnText}>
                          {sending ? "..." : TXT.invite}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })
              ) : (
                <Text style={styles.modalHint}>{TXT.noFriendsToInvite}</Text>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={sharedNotificationOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSharedNotificationOpen(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setSharedNotificationOpen(false)}
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: UI.accent }]}>
                {TXT.notifications}
              </Text>

              <Pressable
                onPress={() => setSharedNotificationOpen(false)}
                style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.88 }]}
              >
                <Text style={styles.closeText}>{TXT.close}</Text>
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={{
                paddingBottom: Math.max(18, insets.bottom + 18),
              }}
            >
              <View style={styles.modalRow}>
              <Text style={[styles.modalLabel, { color: UI.text }]}>
                {TXT.notifications}
              </Text>

              <Switch
                value={sharedNotificationSetting.enabled}
                onValueChange={(v) => {
                  setSharedNotificationSetting((prev) => ({
                    ...prev,
                    enabled: v,
                    count: v ? Math.max(1, prev.count || 1) : 1,
                    times: v ? prev.times : [],
                  }));
                }}
              />
            </View>

            {sharedNotificationSetting.enabled && (
              <>
                <Text style={styles.modalHint}>
                  {TXT.notificationCount}
                </Text>

                <View style={styles.pills}>
                  {Array.from(
  { length: Math.max(1, Number(selectedSharedMenu?.targetPerDay ?? 1)) },
  (_, i) => i + 1
).map((n) => {
                    const active = sharedNotificationSetting.count === n;

                    return (
                      <Pressable
                        key={n}
                        onPress={() => {
                          setSharedNotificationSetting((prev) => {
                            const nextTimes = [...(prev.times ?? [])];

                            while (nextTimes.length < n) {
                              nextTimes.push(nowHM());
                            }

                            return {
                              ...prev,
                              count: n,
                              times: nextTimes.slice(0, n),
                            };
                          });
                        }}
                        style={({ pressed }) => [
                          styles.pill,
                          active && styles.pillActive,
                          pressed && { opacity: 0.9 },
                        ]}
                      >
                        <Text style={[styles.pillText, active && styles.pillTextActive]}>
                          #{n}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {Array.from(
                  { length: sharedNotificationSetting.count },
                  (_, i) => i
                ).map((i) => {
                  const value = sharedNotificationSetting.times?.[i] ?? nowHM();

                  return (
                    <Pressable
                      key={i}
                     onPress={() => {
  setSharedTimePickerIndex(i);

  const [hh, mm] = String(value).split(":").map(Number);
  const d = new Date();

  if (Number.isFinite(hh)) d.setHours(hh);
  if (Number.isFinite(mm)) d.setMinutes(mm);

  setSharedTimePickerValue(d);
  setSharedTimePickerOpen(true);
}}
                      style={({ pressed }) => [
                        styles.timeRow,
                        pressed && { opacity: 0.9 },
                      ]}
                    >
                      <Text style={[styles.timeIndex, { color: UI.text }]}>
                        #{i + 1}
                      </Text>
                      <Text style={{ color: UI.text, fontWeight: "900" }}>
                        {value}
                      </Text>
                      <Ionicons name="time" size={18} color={UI.text} />
                    </Pressable>
                  );
                })}
              </>
            )}

            <Pressable
            onPress={async () => {
  if (!selectedSharedMenu?.id) return;

  if (!premium && sharedNotificationSetting.enabled) {
    const normalActiveId = getFreeActiveReminderChallengeId(appState as any);
    const otherSharedActive = await hasOtherActiveSharedNotification(
      selectedSharedMenu.id
    );

    if (normalActiveId || otherSharedActive) {
      Alert.alert(
        TXT.notifications,
        TXT.notificationFreeLimit
      );
      return;
    }
  }

try {
  // vždy nejdřív smaž staré
  await clearSharedRemindersForChallenge(
    selectedSharedMenu.id
  );

  if (sharedNotificationSetting.enabled && sharedNotificationSetting.times.length) {
    await setSharedRemindersForChallenge(
      selectedSharedMenu.id,
      selectedSharedMenu.title ?? "Shared challenge",
      sharedNotificationSetting.times,
      selectedSharedMenu
    );
  }

  await saveSharedNotificationSetting(
    selectedSharedMenu.id,
    sharedNotificationSetting
  );
} catch (error: any) {
  const message = String(error?.message ?? "");

  if (message.includes("NOTIFICATIONS_PERMISSION_DENIED")) {
    const disabledSetting = {
      ...sharedNotificationSetting,
      enabled: false,
      count: 1,
      times: [],
    };
    setSharedNotificationSetting(disabledSetting);
    try {
      await saveSharedNotificationSetting(
        selectedSharedMenu.id,
        disabledSetting
      );
    } catch {}
    Alert.alert(TXT.notifications, TXT.notificationPermissionDenied);
  } else {
    Alert.alert(TXT.notifications, TXT.notificationsFailed);
  }
  return;
}

                setSharedNotificationOpen(false);

                Alert.alert(
                  TXT.notifications,
                  sharedNotificationSetting.enabled
                    ? TXT.sharedNotificationsSaved
                    : TXT.sharedNotificationsOff
                );
              }}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && { opacity: 0.9 },
              ]}
            >
              <Text style={styles.primaryBtnText}>
                {TXT.saveNotifications}
              </Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {sharedTimePickerOpen && (
  <DateTimePicker
    value={sharedTimePickerValue}
    mode="time"
    is24Hour
    display="spinner"
    onChange={(e: DateTimePickerEvent, date?: Date) => {
      if (e.type === "dismissed") {
        setSharedTimePickerOpen(false);
        return;
      }

      const d = date ?? sharedTimePickerValue;
      const hh = pad2(d.getHours());
      const mm = pad2(d.getMinutes());

      setSharedNotificationSetting((prev) => {
        const nextTimes = Array.isArray(prev.times) ? [...prev.times] : [];

        while (nextTimes.length <= sharedTimePickerIndex) {
          nextTimes.push(nowHM());
        }

        nextTimes[sharedTimePickerIndex] = `${hh}:${mm}`;

        return {
          ...prev,
          times: nextTimes,
        };
      });

      setSharedTimePickerOpen(false);
    }}
  />
)}

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
            ListFooterComponent={
              <>
                {!!visibleSharedChallenges.length && (
                  <View style={styles.sharedWrap}>
                    <Text style={styles.sharedSectionTitle}>{TXT.sharedChallenges}</Text>

                    {visibleSharedChallenges.map((item, sharedIndex) => {
  const lockedByFree = !premium && sharedIndex >= FREE_SHARED_MAX;
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
                      const compactMemberRow = memberRows.length <= 3;

                      const myDone = getSharedUserCompletedCount(item, me);
                      const activeToday = isSharedChallengeActiveOnDate(item, getSharedTodayISO());
                      const myDoneToday = myDone >= item.targetPerDay;
                      const sharedCompleting = !!sharedCompletingMap[item.id];
                      const expanded = expandedSharedId === item.id;
                      const iAccepted = item.acceptedBy.includes(me);
                      const pending = item.status === "pending";
                      const canShowSharedInviteButton =
                        canInviteToSharedChallenge(item) &&
                        getEligibleSharedInviteFriends(item).length > 0;

                      return (
                        <View key={item.id} style={styles.sharedCardOuter}>
                          <View style={styles.sharedCardInner}>
                            <View style={styles.sharedCompactRow}>
                              <Pressable
  onPress={() => {
    if (lockedByFree) {
      Alert.alert(
        TXT.premium,
        lang === "cs"
          ? "Tahle společná výzva je uložená, ale ve Free verzi je zamčená. Obnov Premium a znovu se odemkne."
          : "This shared challenge is saved, but locked in the Free version. Restore Premium to unlock it again."
      );
      return;
    }

    openSharedMenu(item);
  }}
  style={({ pressed }) => [
    styles.sharedCompactLeft,
    pressed && { opacity: 0.88 },
  ]}
>
                                

                              <Text style={styles.sharedTitle} numberOfLines={1}>
  {lockedByFree ? "🔒 " : ""}
  {item.title}
</Text>

                                <View style={styles.sharedFriendLine}>
                                  <Text style={styles.sharedFriendLineText} numberOfLines={1}>
                                    {`S: ${getSharedDisplayName(
                                      item.memberUids.find((uid) => String(uid) !== String(auth.currentUser?.uid ?? "")) ?? ""
                                    )}`}
                                  </Text>

                                  {canShowSharedInviteButton && (
                                    <Pressable
                                      onPress={(e) => {
                                        e.stopPropagation();
                                        openSharedInviteModal(item);
                                      }}
                                      style={({ pressed }) => [
                                        styles.sharedInviteMiniBtn,
                                        pressed && { opacity: 0.88 },
                                      ]}
                                      hitSlop={8}
                                    >
                                      <Ionicons name="add" size={16} color="#111827" />
                                    </Pressable>
                                  )}
                                </View>
                              </Pressable>
<View style={styles.sharedActionsRow}>

<Pressable
  disabled={sharedCompleting || myDoneToday}
  onPress={() => {
    if (false && lockedByFree) {
      Alert.alert(
        TXT.premium,
        lang === "cs"
          ? "Tahle společná výzva je ve Free verzi zamčená. Obnov Premium a můžeš v ní pokračovat."
          : "This shared challenge is locked in the Free version. Restore Premium to continue."
      );
      return;
    }

    void markSharedDoneToday(item);
  }}
  style={({ pressed }) => [
    styles.sharedDoneBtn,
    false && lockedByFree && {
      backgroundColor: UI.card2,
      borderColor: UI.stroke,
      opacity: 0.55,
    },
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
    sharedCompleting && {
      backgroundColor: UI.card2,
      borderColor: UI.stroke,
      opacity: 0.78,
    },
    pressed && !myDoneToday && !sharedCompleting && activeToday && { opacity: 0.9 },
  ]}
>
  <Text
    style={[
      styles.sharedDoneBtnText,
      (myDoneToday || sharedCompleting || !activeToday) && { color: UI.sub },
    ]}
  >
    {false && lockedByFree
      ? TXT.premium
      : myDoneToday || sharedCompleting
        ? TXT.done
        : !activeToday
          ? TXT.freeDay
          : TXT.complete}
  </Text>
</Pressable>

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

                                      
                                    </View>

     <View style={styles.sharedMembersGrid}>
  {memberRows.map((member, memberIndex) => {
    const colIndex = memberIndex % 5;
    const isLastInRow =
      compactMemberRow ? memberIndex === memberRows.length - 1 : colIndex === 4;

    return (
      <View
        key={member.uid}
        style={[
          styles.sharedMemberCol,
          compactMemberRow && styles.sharedMemberColCompact,
          isLastInRow && styles.sharedMemberColLastInRow,
        ]}
      >
       <View style={styles.sharedMemberTop}>
  <Text style={styles.sharedPlayerName} numberOfLines={1} ellipsizeMode="tail">
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
              const lockedByFree = !premium && index >= FREE_MAX;
              const id = String(item.id);
              const ratio = progressRatioForCell(id);
              const streak = streakForChallenge(id);
              const done = completedTodayCount(id);
              const target = targetForChallenge(id);

              const isDisabled = item.enabled === false;
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
  style={[
    styles.rowOuter,
    item.enabled === false && { opacity: 0.35 },
    lockedByFree && { opacity: 0.55 },
  ]}
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

  if (lockedByFree) {
    Alert.alert(
      TXT.premium,
      lang === "cs"
        ? "Tahle výzva je uložená, ale ve Free verzi je zamčená. Přesuň ji mezi první 2 výzvy nebo obnov Premium."
        : "This challenge is saved, but locked in the Free version. Move it into the first 2 challenges or restore Premium."
    );
    return;
  }

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
  {lockedByFree ? "🔒 " : ""}
  {challengeDisplayText(item as any)}
</Text>
                           <Text style={styles.rowDoneSmall}>
  {lockedByFree
    ? lang === "cs"
      ? "Zamčeno ve Free verzi"
      : "Locked in Free version"
    : isDisabled
      ? TXT.challengeOff
    : activeToday
      ? item.period === FLEXIBLE_WEEKLY_PERIOD
        ? t.flexibleWeekly.weeklyProgress.replace("{done}", String(done)).replace("{target}", String(Math.max(1, target)))
        : `${TXT.addTodayCount} ${done}/${Math.max(1, target)}`
      : TXT.freeRelax}
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
  if (isDisabled) return;

  if (lockedByFree) {
    Alert.alert(
      TXT.premium,
      lang === "cs"
        ? "Tahle výzva je ve Free verzi zamčená. Přesuň ji mezi první 2 výzvy nebo obnov Premium."
        : "This challenge is locked in the Free version. Move it into the first 2 challenges or restore Premium."
    );
    return;
  }

  if (!activeToday) {
    Alert.alert(TXT.freeDay, TXT.freeRelax);
    return;
  }

  if (isCompleteToday) return;
  void markDoneToday(id);
}}
                        style={({ pressed }) => [
  styles.rowDoneBtn,
  isDisabled && { opacity: 0.35 },

  lockedByFree && {
    backgroundColor: UI.card2,
    borderColor: UI.stroke,
    opacity: 0.78,
    transform: [{ scale: 1 }],
  },

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

                           !lockedByFree &&
  !isCompleteToday &&
  !isDisabled && {
                                opacity: pressed ? 0.88 : 1,
                                transform: [{ scale: pressed ? 0.98 : 1 }],
                              },
                          ]}
                          hitSlop={10}
                        >
                          <Text
                           style={[
  styles.rowDoneBtnText,
  (lockedByFree || isDisabled || isCompleteToday || !activeToday) && { color: UI.sub },
]}
                          >
                           {lockedByFree
  ? TXT.premium
  : isDisabled
    ? TXT.inactive
  : isCompleteToday
    ? TXT.done
    : !activeToday
      ? TXT.freeDay
      : TXT.complete}
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
