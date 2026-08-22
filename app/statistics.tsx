// app/statistics.tsx
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppState, easyModeChallengeIdSet, getCachedState, isChallengeActiveOnDate, isChallengeEasyMode, loadState, subscribeState } from "../lib/storage";
import { isPremiumActive, subscribePremium } from "../lib/premium";
import { useTheme } from "../lib/theme";
import { useTodayISO } from "../lib/useTodayISO";
import { useI18n, type Lang } from "../lib/i18n";
import { countDailySkippedHistory } from "../lib/statisticsHistory";
import { MEDAL_HISTORY_THRESHOLDS } from "../lib/medalCollectionFromHistory";
import { medalDisplaySummaryFromHistory } from "../lib/statisticsMedalSummary";
import type { EarnedMedalTier } from "../lib/medals";

const ROOT_PROFILE_STRINGS: Record<Lang, Record<string, string>> = {
  cs: { title: "Statistika", currentStreak: "Aktuální série (dny)", longestStreak: "Nejdelší série v aplikaci", activeChallenges: "Aktivní výzvy", completed: "Celkem splněných výzev", medals: "Medaile", noMedals: "Zatím žádná. Medaile získáš po 5 / 10 / 20 / 30 / 60 / 90 dnech série.", history: "Otevřít historii výzev", days: "{count} dní" },
  en: { title: "Statistics", currentStreak: "Current streak (days)", longestStreak: "Longest app streak", activeChallenges: "Active challenges", completed: "Challenges completed", medals: "Medals", noMedals: "None yet. You earn medals after streaks of 5 / 10 / 20 / 30 / 60 / 90 days.", history: "Open challenge history", days: "{count} days" },
  pl: { title: "Statystyki", currentStreak: "Aktualna seria (dni)", longestStreak: "Najdłuższa seria w aplikacji", activeChallenges: "Aktywne wyzwania", completed: "Ukończone wyzwania", medals: "Medale", noMedals: "Jeszcze brak. Medale zdobędziesz za serie trwające 5 / 10 / 20 / 30 / 60 / 90 dni.", history: "Otwórz historię wyzwań", days: "{count} dni" },
  de: { title: "Statistik", currentStreak: "Aktuelle Serie (Tage)", longestStreak: "Längste Serie in der App", activeChallenges: "Aktive Challenges", completed: "Abgeschlossene Challenges", medals: "Medaillen", noMedals: "Noch keine. Medaillen erhältst du für Serien von 5 / 10 / 20 / 30 / 60 / 90 Tagen.", history: "Challenge-Verlauf öffnen", days: "{count} Tage" },
};

type HistoryEntry = {
  date: string; // YYYY-MM-DD
  status: "completed" | "skipped";
  challengeId?: string;
  challengeText?: string;
  eventType?: string;
};

const STAT_MEDAL_IMAGES: Record<EarnedMedalTier, any> = {
  brambora: require("../assets/medals/potato_medal.png"),
  steel: require("../assets/medals/steel_medal.png"),
  bronze: require("../assets/medals/bronze_medal.png"),
  silver: require("../assets/medals/silver_medal.png"),
  gold: require("../assets/medals/gold_medal.png"),
  diamond: require("../assets/medals/diamond_medal.png"),
};

function hasEverCompleted(state: AppState | null, challengeId: string, challengeText: string) {
  const keys = (state as any)?.everCompletedKeys ?? [];
  const idKey = `id:${String(challengeId)}`;
  const textKey = `text:${String(challengeText ?? "")}`;
  return Array.isArray(keys) && (keys.includes(idKey) || keys.includes(textKey));
}

