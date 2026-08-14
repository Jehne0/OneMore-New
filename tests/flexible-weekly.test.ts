import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyChallengeCompletion } from "../lib/challengeCompletion";
import { preserveUnknownFlexibleWeeklyFields } from "../lib/cloudMergePolicy";
import {
  addLocalDays,
  canCompleteFlexibleWeekly,
  flexibleWeeklyProgress,
  flexibleWeeklyWindowForDate,
  nextWeekdayOnOrAfter,
  normalizeFlexibleWeeklyFields,
  reconcileFlexibleWeeklyPeriods,
  scheduleFlexibleWeeklySettings,
} from "../lib/flexibleWeekly";
import { createWidgetModel } from "../lib/widgetModel";
import { createIosWidgetSnapshot } from "../lib/iosWidgetSnapshot";
import { flexibleWeeklyWindowForServer } from "../functions/src/flexibleWeeklyCore";
import { medalCollectionFromHistory } from "../lib/medalCollectionFromHistory";
import { formatFlexibleWeeklyMissedLabel } from "../lib/flexibleWeeklyPresentation";
import { countDailySkippedHistory } from "../lib/statisticsHistory";
import { medalDisplaySummaryFromHistory } from "../lib/statisticsMedalSummary";
import { clearDebugTodayISO, setDebugTodayISO } from "../lib/clock";
import {
  applyPlanAccessToFlexibleWeeklyState,
  isChallengeActiveOnDate,
  loadStateForUid,
  replaceStateForUid,
  saveStateForUid,
  transitionChallengeEnabled,
} from "../lib/storage";

function challenge(overrides: Record<string, unknown> = {}) {
  return {
    id: "flex-1", text: "Bike", enabled: true, period: "flexibleWeekly",
    targetPerDay: 1, flexibleWeeklyTarget: 2, flexibleWeeklyStartDay: 0,
    flexibleWeeklyFirstPeriodStart: "2026-03-23", reminderEnabled: false,
    reminderTimes: [], ...overrides,
  } as any;
}

function state(overrides: Record<string, unknown> = {}) {
  return {
    challenges: [challenge()], streak: 0, history: [], archivedChallenges: [],
    everCompletedKeys: [], reminderNotifIds: {}, challengeStats: {}, ...overrides,
  } as any;
}

test("2x weekly accepts one completion per day and at most two fires per period", () => {
  const first = applyChallengeCompletion(state(), "flex-1", "2026-03-23", new Date(2026, 2, 23, 8));
  assert.equal(first.status, "completed");
  if (first.status !== "completed") return;
  assert.equal(first.state.challengeStats["flex-1"].currentStreak, 1);
  assert.equal(flexibleWeeklyProgress(first.state.challenges[0], first.state.history, "2026-03-23").done, 1);
  assert.equal(applyChallengeCompletion(first.state, "flex-1", "2026-03-23").status, "already-completed");
  const second = applyChallengeCompletion(first.state, "flex-1", "2026-03-25", new Date(2026, 2, 25, 8));
  assert.equal(second.status, "completed");
  if (second.status !== "completed") return;
  assert.equal(second.state.challengeStats["flex-1"].currentStreak, 2);
  assert.equal(flexibleWeeklyProgress(second.state.challenges[0], second.state.history, "2026-03-27").done, 2);
  assert.equal(applyChallengeCompletion(second.state, "flex-1", "2026-03-27").status, "already-completed");
});

test("fires continue across successful periods", () => {
  let current = state();
  for (const date of ["2026-03-23", "2026-03-25", "2026-03-30", "2026-04-01"]) {
    const result = applyChallengeCompletion(current, "flex-1", date, new Date(`${date}T08:00:00`));
    assert.equal(result.status, "completed");
    current = result.state;
  }
  assert.equal(current.challengeStats["flex-1"].currentStreak, 4);
});

