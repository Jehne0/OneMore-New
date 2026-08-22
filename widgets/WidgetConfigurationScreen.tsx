import React, { useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { WidgetConfigurationScreenProps } from "react-native-android-widget";
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from "react-native-safe-area-context";
import { auth } from "../lib/firebase";
import { readStoredLanguage, type Lang } from "../lib/i18n";
import { loadStateForUid } from "../lib/storage";
import { syncNow } from "../lib/cloudSync";
import { isPremiumConfirmedForUid, readPremiumSnapshot } from "../lib/premium";
import { openCancelSubscription, revenueCatLogin } from "../lib/revenuecat";
import type { PremiumAccessState } from "../lib/premiumSnapshot";
import { readSharedCache } from "../lib/sharedCompletion";
import { premiumWidgetDestination } from "../lib/widgetAccess";
import { reconcileAllWidgetConfigs, resolveWidgetAddRequest, saveWidgetSelection, type WidgetSelectionMode } from "../lib/widgetConfig";
import { readWidgetActiveUid, resolveWidgetAuthState, setWidgetActiveUid, type WidgetAuthState } from "../lib/widgetSession";
import { createVisibleFallback } from "./OneMoreWidget";
import { updateAllOneMoreWidgets } from "./widgetService";
import { isAccountSnapshotPremiumAt, readAccountSnapshot, resolveAccountPremiumBootstrapState, writeAccountSnapshot } from "../lib/accountSnapshot";

type Row = { id: string; title: string; shared: boolean };
export const copy: Record<Lang, Record<string, string>> = {
  cs: { title: "Nastavit widget", loading: "Načítání účtu a výzev…", checkingPremium: "Kontroluji Premium…", premiumActive: "Premium aktivní", frozen: "Zamčeno po skončení Premium", activate: "Aktivovat", selected: "Vybráno", personal: "Osobní", shared: "Společná", add: "+ Přidat", remove: "Odebrat", save: "Uložit", cancel: "Zrušit", automatic: "Automaticky zobrazovat dnešní výzvy", signedOut: "Nejdřív se přihlas v OneMore.", empty: "Nejsou dostupné žádné výzvy.", error: "Konfiguraci se nepodařilo načíst. Zkus to znovu.", premiumTitle: "Více výzev je Premium", premiumBody: "Free widget může zobrazit jednu výzvu.", getPremium: "Získat Premium", managePremium: "Spravovat Premium" },
  en: { title: "Configure widget", loading: "Loading your account and challenges…", checkingPremium: "Checking Premium…", premiumActive: "Premium active", frozen: "Locked after Premium expired", activate: "Activate", selected: "Selected", personal: "Personal", shared: "Shared", add: "+ Add", remove: "Remove", save: "Save", cancel: "Cancel", automatic: "Automatically show today's challenges", signedOut: "Sign in to OneMore first.", empty: "No challenges are available.", error: "The configuration could not be loaded. Try again.", premiumTitle: "Multiple challenges are Premium", premiumBody: "The Free widget can show one challenge.", getPremium: "Get Premium", managePremium: "Manage Premium" },
  pl: { title: "Ustaw widget", loading: "Wczytywanie konta i wyzwań…", checkingPremium: "Sprawdzam Premium…", premiumActive: "Premium aktywne", frozen: "Zablokowane po wygaśnięciu Premium", activate: "Aktywuj", selected: "Wybrano", personal: "Osobiste", shared: "Wspólne", add: "+ Dodaj", remove: "Usuń", save: "Zapisz", cancel: "Anuluj", automatic: "Automatycznie pokazuj dzisiejsze wyzwania", signedOut: "Najpierw zaloguj się w OneMore.", empty: "Brak dostępnych wyzwań.", error: "Nie udało się wczytać konfiguracji. Spróbuj ponownie.", premiumTitle: "Wiele wyzwań wymaga Premium", premiumBody: "Darmowy widget może pokazać jedno wyzwanie.", getPremium: "Uzyskaj Premium", managePremium: "Zarządzaj Premium" },
  de: { title: "Widget einrichten", loading: "Konto und Challenges werden geladen…", checkingPremium: "Premium wird geprüft…", premiumActive: "Premium aktiv", frozen: "Nach Premium-Ablauf gesperrt", activate: "Aktivieren", selected: "Ausgewählt", personal: "Persönlich", shared: "Gemeinsam", add: "+ Hinzufügen", remove: "Entfernen", save: "Speichern", cancel: "Abbrechen", automatic: "Heutige Challenges automatisch anzeigen", signedOut: "Melde dich zuerst bei OneMore an.", empty: "Keine Challenges verfügbar.", error: "Die Konfiguration konnte nicht geladen werden. Versuche es erneut.", premiumTitle: "Mehrere Challenges sind Premium", premiumBody: "Das kostenlose Widget kann eine Challenge anzeigen.", getPremium: "Premium holen", managePremium: "Premium verwalten" },
};

function rowsFromCaches(state: Awaited<ReturnType<typeof loadStateForUid>>, sharedCache: Awaited<ReturnType<typeof readSharedCache>>, uid: string): Row[] {
  const personal: Row[] = (state.challenges ?? [])
    .filter((item) => item.enabled !== false && !item.deletedAt)
    .map((item) => ({ id: String(item.id), title: item.text, shared: false }));
  const shared: Row[] = sharedCache
    .filter((item) => item.enabled !== false && item.status === "active" && item.memberUids.includes(uid) && !(item.leftBy ?? []).includes(uid))
    .map((item) => ({ id: item.id, title: item.title, shared: true }));
  return [...personal, ...shared];
}

async function loadConfigurationData(widgetId: number, uid: string) {
  const [state, shared, premium] = await Promise.all([
    loadStateForUid(uid), readSharedCache(uid), isPremiumConfirmedForUid(uid),
  ]);
  const rows = rowsFromCaches(state, shared, uid);
  const reconciled = await reconcileAllWidgetConfigs(uid, rows.map((row) => row.id), premium, [widgetId]);
  return {
    rows,
    config: reconciled.configs.get(widgetId) ?? null,
    premium,
    accessPolicy: reconciled.policy,
  };
}

export function WidgetConfigurationContent({ widgetInfo, renderWidget, setResult }: WidgetConfigurationScreenProps) {
  const insets = useSafeAreaInsets();
  const [language, setLanguage] = useState<Lang | null>(null);
  const [authState, setAuthState] = useState<WidgetAuthState>({ kind: "restoringLocalSession" });
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<WidgetSelectionMode>("manual");
  const [premium, setPremium] = useState(false);
  const [premiumState, setPremiumState] = useState<PremiumAccessState>("unknown");
  const [activeFreeId, setActiveFreeId] = useState<string | null>(null);
  const [managementURL, setManagementURL] = useState<string | null>(null);
  const t = language ? copy[language] : null;
  const uid = "uid" in authState ? authState.uid : null;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [storedLanguage, activeUid] = await Promise.all([readStoredLanguage(), readWidgetActiveUid()]);
        if (!active) return;
        setLanguage(storedLanguage);
        let accountSnapshot = activeUid ? await readAccountSnapshot(activeUid) : null;
        const cachedUid = activeUid ?? auth.currentUser?.uid ?? null;
        if (cachedUid) {
          const snapshot = await readPremiumSnapshot(cachedUid);
          if (!accountSnapshot) {
            const displayNameFallback = await AsyncStorage.getItem(`onemore_profile_name:${cachedUid}`);
            accountSnapshot = await writeAccountSnapshot({
              activeUid: cachedUid, displayNameFallback,
              premiumState: snapshot ? (snapshot.isPremiumActive ? "premium" : "free") : "checking",
              expirationDate: snapshot?.expirationDate ?? null, lifetime: snapshot?.isLifetime ?? false,
              willRenew: snapshot?.willRenew ?? null, managementURL: snapshot?.managementURL ?? null,
              checkedAt: snapshot?.checkedAt ?? new Date().toISOString(),
            }).catch(() => null);
          }
          const cachedPremium = accountSnapshot ? isAccountSnapshotPremiumAt(accountSnapshot) : await isPremiumConfirmedForUid(cachedUid);
          if (!active) return;
          setAuthState(accountSnapshot ? { kind: "cachedAuthenticated", uid: cachedUid } : { kind: "restoringFirebaseAuth", uid: cachedUid });
          setPremium(cachedPremium);
          setManagementURL(accountSnapshot?.managementURL ?? snapshot?.managementURL ?? null);
          const bootstrapPremiumState = resolveAccountPremiumBootstrapState(accountSnapshot);
          setPremiumState(bootstrapPremiumState === "checking" ? "restoringSession" : bootstrapPremiumState);
          if (__DEV__) console.log("[Widget account bootstrap]", { widgetId: widgetInfo.widgetId, uid: `${cachedUid.slice(0, 3)}***`, accountSnapshotFound: !!accountSnapshot, premiumSnapshotFound: !!snapshot, snapshotActive: cachedPremium, expirationDate: accountSnapshot?.expirationDate ?? snapshot?.expirationDate ?? null });

          const cached = await loadConfigurationData(widgetInfo.widgetId, cachedUid);
          if (!active) return;
          setRows(cached.rows);
          const configuredIds = cached.config?.orderedChallengeIds ?? [];
          const globalActiveId = cached.accessPolicy.activeFreeChallengeId ?? configuredIds[0] ?? null;
          setSelected(configuredIds);
          setMode(cached.config?.mode ?? "manual");
          setActiveFreeId(globalActiveId);
        }
        const resolved = await resolveWidgetAuthState({
          activeUid: cachedUid,
          // The configuration activity can run in a separate RN lifecycle. The native
          // SharedPreferences value mirrors the Firebase JS session and is authoritative here.
          waitForAuthReady: () => auth.authStateReady(),
          getAuthenticatedUid: () => auth.currentUser?.uid ?? null,
          persistActiveUid: (nextUid) => setWidgetActiveUid(nextUid),
          hasCachedAccount: !!accountSnapshot,
        });
        if (!active) return;
        setAuthState(resolved);
        if (!("uid" in resolved) || !resolved.uid) return;
        const resolvedUid = resolved.uid;

        // Render the UID-scoped local cache first; a missing cache is a valid empty state.
        const cached = await loadConfigurationData(widgetInfo.widgetId, resolvedUid);
        if (!active) return;
        setRows(cached.rows);
        const configuredIds = cached.config?.orderedChallengeIds ?? [];
        const globalActiveId = cached.accessPolicy.activeFreeChallengeId ?? configuredIds[0] ?? null;
        setSelected(configuredIds);
        setMode(cached.config?.mode ?? "manual");
        setActiveFreeId(globalActiveId);
        const effectiveCachedPremium = accountSnapshot?.activeUid === resolvedUid
          ? isAccountSnapshotPremiumAt(accountSnapshot)
          : cached.premium;
        setPremium(effectiveCachedPremium);
        const bootstrapPremiumState = resolveAccountPremiumBootstrapState(accountSnapshot);
        setPremiumState(bootstrapPremiumState === "checking" ? "checkingPremium" : bootstrapPremiumState);

        if (resolved.kind === "authenticated") try {
          await revenueCatLogin(resolvedUid);
          const verified = await isPremiumConfirmedForUid(resolvedUid);
          if (!active) return;
          setPremium(verified);
          setPremiumState(verified ? "premium" : "free");
        } catch (error) {
          if (!active) return;
          setPremiumState(effectiveCachedPremium ? "errorWithValidCache" : "errorWithoutCache");
          if (__DEV__) console.log("[Widget Premium verification error]", { uid: `${resolvedUid.slice(0, 3)}***`, cachedPremium: effectiveCachedPremium, error: String((error as Error)?.message ?? error) });
        }

        // Refresh opportunistically. Offline/error conditions keep the safe local cache.
        void syncNow(resolvedUid).then(async () => {
          const refreshed = await loadConfigurationData(widgetInfo.widgetId, resolvedUid);
          if (!active || auth.currentUser?.uid !== resolvedUid) return;
          setRows(refreshed.rows);
          setSelected(refreshed.config?.orderedChallengeIds ?? []);
          setMode(refreshed.config?.mode ?? "manual");
          setActiveFreeId(refreshed.accessPolicy.activeFreeChallengeId);
          setPremium(refreshed.premium);
        }).catch(() => {});
      } catch {
        if (active) setAuthState((current) => "uid" in current && current.uid
          ? { kind: "errorWithValidCache", uid: current.uid }
          : { kind: "errorWithoutCache" });
      }
    })();
    return () => { active = false; };
  }, [widgetInfo.widgetId]);

  const selectedRows = useMemo(() => selected.map((id) => rows.find((row) => row.id === id)).filter((row): row is Row => !!row), [rows, selected]);
  const availableRows = useMemo(() => rows.filter((row) => !selected.includes(row.id)), [rows, selected]);
  const premiumDecisionPending = premiumState === "unknown" || premiumState === "restoringSession" || premiumState === "checkingPremium";
  const premiumForDisplay = premium || premiumDecisionPending;

  if (!t) return <View style={styles.screen} />;

  function add(id: string) {
    if (premiumDecisionPending) return;
    const result = resolveWidgetAddRequest(selected, id, premium);
    if (result.requiresPremium) {
      Alert.alert(t!.premiumTitle, t!.premiumBody, [
        { text: t!.cancel, style: "cancel" },
        { text: t!.getPremium, onPress: () => void Linking.openURL(premiumWidgetDestination(uid)) },
      ]);
      return;
    }
    setSelected(result.selectedIds);
  }

  function remove(id: string) {
    setSelected((value) => {
      const next = value.filter((item) => item !== id);
      if (activeFreeId === id) setActiveFreeId(next[0] ?? null);
      return next;
    });
  }

  function move(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= selected.length) return;
    setSelected((value) => { const next = [...value]; [next[index], next[destination]] = [next[destination], next[index]]; return next; });
  }

  async function save() {
    if (!uid || !language || premiumDecisionPending) return;
    await saveWidgetSelection(
      { widgetId: widgetInfo.widgetId, uid, mode: premium ? mode : "manual", orderedChallengeIds: selected },
      rows.map((row) => row.id),
      premium,
      activeFreeId ?? selected[0] ?? null,
    );
    if (Platform.OS === "android") renderWidget(createVisibleFallback(widgetInfo, language));
    setResult("ok");
    void updateAllOneMoreWidgets();
  }

  const message = authState.kind === "restoringLocalSession" || authState.kind === "restoringFirebaseAuth" ? t.loading
    : authState.kind === "confirmedSignedOut" ? t.signedOut
      : authState.kind === "errorWithoutCache" ? t.error
        : rows.length === 0 ? t.empty : null;

  return <View style={[styles.screen, { paddingTop: insets.top }]}>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>{t.title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : <>
        {(premiumState === "restoringSession" || premiumState === "checkingPremium") && <Text style={styles.message}>{t.checkingPremium}</Text>}
        {(premiumState === "premium" || premiumState === "errorWithValidCache") && <View style={styles.switchRow}><Text style={styles.label}>{t.premiumActive}</Text><Pressable onPress={() => void openCancelSubscription(managementURL)} style={styles.add}><Text style={styles.addText}>{t.managePremium}</Text></Pressable></View>}
        {premiumForDisplay && <View style={styles.switchRow}><Text style={styles.label}>{t.automatic}</Text><Switch disabled={premiumDecisionPending} value={mode === "automatic"} onValueChange={(value) => setMode(value ? "automatic" : "manual")} /></View>}
        <Text style={styles.section}>{t.selected}: {selectedRows.length}</Text>
        {selectedRows.map((row, index) => { const frozen = !premiumForDisplay && row.id !== (activeFreeId ?? selectedRows[0]?.id); return <View key={`selected:${row.id}`} style={styles.row}>
          <View style={styles.rowText}><Text numberOfLines={2} style={styles.title}>{row.title}</Text><Text style={styles.kind}>{frozen ? t.frozen : row.shared ? t.shared : t.personal}</Text></View>
          {frozen ? <Pressable onPress={() => setActiveFreeId(row.id)} style={styles.add}><Text style={styles.addText}>{t.activate}</Text></Pressable> : <>
          <Pressable accessibilityLabel={`${t.selected} ${index + 1}`} onPress={() => move(index, -1)} style={styles.smallButton}><Text style={styles.buttonText}>↑</Text></Pressable>
          <Pressable accessibilityLabel={`${t.selected} ${index + 1}`} onPress={() => move(index, 1)} style={styles.smallButton}><Text style={styles.buttonText}>↓</Text></Pressable></>}
          <Pressable onPress={() => remove(row.id)} style={styles.remove}><Text style={styles.removeText}>{t.remove}</Text></Pressable>
        </View>})}
        {availableRows.map((row) => <View key={`available:${row.id}`} style={styles.row}><View style={styles.rowText}><Text numberOfLines={2} style={styles.title}>{row.title}</Text><Text style={styles.kind}>{row.shared ? t.shared : t.personal}</Text></View><Pressable onPress={() => add(row.id)} style={styles.add}><Text style={styles.addText}>{t.add}</Text></Pressable></View>)}
      </>}
    </ScrollView>
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <Pressable onPress={() => setResult("cancel")} style={styles.cancel}><Text style={styles.buttonText}>{t.cancel}</Text></Pressable>
      <Pressable disabled={!uid || premiumDecisionPending} onPress={() => void save()} style={[styles.save, (!uid || premiumDecisionPending) && styles.disabled]}><Text style={styles.saveText}>{t.save}</Text></Pressable>
    </View>
  </View>;
}

