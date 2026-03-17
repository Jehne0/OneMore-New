import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState, useRef } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { loadChallengesFast, loadChallengeStatsFast } from "../lib/storage";
import { useTheme } from "../lib/theme";
import { useTodayISO } from "../lib/clock";

type StatRow = {
  id: string;
  text: string;
  enabled: boolean;
  completed: number;
  skipped: number;
  streak: number;
  lastCompleted?: string;
};

// In-memory cache so returning to History is instant even with large datasets.
// We still refresh in the background on focus.
const PAGE_SIZE = 50;

let MEM_ALL: StatRow[] | null = null;
let MEM_ROWS: StatRow[] | null = null; // cached first page only
let MEM_ROWS_AT = 0;


const HistoryCard = React.memo(function HistoryCard({
  r,
  UI,
}: {
  r: StatRow;
  UI: any;
}) {
  return (
    <View style={[styles.card, { backgroundColor: UI.card, borderColor: UI.stroke }]}>
      <Text style={[styles.cardTitle, { color: UI.text }]} numberOfLines={2}>
        {r.text || "(bez názvu)"}
      </Text>

      <View style={styles.statsRow}>
        <Text style={[styles.stat, { color: UI.sub }]}>
          Splněno: <Text style={{ color: UI.text, fontWeight: "900" }}>{r.completed}</Text>
        </Text>
        <Text style={[styles.stat, { color: UI.sub }]}>
          Vynecháno: <Text style={{ color: UI.text, fontWeight: "900" }}>{r.skipped}</Text>
        </Text>
      </View>

      <View style={styles.statsRow}>
        <Text style={[styles.stat, { color: UI.sub }]}>
          Streak: <Text style={{ color: UI.text, fontWeight: "900" }}>{r.streak}</Text>
        </Text>
        <Text style={[styles.stat, { color: UI.sub }]}>
          Naposledy: <Text style={{ color: UI.text, fontWeight: "900" }}>{r.lastCompleted ?? "—"}</Text>
        </Text>
      </View>

      <Text style={[styles.badge, { color: r.enabled ? UI.text : UI.sub }]}>
        {r.enabled ? "Aktivní" : "Vypnutá"}
      </Text>
    </View>
  );
});

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function addDaysISO(iso: string, deltaDays: number) {
  const dt = isoToDate(iso);
  dt.setDate(dt.getDate() + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export default function HistoryScreen() {
  const router = useRouter();
  const { UI, isDark } = useTheme();
  const todayISO = useTodayISO();

  // If we have cached rows, show them immediately and refresh in background.
  const [rows, setRows] = useState<StatRow[]>(() => MEM_ROWS ?? []);
  const [visibleCount, setVisibleCount] = useState(() => (MEM_ROWS ? MEM_ROWS.length : PAGE_SIZE));
  const [totalCount, setTotalCount] = useState(() => (MEM_ALL ? MEM_ALL.length : MEM_ROWS ? MEM_ROWS.length : 0));
  const [loading, setLoading] = useState(() => (MEM_ROWS ? false : true));
  const [loadingMore, setLoadingMore] = useState(false);
  const runIdRef = useRef(0);
  const hasLoadedRef = useRef(!!MEM_ROWS);
  const allRowsRef = useRef<StatRow[] | null>(MEM_ALL);

  const gradientColors = isDark ? [UI.bg, UI.bg, UI.bg] : [UI.accent, UI.bg, UI.bg, UI.accent];
  const gradientLocations = isDark ? [0, 0.5, 1] : [0, 0.3, 0.7, 1];

  const reload = useCallback(async () => {
    const runId = ++runIdRef.current;
    // Nech zobrazit UI okamžitě: spinner hlavně při prvním načtení.
    if (!hasLoadedRef.current) setLoading(true);

    try {
      // ✅ FAST: žádné čtení velkého JSONu (history/archiv). Jen malé klíče.
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
          lastCompleted: st.lastCompletedDay ? String(st.lastCompletedDay) : undefined,
        };
      });

      // stable sort: enabled first, then by completed desc, then text
      out.sort((a, b) => {
        const ae = a.enabled ? 0 : 1;
        const be = b.enabled ? 0 : 1;
        if (ae !== be) return ae - be;
        if (b.completed !== a.completed) return b.completed - a.completed;
        return a.text.localeCompare(b.text);
      });

      if (runIdRef.current === runId) {
        // Pagination: render only the first page immediately.
        allRowsRef.current = out;
        MEM_ALL = out;
        setTotalCount(out.length);
        setTotalCount(out.length);

        const firstPage = out.slice(0, PAGE_SIZE);
        setVisibleCount(firstPage.length);
        setRows(firstPage);
        hasLoadedRef.current = true;
        MEM_ROWS = firstPage;
        MEM_ROWS_AT = Date.now();
      }
    } catch (e) {
      console.warn("History reload failed", e);
    } finally {
      if (runIdRef.current === runId) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      // DŮLEŽITÉ: Nechceme blokovat přechod na obrazovku (I/O + JSON.parse).
      // Proto vždy nejdřív ukážeme cached první stránku a refresh pustíme až po chvilce,
      // a jen když je cache prázdná nebo "stará".
      const staleMs = 30_000;
      const shouldReload = !hasLoadedRef.current || Date.now() - MEM_ROWS_AT > staleMs;

      if (!shouldReload) return;

      const t = setTimeout(() => {
        void reload();
      }, 250);
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
    // Yield to UI thread so scrolling stays smooth.
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
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.85 }]}>
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
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (hasMore) loadNextPage();
        }}
        ListHeaderComponent={
          loading ? (
            <View style={{ paddingVertical: 10 }}>
              <ActivityIndicator />
              <Text style={{ color: UI.sub, textAlign: "center", marginTop: 6 }}>Načítám historii…</Text>
            </View>
          ) : totalCount > 0 ? (
            <Text style={{ color: UI.sub, textAlign: "center", paddingBottom: 8 }}>
              Zobrazeno {Math.min(rows.length, totalCount)} z {totalCount}
            </Text>
          ) : null
        }
        ListFooterComponent={
          !loading && hasMore ? (
            <View style={{ paddingVertical: 14 }}>
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
    // Posuň hlavičku níž (název i tlačítko Zpět mají být níže).
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
  title: { fontSize: 18, fontWeight: "900" },
  container: { padding: 16, paddingBottom: 26, gap: 12 },
  card: { borderWidth: 1, borderRadius: 18, padding: 14 },
  cardTitle: { fontSize: 15, fontWeight: "900", marginBottom: 10 },
  statsRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, marginTop: 4 },
  stat: { fontSize: 12, fontWeight: "700" },
  badge: { marginTop: 10, fontSize: 12, fontWeight: "900" },
});
