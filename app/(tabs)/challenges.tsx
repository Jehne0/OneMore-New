 import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  ScrollView
} from "react-native";
import DraggableFlatList, { type RenderItemParams } from "react-native-draggable-flatlist";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Alert } from "../../lib/appAlert";
import { getTodayISO, useTodayISO } from "../../lib/clock";
import { ensureDaily } from "../../lib/logic";
import { isPremiumActive, subscribePremium } from "../../lib/premium";
import {
  clearDailyRemindersForChallenge,
  getFreeActiveReminderChallengeId,
  setDailyRemindersForChallenge,
  setRemindersPremiumEnabled,
} from "../../lib/reminders";
import { AppState, loadState, renameChallenge, saveState } from "../../lib/storage";
import { useTheme } from "../../lib/theme";

const FREE_MAX = 3;

function addDaysISO(iso: string, deltaDays: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function getEntry(history: any[], challengeId: string, dateISO: string) {
  const list = (history ?? []).filter(
    (h) => String((h as any)?.challengeId ?? "") === String(challengeId) && (h as any)?.date === dateISO
  ) as any[];

  // prefer completed (kvůli multi-complete)
  return (
    list.find((h) => (h as any)?.status === "completed") ??
    list.find((h) => (h as any)?.status === "skipped") ??
    list[0]
  ) as any | undefined;
}

function streakForChallenge(history: any[], challengeId: string, todayISO: string) {
  const todayEntry = getEntry(history, challengeId, todayISO);
  if (todayEntry?.status === "skipped") return 0;

  const baseDate = todayEntry?.status === "completed" ? todayISO : addDaysISO(todayISO, -1);

  let streak = 0;
  let cursor = baseDate;

  while (true) {
    const e = getEntry(history, challengeId, cursor);
    if (!e || e.status !== "completed") break;
    streak += 1;
    cursor = addDaysISO(cursor, -1);
  }
  return streak;
}

function makeStyles(UI: any, isDark: boolean) {
  // Light mode in Challenges should still feel like OneMore: clean, bright background,
  // warm cards, orange accent — but NO orange "wash" over the whole screen.
  const inputBg = isDark ? UI.card : "#FFFFFF";
  const inputBorder = isDark ? UI.stroke : "rgba(0,0,0,0.08)";

  const cardBg = isDark ? "rgba(43, 31, 26, 0.92)" : "#FFF6EC";
  const cardBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";

  const chipBg = isDark ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.65)";
  const chipBorder = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)";

  const badgeBg = isDark ? "rgba(255, 153, 51, 0.18)" : "#FFE6D1";
  const badgeBorder = isDark ? "rgba(255, 153, 51, 0.35)" : "rgba(0,0,0,0.06)";
  const badgeText = isDark ? UI.text : "#2B1F1A";

  const shadowColor = "#000";
  const shadowOpacity = isDark ? 0.22 : 0.10;

  return StyleSheet.create({
    // ✅ musí být transparentní, gradient dělá pozadí (stejně jako OneMore/Settings)
    screen: { flex: 1, backgroundColor: "transparent" },
    gradient: { ...StyleSheet.absoluteFillObject },

    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
      padding: 20,
    },

    container: { paddingHorizontal: 20, paddingBottom: 20, gap: 12, backgroundColor: "transparent" },

    addRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 6,
    },

    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: inputBorder,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: 16,
      color: UI.text,
      backgroundColor: inputBg,
    },

    addButton: {
      height: 48,
      paddingHorizontal: 16,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: inputBorder,
      backgroundColor: isDark ? UI.card2 : "#FFF0E3",
      alignItems: "center",
      justifyContent: "center",
    },
    addButtonDisabled: { opacity: 0.35 },
    addButtonPressed: { transform: [{ scale: 0.98 }] },
    addButtonText: { fontSize: 16, fontWeight: "900", color: UI.text },

    list: { gap: 10, marginTop: 8 },

    rowCard: {
      width: "100%",
      borderRadius: 18,
      paddingVertical: 10, // slimmer than before
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: cardBorder,
      overflow: "hidden",
      backgroundColor: cardBg,
      shadowColor,
      shadowOpacity,
      shadowRadius: isDark ? 14 : 12,
      shadowOffset: { width: 0, height: isDark ? 8 : 6 },
      elevation: 3,
    },
    // Během drag (Android) občas problikne kvůli overflow:"hidden" + elevaci.
    // Aktivní karta proto dočasně vypne ořez a dostane vyšší elevaci.
    rowCardActive: {
      overflow: "visible",
      elevation: 10,
      zIndex: 50,
    },
    // ✅ žádný oranžový "bar" uvnitř, jen oranžové ohraničení karty
    rowCardOrange: {
      borderColor: UI.accent,
      borderWidth: 1,
    },
    rowPressed: { opacity: 0.9 },

    rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    rowTitle: {
      flex: 1,
      minWidth: 0,
      fontSize: 18,
      fontWeight: "900",
      color: isDark ? "#FFFFFF" : "#1A1A1A",
    },
    rightTop: { flexDirection: "row", alignItems: "center", gap: 10 },

    notifChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      height: 34,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: chipBorder,
      backgroundColor: chipBg,
    },
    notifChipText: { fontWeight: "900", fontSize: 12, color: isDark ? "#FFFFFF" : "#1A1A1A" },
    notifChipSub: { fontWeight: "800", fontSize: 11, color: UI.sub, marginTop: -1 },

    badgeSquare: {
      minWidth: 44,
      height: 34,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: badgeBg,
      borderWidth: 1,
      borderColor: badgeBorder,
      paddingHorizontal: 10,
    },
    badgeText: { fontWeight: "900", fontSize: 13, color: badgeText },

    // ----- Modals -----
    modalBackdrop: {
      flex: 1,
      backgroundColor: UI.backdrop,
      justifyContent: "center",
      padding: 18,
    },
    modalCard: {
      backgroundColor: UI.sheetBg,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: UI.sheetStroke,
      padding: 14,
    },
    modalTitle: { color: UI.text, fontWeight: "900", fontSize: 16, marginBottom: 10 },
    modalInput: {
      borderWidth: 1,
      borderColor: inputBorder,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: 16,
      color: UI.text,
      backgroundColor: inputBg,
    },
    modalBtns: { flexDirection: "row", justifyContent: "center", gap: 25, marginTop: 10 },
  modalBtn: {
  paddingHorizontal: 14,
  paddingVertical: 10,
  borderRadius: 14,
  borderWidth: 1,
  borderColor: "rgba(255,166,92,0.45)",     // pastel orange border
  backgroundColor: "rgba(255,166,92,0.28)", // hodně jemné pozadí
},

