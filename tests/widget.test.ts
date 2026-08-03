import assert from "node:assert/strict";
import test from "node:test";
import { applyChallengeCompletion } from "../lib/challengeCompletion";
import { createWidgetModel } from "../lib/widgetModel";
import { defaultState, type AppState } from "../lib/storage";

function state(count: number): AppState {
  return {
    ...defaultState,
    challenges: Array.from({ length: count }, (_, index) => ({
      id: String(index + 1), text: `Výzva ${index + 1}`, enabled: true, period: "daily" as const,
    })),
    history: [], archivedChallenges: [], everCompletedKeys: [], challengeStats: {},
  };
}

for (const count of [0, 1, 2, 3, 5]) {
  test(`widget model handles ${count} personal challenges`, () => {
    const model = createWidgetModel(state(count), "cs", "2026-07-17");
    assert.equal(model.total, count);
    assert.equal(model.challenges.length, count);
  });
}

test("completion is idempotent and updates streak once", () => {
  const initial = state(1);
  const first = applyChallengeCompletion(initial, "1", "2026-07-17", new Date(2026, 6, 17, 12));
  assert.equal(first.status, "completed");
  const second = applyChallengeCompletion(first.state, "1", "2026-07-17", new Date(2026, 6, 17, 12, 1));
  assert.equal(second.status, "already-completed");
  assert.equal(second.state.history.length, 1);
  assert.equal(second.state.challengeStats?.["1"]?.currentStreak, 1);
});

test("partial target increments stats only on the final completion", () => {
  const initial = state(1);
  initial.challenges[0].targetPerDay = 2;
  const first = applyChallengeCompletion(initial, "1", "2026-07-17");
  assert.equal(first.status, "completed");
  assert.equal(first.state.challengeStats?.["1"], undefined);
  const second = applyChallengeCompletion(first.state, "1", "2026-07-17");
  assert.equal(second.status, "completed");
  assert.equal(second.state.challengeStats?.["1"]?.currentStreak, 1);
});

test("inactive, deleted, and long localized challenge states are safe", () => {
  const initial = state(1);
  initial.challenges[0] = { ...initial.challenges[0], text: "Sehr lange tägliche Herausforderung ąćęł", period: "custom", customDays: [] };
  assert.equal(applyChallengeCompletion(initial, "1", "2026-07-17").status, "inactive");
  assert.equal(createWidgetModel(initial, "de", "2026-07-17").kind, "rest");
});

test("signed-out model never exposes state", () => {
  assert.equal(createWidgetModel(null, "pl", "2026-07-17").kind, "signed-out");
});

test("multiple widget instances receive the same deterministic model", () => {
  const current = state(3);
  const first = createWidgetModel(current, "en", "2026-07-17");
  const second = createWidgetModel(current, "en", "2026-07-17");
  assert.deepEqual(second, first);
});
