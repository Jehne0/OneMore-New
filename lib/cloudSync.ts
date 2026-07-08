import AsyncStorage from "@react-native-async-storage/async-storage";
import { onAuthStateChanged } from "firebase/auth";
import { fetchCloudState, writeCloudState } from "./cloud";
import { getTodayISO } from "./clock";
import { auth } from "./firebase";
import { cancelScheduledPersonalReminderNotifications } from "./reminders";
import {
  activateUserState,
  clearInMemoryState,
  loadStateForUid,
  localUpdatedAtKeyForUid,
  replaceStateForUid,
  subscribeState,
  type AppState,
  type Challenge,
  type ChallengeStats,
  type HistoryEntry,
} from "./storage";
import { registerPushTokenForCurrentUser } from "./pushTokens";

const REVIEW_ACCOUNT_EMAIL = "review@desigame.eu";

let _unsubState: (() => void) | null = null;
let _unsubAuth: (() => void) | null = null;
let _timer: ReturnType<typeof setTimeout> | null = null;
let _pending: { uid: string; state: AppState; iso: string } | null = null;
let _authGeneration = 0;
let _lastUid: string | null = null;
let _bootstrapUid: string | null = null;
let _bootstrapPromise: Promise<void> | null = null;

export async function getLocalUpdatedAtISO(uid: string): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(localUpdatedAtKeyForUid(uid));
    return v ? String(v) : null;
  } catch {
    return null;
  }
}

export async function setLocalUpdatedAtISO(uid: string, iso: string): Promise<void> {
  try {
    await AsyncStorage.setItem(localUpdatedAtKeyForUid(uid), iso);
  } catch {}
}

