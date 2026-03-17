// app/profile.tsx
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppState, getCachedState, loadState, subscribeState } from "../lib/storage";
import { isPremiumActive, subscribePremium } from "../lib/premium";
import { useTheme } from "../lib/theme";
import { useTodayISO } from "../lib/clock";

type HistoryEntry = {
  date: string; // YYYY-MM-DD
  status: "completed" | "skipped";
  challengeId?: string;
  challengeText?: string;
};

// ---------- DATE HELPERS ----------
function prevDayISO(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() - 1);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
function nextDayISO(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + 1);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function computeLongestStreakDays(completedDays: Set<string>) {
  if (completedDays.size === 0) return 0;
  const dates = Array.from(completedDays).sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = dates[i - 1];
    const cur = dates[i];
    if (cur === nextDayISO(prev)) {
      run++;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }
  return best;
}

function computeCurrentStreakDays(completedDays: Set<string>, todayISO: string) {
  let streak = 0;
  let cursor = todayISO;
  while (completedDays.has(cursor)) {
    streak++;
    cursor = prevDayISO(cursor);
  }
  return streak;
}

function hasEverCompleted(state: AppState | null, challengeId: string, challengeText: string) {
  const keys = (state as any)?.everCompletedKeys ?? [];
  const idKey = `id:${String(challengeId)}`;
  const textKey = `text:${String(challengeText ?? "")}`;
  return Array.isArray(keys) && (keys.includes(idKey) || keys.includes(textKey));
}

export default function ProfileScreen() {
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

  const stats = useMemo(() => {
    const history: HistoryEntry[] = ((state as any)?.history ?? []) as HistoryEntry[];
    const archived = ((state as any)?.archivedChallenges ?? []) as any[];
    const challenges = (state?.challenges ?? []) as any[];

    const totalCompleted = history.filter((h) => h.status === "completed").length;
    const totalSkipped = history.filter((h) => h.status === "skipped").length;

    const daysWithCompleted = new Set(history.filter((h) => h.status === "completed").map((h) => h.date));
    const longestStreak = computeLongestStreakDays(daysWithCompleted);
    const currentStreak = computeCurrentStreakDays(daysWithCompleted, todayISO);

    const activeChallengesCount = challenges.filter((c) => !c?.deletedAt && c?.enabled !== false).length;

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
      longestStreak,
      currentStreak,
      activeChallengesCount,
      everTotal,
      everActive,
      everArchived,
      archivedCount: archived.length,
      uniqueHistoryChallenges: uniqueHistoryChallengeIds.size,
    };
  }, [state, todayISO]);

  const earnedMedals = useMemo(() => {
    let remaining = stats.longestStreak;
    const medals: Array<{ icon: string; label: string }> = [];

    // ✅ nové prahy: 30 / 90 / 180 dní
    while (remaining >= 180) {
      medals.push({ icon: "🥇", label: "180 dní" });
      remaining -= 180;
    }
    while (remaining >= 90) {
      medals.push({ icon: "🥈", label: "90 dní" });
      remaining -= 90;
    }
    while (remaining >= 30) {
      medals.push({ icon: "🥉", label: "30 dní" });
      remaining -= 30;
    }
    return medals;
  }, [stats.longestStreak]);

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={mode === "dark" ? [UI.bg, UI.bg] : [UI.accent, UI.bg, UI.bg, UI.accent]}
        locations={mode === "dark" ? [0, 1] : [0, 0.3, 0.7, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 10 }]}>
        <Text style={[styles.title, { color: UI.text }]}>Statistika</Text>

        {/* GRID – jako na tvém screenshotu */}
        <View style={styles.grid}>
          <View style={[styles.card, { backgroundColor: UI.card, borderColor: UI.stroke }]}>
            <Text style={[styles.big, { color: UI.text }]}>{stats.currentStreak}</Text>
            <Text style={[styles.small, { color: UI.sub }]}>Aktuální streak (dny)</Text>
          </View>

          <View style={[styles.card, { backgroundColor: UI.card, borderColor: UI.stroke }]}>
            <Text style={[styles.big, { color: UI.text }]}>{stats.longestStreak}</Text>
            <Text style={[styles.small, { color: UI.sub }]}>Nejdelší streak (aplikace)</Text>
          </View>

          <View style={[styles.card, { backgroundColor: UI.card, borderColor: UI.stroke }]}>
            <Text style={[styles.big, { color: UI.text }]}>{stats.activeChallengesCount}</Text>
            <Text style={[styles.small, { color: UI.sub }]}>Aktivní výzvy</Text>
          </View>

          <View style={[styles.card, { backgroundColor: UI.card, borderColor: UI.stroke }]}>
            <Text style={[styles.big, { color: UI.text }]}>{stats.totalCompleted}</Text>
            <Text style={[styles.small, { color: UI.sub }]}>Celkem splněných výzev</Text>
          </View>
        </View>


        

        {/* Medaile */}
        <View style={[styles.medalsCard, { backgroundColor: UI.card, borderColor: UI.stroke }]}>
          <Text style={[styles.medalsTitle, { color: UI.text }]}>Medaile</Text>
          {earnedMedals.length === 0 ? (
            <Text style={[styles.medalsSub, { color: UI.sub }]}>Zatím žádná. Medaile získáš po 30 / 90 / 180 dnech ve streaku.</Text>
          ) : (
            <View style={styles.medalsRow}>
              {earnedMedals.map((m, idx) => (
                <View key={`${m.label}-${idx}`} style={styles.medalItem}>
                  <Text style={styles.medalIcon}>{m.icon}</Text>
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
            <Text style={{ color: UI.text, fontWeight: "900" }}>Otevřít historii výzev</Text>
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
  medalIcon: { fontSize: 28, lineHeight: 32 },
  medalLabel: { fontSize: 12, fontWeight: "900", marginTop: 2 },
});
