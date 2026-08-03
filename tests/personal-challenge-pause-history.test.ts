import assert from "node:assert/strict";
import test from "node:test";
import { applyChallengeCompletion } from "../lib/challengeCompletion";
import { newestChallengeTimelineFirst } from "../lib/challengeHistoryTimeline";
import {
  backfillSkippedDaysAndBreakStreak,
  calculateStreaksFromHistoryForChallenge,
  defaultState,
  isChallengeActiveOnDate,
  normalizeAppStateSnapshot,
  transitionChallengeEnabled,
  updateStatsOnSkipped,
  type AppState,
  type Challenge,
  type HistoryEntry,
} from "../lib/storage";

const challenge = (overrides: Partial<Challenge> = {}): Challenge => ({
  id: "personal-1", text: "Čtení", enabled: true, period: "daily", ...overrides,
});

const completed = (date: string, time = "19:37"): HistoryEntry => ({
  date, time, atISO: `${date}T${time}:00.000Z`, challengeId: "personal-1",
  challengeText: "Čtení", status: "completed",
});

const stateWith = (c: Challenge, history: HistoryEntry[] = [completed("2026-07-01")]): AppState => ({
  ...defaultState,
  challenges: [c], history, archivedChallenges: [], everCompletedKeys: [],
  challengeStats: { "personal-1": { completedCount: 1, skippedCount: 0, lastCompletedDay: "2026-07-01", lastStreakDay: "2026-07-01", currentStreak: 1, bestStreak: 1, skipCredits: 0 } },
});

test("same-day disable and re-enable preserves streak, history, and medals", () => {
  const original = stateWith(challenge());
  const paused = transitionChallengeEnabled(original.challenges[0], false, "2026-07-01");
  const resumed = transitionChallengeEnabled(paused, true, "2026-07-01");
  const normalized = normalizeAppStateSnapshot({ ...original, challenges: [resumed] });
  assert.equal(normalized.challengeStats?.["personal-1"]?.currentStreak, 1);
  assert.equal(normalized.challengeStats?.["personal-1"]?.bestStreak, 1);
  assert.equal(normalized.history.length, original.history.length);
  assert.equal(normalized.history[0].atISO, original.history[0].atISO);
  assert.deepEqual(resumed.inactivePeriods, []);
});

test("multiple paused days are neutral and next completion continues streak to two", () => {
  const paused = transitionChallengeEnabled(challenge(), false, "2026-07-02");
  const resumed = transitionChallengeEnabled(paused, true, "2026-07-06");
  assert.equal(isChallengeActiveOnDate(resumed, "2026-07-03"), false);
  const before = normalizeAppStateSnapshot(stateWith(resumed));
  assert.equal(before.challengeStats?.["personal-1"]?.currentStreak, 1);
  const result = applyChallengeCompletion(before, "personal-1", "2026-07-06", new Date(2026, 6, 6, 19, 37));
  assert.equal(result.status, "completed");
  assert.equal(result.state.challengeStats?.["personal-1"]?.currentStreak, 2);
  assert.equal(result.state.challengeStats?.["personal-1"]?.bestStreak, 2);
});

test("a genuinely skipped active day breaks current streak without lowering best", () => {
  const initial = stateWith(challenge(), [completed("2026-07-01"), completed("2026-06-30")]);
  initial.challengeStats!["personal-1"] = { ...initial.challengeStats!["personal-1"], currentStreak: 2, bestStreak: 7 };
  const stats = updateStatsOnSkipped(initial, "personal-1", "2026-07-02");
  assert.equal(stats["personal-1"].currentStreak, 0);
  assert.equal(stats["personal-1"].bestStreak, 7);
});

test("backfill creates no skipped entry inside an inactive period", () => {
  const today = new Date();
  const key = (delta: number) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + delta);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const c = challenge({ inactivePeriods: [{ startDate: key(-3), endDate: key(0) }] });
  const initial = stateWith(c, [completed(key(-4))]);
  initial.lastOpenDate = key(-2);
  const result = backfillSkippedDaysAndBreakStreak(initial);
  assert.equal(result.next.history.some((entry) => entry.status === "skipped" && entry.date === key(-1)), false);
});

test("pause-aware history calculation bridges only inactive dates", () => {
  const c = challenge({ inactivePeriods: [{ startDate: "2026-07-02", endDate: "2026-07-06" }] });
  const bridged = calculateStreaksFromHistoryForChallenge([completed("2026-07-06"), completed("2026-07-01")], c.id, c);
  assert.equal(bridged.currentStreak, 2);
  assert.equal(bridged.bestStreak, 2);
  const broken = calculateStreaksFromHistoryForChallenge([completed("2026-07-07"), completed("2026-07-01")], c.id, c);
  assert.equal(broken.currentStreak, 1);
});

test("completion stores local date, time, atISO and partial state", () => {
  const initial = stateWith(challenge({ targetPerDay: 2 }), []);
  initial.challengeStats = {};
  const result = applyChallengeCompletion(initial, "personal-1", "2026-07-01", new Date(2026, 6, 1, 19, 37));
  assert.equal(result.status, "completed");
  assert.deepEqual(result.state.history[0], {
    date: "2026-07-01", time: "19:37", atISO: new Date(2026, 6, 1, 19, 37).toISOString(),
    challengeId: "personal-1", challengeText: "Čtení", status: "completed", partial: true,
  });
});

test("100+ history rows remain complete and newest-first", () => {
  const rows = Array.from({ length: 125 }, (_, index) => ({
    date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String(index % 28 + 1).padStart(2, "0")}`,
    status: "completed", time: "19:37", done: 1, target: 1,
  }));
  const sorted = newestChallengeTimelineFirst(rows);
  assert.equal(sorted.length, 125);
  assert.equal(sorted[0].date, rows[124].date);
  assert.equal(sorted.at(-1)?.date, rows[0].date);
});

test("legacy history is preserved and disabled legacy data migrates idempotently", () => {
  const raw = stateWith(challenge({ enabled: false }), [completed("2025-01-01")]);
  const once = normalizeAppStateSnapshot(raw);
  const twice = normalizeAppStateSnapshot(once);
  assert.equal(twice.history.length, raw.history.length);
  assert.equal(twice.history[0].atISO, raw.history[0].atISO);
  assert.deepEqual(twice.challenges[0].inactivePeriods, once.challenges[0].inactivePeriods);
  assert.equal(twice.challengeStats?.["personal-1"]?.bestStreak, 1);
});