export default function ProfileScreen() {
  const { lang } = useI18n();
  const tx = ROOT_PROFILE_STRINGS[lang];
  const router = useRouter();
  const { UI, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const todayISO = useTodayISO();

  const [state, setState] = useState<AppState | null>(() => getCachedState());
  const [premium, setPremium] = useState(false);

  useEffect(() => subscribeState((s) => setState(s)), []);

  useEffect(() => {
    isPremiumActive().then(setPremium);
    const unsub = subscribePremium((p) => setPremium(p));
    return () => unsub();
  }, []);

  const refresh = useCallback(async () => {
    const s = await loadState();
    setState(s);
    const p = await isPremiumActive();
    setPremium(p);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const medalSummary = useMemo(
    () => medalDisplaySummaryFromHistory(state, isChallengeActiveOnDate, todayISO),
    [state, todayISO],
  );

  const stats = useMemo(() => {
    const history: HistoryEntry[] = ((state as any)?.history ?? []) as HistoryEntry[];
    const archived = ((state as any)?.archivedChallenges ?? []) as any[];
    const challenges = (state?.challenges ?? []) as any[];

    const easyIds = easyModeChallengeIdSet(state);
    const normalHistory = history.filter((h: any) => !easyIds.has(String(h?.challengeId ?? "")));

    const totalCompleted = normalHistory.filter((h) => h.status === "completed").length;
    const totalSkipped = countDailySkippedHistory(history);

    const daysWithCompleted = new Set(normalHistory.filter((h) => h.status === "completed").map((h) => h.date));

    const activeChallengesCount = challenges.filter((c) => !c?.deletedAt && c?.enabled !== false && !isChallengeEasyMode(c)).length;

    // výzvy, které jsem kdy splnil (aktivní + dřívější)
    const everActive = challenges.filter((c) => hasEverCompleted(state, String(c.id), String(c.text ?? ""))).length;
    const everArchived = archived.filter((c) => hasEverCompleted(state, String(c.id), String(c.text ?? ""))).length;
    const everTotal = everActive + everArchived;

    // premium navíc: celkový počet unikátních výzev v historii (podle challengeId)
    const uniqueHistoryChallengeIds = new Set(history.map((h: any) => String(h.challengeId ?? "")).filter(Boolean));

    return {
      totalCompleted,
      daysWithCompleted: daysWithCompleted.size,
      totalSkipped,
      longestStreak: medalSummary.longestStreak,
      currentStreak: medalSummary.currentStreak,
      activeChallengesCount,
      everTotal,
      everActive,
      everArchived,
      archivedCount: archived.length,
      uniqueHistoryChallenges: uniqueHistoryChallengeIds.size,
    };
  }, [medalSummary.currentStreak, medalSummary.longestStreak, state]);

  const earnedMedals = useMemo(() => {
    return MEDAL_HISTORY_THRESHOLDS.flatMap(({ tier, days }) => {
      const count = medalSummary.collection.state.counts[tier];
      if (count < 1) return [];
      return [{
        tier,
        image: STAT_MEDAL_IMAGES[tier],
        label: `${tx.days.replace("{count}", String(days))}${count > 1 ? ` ×${count}` : ""}`,
      }];
    });
  }, [medalSummary.collection.state.counts, tx.days]);

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={mode === "dark" ? [UI.bg, UI.bg] : [UI.accent, UI.bg, UI.bg, UI.accent]}
        locations={mode === "dark" ? [0, 1] : [0, 0.3, 0.7, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 10 }]}>
        <Text style={[styles.title, { color: UI.text }]}>{tx.title}</Text>

        {/* GRID – jako na tvém screenshotu */}
        <View style={styles.grid}>
          <View style={[styles.card, { backgroundColor: UI.card, borderColor: UI.stroke }]}>
            <Text style={[styles.big, { color: UI.text }]}>{stats.currentStreak}</Text>
            <Text style={[styles.small, { color: UI.sub }]}>{tx.currentStreak}</Text>
          </View>

          <View style={[styles.card, { backgroundColor: UI.card, borderColor: UI.stroke }]}>
            <Text style={[styles.big, { color: UI.text }]}>{stats.longestStreak}</Text>
            <Text style={[styles.small, { color: UI.sub }]}>{tx.longestStreak}</Text>
          </View>

          <View style={[styles.card, { backgroundColor: UI.card, borderColor: UI.stroke }]}>
            <Text style={[styles.big, { color: UI.text }]}>{stats.activeChallengesCount}</Text>
            <Text style={[styles.small, { color: UI.sub }]}>{tx.activeChallenges}</Text>
          </View>

          <View style={[styles.card, { backgroundColor: UI.card, borderColor: UI.stroke }]}>
            <Text style={[styles.big, { color: UI.text }]}>{stats.totalCompleted}</Text>
            <Text style={[styles.small, { color: UI.sub }]}>{tx.completed}</Text>
          </View>
        </View>


        

        {/* Medaile */}
        <View style={[styles.medalsCard, { backgroundColor: UI.card, borderColor: UI.stroke }]}>
          <Text style={[styles.medalsTitle, { color: UI.text }]}>{tx.medals}</Text>
          {earnedMedals.length === 0 ? (
            <Text style={[styles.medalsSub, { color: UI.sub }]}>{tx.noMedals}</Text>
          ) : (
            <View style={styles.medalsRow}>
              {earnedMedals.map((m) => (
                <View key={m.tier} style={styles.medalItem}>
                  <Image source={m.image} style={styles.medalIcon} resizeMode="contain" />
                  <Text style={[styles.medalLabel, { color: UI.sub }]}>{m.label}</Text>
                </View>
              ))}
            </View>
          )}
        </View>


        {premium && (
          <Pressable
            onPress={() => router.push("/history")}
            style={({ pressed }) => [
              styles.premiumBtn,
              { borderColor: UI.stroke, backgroundColor: UI.card2, marginTop: 16, marginBottom: 24 },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={{ color: UI.text, fontWeight: "900" }}>{tx.history}</Text>
          </Pressable>
        )}

        <View style={{ height: 64 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 28 },
  title: { fontSize: 28, fontWeight: "900", marginBottom: 14 },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 14,
  },
  card: {
    width: "48%",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  big: { fontSize: 22, fontWeight: "900", marginBottom: 6 },
  small: { fontSize: 12, fontWeight: "700", lineHeight: 16 },
  small2: { fontSize: 11, fontWeight: "800", marginTop: 6 },

  premiumCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
    gap: 6,
  },
  premiumTitle: { fontSize: 16, fontWeight: "900", marginBottom: 4 },
  premiumText: { fontSize: 12, fontWeight: "800" },
  premiumBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  medalsCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    alignItems: "center",
  },
  medalsTitle: { fontSize: 16, fontWeight: "900", marginBottom: 6 },
  medalsSub: { fontSize: 13, fontWeight: "700", textAlign: "center", lineHeight: 18 },
  medalsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "center",
    marginTop: 8,
  },
  medalItem: { alignItems: "center", minWidth: 64 },
  medalIcon: { width: 42, height: 42 },
  medalLabel: { fontSize: 12, fontWeight: "900", marginTop: 2 },
});