test("a closed 0/2 period resets once and produces one failure audit entry", () => {
  const initial = state({ challengeStats: { "flex-1": { completedCount: 2, skippedCount: 0, currentStreak: 2, bestStreak: 2, skipCredits: 0 } } });
  const first = reconcileFlexibleWeeklyPeriods(initial, "2026-03-30");
  assert.equal(first.next.challengeStats["flex-1"].currentStreak, 0);
  assert.equal(first.next.history.filter((entry: any) => entry.flexibleWeeklyPeriodStart === "2026-03-23").length, 1);
  const again = reconcileFlexibleWeeklyPeriods(first.next, "2026-03-30");
  assert.equal(again.changed, false);
  assert.equal(again.next.history.filter((entry: any) => entry.flexibleWeeklyPeriodStart === "2026-03-23").length, 1);
});

test("a closed 1/2 period resets but preserves the real completion", () => {
  const completed = applyChallengeCompletion(state(), "flex-1", "2026-03-24", new Date(2026, 2, 24, 8));
  assert.equal(completed.status, "completed");
  const evaluated = reconcileFlexibleWeeklyPeriods(completed.state, "2026-03-30").next;
  assert.equal(evaluated.challengeStats["flex-1"].currentStreak, 0);
  assert.equal(evaluated.history.filter((entry: any) => entry.status === "completed").length, 1);
  assert.equal(evaluated.history.filter((entry: any) => entry.flexibleWeeklyPeriodStart === "2026-03-23").length, 1);
});

test("all seven custom start days produce the expected inclusive window", () => {
  for (let startDay = 0; startDay < 7; startDay += 1) {
    const start = nextWeekdayOnOrAfter("2026-03-25", startDay);
    const item = challenge({ flexibleWeeklyStartDay: startDay, flexibleWeeklyFirstPeriodStart: start });
    assert.deepEqual(flexibleWeeklyWindowForDate(item, addLocalDays(start, 6)), { start, end: addLocalDays(start, 6), target: 2, startDay });
  }
});

test("time before the first selected start is neutral", () => {
  const item = challenge({ flexibleWeeklyStartDay: 2, flexibleWeeklyFirstPeriodStart: "2026-04-01" });
  assert.equal(flexibleWeeklyWindowForDate(item, "2026-03-31"), null);
  assert.equal(canCompleteFlexibleWeekly(item, [], "2026-03-31"), false);
  const evaluated = reconcileFlexibleWeeklyPeriods(state({ challenges: [item] }), "2026-04-01");
  assert.equal(evaluated.next.challengeStats?.["flex-1"]?.currentStreak ?? 0, 0);
  assert.equal(evaluated.next.history.length, 0);
});

test("local date arithmetic crosses month, year and DST without UTC drift", () => {
  assert.equal(addLocalDays("2026-12-30", 6), "2027-01-05");
  assert.equal(addLocalDays("2026-03-28", 1), "2026-03-29");
  assert.equal(addLocalDays("2026-10-24", 1), "2026-10-25");
});

test("several missed periods after a long closure are each evaluated once", () => {
  const initial = state({ challengeStats: { "flex-1": { completedCount: 4, skippedCount: 0, currentStreak: 4, bestStreak: 4, skipCredits: 0 } } });
  const evaluated = reconcileFlexibleWeeklyPeriods(initial, "2026-04-13").next;
  assert.equal(evaluated.challengeStats["flex-1"].currentStreak, 0);
  assert.equal(evaluated.history.filter((entry: any) => entry.flexibleWeeklyPeriodStart).length, 3);
  assert.equal(reconcileFlexibleWeeklyPeriods(evaluated, "2026-04-13").changed, false);
});

test("editing an active flexible week keeps the current period and schedules the next full one", () => {
  const edited = scheduleFlexibleWeeklySettings(challenge(), 3, 2, "2026-03-25");
  assert.deepEqual(edited.flexibleWeeklyPending, { target: 3, startDay: 2, effectiveFrom: "2026-04-01", previousPeriodEnd: "2026-03-29" });
  assert.equal(flexibleWeeklyWindowForDate(edited, "2026-03-29")?.target, 2);
  assert.equal(flexibleWeeklyWindowForDate(edited, "2026-03-30"), null);
  assert.equal(flexibleWeeklyWindowForDate(edited, "2026-04-01")?.target, 3);
});

