import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState, useRef } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { loadChallengesFast, loadChallengeStatsFast } from "../lib/storage";
import { useTheme } from "../lib/theme";

type StatRow = {
  id: string;
  text: string;
  enabled: boolean;
  completed: number;
  skipped: number;
  streak: number;
  lastCompleted?: string;
};

type SummaryStats = {
  bestStreak: number;
  totalCompleted: number;
  activeChallenges: number;
};

const PAGE_SIZE = 50;

let MEM_ALL: StatRow[] | null = null;
let MEM_ROWS: StatRow[] | null = null;
let MEM_ROWS_AT = 0;

function computeSummary(rows: StatRow[]): SummaryStats {
  return rows.reduce(
    (acc, r) => {
      acc.bestStreak = Math.max(acc.bestStreak, Number(r.streak ?? 0));
      acc.totalCompleted += Number(r.completed ?? 0);
      if (r.enabled) acc.activeChallenges += 1;
      return acc;
    },
    {
      bestStreak: 0,
      totalCompleted: 0,
      activeChallenges: 0,
    }
  );
}

function formatDateCZ(iso?: string) {
  if (!iso) return "—";

  const parts = String(iso).split("-");
  if (parts.length !== 3) return iso;

  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);

  if (!y || !m || !d) return iso;

  return `${d}. ${m}. ${y}`;
}

const HistoryCard = React.memo(function HistoryCard({
  r,
  UI,
}: {
  r: StatRow;
  UI: any;
}) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: UI.card, borderColor: UI.stroke },
      ]}
    >
      <View style={styles.cardTopRow}>
        <Text
          style={[styles.cardTitle, { color: UI.text }]}
          numberOfLines={1}
        >
          {r.text || "(bez názvu)"}
        </Text>

        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: r.enabled
                ? "rgba(34,197,94,0.14)"
                : "rgba(148,163,184,0.12)",
              borderColor: r.enabled
                ? "rgba(34,197,94,0.35)"
                : UI.stroke,
            },
          ]}
        >
          <Text
            style={[
              styles.statusBadgeText,
              { color: r.enabled ? "#22c55e" : UI.sub },
            ]}
          >
            {r.enabled ? "Aktivní" : "Vypnutá"}
          </Text>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <View
          style={[
            styles.metricMini,
            { backgroundColor: UI.card2, borderColor: UI.stroke },
          ]}
        >
          <Text style={[styles.metricMiniLabel, { color: UI.sub }]}>
            Splněno
          </Text>
          <Text style={[styles.metricMiniValue, { color: UI.text }]}>
            {r.completed}
          </Text>
        </View>

        <View
          style={[
            styles.metricMini,
            { backgroundColor: UI.card2, borderColor: UI.stroke },
          ]}
        >
          <Text style={[styles.metricMiniLabel, { color: UI.sub }]}>
            Vynecháno
          </Text>
          <Text style={[styles.metricMiniValue, { color: UI.text }]}>
            {r.skipped}
          </Text>
        </View>

        <View
          style={[
            styles.metricMini,
            { backgroundColor: UI.card2, borderColor: UI.stroke },
          ]}
        >
          <Text style={[styles.metricMiniLabel, { color: UI.sub }]}>
            Série
          </Text>
          <Text style={[styles.metricMiniValue, { color: UI.text }]}>
            {r.streak}
          </Text>
        </View>
      </View>

      <Text style={[styles.lastDateText, { color: UI.sub }]} numberOfLines={1}>
        Naposledy:{" "}
        <Text style={{ color: UI.text, fontWeight: "900" }}>
          {formatDateCZ(r.lastCompleted)}
        </Text>
      </Text>
    </View>
  );
});

