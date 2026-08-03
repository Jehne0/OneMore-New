import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createWidgetModel } from "../lib/widgetModel";
import { createWidgetRenderModel } from "../lib/widgetRenderModel";
import { widgetCopy } from "../lib/widgetCopy";
import { defaultState, type AppState } from "../lib/storage";
import { deleteWidgetInstance, readWidgetConfig, saveWidgetConfig, selectConfiguredChallengeIds } from "../lib/widgetConfig";
import { cacheSharedProgressHistory, readSharedCache, type CachedSharedChallenge } from "../lib/sharedCompletion";

function state(): AppState {
  return {
    ...defaultState,
    challenges: [
      { id: "a", text: "Read", enabled: true, period: "daily", targetPerDay: 2 },
      { id: "b", text: "Walk", enabled: true, period: "custom", customDays: [0, 2, 4] },
      { id: "deleted", text: "Deleted", enabled: true, deletedAt: "2026-07-01" } as AppState["challenges"][number],
    ],
    history: [
      { date: "2026-07-13", time: "10:00", atISO: "2026-07-13T10:00:00.000Z", challengeId: "a", challengeText: "Read", status: "completed", partial: true },
      { date: "2026-07-13", time: "10:01", atISO: "2026-07-13T10:01:00.000Z", challengeId: "a", challengeText: "Read", status: "completed" },
      { date: "2026-07-17", time: "10:00", atISO: "2026-07-17T10:00:00.000Z", challengeId: "a", challengeText: "Read", status: "completed", partial: true },
    ],
    challengeStats: { a: { completedCount: 2, skippedCount: 0, currentStreak: 1, bestStreak: 1, skipCredits: 0 } },
  };
}

function shared(): CachedSharedChallenge {
  return {
    id: "s", title: "Together", createdBy: "u", memberUids: ["u"], acceptedBy: ["u"], leftBy: [], enabled: true,
    status: "active", targetPerDay: 1, period: "daily", customDays: [], completedByDate: { "2026-07-16": 1 },
  };
}

class MemoryStore {
  values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
}

test("production widget uses compiler-safe supported primitives and visible root", async () => {
  const source = await readFile("widgets/OneMoreWidget.tsx", "utf8");
  assert.match(source, /^"use no memo";/);
  assert.doesNotMatch(source, /from "react-native"/);
  assert.doesNotMatch(source, /<(View|Text|Pressable|Touchable)(?:\s|>)/);
  assert.match(source, /<FlexWidget[\s\S]*width: "match_parent"[\s\S]*height: "match_parent"/);
  assert.match(source, /backgroundColor: "#0B1220"/);
  const textWidgets = [...source.matchAll(/<TextWidget\s+text=/g)];
  assert.ok(textWidgets.length >= 2);
});

test("visible fallback has brand and non-empty loading text props", async () => {
  const source = await readFile("widgets/OneMoreWidget.tsx", "utf8");
  const fallback = source.slice(source.indexOf("export function createVisibleFallback"), source.indexOf("function actionData"));
  assert.match(fallback, /text="OneMore"/);
  assert.match(fallback, /text=\{t\.loading\}/);
  assert.doesNotMatch(fallback, /return null/);
});

test("weekly personal history distinguishes complete partial missed inactive and future", () => {
  const model = createWidgetModel(state(), "en", "2026-07-17", [], "u", true, ["a", "b"]);
  const read = model.challenges.find((row) => row.id === "a")!;
  assert.equal(read.week[0].kind, "completed");
  assert.equal(read.week[4].kind, "partial");
  assert.equal(read.week[1].kind, "missed");
  assert.equal(read.week[5].kind, "future");
  const walk = model.challenges.find((row) => row.id === "b")!;
  assert.equal(walk.week[1].kind, "inactive");
});