test("all seven pending start days finish the old period and create only a neutral non-overlapping gap", () => {
  const base = challenge({ flexibleWeeklyFirstPeriodStart: "2026-03-30", flexibleWeeklyStartDay: 0 });
  for (let startDay = 0; startDay < 7; startDay += 1) {
    const edited = scheduleFlexibleWeeklySettings(base, 3, startDay, "2026-04-01");
    const expectedStart = nextWeekdayOnOrAfter("2026-04-06", startDay);
    assert.equal(edited.flexibleWeeklyPending?.previousPeriodEnd, "2026-04-05");
    assert.equal(edited.flexibleWeeklyPending?.effectiveFrom, expectedStart);
    assert.deepEqual(flexibleWeeklyWindowForDate(edited, "2026-04-05"), {
      start: "2026-03-30", end: "2026-04-05", target: 2, startDay: 0,
    });
    for (let day = "2026-04-06"; day < expectedStart; day = addLocalDays(day, 1)) {
      assert.equal(flexibleWeeklyWindowForDate(edited, day), null);
      assert.equal(canCompleteFlexibleWeekly(edited, [], day), false);
    }
    assert.equal(flexibleWeeklyWindowForDate(edited, expectedStart)?.start, expectedStart);
  }
});

test("changing only the target activates on the immediately following whole period", () => {
  const base = challenge({ flexibleWeeklyFirstPeriodStart: "2026-03-30", flexibleWeeklyStartDay: 0 });
  const edited = scheduleFlexibleWeeklySettings(base, 5, 0, "2026-04-01");
  assert.deepEqual(edited.flexibleWeeklyPending, {
    target: 5, startDay: 0, effectiveFrom: "2026-04-06", previousPeriodEnd: "2026-04-05",
  });
  assert.equal(flexibleWeeklyWindowForDate(edited, "2026-04-05")?.target, 2);
  assert.equal(flexibleWeeklyWindowForDate(edited, "2026-04-06")?.target, 5);
});

test("documented Sunday transition leaves 6-11 April neutral and activates deterministically", () => {
  const base = challenge({ flexibleWeeklyFirstPeriodStart: "2026-03-30", flexibleWeeklyStartDay: 0 });
  const edited = scheduleFlexibleWeeklySettings(base, 2, 6, "2026-04-01");
  assert.equal(edited.flexibleWeeklyPending?.effectiveFrom, "2026-04-12");
  for (let date = "2026-04-06"; date <= "2026-04-11"; date = addLocalDays(date, 1)) {
    assert.equal(flexibleWeeklyWindowForDate(edited, date), null);
  }
  const reconciled = reconcileFlexibleWeeklyPeriods(state({ challenges: [edited] }), "2026-04-12").next;
  assert.equal(reconciled.challenges[0].flexibleWeeklyPending, undefined);
  assert.equal(reconciled.challenges[0].flexibleWeeklyFirstPeriodStart, "2026-04-12");
  assert.equal(reconciled.history.filter((entry: any) => entry.flexibleWeeklyPeriodStart === "2026-03-30").length, 1);
  assert.equal(reconciled.history.some((entry: any) => entry.flexibleWeeklyPeriodStart >= "2026-04-06" && entry.flexibleWeeklyPeriodStart <= "2026-04-11"), false);
});

test("Firebase production window mirrors the app pending gap for all start days", () => {
  const base = challenge({ flexibleWeeklyFirstPeriodStart: "2026-03-30", flexibleWeeklyStartDay: 0 });
  for (let startDay = 0; startDay < 7; startDay += 1) {
    const edited = scheduleFlexibleWeeklySettings(base, 4, startDay, "2026-04-01");
    for (let date = "2026-03-30"; date <= addLocalDays(edited.flexibleWeeklyPending!.effectiveFrom, 7); date = addLocalDays(date, 1)) {
      const appWindow = flexibleWeeklyWindowForDate(edited, date);
      const serverWindow = flexibleWeeklyWindowForServer(edited, date);
      assert.deepEqual(serverWindow, appWindow && { start: appWindow.start, end: appWindow.end, target: appWindow.target });
    }
  }
});