export function WidgetConfigurationScreen(props: WidgetConfigurationScreenProps) {
  return <SafeAreaProvider initialMetrics={initialWindowMetrics}>
    <WidgetConfigurationContent {...props} />
  </SafeAreaProvider>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0B1220" }, scroll: { flex: 1 }, content: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 18, gap: 10 }, heading: { color: "#F8FAFC", fontSize: 24, fontWeight: "800", marginBottom: 8 }, message: { color: "#CBD5E1", fontSize: 16, paddingVertical: 30, textAlign: "center" }, section: { color: "#F59E0B", fontSize: 14, fontWeight: "700", marginTop: 8 }, switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#111C2D", padding: 12, borderRadius: 14 }, label: { color: "#F8FAFC", flex: 1, marginRight: 10 }, row: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 6, padding: 10, borderRadius: 14, backgroundColor: "#111C2D" }, rowText: { flex: 1, minWidth: 0 }, title: { color: "#F8FAFC", fontSize: 15, fontWeight: "600" }, kind: { color: "#94A3B8", fontSize: 11, marginTop: 3 }, smallButton: { width: 32, height: 36, alignItems: "center", justifyContent: "center", backgroundColor: "#233044", borderRadius: 9 }, remove: { padding: 8 }, removeText: { color: "#FCA5A5", fontSize: 12 }, add: { padding: 10, borderRadius: 10, backgroundColor: "#31230F" }, addText: { color: "#F59E0B", fontWeight: "700" }, footer: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 12, backgroundColor: "#0B1220" }, cancel: { flex: 1, padding: 14, borderRadius: 12, alignItems: "center", backgroundColor: "#233044" }, save: { flex: 1, padding: 14, borderRadius: 12, alignItems: "center", backgroundColor: "#F59E0B" }, disabled: { opacity: 0.4 }, buttonText: { color: "#F8FAFC", fontWeight: "700" }, saveText: { color: "#111827", fontWeight: "800" },
});