test("completed challenge is pending on the next local day without mutating history", () => {
  const completedToday = state();
  completedToday.history.push({
    date: "2026-07-19", time: "23:59", atISO: "2026-07-19T21:59:00.000Z",
    challengeId: "a", challengeText: "Read", status: "completed",
  });
  completedToday.history.push({
    date: "2026-07-19", time: "23:59", atISO: "2026-07-19T21:59:30.000Z",
    challengeId: "a", challengeText: "Read", status: "completed",
  });
  const beforeMidnight = createWidgetModel(completedToday, "en", "2026-07-19", [], "u", true, ["a"]);
  const afterMidnight = createWidgetModel(completedToday, "en", "2026-07-20", [], "u", true, ["a"]);
  assert.equal(beforeMidnight.challenges[0].dayState, "activeCompleted");
  assert.equal(afterMidnight.challenges[0].dayState, "activePending");
  assert.equal(afterMidnight.challenges[0].done, 0);
  assert.equal(completedToday.history.filter((entry) => entry.date === "2026-07-19").length, 2);
});

test("configured rest day has canonical restDay snapshot, no action, and no 0/1 pending state", () => {
  const model = createWidgetModel(state(), "cs", "2026-07-16", [], "u", true, ["b"]);
  const item = model.challenges[0];
  assert.equal(item.isActiveToday, false);
  assert.equal(item.dayState, "restDay");
  const row = createWidgetRenderModel(model.challenges, "cs", 300, 110, "2026-07-16").rows[0];
  assert.deepEqual({ dayState: row.snapshot.dayState, active: row.snapshot.isActiveToday, completion: row.snapshot.completionState }, { dayState: "restDay", active: false, completion: "restDay" });
  assert.deepEqual({ label: row.button.label, enabled: row.button.enabled }, { label: "Volný den", enabled: false });
  assert.equal(model.completed, 0);
  assert.equal(model.total, 0);
});

test("active pending, active completed, and rest day are mutually exclusive render states", () => {
  const base = state();
  const pending = createWidgetModel(base, "en", "2026-07-17", [], "u", true, ["b"]).challenges[0];
  const completedState = { ...base, history: [...base.history, { date: "2026-07-17", time: "11:00", atISO: "2026-07-17T11:00:00.000Z", challengeId: "b", challengeText: "Walk", status: "completed" as const }] };
  const completed = createWidgetModel(completedState, "en", "2026-07-17", [], "u", true, ["b"]).challenges[0];
  const rest = createWidgetModel(base, "en", "2026-07-16", [], "u", true, ["b"]).challenges[0];
  const rows = [pending, completed, rest].map((item) => createWidgetRenderModel([item], "en", 300, 110).rows[0]);
  assert.deepEqual(rows.map((row) => [row.snapshot.dayState, row.button.enabled]), [["activePending", true], ["activeCompleted", false], ["restDay", false]]);
});

test("every-2-day and shared schedules use their canonical active-day functions", () => {
  const personalState = state();
  personalState.challenges[0] = { ...personalState.challenges[0], period: "every2", periodAnchor: "2026-07-17" };
  assert.equal(createWidgetModel(personalState, "en", "2026-07-18", [], "u", true, ["a"]).challenges[0].dayState, "restDay");
  const sharedRest = { ...shared(), period: "custom" as const, customDays: [0] };
  assert.equal(createWidgetModel(state(), "en", "2026-07-17", [sharedRest], "u", true, ["s"]).challenges[0].dayState, "restDay");
});

test("rest-day copy is exact in every widget locale", () => {
  assert.deepEqual([widgetCopy.cs.restDay, widgetCopy.en.restDay, widgetCopy.pl.restDay, widgetCopy.de.restDay], ["Volný den", "Rest day", "Dzień wolny", "Ruhetag"]);
});

test("shared weekly history comes only from per-user cache", () => {
  const model = createWidgetModel(state(), "cs", "2026-07-17", [shared()], "u", true, ["s"]);
  assert.equal(model.challenges[0].shared, true);
  assert.equal(model.challenges[0].week[3].kind, "completed");
  assert.equal(model.challenges[0].week[4].kind, "missed");
});