test("widget shows weekly progress and blocks a second tap on the same date", () => {
  const completed = applyChallengeCompletion(state(), "flex-1", "2026-03-24", new Date(2026, 2, 24, 8));
  const model = createWidgetModel(completed.state, "en", "2026-03-24", [], "u1", true, ["flex-1"]);
  assert.equal(model.challenges[0].done, 1);
  assert.equal(model.challenges[0].target, 2);
  assert.equal(model.challenges[0].canCompleteToday, false);
  assert.equal(model.challenges[0].streak, 1);
});

test("old data remains daily and old cloud defaults cannot erase a local flexible schedule", () => {
  const old = { id: "old", text: "Old", enabled: true, period: "daily", targetPerDay: 1 };
  assert.deepEqual(normalizeFlexibleWeeklyFields(old, "2026-03-25"), old);
  const local = state();
  const cloud = state({ challenges: [{ id: "flex-1", text: "Renamed remotely", enabled: true, period: "daily" }] });
  const merged = preserveUnknownFlexibleWeeklyFields(local, cloud);
  assert.equal(merged.challenges[0].period, "flexibleWeekly");
  assert.equal(merged.challenges[0].flexibleWeeklyTarget, 2);
  assert.equal(merged.challenges[0].text, "Renamed remotely");
});

test("shared challenge domain does not expose flexibleWeekly", () => {
  const source = readFileSync(join(process.cwd(), "lib/sharedChallenges.ts"), "utf8");
  assert.equal(source.includes("flexibleWeekly"), false);
});

test("saveStateForUid and loadStateForUid preserve a 2-fire weekly streak", async () => {
  const values = new Map<string, string>();
  const localStorage = {
    get length() { return values.size; },
    key(index: number) { return Array.from(values.keys())[index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, String(value)); },
    removeItem(key: string) { values.delete(key); },
    clear() { values.clear(); },
  };
  (globalThis as any).window = { localStorage };

  const uid = "flex-save-load-test";
  await setDebugTodayISO("2026-03-25");
  let current = state({ uid, lastOpenDate: "2026-03-25" });
  const monday = applyChallengeCompletion(current, "flex-1", "2026-03-23", new Date("2026-03-23T08:00:00"));
  assert.equal(monday.status, "completed");
  current = monday.state;
  const wednesday = applyChallengeCompletion(current, "flex-1", "2026-03-25", new Date("2026-03-25T08:00:00"));
  assert.equal(wednesday.status, "completed");
  current = wednesday.state;

  await saveStateForUid(current, uid);
  const loaded = await loadStateForUid(uid);
  assert.equal(loaded.challenges[0].period, "flexibleWeekly");
  assert.equal(loaded.challengeStats["flex-1"].currentStreak, 2);
  assert.equal(loaded.challengeStats["flex-1"].bestStreak, 2);
  assert.equal(loaded.history.filter((entry) => entry.eventType === "flexibleWeeklyCompleted").length, 2);
  const afterCloudPolicy = preserveUnknownFlexibleWeeklyFields(loaded, {
    ...loaded,
    challengeStats: { ...loaded.challengeStats, "flex-1": { ...loaded.challengeStats["flex-1"] } },
  }, 2, "2026-03-25");
  await replaceStateForUid(afterCloudPolicy, uid, "2026-03-25T09:00:00.000Z");
  const afterCloudLoad = await loadStateForUid(uid);
  assert.equal(afterCloudLoad.challengeStats["flex-1"].currentStreak, 2);
  assert.equal(afterCloudLoad.challengeStats["flex-1"].bestStreak, 2);
  await clearDebugTodayISO();
});

test("disabled weeks are neutral and re-enable starts at the next whole period", () => {
  const withStreak = state({
    challengeStats: { "flex-1": { completedCount: 2, skippedCount: 0, currentStreak: 2, bestStreak: 2, skipCredits: 0 } },
  });
  const disabled = transitionChallengeEnabled(withStreak.challenges[0], false, "2026-03-26");
  const duringPause = reconcileFlexibleWeeklyPeriods({ ...withStreak, challenges: [disabled] }, "2026-04-20").next;
  assert.equal(duringPause.history.length, 0);
  assert.equal(duringPause.challengeStats["flex-1"].currentStreak, 2);
  assert.equal(duringPause.challengeStats["flex-1"].skippedCount, 0);

  const enabled = transitionChallengeEnabled(duringPause.challenges[0], true, "2026-04-21");
  assert.equal(enabled.flexibleWeeklyFirstPeriodStart, "2026-04-27");
  const beforeStart = reconcileFlexibleWeeklyPeriods({ ...duringPause, challenges: [enabled] }, "2026-04-27").next;
  assert.equal(beforeStart.history.length, 0);
  assert.equal(beforeStart.challengeStats["flex-1"].currentStreak, 2);
});