function hasMeaningfulState(state?: AppState | null): boolean {
  if (!state) return false;

  return (
    (state.challenges ?? []).length > 0 ||
    (state.history ?? []).length > 0 ||
    Object.keys(state.challengeStats ?? {}).length > 0 ||
    (state.archivedChallenges ?? []).length > 0 ||
    Number(state.streak ?? 0) > 0 ||
    (state.everCompletedKeys ?? []).length > 0
  );
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function historyEntry(date: string, challenge: Challenge, time: string): HistoryEntry {
  return {
    date,
    time,
    atISO: `${date}T${time}:00.000Z`,
    challengeId: challenge.id,
    challengeText: challenge.text,
    status: "completed",
  };
}

function reviewDemoChallengeTemplate(
  id: string,
  text: string,
  enabled: boolean
): Challenge {
  return {
    id,
    text,
    enabled,
    period: "daily",
    customDays: [],
    targetPerDay: 1,
    reminderEnabled: false,
    reminderTimes: [],
  };
}

function createReviewDemoState(): AppState {
  const today = getTodayISO();
  const yesterday = addDaysISO(today, -1);
  const twoDaysAgo = addDaysISO(today, -2);
  const threeDaysAgo = addDaysISO(today, -3);
  const fourDaysAgo = addDaysISO(today, -4);

  const challenges: Challenge[] = [
    reviewDemoChallengeTemplate("1", "Morning walk", true),
    reviewDemoChallengeTemplate("2", "Drink water", true),
    reviewDemoChallengeTemplate("3", "Read 10 minutes", false),
  ];

  const history: HistoryEntry[] = [
    historyEntry(today, challenges[0], "07:35"),
    historyEntry(today, challenges[1], "08:10"),
    historyEntry(yesterday, challenges[0], "07:30"),
    historyEntry(yesterday, challenges[1], "08:05"),
    historyEntry(twoDaysAgo, challenges[0], "07:40"),
    historyEntry(twoDaysAgo, challenges[1], "08:15"),
    historyEntry(threeDaysAgo, challenges[0], "07:25"),
    historyEntry(fourDaysAgo, challenges[1], "08:20"),
  ];

  const challengeStats: Record<string, ChallengeStats> = {
    "1": {
      completedCount: 4,
      skippedCount: 0,
      lastCompletedDay: today,
      lastStreakDay: today,
      currentStreak: 4,
      bestStreak: 4,
      skipCredits: 0,
    },
    "2": {
      completedCount: 4,
      skippedCount: 0,
      lastCompletedDay: today,
      lastStreakDay: today,
      currentStreak: 3,
      bestStreak: 3,
      skipCredits: 0,
    },
  };

  return {
    challenges,
    easyModeChallengeIds: [],
    reminderNotifIds: {},
    lastPickDate: today,
    dailyIds: ["1"],
    lastCompletedDate: today,
    streak: 4,
    lastOpenDate: today,
    mode: "RANDOM_1",
    oddEvenIds: { odd: "1", even: "2" },
    challengeStats,
    history,
    archivedChallenges: [],
    everCompletedKeys: ["id:1", "id:2"],
  };
}

function isReviewAccount(): boolean {
  return (auth.currentUser?.email ?? "").trim() === REVIEW_ACCOUNT_EMAIL;
}

function normalizedChallengeName(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function nextReviewChallengeId(state: AppState): string {
  const ids = [
    ...(state.challenges ?? []).map((c) => c.id),
    ...(state.archivedChallenges ?? []).map((c) => c.id),
    ...(state.history ?? []).map((h) => h.challengeId),
  ]
    .map((id) => Number(id ?? 0))
    .filter((id) => Number.isFinite(id) && id > 0);

  return String(Math.max(0, ...ids) + 1);
}

function ensureReviewChallenge(
  state: AppState,
  name: "Morning walk" | "Drink water" | "Read 10 minutes",
  enabled: boolean
): { state: AppState; challenge: Challenge; changed: boolean } {
  const wantedName = normalizedChallengeName(name);
  const index = (state.challenges ?? []).findIndex(
    (challenge) => normalizedChallengeName(challenge.text) === wantedName
  );

  if (index < 0) {
    const challenge = reviewDemoChallengeTemplate(nextReviewChallengeId(state), name, enabled);
    return {
      state: { ...state, challenges: [...(state.challenges ?? []), challenge] },
      challenge,
      changed: true,
    };
  }

  const existing = state.challenges[index];
  const next: Challenge = {
    ...existing,
    text: name,
    enabled,
    deletedAt: undefined,
    period: existing.period === "every2" || existing.period === "custom" ? existing.period : "daily",
    customDays: Array.isArray(existing.customDays) ? existing.customDays : [],
    targetPerDay:
      typeof existing.targetPerDay === "number" && Number.isFinite(existing.targetPerDay) && existing.targetPerDay > 0
        ? existing.targetPerDay
        : 1,
    reminderEnabled: typeof existing.reminderEnabled === "boolean" ? existing.reminderEnabled : false,
    reminderTimes: Array.isArray(existing.reminderTimes) ? existing.reminderTimes : [],
  };

  const changed = JSON.stringify(existing) !== JSON.stringify(next);
  if (!changed) return { state, challenge: existing, changed: false };

  const challenges = [...(state.challenges ?? [])];
  challenges[index] = next;
  return { state: { ...state, challenges }, challenge: next, changed: true };
}

function countFullCompletionsForChallenge(history: HistoryEntry[], challengeId: string): number {
  return history.filter(
    (entry) =>
      String(entry.challengeId ?? "") === challengeId &&
      entry.status === "completed" &&
      entry.partial !== true
  ).length;
}

function ensureReviewHistory(
  state: AppState,
  challenge: Challenge,
  dates: string[],
  times: string[]
): { state: AppState; changed: boolean } {
  let changed = false;
  const history = [...(state.history ?? [])];

  dates.forEach((date, index) => {
    const exists = history.some(
      (entry) =>
        String(entry.challengeId ?? "") === String(challenge.id) &&
        entry.date === date &&
        entry.status === "completed" &&
        entry.partial !== true
    );

    if (!exists) {
      history.push(historyEntry(date, challenge, times[index] ?? "08:00"));
      changed = true;
    }
  });

  return changed ? { state: { ...state, history }, changed } : { state, changed };
}

function ensureReviewStats(
  state: AppState,
  challenge: Challenge,
  currentStreak: number
): { state: AppState; changed: boolean } {
  const id = String(challenge.id);
  const stats = { ...(state.challengeStats ?? {}) };
  const existing = stats[id] ?? {
    completedCount: 0,
    skippedCount: 0,
    currentStreak: 0,
    bestStreak: 0,
    skipCredits: 0,
  };
  const today = getTodayISO();
  const completedCount = countFullCompletionsForChallenge(state.history ?? [], id);
  const next: ChallengeStats = {
    ...existing,
    completedCount: Math.max(Number(existing.completedCount ?? 0), completedCount),
    skippedCount: Number(existing.skippedCount ?? 0),
    lastCompletedDay: today,
    lastStreakDay: today,
    currentStreak: Math.max(Number(existing.currentStreak ?? 0), currentStreak),
    bestStreak: Math.max(Number(existing.bestStreak ?? 0), currentStreak),
    skipCredits: Math.min(1, Math.max(0, Number(existing.skipCredits ?? 0))),
  };

  const changed = JSON.stringify(existing) !== JSON.stringify(next);
  if (!changed) return { state, changed: false };

  stats[id] = next;
  return { state: { ...state, challengeStats: stats }, changed: true };
}

function ensureReviewDemoState(state: AppState): { state: AppState; changed: boolean } {
  const today = getTodayISO();
  const yesterday = addDaysISO(today, -1);
  const twoDaysAgo = addDaysISO(today, -2);
  const threeDaysAgo = addDaysISO(today, -3);
  const fourDaysAgo = addDaysISO(today, -4);
  let next = state;
  let changed = false;

  const morning = ensureReviewChallenge(next, "Morning walk", true);
  next = morning.state;
  changed = changed || morning.changed;

  const water = ensureReviewChallenge(next, "Drink water", true);
  next = water.state;
  changed = changed || water.changed;

  const read = ensureReviewChallenge(next, "Read 10 minutes", false);
  next = read.state;
  changed = changed || read.changed;

  const morningHistory = ensureReviewHistory(
    next,
    morning.challenge,
    [today, yesterday, twoDaysAgo, threeDaysAgo],
    ["07:35", "07:30", "07:40", "07:25"]
  );
  next = morningHistory.state;
  changed = changed || morningHistory.changed;

  const waterHistory = ensureReviewHistory(
    next,
    water.challenge,
    [today, yesterday, twoDaysAgo, fourDaysAgo],
    ["08:10", "08:05", "08:15", "08:20"]
  );
  next = waterHistory.state;
  changed = changed || waterHistory.changed;

  const morningStats = ensureReviewStats(next, morning.challenge, 4);
  next = morningStats.state;
  changed = changed || morningStats.changed;

  const waterStats = ensureReviewStats(next, water.challenge, 3);
  next = waterStats.state;
  changed = changed || waterStats.changed;

  const ever = new Set((next.everCompletedKeys ?? []).map(String));
  const beforeEverSize = ever.size;
  ever.add(`id:${String(morning.challenge.id)}`);
  ever.add(`id:${String(water.challenge.id)}`);
  if (ever.size !== beforeEverSize) {
    next = { ...next, everCompletedKeys: Array.from(ever) };
    changed = true;
  }

  const statePatch: Partial<AppState> = {};
  if (Number(next.streak ?? 0) < 4) statePatch.streak = 4;
  if (next.lastCompletedDate !== today) statePatch.lastCompletedDate = today;
  if (next.lastOpenDate !== today) statePatch.lastOpenDate = today;
  if ((next.dailyIds ?? []).length === 0) statePatch.dailyIds = [String(morning.challenge.id)];
  if (!next.lastPickDate) statePatch.lastPickDate = today;

  if (Object.keys(statePatch).length) {
    next = { ...next, ...statePatch };
    changed = true;
  }

  return { state: next, changed };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function syncNow(expectedUid?: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  const uid = user.uid;
  if (expectedUid && expectedUid !== uid) return;

  const local = await loadStateForUid(uid);
  const localISO = await getLocalUpdatedAtISO(uid);
  const cloud = await fetchCloudState(uid);

  if (auth.currentUser?.uid !== uid) return;

  const cloudISO = cloud?.clientUpdatedAtISO || null;

  if (cloud?.state && hasMeaningfulState(cloud.state)) {
    const repaired = isReviewAccount() ? ensureReviewDemoState(cloud.state) : null;
    const iso = repaired?.changed ? new Date().toISOString() : cloudISO || new Date().toISOString();
    const state = repaired?.state ?? cloud.state;
    await replaceStateForUid(state, uid, iso);
    if (repaired?.changed) {
      await writeCloudState(uid, state, iso);
    }
    await setLocalUpdatedAtISO(uid, iso);
    return;
  }

  if (hasMeaningfulState(local)) {
    const repaired = isReviewAccount() ? ensureReviewDemoState(local) : null;
    const iso = repaired?.changed ? new Date().toISOString() : localISO ?? new Date().toISOString();
    const state = repaired?.state ?? local;
    if (repaired?.changed) {
      await replaceStateForUid(state, uid, iso);
    }
    await writeCloudState(uid, state, iso);
    await setLocalUpdatedAtISO(uid, iso);
    return;
  }

  if (isReviewAccount()) {
    const iso = new Date().toISOString();
    const demoState = await replaceStateForUid(ensureReviewDemoState(createReviewDemoState()).state, uid, iso);
    await writeCloudState(uid, demoState, iso);
    await setLocalUpdatedAtISO(uid, iso);
  }
}

function scheduleUpload(uid: string, state: AppState) {
  const iso = new Date().toISOString();
  _pending = { uid, state, iso };

  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(async () => {
    const user = auth.currentUser;
    const p = _pending;
    _pending = null;
    _timer = null;
    if (!user || !p || user.uid !== p.uid) return;

    try {
      await writeCloudState(p.uid, p.state, p.iso);
      await setLocalUpdatedAtISO(p.uid, p.iso);
    } catch {
      // Keep the AsyncStorage cache as the source until connectivity returns.
    }
  }, 900);
}

export function startCloudAutoSync() {
  if (_unsubState) return;

  _unsubState = subscribeState((state) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    scheduleUpload(uid, state);
  });
}

export function stopCloudAutoSync() {
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }

  _pending = null;
  _unsubState?.();
  _unsubState = null;
}

export function initCloudSync() {
  if (_unsubAuth) return;

  _unsubAuth = onAuthStateChanged(auth, (user) => {
    const generation = ++_authGeneration;
    const uid = user?.uid ?? null;
    const previousUid = _lastUid;
    _lastUid = uid;
    _bootstrapUid = uid;

    const task = (async () => {
      stopCloudAutoSync();
      clearInMemoryState();

      if (previousUid && previousUid !== uid) {
        try {
          await cancelScheduledPersonalReminderNotifications();
        } catch {}
      }

      if (!user || generation !== _authGeneration) return;

      try {
        await activateUserState(user.uid);
      } catch {
        // A missing UID-scoped state intentionally remains clean.
      }

      if (generation !== _authGeneration || auth.currentUser?.uid !== user.uid) return;

      try {
        await syncNow(user.uid);
      } catch {
        // Offline startup should still use the local AsyncStorage cache.
      }

      if (generation !== _authGeneration || auth.currentUser?.uid !== user.uid) return;

      try {
        await registerPushTokenForCurrentUser();
      } catch {
        if (__DEV__) {
          console.log("Push token registration failed");
        }
      }

      if (generation === _authGeneration && auth.currentUser?.uid === user.uid) {
        startCloudAutoSync();
      }
    })();

    _bootstrapPromise = task;
    void task;
  });
}

export async function waitForCloudSyncReady(
  expectedUid: string
): Promise<void> {
  if (!expectedUid) return;
  initCloudSync();

  while (
    (!_bootstrapPromise || _bootstrapUid !== expectedUid) &&
    auth.currentUser?.uid === expectedUid
  ) {
    await delay(25);
  }

  if (!_bootstrapPromise || _bootstrapUid !== expectedUid) return;

  await _bootstrapPromise;
}