test("shared progress subscription cache persists only the latest seven per-user days", async () => {
  const store = new MemoryStore();
  store.values.set("onemore_shared_widget_cache_u", JSON.stringify([shared()]));
  await cacheSharedProgressHistory("u", "s", Array.from({ length: 9 }, (_, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, "0")}`,
    completedCount: index % 2,
  })), store);
  const cached = (await readSharedCache("u", store))[0];
  assert.equal(cached.completedByDate["2026-07-01"], undefined);
  assert.equal(cached.completedByDate["2026-07-03"], 0);
  assert.equal(cached.completedByDate["2026-07-09"], 0);
});

test("manual selection preserves order and does not replace removed invalid challenges", () => {
  const ids = selectConfiguredChallengeIds(["a", "b"], { widgetId: 1, uid: "u", mode: "manual", orderedChallengeIds: ["gone", "b", "a"], updatedAtISO: "x", version: 1 }, true);
  assert.deepEqual(ids, ["b", "a"]);
  assert.deepEqual(selectConfiguredChallengeIds(["a"], { widgetId: 1, uid: "u", mode: "manual", orderedChallengeIds: ["gone"], updatedAtISO: "x", version: 1 }, true), []);
});

test("automatic mode uses available challenges while Free shows exactly one", () => {
  const config = { widgetId: 1, uid: "u", mode: "automatic" as const, orderedChallengeIds: ["b"], updatedAtISO: "x", version: 1 as const };
  assert.deepEqual(selectConfiguredChallengeIds(["a", "b", "c"], config, true), ["a", "b", "c"]);
  assert.deepEqual(selectConfiguredChallengeIds(["a", "b", "c"], config, false), ["b"]);
});

test("Premium expiration preserves full saved selection and restoration restores it", () => {
  const config = { widgetId: 1, uid: "u", mode: "manual" as const, orderedChallengeIds: ["b", "a"], updatedAtISO: "x", version: 1 as const };
  assert.deepEqual(selectConfiguredChallengeIds(["a", "b"], config, false), ["b", "a"]);
  assert.deepEqual(selectConfiguredChallengeIds(["a", "b"], config, true), ["b", "a"]);
});

test("two widget instances and users have isolated durable configurations", async () => {
  const store = new MemoryStore();
  await saveWidgetConfig({ widgetId: 1, uid: "u1", mode: "manual", orderedChallengeIds: ["a"] }, store);
  await saveWidgetConfig({ widgetId: 2, uid: "u1", mode: "manual", orderedChallengeIds: ["b"] }, store);
  await saveWidgetConfig({ widgetId: 1, uid: "u2", mode: "manual", orderedChallengeIds: ["s"] }, store);
  assert.deepEqual((await readWidgetConfig(1, "u1", store))?.orderedChallengeIds, ["a"]);
  assert.deepEqual((await readWidgetConfig(2, "u1", store))?.orderedChallengeIds, ["b"]);
  assert.deepEqual((await readWidgetConfig(1, "u2", store))?.orderedChallengeIds, ["s"]);
});

test("WIDGET_DELETED cleanup removes only that instance for every owner", async () => {
  const store = new MemoryStore();
  await saveWidgetConfig({ widgetId: 1, uid: "u1", mode: "manual", orderedChallengeIds: ["a"] }, store);
  await saveWidgetConfig({ widgetId: 1, uid: "u2", mode: "manual", orderedChallengeIds: ["b"] }, store);
  await saveWidgetConfig({ widgetId: 2, uid: "u1", mode: "manual", orderedChallengeIds: ["b"] }, store);
  await deleteWidgetInstance(1, store);
  assert.equal(await readWidgetConfig(1, "u1", store), null);
  assert.equal(await readWidgetConfig(1, "u2", store), null);
  assert.ok(await readWidgetConfig(2, "u1", store));
});

test("widget config sanitizes duplicate IDs", async () => {
  const store = new MemoryStore();
  await saveWidgetConfig({ widgetId: 7, uid: "u", mode: "manual", orderedChallengeIds: ["a", "a", "b"] }, store);
  assert.deepEqual((await readWidgetConfig(7, "u", store))?.orderedChallengeIds, ["a", "b"]);
});

test("responsive render consumes the deterministic compact row render model", async () => {
  const source = await readFile("widgets/OneMoreWidget.tsx", "utf8");
  assert.match(source, /createWidgetRenderModel\(model\.challenges/);
  assert.match(source, /renderModel\.rows\.map/);
  assert.match(source, /<ChallengeRow/);
  assert.doesNotMatch(source, /LargeCard|MediumWidget|SmallWidget/);
});

test("Expo widget name, reconfiguration and versioning match production handler", async () => {
  const app = JSON.parse(await readFile("app.json", "utf8"));
  const eas = JSON.parse(await readFile("eas.json", "utf8"));
  const service = await readFile("widgets/widgetService.tsx", "utf8");
  const widget = app.expo.plugins.find((item: unknown) => Array.isArray(item) && item[0] === "react-native-android-widget")[1].widgets[0];
  assert.equal(widget.name, "OneMore");
  assert.match(service, /WIDGET_NAME = "OneMore"/);
  assert.equal(widget.widgetFeatures, "reconfigurable");
  assert.ok(app.expo.android.versionCode > 55);
  assert.equal(eas.build.preview.autoIncrement, true);
});

test("Today uses a unique completion action and never routes Free users to Premium", async () => {
  const [widget, service, nativeWidget] = await Promise.all([
    readFile("widgets/OneMoreWidget.tsx", "utf8"),
    readFile("widgets/widgetService.tsx", "utf8"),
    readFile("node_modules/react-native-android-widget/android/src/main/java/com/reactnativeandroidwidget/RNWidget.java", "utf8"),
  ]);
  assert.match(widget, /WIDGET_COMPLETE_CHALLENGE = "WIDGET_COMPLETE_CHALLENGE"/);
  assert.match(service, /props\.clickAction === WIDGET_COMPLETE_CHALLENGE/);
  assert.doesNotMatch(widget, /model\.premium \? \(item\.shared/);
  assert.doesNotMatch(widget, /interactive \? \(item\.shared/);
  assert.doesNotMatch(service, /clickAction === "OPEN_PREMIUM"/);
  assert.match(nativeWidget, /PendingIntent\.getBroadcast/);
  assert.match(nativeWidget, /System\.currentTimeMillis\(\)/);
  assert.doesNotMatch(service, /WIDGET_COMPLETE_CHALLENGE[\s\S]{0,400}premiumWidgetDestination/);
});

test("app and widget completion await canonical persistence before requesting a render", async () => {
  const [app, service, completion] = await Promise.all([
    readFile("app/(tabs)/index.tsx", "utf8"),
    readFile("widgets/widgetService.tsx", "utf8"),
    readFile("lib/challengeCompletion.ts", "utf8"),
  ]);
  const appFlow = app.slice(app.indexOf("async function markDoneToday"), app.indexOf("async function markDoneToday") + 900);
  assert.ok(appFlow.indexOf("await completeChallengeForUid") < appFlow.indexOf("await updateAllOneMoreWidgets"));
  const repositoryFlow = completion.slice(completion.indexOf("export async function completeChallengeWithRepository"));
  assert.ok(repositoryFlow.indexOf("await repository.save(result.state, uid)") < repositoryFlow.indexOf("})().finally"));
  const widgetFlow = service.slice(service.indexOf("if (props.widgetAction === \"WIDGET_CLICK\" && props.clickAction === WIDGET_COMPLETE_CHALLENGE"));
  assert.ok(widgetFlow.indexOf("await handleWidgetCompletion") < widgetFlow.indexOf("await representation(props.widgetInfo)"));
});