test("archive interval and restore do not create failed weekly audits", () => {
  const archived = challenge({
    deletedAt: "2026-03-26T12:00:00.000Z",
    inactivePeriods: [{ startDate: "2026-03-26", reason: "disabled" }],
  });
  const archivedState = state({ challenges: [archived] });
  const evaluated = reconcileFlexibleWeeklyPeriods(archivedState, "2026-05-04").next;
  assert.equal(evaluated.history.length, 0);
  const restored = {
    ...evaluated.challenges[0],
    deletedAt: undefined,
    inactivePeriods: [{ startDate: "2026-03-26", endDate: "2026-05-05", reason: "disabled" as const }],
    flexibleWeeklyFirstPeriodStart: "2026-05-11",
    flexibleWeeklyLastEvaluatedPeriodStart: undefined,
  };
  const afterRestore = reconcileFlexibleWeeklyPeriods({ ...evaluated, challenges: [restored] }, "2026-05-11").next;
  assert.equal(afterRestore.history.length, 0);
});

test("Premium lock is neutral and unlock resumes at the next whole period", () => {
  const lockedChallenge = challenge({ id: "flex-3" });
  const initial = state({
    lastOpenDate: "2026-03-25",
    challenges: [challenge({ id: "daily-1", period: "daily" }), challenge({ id: "daily-2", period: "daily" }), lockedChallenge],
    challengeStats: { "flex-3": { completedCount: 3, skippedCount: 0, currentStreak: 3, bestStreak: 3, skipCredits: 0 } },
  });
  const locked = applyPlanAccessToFlexibleWeeklyState(initial, false, "2026-03-25");
  assert.equal(locked.next.challenges[2].inactivePeriods?.[0]?.reason, "planLock");
  const later = reconcileFlexibleWeeklyPeriods(locked.next, "2026-05-04", { challengeIds: locked.accessibleIds }).next;
  assert.equal(later.history.length, 0);
  assert.equal(later.challengeStats["flex-3"].currentStreak, 3);

  const unlocked = applyPlanAccessToFlexibleWeeklyState(later, true, "2026-05-05").next;
  assert.equal(unlocked.challenges[2].flexibleWeeklyFirstPeriodStart, "2026-05-11");
  assert.equal(unlocked.challenges[2].inactivePeriods?.[0]?.endDate, "2026-05-05");
});

test("Easy mode tracks progress without competitive streaks, medals or missed-week resets", () => {
  const easyState = state({
    challenges: [challenge({ easyMode: true })],
    challengeStats: { "flex-1": { completedCount: 0, skippedCount: 0, currentStreak: 7, bestStreak: 9, skipCredits: 0 } },
  });
  const result = applyChallengeCompletion(easyState, "flex-1", "2026-03-23", new Date("2026-03-23T08:00:00"));
  assert.equal(result.status, "completed");
  assert.equal(result.state.challengeStats["flex-1"].completedCount, 1);
  assert.equal(result.state.challengeStats["flex-1"].currentStreak, 7);
  assert.equal(result.state.challengeStats["flex-1"].bestStreak, 9);
  const missed = reconcileFlexibleWeeklyPeriods(result.state, "2026-03-30", {
    isEasyMode: () => true,
  }).next;
  assert.equal(missed.challengeStats["flex-1"].currentStreak, 7);
  assert.equal(missed.challengeStats["flex-1"].bestStreak, 9);
  assert.equal(missed.challengeStats["flex-1"].skippedCount, 0);
  const model = createWidgetModel(missed, "en", "2026-03-30", [], "u1", true, ["flex-1"]);
  assert.equal(model.challenges[0].competitiveStreakEnabled, false);
  const snapshot = createIosWidgetSnapshot(model, "u1", "2026-03-30");
  assert.equal(snapshot.challenges[0].competitiveStreakEnabled, false);
});