modalBtnPrimary: {
  paddingHorizontal: 14,
  paddingVertical: 10,
  borderRadius: 14,
  borderWidth: 1,
  borderColor: "rgba(255,166,92,0.55)",
  backgroundColor: "rgba(255,166,92,0.28)", // stále jemné, ale výraznější než modalBtn
},

    modalBtnText: { color: UI.text, fontWeight: "900" },

    // reminder modal bits (keep existing functionality)
    modalHint: { marginTop: 8, color: UI.sub, fontWeight: "700" },
    premiumRow: { marginTop: 12 },
    modalLabel: { color: UI.sub, fontWeight: "900", fontSize: 12, marginBottom: 8 },
    pills: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    pill: {
      borderWidth: 1,
      borderColor: inputBorder,
      backgroundColor: isDark ? UI.card2 : "#FFFFFF",
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 12,
    },
    pillActive: { backgroundColor: UI.accent, borderColor: UI.accent },
    pillText: { fontWeight: "900", color: UI.text },
    pillTextActive: { color: "#FFFFFF" },

    toggleBtn: {
      alignSelf: "flex-start",
      borderWidth: 1,
      borderColor: inputBorder,
      backgroundColor: isDark ? UI.card2 : "#FFFFFF",
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 14,
    },
    toggleBtnOn: { backgroundColor: UI.goodBg, borderColor: UI.goodBg },
    toggleText: { fontWeight: "900", color: UI.text },

    timesWrap: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
    timeBtn: {
      borderWidth: 1,
      borderColor: inputBorder,
      backgroundColor: isDark ? UI.card2 : "#FFFFFF",
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 14,
      minWidth: 84,
      alignItems: "center",
    },
    timeBtnDisabled: { opacity: 0.35 },
    timeText: { fontWeight: "900", color: UI.text },

    remindBtnDisabled: { opacity: 0.4 },

    // ✅ chybělo v tvém kódu, ale používáš níže v archivu
    subtitle: { color: UI.sub, fontWeight: "900", fontSize: 13 },

    // ✅ chybělo: archiv řádky a tlačítka (používáš v ListFooterComponent)
    row: {
      width: "100%",
      borderRadius: 22,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: inputBorder,
      backgroundColor: isDark ? UI.card : "#FFFFFF",
      overflow: "hidden",
    },
    rowLeft: { flex: 1, minWidth: 0, gap: 4 },
    rowRight: { flexDirection: "row", alignItems: "center", gap: 10 },
    text: { color: UI.text, fontWeight: "900", fontSize: 14 },

    remindBtn: {
      borderWidth: 1,
      borderColor: inputBorder,
      backgroundColor: isDark ? UI.card2 : "#FFFFFF",
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      minWidth: 110,
    },
    remindText: { color: UI.text, fontWeight: "900", fontSize: 13 },
    remindSub: { color: UI.sub, fontWeight: "800", fontSize: 11, marginTop: 2 },

    deleteBtn: {
      borderWidth: 1,
      borderColor: "rgba(255,77,109,0.35)",
      backgroundColor: "rgba(255,77,109,0.12)",
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      minWidth: 90,
    },
    deleteText: { color: UI.text, fontWeight: "900", fontSize: 13 },
  });
}

/**
 * ✅ ID se NESMÍ recyklovat – jinak se nová výzva tváří „zeleně“
 * kvůli staré historii pro stejné challengeId.
 * Proto bereme max ID i z historie.
 */