export default function HistoryScreen() {
  const router = useRouter();
  const { UI, isDark } = useTheme();

  const [rows, setRows] = useState<StatRow[]>(() => MEM_ROWS ?? []);
  const [visibleCount, setVisibleCount] = useState(() =>
    MEM_ROWS ? MEM_ROWS.length : PAGE_SIZE
  );
  const [totalCount, setTotalCount] = useState(() =>
    MEM_ALL ? MEM_ALL.length : MEM_ROWS ? MEM_ROWS.length : 0
  );
  const [loading, setLoading] = useState(() => (MEM_ROWS ? false : true));
  const [summary, setSummary] = useState<SummaryStats>(() =>
    computeSummary(MEM_ALL ?? MEM_ROWS ?? [])
  );
  const [loadingMore, setLoadingMore] = useState(false);

  const runIdRef = useRef(0);
  const allRowsRef = useRef<StatRow[] | null>(MEM_ALL);

  const gradientColors = isDark
    ? [UI.bg, UI.bg, UI.bg]
    : [UI.accent, UI.bg, UI.bg, UI.accent];

  const gradientLocations = isDark ? [0, 0.5, 1] : [0, 0.3, 0.7, 1];

  const reload = useCallback(async () => {
    const runId = ++runIdRef.current;

    if (!MEM_ROWS) setLoading(true);

    try {
      const [challenges, stats] = await Promise.all([
        loadChallengesFast(),
        loadChallengeStatsFast(),
      ]);

      const out: StatRow[] = (challenges ?? []).map((c: any) => {
        const id = String(c.id);
        const st: any = (stats as any)?.[id] ?? {};

        return {
          id,
          text: String(c.text ?? ""),
          enabled: !!c.enabled && !c.deletedAt,
          completed: Number(st.completedCount ?? 0),
          skipped: Number(st.skippedCount ?? 0),
          streak: Number(st.currentStreak ?? 0),
          lastCompleted: st.lastCompletedDay
            ? String(st.lastCompletedDay)
            : undefined,
        };
      });

      out.sort((a, b) => {
        const ae = a.enabled ? 0 : 1;
        const be = b.enabled ? 0 : 1;

        if (ae !== be) return ae - be;
        if (b.completed !== a.completed) return b.completed - a.completed;
        return a.text.localeCompare(b.text);
      });

      if (runIdRef.current === runId) {
        allRowsRef.current = out;
        MEM_ALL = out;
        MEM_ROWS_AT = Date.now();

        const firstPage = out.slice(0, PAGE_SIZE);
        MEM_ROWS = firstPage;

        setTotalCount(out.length);
        setSummary(computeSummary(out));
        setVisibleCount(firstPage.length);
        setRows(firstPage);
      }
    } catch (e) {
      console.warn("History reload failed", e);
    } finally {
      if (runIdRef.current === runId) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const t = setTimeout(() => {
        void reload();
      }, 50);

      return () => clearTimeout(t);
    }, [reload])
  );

  const hasMore = visibleCount < totalCount;

  const loadNextPage = useCallback(() => {
    if (loading || loadingMore) return;

    const all = allRowsRef.current;
    if (!all) return;
    if (visibleCount >= all.length) return;

    setLoadingMore(true);

    setTimeout(() => {
      const nextCount = Math.min(visibleCount + PAGE_SIZE, all.length);
      setVisibleCount(nextCount);
      setRows(all.slice(0, nextCount));
      setLoadingMore(false);
    }, 0);
  }, [loading, loadingMore, visibleCount]);

  return (
    <View style={[styles.screen, { backgroundColor: UI.bg }]}>
      <LinearGradient
        colors={gradientColors as any}
        locations={gradientLocations as any}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.gradient}
      />

      <View style={[styles.header, { borderBottomColor: UI.stroke }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.85 }]}
        >
          <Text style={{ color: UI.text, fontWeight: "900" }}>‹ Zpět</Text>
        </Pressable>

        <Text style={[styles.title, { color: UI.text }]}>Historie výzev</Text>

        <View style={{ width: 54 }} />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.container}
        renderItem={({ item }) => <HistoryCard r={item} UI={UI} />}
        initialNumToRender={14}
        maxToRenderPerBatch={14}
        windowSize={8}
        updateCellsBatchingPeriod={40}
        removeClippedSubviews
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (hasMore) loadNextPage();
        }}
        ListHeaderComponent={
          <View style={{ paddingBottom: 8 }}>
            {loading ? (
              <View style={{ paddingVertical: 10 }}>
                <ActivityIndicator />
                <Text style={{ color: UI.sub, textAlign: "center", marginTop: 6 }}>
                  Načítám historii…
                </Text>
              </View>
            ) : totalCount > 0 ? (
              <>
                <View style={styles.summaryGrid}>
                  <View
                    style={[
                      styles.summaryCard,
                      { backgroundColor: UI.card, borderColor: UI.stroke },
                    ]}
                  >
                    <Text style={[styles.summaryValue, { color: UI.text }]}>
                      {summary.bestStreak}
                    </Text>
                    <Text style={[styles.summaryLabel, { color: UI.sub }]}>
                      Nejlepší série
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.summaryCard,
                      { backgroundColor: UI.card, borderColor: UI.stroke },
                    ]}
                  >
                    <Text style={[styles.summaryValue, { color: UI.text }]}>
                      {summary.totalCompleted}
                    </Text>
                    <Text style={[styles.summaryLabel, { color: UI.sub }]}>
                      Splněno celkem
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.summaryCard,
                      { backgroundColor: UI.card, borderColor: UI.stroke },
                    ]}
                  >
                    <Text style={[styles.summaryValue, { color: UI.text }]}>
                      {summary.activeChallenges}
                    </Text>
                    <Text style={[styles.summaryLabel, { color: UI.sub }]}>
                      Aktivní výzvy
                    </Text>
                  </View>
                </View>

                <Text
                  style={{
                    color: UI.sub,
                    textAlign: "center",
                    paddingBottom: 6,
                    fontSize: 12,
                    fontWeight: "700",
                  }}
                >
                  Zobrazeno {Math.min(rows.length, totalCount)} z {totalCount}
                </Text>
              </>
            ) : null}
          </View>
        }
        ListFooterComponent={
          !loading && hasMore ? (
            <View style={{ paddingVertical: 12 }}>
              {loadingMore ? <ActivityIndicator /> : null}
              <Text style={{ color: UI.sub, textAlign: "center", marginTop: 6 }}>
                {loadingMore ? "Načítám další…" : "Sjeď dolů pro další"}
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          !loading ? (
            <Text style={{ color: UI.sub, textAlign: "center", marginTop: 30 }}>
              Zatím tu nic není. Splň první výzvu a historie se začne plnit.
            </Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  gradient: { ...StyleSheet.absoluteFillObject },

  header: {
    paddingTop: 52,
    paddingHorizontal: 14,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    backgroundColor: "transparent",
  },

  backBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
  },

  title: {
    fontSize: 18,
    fontWeight: "900",
  },

  container: {
    padding: 12,
    paddingBottom: 20,
    gap: 10,
  },

  summaryGrid: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },

  summaryCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },

  summaryValue: {
    fontSize: 18,
    fontWeight: "900",
  },

  summaryLabel: {
    marginTop: 3,
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
  },

  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 10,
  },

  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },

  cardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "900",
  },

  statusBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },

  statusBadgeText: {
    fontSize: 10,
    fontWeight: "900",
  },

  metricsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },

  metricMini: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },

  metricMiniLabel: {
    fontSize: 10,
    fontWeight: "800",
    marginBottom: 4,
  },

  metricMiniValue: {
    fontSize: 16,
    fontWeight: "900",
  },

  lastDateText: {
    fontSize: 11,
    fontWeight: "700",
  },
});