test("pending configuration catches up all new periods in one stable reconciliation", () => {
  const pending = scheduleFlexibleWeeklySettings(challenge(), 3, 2, "2026-03-25");
  const first = reconcileFlexibleWeeklyPeriods(state({ challenges: [pending] }), "2026-07-01");
  const audits = first.next.history.filter((entry: any) => entry.eventType === "weeklyGoalMissed");
  assert.ok(audits.length > 8);
  assert.equal(first.next.challenges[0].flexibleWeeklyPending, undefined);
  assert.equal(first.next.challenges[0].flexibleWeeklyTarget, 3);
  const second = reconcileFlexibleWeeklyPeriods(first.next, "2026-07-01");
  assert.equal(second.changed, false);
  assert.equal(second.next.history.length, first.next.history.length);
});

test("flexible-weekly medals use canonical completion events across nonconsecutive calendar days", () => {
  const dates = ["2026-03-23", "2026-03-25", "2026-03-30", "2026-04-01", "2026-04-06", "2026-04-08"];
  const history = dates.map((date, index) => ({
    date, time: "08:00", atISO: `${date}T08:00:00.000Z`, challengeId: "flex-1", challengeText: "Bike",
    status: "completed", eventType: "flexibleWeeklyCompleted", partial: false, index,
  }));
  const collection = medalCollectionFromHistory(state({ history }), () => true, "2026-04-09");
  assert.equal(collection.earnedByChallenge.get("flex-1")?.brambora, 1);
  assert.equal(collection.earnedByChallenge.get("flex-1")?.steel, 0);

  const ten = medalCollectionFromHistory(state({
    history: Array.from({ length: 10 }, (_, index) => {
      const date = addLocalDays("2026-01-05", index * 3);
      return { date, time: "08:00", atISO: `${date}T08:00:00.000Z`, challengeId: "flex-1", challengeText: "Bike", status: "completed", eventType: "flexibleWeeklyCompleted" };
    }),
  }), () => true, "2026-03-01");
  assert.equal(ten.earnedByChallenge.get("flex-1")?.steel, 1);
});

test("weekly failure closes the canonical medal run while Easy mode earns nothing", () => {
  const history = [
    ...Array.from({ length: 5 }, (_, index) => {
      const date = addLocalDays("2026-01-05", index * 4);
      return { date, time: "08:00", atISO: `${date}T08:00:00.000Z`, challengeId: "flex-1", challengeText: "Bike", status: "completed", eventType: "flexibleWeeklyCompleted" };
    }),
    { date: "2026-02-01", time: "23:59", atISO: "2026-02-01T23:59:59.000Z", challengeId: "flex-1", challengeText: "Bike", status: "skipped", eventType: "weeklyGoalMissed", flexibleWeeklyPeriodStart: "2026-01-26", flexibleWeeklyDone: 0, flexibleWeeklyTarget: 2 },
  ];
  const competitive = medalCollectionFromHistory(state({ history }), () => true, "2026-02-02");
  assert.equal(competitive.earnedByChallenge.get("flex-1")?.brambora, 1);
  const easy = medalCollectionFromHistory(state({ history, challenges: [challenge({ easyMode: true })], easyModeChallengeIds: ["flex-1"] }), () => true, "2026-02-02");
  assert.equal(easy.earnedByChallenge.get("flex-1")?.brambora, 0);
});