function nextNumericId(state: AppState): string {
  const idsFromActive = (state.challenges ?? []).map((c) => Number((c as any).id) || 0);

  const idsFromHistory = (state.history ?? [])
    .map((h: any) => Number(h?.challengeId) || 0)
    .filter((n: number) => Number.isFinite(n));

  const maxId = Math.max(0, ...idsFromActive, ...idsFromHistory);
  return String(maxId + 1);
}

function countFreeChallenges(s: AppState): number {
  return (s.challenges ?? []).length;
}

export default function ChallengesScreen() {
  const { UI, isDark, mode } = useTheme();
  const styles = useMemo(() => makeStyles(UI, isDark), [UI, isDark]);
  const insets = useSafeAreaInsets();

  // Pokud sem přijdeš z OneMore pro správu konkrétní výzvy,
  // předá se manageId a rovnou otevřeme akce.
  const { manageId } = useLocalSearchParams<{ manageId?: string }>();
  const openedFromParams = useRef<string | null>(null);

  // Unified tab transition (same feel as other screens)
  const enter = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      enter.setValue(0);
      Animated.timing(enter, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }, [enter])
  );

  const [state, setState] = useState<AppState | null>(null);
  const [text, setText] = useState("");

  const tdy = useTodayISO();
  const historyEntries = state?.history ?? [];

  const historyIndex = useMemo(() => {
    // key: "<challengeId>|<YYYY-MM-DD>" -> status ("completed"/"skipped"/...)
    const map = new Map<string, string>();
    for (const h of historyEntries as any[]) {
      const cid = String((h as any)?.challengeId ?? "");
      const d = String((h as any)?.date ?? "");
      const st = String((h as any)?.status ?? "");
      if (!cid || !d) continue;
      const k = `${cid}|${d}`;
      const prev = map.get(k);
      // prefer completed
      if (prev === "completed") continue;
      if (st === "completed") {
        map.set(k, "completed");
      } else if (!prev && st) {
        map.set(k, st);
      }
    }
    return map;
  }, [historyEntries]);

  const streakById = useMemo(() => {
    const out: Record<string, number> = {};
    const list = (state?.challenges ?? []) as any[];
    for (const c of list) {
      const id = String(c?.id ?? "");
      if (!id) continue;
      const todayStatus = historyIndex.get(`${id}|${tdy}`);
      if (todayStatus === "skipped") {
        out[id] = 0;
        continue;
      }
      const base = todayStatus === "completed" ? tdy : addDaysISO(tdy, -1);
      let streak = 0;
      let cursor = base;
      while (true) {
        const st = historyIndex.get(`${id}|${cursor}`);
        if (st !== "completed") break;
        streak += 1;
        cursor = addDaysISO(cursor, -1);
      }
      out[id] = streak;
    }
    return out;
  }, [state?.challenges, historyIndex, tdy]);

  // rename modal state
  const [renameOpen, setRenameOpen] = useState(false);

  // reminder modal state
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderId, setReminderId] = useState<string | null>(null);
  const [remEnabled, setRemEnabled] = useState(false);
  const [tempTarget, setTempTarget] = useState(1);
  const [tempTimes, setTempTimes] = useState<string[]>([]);
  const [premium, setPremium] = useState(false);
  const [remStep, setRemStep] = useState<1 | 2>(1);

  // time picker
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [timePickerIndex, setTimePickerIndex] = useState(0);
  const [timePickerValue, setTimePickerValue] = useState(new Date());

  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  // akční modal (přejmenovat / smazat)
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionLabel, setActionLabel] = useState("");

  // target per day picker (1×..20×)
  const [targetOpen, setTargetOpen] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [targetValue, setTargetValue] = useState(1);

  // ✅ vždy načti aktuální stav při návratu na screen
  const refresh = useCallback(async () => {
    const s = await loadState();
    if (!Array.isArray((s as any).history)) (s as any).history = [];
    if (!Array.isArray((s as any).archivedChallenges)) (s as any).archivedChallenges = [];
    setState(s);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      isPremiumActive().then((p) => {
        setPremium(p);
        setRemindersPremiumEnabled(p);
      });
    }, [refresh])
  );

  // ✅ okamžitá reakce na přepnutí Premium v test záložce
  useEffect(() => {
    const unsubPremium = subscribePremium((p) => {
      setPremium(p);
      setRemindersPremiumEnabled(p);
    });
    return () => unsubPremium();
  }, []);

  const canAddText = useMemo(() => text.trim().length > 0, [text]);

  // ✅ v reminder modálu: notifikací nesmí být víc než frekvence výzvy (a free max 3)
  const reminderMaxAllowed = useMemo(() => {
    if (!state || !reminderId) return 1;
    const c = (state.challenges ?? []).find((x: any) => String(x.id) === String(reminderId)) as any;
    const freq = Number(c?.targetPerDay ?? 1);
    const freqSafe = Number.isFinite(freq) && freq > 0 ? Math.min(20, Math.floor(freq)) : 1;
    return premium ? freqSafe : Math.min(3, freqSafe);
  }, [state, reminderId, premium]);

  // ✅ KRITICKÉ: persist musí pracovat s nejnovějším state ze storage,
  // aby nepřepsal historii starou verzí.
  async function persist(apply: (latest: AppState) => AppState): Promise<void> {
    const latest0 = await loadState();
    const latest: AppState = {
      ...(latest0 as any),
      archivedChallenges: Array.isArray((latest0 as any).archivedChallenges)
        ? (latest0 as any).archivedChallenges
        : [],
      history: Array.isArray((latest0 as any).history) ? (latest0 as any).history : [],
    };

    let updated = apply(latest);

    // zachovej tvoje chování (daily pick)
    let updated2 = ensureDaily(updated);

    const tdy2 = getTodayISO();

    // ve FREE jsou všechny výzvy "aktivní"
    const activeIds = new Set((updated2.challenges ?? []).map((c: any) => String(c.id)));

    const hasTodayEntry = (id: string) =>
      (updated2.history ?? []).some(
        (h: any) => String(h?.challengeId ?? "") === String(id) && h?.date === tdy2
      );

    const before = (updated2.dailyIds ?? []).map(String);
    const filtered = before.filter((id) => activeIds.has(id) || hasTodayEntry(id));

    if (filtered.length !== before.length) {
      updated2 = { ...updated2, dailyIds: filtered };
    }

    if ((updated2.dailyIds?.length ?? 0) === 0 && activeIds.size > 0) {
      const picked = ensureDaily({
        ...updated2,
        dailyIds: [],
        lastPickDate: undefined,
      });

      updated2 = {
        ...updated2,
        dailyIds: picked.dailyIds,
        lastPickDate: picked.lastPickDate,
      };
    }

    setState(updated2);
    await saveState(updated2);
  }

  async function toggleEnabled(id: string): Promise<void> {
    await persist((latest) => {
      const nextChallenges = (latest.challenges ?? []).map((c: any) => {
        if (String(c.id) !== String(id)) return c;
        return { ...c, enabled: !c.enabled };
      });
      return { ...latest, challenges: nextChallenges };
    });
  }

  async function addChallenge(): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    // ✅ limit 3 ve FREE – kontrola proti real storage (ne jen UI)
    // Premium limit NEPLATÍ
    if (!premium) {
      const latest = await loadState();
      const n = countFreeChallenges(latest);
      if (n >= FREE_MAX) {
        Alert.alert("Limit ve free verzi", `Ve free verzi můžeš mít max ${FREE_MAX} výzvy.`);
        return;
      }
    }

    Keyboard.dismiss();
    setText("");

    await persist((latest2) => {
      const newId = nextNumericId(latest2);
      return {
        ...latest2,
        challenges: [{ id: newId, text: trimmed, enabled: true }, ...(latest2.challenges ?? [])],
      };
    });
  }

  function openReminderConfig(id: string) {
    const c = (state?.challenges ?? []).find((x) => String(x.id) === String(id));
    if (!c) return;

    // Frekvence výzvy (kolikrát denně) – tohle je limit pro počet notifikací.
    const freq = Number((c as any).targetPerDay ?? 1);
    const freqSafe = Number.isFinite(freq) && freq > 0 ? Math.min(20, Math.floor(freq)) : 1;

    const savedTimes = Array.isArray((c as any).reminderTimes)
      ? ((c as any).reminderTimes as string[])
      : [];
    const enabled = !!(c as any).reminderEnabled;

    setReminderId(String(id));
    setRemEnabled(enabled);

    // ✅ PODMÍNKA: notifikací nesmí být víc než frekvence.
    // Free: max 3 notifikace/den a jen u 1 výzvy.
    const maxAllowed = premium ? freqSafe : Math.min(3, freqSafe);

    // Kolik notifikací chceme v UI zobrazit (preferuj uložené, jinak 1)
    const desiredCount = Math.min(
      Math.max(1, savedTimes.length > 0 ? savedTimes.length : 1),
      maxAllowed
    );

    setTempTarget(desiredCount);
    setTempTimes(() => {
      const base = savedTimes.length
        ? savedTimes.slice(0, desiredCount)
        : Array.from({ length: desiredCount }, () => "");
      while (base.length < desiredCount) base.push("");
      return base.slice(0, desiredCount);
    });

    // už rovnou na časy (počty řešíme přes pillky níže)
    setRemStep(2);
    setReminderOpen(true);
  }

  function openTimePicker(idx: number) {
    const base = new Date();
    const cur = tempTimes[idx];
    const m = cur?.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (m) base.setHours(Number(m[1]), Number(m[2]), 0, 0);
    setTimePickerIndex(idx);
    setTimePickerValue(base);
    setTimePickerOpen(true);
  }

  function onTimePicked(_event: DateTimePickerEvent, date?: Date) {
    if (!date) {
      setTimePickerOpen(false);
      return;
    }
    setTimePickerOpen(false);

    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");

    setTempTimes((prev) => {
      const copy = [...prev];
      if (timePickerIndex < 0 || timePickerIndex >= copy.length) return copy;
      copy[timePickerIndex] = `${hh}:${mm}`;
      return copy;
    });
  }

  async function saveReminderConfig() {
    if (!state || !reminderId) return;

    const id = String(reminderId);

    // Frekvence výzvy = absolutní limit pro počet notifikací.
    const c0 = (state.challenges ?? []).find((x: any) => String(x.id) === id) as any;
    const freq = Number(c0?.targetPerDay ?? 1);
    const freqSafe = Number.isFinite(freq) && freq > 0 ? Math.min(20, Math.floor(freq)) : 1;

    const maxAllowed = premium ? freqSafe : Math.min(3, freqSafe);
    const desiredCount = Math.min(Math.max(1, Number(tempTarget) || 1), maxAllowed);

    const times = (tempTimes ?? [])
      .slice(0, desiredCount)
      .map((t) => String(t ?? ""))
      .filter(Boolean);

    // ✅ Povolené je mít MÍŇ notifikací než je frekvence.
    // Jediná podmínka: když jsou notifikace zapnuté, musí být nastavený aspoň 1 čas.
    if (remEnabled && times.length === 0) {
      Alert.alert("Chybí čas", "Nastav aspoň 1× čas, nebo vypni notifikace.");
      return;
    }

    // Free: jen 1 výzva může mít zapnuté notifikace
    if (!premium && remEnabled) {
      const activeId = getFreeActiveReminderChallengeId(state);
      if (activeId && String(activeId) != id) {
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
          // ⚠️ frekvenci (targetPerDay) neměníme v modálu notifikací
          reminderEnabled: remEnabled,
          reminderTimes: remEnabled ? times : [],
        };
      });
      return { ...latest, challenges: nextChallenges };
    });

    try {
      if (remEnabled && times.length) {
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

    setReminderOpen(false);
    await refresh();
  }

  function openRename(id: string, currentText: string) {
    setRenameId(id);
    setRenameText(currentText);
    setRenameOpen(true);
  }

  function openActions(id: string, label: string) {
    setActionId(id);
    setActionLabel(label);
    setActionsOpen(true);
  }

  // Auto-open akce, pokud máme manageId z OneMore.
  useEffect(() => {
    const id = String(manageId ?? "");
    if (!id) return;
    if (!state) return;
    if (openedFromParams.current === id) return;

    const c = (state.challenges ?? []).find((x: any) => String((x as any).id) === id) as any;
    if (!c) return;

    openedFromParams.current = id;
    openActions(id, String(c.text ?? ""));
  }, [manageId, state]);

  function openTargetPicker(id: string) {
    const c = (state?.challenges ?? []).find((x: any) => String((x as any).id) === String(id));
    if (!c) return;
    const cur = Number((c as any).targetPerDay ?? 1);
    const safe = Number.isFinite(cur) && cur > 0 ? Math.min(20, Math.floor(cur || 1)) : 1;
    setTargetId(String(id));
    setTargetValue(safe);
    setTargetOpen(true);
  }

  async function saveTargetPicker(v: number): Promise<void> {
    if (!targetId) return;
    const value = Math.min(20, Math.max(1, Math.floor(v || 1)));
    const id = String(targetId);

    await persist((latest) => {
      const nextChallenges = (latest.challenges ?? []).map((c: any) => {
        if (String(c.id) !== id) return c;
        const prevTimes = Array.isArray(c.reminderTimes) ? (c.reminderTimes as string[]) : [];
        const trimmed = prevTimes.slice(0, value);
        return { ...c, targetPerDay: value, reminderTimes: trimmed };
      });
      return { ...latest, challenges: nextChallenges };
    });

    try {
      const latest = await loadState();
      const c = (latest.challenges ?? []).find((x: any) => String(x.id) === id) as any;
      const enabled = !!c?.reminderEnabled;
      const times = Array.isArray(c?.reminderTimes) ? (c.reminderTimes as string[]) : [];
      const filled = times.filter((t) => String(t ?? "").trim());
      if (enabled && filled.length) {
        await setDailyRemindersForChallenge(id, String(c?.text ?? "OneMore"), filled);
      } else {
        await clearDailyRemindersForChallenge(id);
      }
    } catch {}

    setTargetOpen(false);
    await refresh();
  }

  async function saveRename(): Promise<void> {
    if (!renameId) return;
    const v = renameText.trim();
    if (!v) return;

    const next = await renameChallenge(renameId, v);
    const next2 = ensureDaily(next);
    setState(next2);
    await saveState(next2);

    setRenameOpen(false);
    setRenameId(null);
  }

  async function deleteChallengeNow(id: string): Promise<void> {
    try {
      await clearDailyRemindersForChallenge(String(id));
    } catch {}

    await persist((latest) => ({
      ...latest,
      challenges: (latest.challenges ?? []).filter((c: any) => String(c.id) !== String(id)),
      dailyIds: (latest.dailyIds ?? []).filter((x: any) => String(x) !== String(id)),
      reminderNotifIds: (() => {
        const copy = { ...((latest as any).reminderNotifIds ?? {}) };
        delete copy[String(id)];
        return copy;
      })(),
    }));

    await refresh();
  }

  const atLimit = !premium && (state ? countFreeChallenges(state) >= FREE_MAX : false);
  const canAdd = canAddText && !atLimit;

  const freeActiveReminderId = state && !premium ? getFreeActiveReminderChallengeId(state) : null;

  if (!state) {
    return (
      <Animated.View
        style={[
          styles.screen,
          {
            opacity: enter,
            transform: [
              {
                translateY: enter.interpolate({
                  inputRange: [0, 1],
                  outputRange: [8, 0],
                }),
              },
            ],
          },
        ]}
      >
        {/* ✅ STEJNÝ gradient wrapper jako OneMore/Settings */}
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

        <View style={styles.center}>
          <Text style={{ color: UI.text }}>Načítám…</Text>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.screen,
        {
          opacity: enter,
          transform: [
            {
              translateY: enter.interpolate({
                inputRange: [0, 1],
                outputRange: [8, 0],
              }),
            },
          ],
        },
      ]}
    >
      {/* ✅ STEJNÝ gradient wrapper jako OneMore/Settings (včetně spodní oranžové pro napojení na tab bar) */}
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

      <View style={[styles.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
        {/* ACTIONS MODAL */}
        <Modal visible={actionsOpen} transparent animationType="fade" onRequestClose={() => setActionsOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setActionsOpen(false)}>
            <Pressable style={styles.modalCard} onPress={() => {}}>
              <View style={styles.modalBtns}>
                <Pressable
                  style={styles.modalBtn}
                  onPress={() => {
                    if (!actionId) return;
                    const id = actionId;
                    const label = actionLabel;
                    setActionsOpen(false);
                    openRename(id, label);
                  }}
                >
                  <Text style={styles.modalBtnText}>Přejmenovat</Text>
                </Pressable>

                <Pressable
                  style={styles.modalBtnPrimary}
                  onPress={() => {
                    if (!actionId) return;
                    const id = String(actionId);
                    setActionsOpen(false);
                    void deleteChallengeNow(id);
                  }}
                >
                  <Text style={styles.modalBtnText}>Smazat</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* TARGET MODAL */}
        <Modal visible={targetOpen} transparent animationType="fade" onRequestClose={() => setTargetOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setTargetOpen(false)}>
            <Pressable style={styles.modalCard} onPress={() => {}}>
              <Text style={styles.modalTitle}>Kolikrát denně? (1×–20×)</Text>

              <View style={styles.pills}>
                {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => setTargetValue(n)}
                    style={({ pressed }) => [
                      styles.pill,
                      targetValue === n && styles.pillActive,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={[styles.pillText, targetValue === n && styles.pillTextActive]}>{n}×</Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.modalBtns}>
                <Pressable style={styles.modalBtn} onPress={() => setTargetOpen(false)}>
                  <Text style={styles.modalBtnText}>Zrušit</Text>
                </Pressable>
                <Pressable style={styles.modalBtnPrimary} onPress={() => void saveTargetPicker(targetValue)}>
                  <Text style={styles.modalBtnText}>Uložit</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* RENAME MODAL */}
        <Modal visible={renameOpen} transparent animationType="fade" onRequestClose={() => setRenameOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setRenameOpen(false)}>
            <Pressable style={styles.modalCard} onPress={() => {}}>
              <Text style={styles.modalTitle}>Přejmenovat výzvu</Text>

              <TextInput
                value={renameText}
                onChangeText={setRenameText}
                placeholder="Název výzvy…"
                placeholderTextColor={UI.sub}
                style={styles.modalInput}
                returnKeyType="done"
                autoFocus
                onSubmitEditing={() => void saveRename()}
              />

              <View style={styles.modalBtns}>
                <Pressable style={styles.modalBtn} onPress={() => setRenameOpen(false)}>
                  <Text style={styles.modalBtnText}>Zrušit</Text>
                </Pressable>

                <Pressable style={styles.modalBtnPrimary} onPress={() => void saveRename()}>
                  <Text style={styles.modalBtnText}>Uložit</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* REMINDER MODAL */}
        <Modal
          visible={reminderOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setReminderOpen(false)}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setReminderOpen(false)}>
            <Pressable style={styles.modalCard} onPress={() => {}}>
              <Text style={styles.modalTitle}>Notifikace</Text>

              <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: 10 }} keyboardShouldPersistTaps="handled">

              {/* Enable/Disable */}
              <Pressable
                onPress={() => setRemEnabled((v) => !v)}
                style={({ pressed }) => [
                  styles.toggleBtn,
                  remEnabled && styles.toggleBtnOn,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.toggleText}>{remEnabled ? "Zapnuto" : "Vypnuto"}</Text>
              </Pressable>

              {!premium && (
                <Text style={styles.modalHint}>
                  Free: notifikace lze nastavit jen u jedné výzvy (max 3× denně).
                </Text>
              )}

              {/* Kolik notifikací denně? (max = frekvence výzvy; free max 3) */}
              {reminderMaxAllowed > 1 && (
                <View style={styles.premiumRow}>
                  <Text style={styles.modalLabel}>Kolik notifikací denně?</Text>
                  <View style={styles.pills}>
                    {Array.from({ length: reminderMaxAllowed }, (_, i) => i + 1).map((n) => (
                      <Pressable
                        key={n}
                        onPress={() => {
                          setTempTarget(n);
                          setTempTimes((prev) => {
                            const next = [...(prev ?? [])];
                            while (next.length < n) next.push("");
                            return next.slice(0, n);
                          });
                        }}
                        style={({ pressed }) => [
                          styles.pill,
                          Number(tempTarget) === n && styles.pillActive,
                          pressed && { opacity: 0.85 },
                        ]}
                      >
                        <Text style={[styles.pillText, Number(tempTarget) === n && styles.pillTextActive]}>{n}×</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.modalHint}>Notifikací nesmí být víc než frekvence výzvy.</Text>
                </View>
              )}

              {/* Step 2: times */}
              {(!premium || remStep === 2) && (
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.modalLabel}>Časy</Text>
                  <View style={styles.timesWrap}>
                    {Array.from(
                      { length: Math.min(Math.max(1, Number(tempTarget) || 1), reminderMaxAllowed) },
                      (_, idx) => {
                        const t = tempTimes?.[idx] ?? "";
                        return (
                          <Pressable
                            key={idx}
                            onPress={() => openTimePicker(idx)}
                            style={({ pressed }) => [styles.timeBtn, pressed && { opacity: 0.85 }]}
                          >
                            <Text style={styles.timeText}>{t ? t : "Nastavit"}</Text>
                          </Pressable>
                        );
                      }
                    )}
                  </View>

                  {premium && (
                    <Pressable
                      onPress={() => setRemStep(1)}
                      style={({ pressed }) => [
                        styles.modalBtn,
                        { alignSelf: "flex-start", marginTop: 10 },
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text style={styles.modalBtnText}>Zpět</Text>
                    </Pressable>
                  )}

                  <View style={styles.modalBtns}>
                    <Pressable style={styles.modalBtn} onPress={() => setReminderOpen(false)}>
                      <Text style={styles.modalBtnText}>Zrušit</Text>
                    </Pressable>

                    <Pressable style={styles.modalBtnPrimary} onPress={() => void saveReminderConfig()}>
                      <Text style={styles.modalBtnText}>Uložit</Text>
                    </Pressable>
                  </View>

                </View>
              )}
              {timePickerOpen && (
                    <View style={{ marginTop: 10 }}>
                      <DateTimePicker value={timePickerValue} mode="time" is24Hour onChange={onTimePicked} />
                    </View>
                  )}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* ADD */}
        <View style={styles.addRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={atLimit ? `Ve free verzi max ${FREE_MAX} výzvy` : "Nová výzva… (např. 20 kliků)"}
            placeholderTextColor={UI.sub}
            style={styles.input}
            returnKeyType="done"
            editable={!atLimit}
            onSubmitEditing={() => void addChallenge()}
          />

          <Pressable
            onPress={() => void addChallenge()}
            disabled={!canAdd}
            style={({ pressed }) => [
              styles.addButton,
              !canAdd && styles.addButtonDisabled,
              pressed && canAdd && styles.addButtonPressed,
            ]}
          >
            <Text style={styles.addButtonText}>{atLimit ? "Limit 3" : "Přidat"}</Text>
          </Pressable>
        </View>

        {/* LIST (drag & drop) */}
        <View style={styles.list}>
          <DraggableFlatList
            data={(state.challenges ?? []) as any[]}
            keyExtractor={(item) => String((item as any).id)}
            activationDistance={12}
            dragItemOverflow
            scrollEnabled
            nestedScrollEnabled
            contentContainerStyle={{ paddingBottom: 24 }}
            onDragEnd={({ data }) => {
              // ✅ dlouhý stisk = přesun pořadí (bez akcí)
              void persist((latest) => ({ ...latest, challenges: data as any }));
            }}
            ListFooterComponent={() => (
              <View style={{ paddingBottom: 24 }}>
                {/* ARCHIVE (Premium) */}
                {premium && (state.archivedChallenges ?? []).length > 0 && (
                  <View style={{ marginTop: 18 }}>
                    <Text style={[styles.subtitle, { marginTop: 8 }]}>Historie smazaných výzev</Text>

                    <View style={{ marginTop: 10, gap: 10 }}>
                      {(state.archivedChallenges ?? []).map((a: any) => (
                        <View
                          key={`arch-${a.id}-${a.deletedAtISO}`}
                          style={[styles.row, { justifyContent: "space-between", overflow: "hidden" }]}
                        >
                          <LinearGradient
                            colors={
                              isDark
                                ? (["rgba(255,154,61,0.16)", "rgba(60,44,33,0.92)", "rgba(20,16,12,0.92)"] as any)
                                : (["rgba(255,178,102,0.22)", "rgba(255,244,235,0.98)"] as any)
                            }
                            locations={isDark ? ([0, 0.55, 1] as any) : ([0, 1] as any)}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={[StyleSheet.absoluteFillObject, { borderRadius: 22 }]}
                          />

                          <View style={styles.rowLeft}>
                            <Text style={styles.text} numberOfLines={2}>
                              {a.text}
                            </Text>
                            <Text style={styles.subtitle}>Smazáno: {String(a.deletedAtISO).slice(0, 10)}</Text>
                          </View>

                          <View style={styles.rowRight}>
                            <Pressable
                              style={({ pressed }) => [styles.remindBtn, pressed && { opacity: 0.85 }]}
                              onPress={() => {
                                const clash = (state.challenges ?? []).some((c: any) => String(c.id) === String(a.id));
                                if (clash) {
                                  Alert.alert(
                                    "Nejde obnovit",
                                    "U téhle výzvy už existuje aktivní položka se stejným ID. Aby se zachovala historie, nelze vytvořit kopii s jiným ID. Nejprve smaž/archivuj tu aktivní a pak obnov z historie."
                                  );
                                  return;
                                }

                                void persist((latest) => {
                                  const archived = Array.isArray((latest as any).archivedChallenges)
                                    ? (latest as any).archivedChallenges
                                    : [];

                                  const item = archived.find(
                                    (x: any) =>
                                      String(x.id) === String(a.id) && String(x.deletedAtISO) === String(a.deletedAtISO)
                                  );
                                  if (!item) return latest;

                                  const restoreId = String(item.id);

                                  return {
                                    ...latest,
                                    challenges: [
                                      { id: restoreId, text: String(item.text ?? ""), enabled: true },
                                      ...(latest.challenges ?? []),
                                    ],
                                    archivedChallenges: archived.filter(
                                      (x: any) =>
                                        !(String(x.id) === String(a.id) && String(x.deletedAtISO) === String(a.deletedAtISO))
                                    ),
                                  };
                                });
                              }}
                            >
                              <Text style={styles.remindText}>Obnovit</Text>
                              <Text style={styles.remindSub}>Vrátit mezi aktivní</Text>
                            </Pressable>

                            <Pressable
                              style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.85 }]}
                              onPress={() => {
                                Alert.alert(
                                  "Smazat nadobro?",
                                  `"${a.text}"\n\nTahle akce už nejde vrátit zpět.`,
                                  [
                                    { text: "Zrušit", style: "cancel" },
                                    {
                                      text: "Smazat nadobro",
                                      style: "destructive",
                                      onPress: () => {
                                        void persist((latest) => {
                                          const archived = Array.isArray((latest as any).archivedChallenges)
                                            ? (latest as any).archivedChallenges
                                            : [];
                                          return {
                                            ...latest,
                                            archivedChallenges: archived.filter(
                                              (x: any) =>
                                                !(String(x.id) === String(a.id) && String(x.deletedAtISO) === String(a.deletedAtISO))
                                            ),
                                          };
                                        });
                                      },
                                    },
                                  ]
                                );
                              }}
                            >
                              <Text style={styles.deleteText}>Smazat</Text>
                            </Pressable>
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            )}
            renderItem={({ item, drag, isActive }: RenderItemParams<any>) => {
              const c = item as any;

              const freeLocked =
                !premium &&
                !!freeActiveReminderId &&
                String(freeActiveReminderId) !== String(c.id) &&
                !c.reminderEnabled;

              const target = Math.max(1, Number(c.targetPerDay ?? 1) || 1);
              const notifLabel = freeLocked ? "Zamčeno" : c.reminderEnabled ? "Zapnuto" : "Vypnuto";

              return (
                <Pressable
                  onPress={() => openActions(c.id, c.text)}
                  onLongPress={drag}
                  delayLongPress={250}
                  style={({ pressed }) => [
                    styles.rowCard,
                    styles.rowCardOrange,
                    isActive && styles.rowCardActive,
                    (pressed || isActive) && styles.rowPressed,
                  ]}
                >
                  <View style={styles.rowTop}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {c.text}
                    </Text>

                    <View style={styles.rightTop}>
                      <Pressable
                        onPress={() => {
                          if (freeLocked) {
                            Alert.alert(
                              "Notifikace ve free verzi",
                              "Ve free verzi můžeš mít notifikace jen u jedné výzvy. Vypni je nejdřív u jiné výzvy."
                            );
                            return;
                          }
                          openReminderConfig(c.id);
                        }}
                        style={({ pressed }) => [
                          styles.notifChip,
                          pressed && { opacity: 0.85 },
                          freeLocked && styles.remindBtnDisabled,
                        ]}
                      >
                        <Ionicons
                          name={c.reminderEnabled ? "notifications" : "notifications-outline"}
                          size={16}
                          color={UI.text}
                        />
                        <View style={{ gap: 1 }}>
                          <Text style={styles.notifChipText} numberOfLines={1}>
                            Notifikace
                          </Text>
                          <Text style={styles.notifChipSub} numberOfLines={1}>
                            {notifLabel}
                          </Text>
                        </View>
                      </Pressable>

                      <Pressable
                        onPress={() => openTargetPicker(String(c.id))}
                        style={({ pressed }) => [styles.badgeSquare, pressed && { opacity: 0.85 }]}
                      >
                        <Text style={styles.badgeText}>{target}×</Text>
                      </Pressable>

                      <Switch value={!!c.enabled} onValueChange={() => void toggleEnabled(String(c.id))} />
                    </View>
                  </View>

                  {/* podle zadání: žádný oranžový bar */}
                </Pressable>
              );
            }}
          />
        </View>
      </View>
    </Animated.View>
  );
}