test("home hero and StatisticsScreen use the same canonical display summary", () => {
  const weeklyDates = ["2026-03-23", "2026-03-25", "2026-03-30", "2026-04-01", "2026-04-06", "2026-04-08"];
  const sixHistory = weeklyDates.map((date) => ({
    date, time: "08:00", atISO: `${date}T08:00:00.000Z`, challengeId: "flex-1",
    challengeText: "Bike", status: "completed", eventType: "flexibleWeeklyCompleted",
  }));
  const sixState = state({ history: sixHistory });
  const six = medalDisplaySummaryFromHistory(sixState, () => true, "2026-04-09");
  assert.equal(six.longestStreak, 6);
  assert.equal(six.bestStreak, 6);
  assert.equal(six.currentStreak, 6);
  assert.equal(six.collection.state.counts.brambora, 1);
  assert.deepEqual(
    six.collection.state,
    medalCollectionFromHistory(sixState, () => true, "2026-04-09").state,
  );

  const tenHistory = Array.from({ length: 10 }, (_, index) => {
    const date = addLocalDays("2026-01-05", index * 3);
    return { date, time: "08:00", atISO: `${date}T08:00:00.000Z`, challengeId: "flex-1", challengeText: "Bike", status: "completed", eventType: "flexibleWeeklyCompleted" };
  });
  const ten = medalDisplaySummaryFromHistory(state({ history: tenHistory }), () => true, "2026-03-01");
  assert.equal(ten.collection.state.counts.brambora, 1);
  assert.equal(ten.collection.state.counts.steel, 1);

  const missed = medalDisplaySummaryFromHistory(state({ history: [
    ...sixHistory,
    { date: "2026-04-14", time: "23:59", atISO: "2026-04-14T23:59:59.000Z", challengeId: "flex-1", challengeText: "Bike", status: "skipped", eventType: "weeklyGoalMissed", flexibleWeeklyPeriodStart: "2026-04-13" },
  ] }), () => true, "2026-04-15");
  assert.equal(missed.bestStreak, 6);
  assert.equal(missed.currentStreak, 0);

  const dailyChallenge = challenge({ period: "daily", flexibleWeeklyFirstPeriodStart: undefined });
  const dailyHistory = Array.from({ length: 6 }, (_, index) => {
    const date = addLocalDays("2026-04-01", index);
    return { date, time: "08:00", atISO: `${date}T08:00:00.000Z`, challengeId: "flex-1", challengeText: "Bike", status: "completed" };
  });
  const dailyState = state({ challenges: [dailyChallenge], history: dailyHistory });
  const daily = medalDisplaySummaryFromHistory(dailyState, () => true, "2026-04-07");
  assert.equal(daily.longestStreak, 6);
  assert.deepEqual(daily.collection.state, medalCollectionFromHistory(dailyState, () => true, "2026-04-07").state);

  const every2 = medalDisplaySummaryFromHistory(state({
    challenges: [challenge({
      period: "every2",
      periodAnchor: "2026-04-01",
      flexibleWeeklyFirstPeriodStart: undefined,
    })],
    history: ["2026-04-01", "2026-04-03", "2026-04-05"].map((date) => ({
      date, challengeId: "flex-1", challengeText: "Bike", status: "completed",
    })),
  }), isChallengeActiveOnDate, "2026-04-06");
  assert.equal(every2.currentStreak, 3);
  assert.equal(every2.bestStreak, 3);

  const custom = medalDisplaySummaryFromHistory(state({
    challenges: [challenge({
      period: "custom",
      customDays: [0, 2],
      flexibleWeeklyFirstPeriodStart: undefined,
    })],
    history: ["2026-04-01", "2026-04-06"].map((date) => ({
      date, challengeId: "flex-1", challengeText: "Bike", status: "completed",
    })),
  }), isChallengeActiveOnDate, "2026-04-07");
  assert.equal(custom.currentStreak, 2);
  assert.equal(custom.bestStreak, 2);

  const easy = medalDisplaySummaryFromHistory(state({
    challenges: [challenge({ easyMode: true })],
    easyModeChallengeIds: ["flex-1"],
    history: sixHistory,
  }), () => true, "2026-04-09");
  assert.equal(easy.currentStreak, 0);
  assert.equal(easy.bestStreak, 0);

  const monotonic = medalDisplaySummaryFromHistory(state({
    history: sixHistory,
    challengeStats: { "flex-1": { currentStreak: 0, bestStreak: 10 } },
  }), () => true, "2026-04-09");
  assert.equal(monotonic.bestStreak, 10);
  assert.equal(monotonic.collection.state.counts.steel, 1);

  const homeSource = readFileSync(join(process.cwd(), "app", "(tabs)", "index.tsx"), "utf8");
  const statisticsSource = readFileSync(join(process.cwd(), "app", "statistics.tsx"), "utf8");
  assert.match(homeSource, /medalDisplaySummaryFromHistory\(appState, isChallengeActiveOnDate, tdy\)/);
  assert.match(homeSource, /const bestStreak = medalSummary\.currentStreak/);
  assert.match(statisticsSource, /medalDisplaySummaryFromHistory\(state, isChallengeActiveOnDate, todayISO\)/);
});

test("widget axis starts on the configured flexible period day, not Monday", () => {
  const item = challenge({ flexibleWeeklyStartDay: 3, flexibleWeeklyFirstPeriodStart: "2026-04-02" });
  const model = createWidgetModel(state({ challenges: [item] }), "en", "2026-04-04", [], "u1", true, ["flex-1"]);
  assert.deepEqual(model.challenges[0].week.map((day) => day.date), [
    "2026-04-02", "2026-04-03", "2026-04-04", "2026-04-05", "2026-04-06", "2026-04-07", "2026-04-08",
  ]);
});

test("weekly missed history text contains localized period range and real result in every language", () => {
  const templates = {
    cs: "Týdenní cíl nesplněn ({start}–{end}): {done}/{target}",
    en: "Weekly goal missed ({start}–{end}): {done}/{target}",
    de: "Wochenziel nicht erreicht ({start}–{end}): {done}/{target}",
    pl: "Cel tygodniowy niewykonany ({start}–{end}): {done}/{target}",
  } as const;
  for (const lang of ["cs", "en", "de", "pl"] as const) {
    const label = formatFlexibleWeeklyMissedLabel({
      template: templates[lang],
      lang, start: "2026-03-30", end: "2026-04-05", done: 1, target: 2,
    });
    assert.ok(label.includes("1/2"));
    assert.notEqual(label.indexOf("30"), -1);
    assert.notEqual(label.indexOf("5"), -1);
    assert.equal(label.includes("{start}"), false);
    assert.equal(label.includes("{end}"), false);
  }
});

test("weeklyGoalMissed audit entries are excluded from daily totalSkipped", () => {
  assert.equal(countDailySkippedHistory([
    { status: "skipped" },
    { status: "skipped", eventType: "weeklyGoalMissed" },
    { status: "completed", eventType: "flexibleWeeklyCompleted" },
  ]), 1);
});

test("writer versions distinguish legacy damage from a legitimate v2 flexible-to-daily edit", () => {
  const local = state();
  const legacyCloud = state({
    challenges: [{ id: "flex-1", text: "Legacy", enabled: true, period: "daily" }],
    history: [],
  });
  assert.equal(preserveUnknownFlexibleWeeklyFields(local, legacyCloud, 1, "2026-03-25").challenges[0].period, "flexibleWeekly");

  const cleanInstallCloud = state({
    challenges: [{ id: "flex-1", text: "Cloud", enabled: true, period: "daily" }],
    flexibleWeeklyDefinitions: {
      "flex-1": { target: 2, startDay: 0, firstPeriodStart: "2026-03-23", updatedAtISO: "2026-03-23T00:00:00.000Z" },
    },
    flexibleWeeklyWriterVersion: 2,
  });
  const cleanLocal = state({ challenges: [], flexibleWeeklyDefinitions: {} });
  assert.equal(preserveUnknownFlexibleWeeklyFields(cleanLocal, cleanInstallCloud, 1, "2026-03-25").challenges[0].period, "flexibleWeekly");

  const legitimateDaily = state({ challenges: [{ id: "flex-1", text: "Daily now", enabled: true, period: "daily" }], flexibleWeeklyDefinitions: {} });
  assert.equal(preserveUnknownFlexibleWeeklyFields(local, legitimateDaily, 2, "2026-03-25").challenges[0].period, "daily");

  const localWithHistory = state({
    history: [{ date: "2026-03-23", time: "08:00", atISO: "2026-03-23T08:00:00.000Z", challengeId: "flex-1", challengeText: "Bike", status: "completed", eventType: "flexibleWeeklyCompleted" }],
  });
  const protectedState = preserveUnknownFlexibleWeeklyFields(localWithHistory, legacyCloud, 1, "2026-03-25");
  assert.equal(protectedState.challenges[0].period, "flexibleWeekly");
  assert.equal(protectedState.history[0].eventType, "flexibleWeeklyCompleted");
});
