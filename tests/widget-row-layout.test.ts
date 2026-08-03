import assert from "node:assert/strict";
import test from "node:test";
import { createWidgetRowLayout } from "../lib/widgetLayout";
import { createWidgetRenderModel } from "../lib/widgetRenderModel";
import type { WidgetChallenge } from "../lib/widgetModel";
import { WidgetRenderGate } from "../lib/widgetRenderGate";

function challenge(id: string, overrides: Partial<WidgetChallenge> = {}): WidgetChallenge {
  const value: WidgetChallenge = {
    id,
    title: `Challenge ${id}`,
    done: 0,
    target: 1,
    streak: 7,
    bestStreak: 12,
    isActiveToday: true,
    dayState: "activePending",
    week: Array.from({ length: 7 }, (_, i) => ({ date: `2026-07-${13 + i}`, kind: i < 4 ? "completed" as const : "missed" as const, done: i < 4 ? 1 : 0, target: 1 })),
    ...overrides,
  };
  value.dayState = overrides.dayState ?? (!value.isActiveToday ? "restDay" : value.done >= value.target ? "activeCompleted" : "activePending");
  return value;
}

test("very narrow widget always retains a fixed completion button", () => {
  const model = createWidgetRenderModel([challenge("a")], "cs", 110, 110);
  assert.equal(model.layout.variant, "small");
  assert.equal(model.rows[0].button.visible, true);
  assert.equal(model.rows[0].button.width, 64);
  assert.equal(model.rows[0].button.label, "Splnit");
});

test("long title truncates before the button is removed", () => {
  const row = createWidgetRenderModel([challenge("a", { title: "Velmi dlouhý název výzvy, který se nevejde do jediného řádku" })], "cs", 110, 110).rows[0];
  assert.deepEqual({ maxLines: row.title.maxLines, truncate: row.title.truncate }, { maxLines: 1, truncate: "END" });
  assert.equal(row.button.visible, true);
});

test("Czech incomplete and completed rows expose Splnit and disabled Splněno", () => {
  const rows = createWidgetRenderModel([challenge("a"), challenge("b", { done: 1 })], "cs", 300, 180).rows;
  assert.deepEqual(rows.map((row) => [row.button.label, row.button.enabled]), [["Splnit", true], ["Splněno", false]]);
});

test("personal and shared rows preserve distinct action types", () => {
  const rows = createWidgetRenderModel([challenge("p"), challenge("s", { shared: true })], "en", 300, 180).rows;
  assert.deepEqual(rows.map((row) => row.button.challengeType), ["personal", "shared"]);
});

test("4x1 uses one compact row and 4x2 uses multiple compact rows", () => {
  const items = Array.from({ length: 5 }, (_, i) => challenge(String(i)));
  const oneCell = createWidgetRenderModel(items, "cs", 300, 56);
  const twoCells = createWidgetRenderModel(items, "cs", 300, 110);
  assert.equal(oneCell.rows.length, 1);
  assert.equal(oneCell.layout.showHeader, false);
  assert.equal(oneCell.expandedWeek, null);
  assert.equal(oneCell.layout.compactSurfaceHeight, 52);
  assert.ok(oneCell.layout.compactSurfaceHeight <= 60);
  assert.equal(oneCell.layout.rootPadding, 4);
  assert.equal(oneCell.layout.buttonHeight, 38);
  assert.equal(twoCells.rows.length, 2);
});

test("wide compact row keeps week only when mandatory title budget remains", () => {
  assert.equal(createWidgetRenderModel([challenge("a")], "cs", 280, 56).layout.showWeek, false);
  assert.equal(createWidgetRenderModel([challenge("a")], "cs", 300, 56).layout.showWeek, true);
});

test("every size carries complete mandatory challenge snapshot", () => {
  const item = challenge("stable", { title: "Cesta z města", streak: 2, done: 1 });
  for (const [width, height] of [[110, 56], [180, 56], [250, 56], [300, 56], [250, 110], [320, 220]]) {
    const row = createWidgetRenderModel([item], "cs", width, height).rows[0];
    assert.equal(row.snapshot.challengeName, "Cesta z města");
    assert.equal(row.snapshot.currentStreak, 2);
    assert.equal(row.snapshot.completionState, "completed");
    assert.equal(row.button.label, "Splněno");
    assert.notEqual(row.title.text, "--");
  }
});

test("successive resize and orientation preserve title streak history and action", () => {
  const item = challenge("stable", { title: "Cesta z města", streak: 2 });
  const sizes = [[180, 220], [300, 56], [240, 110], [320, 220], [180, 220]];
  const snapshots = sizes.map(([width, height]) => createWidgetRenderModel([item], "cs", width, height).rows[0].snapshot);
  assert.ok(snapshots.every((snapshot) => snapshot.challengeName === "Cesta z města"));
  assert.ok(snapshots.every((snapshot) => snapshot.currentStreak === 2));
  assert.ok(snapshots.every((snapshot) => snapshot.completionState === "available"));
  assert.ok(snapshots.every((snapshot) => snapshot.weeklyHistory === item.week));
});

test("resize preserves rest day and never makes it actionable", () => {
  const item = challenge("rest", { isActiveToday: false, dayState: "restDay" });
  const rows = [[110, 56], [300, 110], [320, 220]].map(([width, height]) => createWidgetRenderModel([item], "de", width, height).rows[0]);
  assert.ok(rows.every((row) => row.snapshot.dayState === "restDay" && row.button.enabled === false && row.button.label === "Ruhetag"));
});

test("delayed older resize generation cannot replace newer snapshot", () => {
  const gate = new WidgetRenderGate();
  const oldResize = gate.begin(42);
  const newResize = gate.begin(42);
  const oldSnapshot = createWidgetRenderModel([challenge("stable", { streak: 0 })], "cs", 300, 110).rows[0].snapshot;
  const newSnapshot = createWidgetRenderModel([challenge("stable", { streak: 2, done: 1 })], "cs", 300, 110).rows[0].snapshot;
  assert.equal(gate.isCurrent(42, oldResize), false);
  assert.equal(gate.isCurrent(42, newResize), true);
  const accepted = [[oldResize, oldSnapshot], [newResize, newSnapshot]].filter(([generation]) => gate.isCurrent(42, generation as number));
  assert.equal(accepted.length, 1);
  assert.equal((accepted[0][1] as typeof newSnapshot).currentStreak, 2);
});

test("long title never removes completion state", () => {
  const model = createWidgetRenderModel([challenge("long", { title: "Mimořádně dlouhý název výzvy, který musí skončit výpustkou" })], "cs", 110, 56);
  assert.equal(model.rows[0].title.truncate, "END");
  assert.equal(model.rows[0].button.visible, true);
  assert.ok(model.layout.minimumTitleWidth > 0);
});

test("4x2 with one challenge uses spare height for localized week and today highlight", () => {
  const model = createWidgetRenderModel([challenge("a")], "cs", 300, 110, "2026-07-17");
  assert.equal(model.rows.length, 1);
  assert.equal(model.layout.showExpandedWeek, true);
  assert.equal(model.expandedWeek?.labelsVisible, true);
  assert.equal(model.expandedWeek?.todayIndex, 4);
});

test("shrinking 4x2 to 4x1 removes detailed week statistics", () => {
  assert.ok(createWidgetRenderModel([challenge("a")], "cs", 300, 110, "2026-07-17").expandedWeek);
  assert.equal(createWidgetRenderModel([challenge("a")], "cs", 300, 56, "2026-07-17").expandedWeek, null);
});

test("large widget uses available height for several rows without cards", () => {
  const items = Array.from({ length: 5 }, (_, i) => challenge(String(i)));
  const model = createWidgetRenderModel(items, "cs", 320, 320);
  assert.equal(model.layout.variant, "large");
  assert.equal(model.rows.length, 5);
  assert.ok(model.rows.every((row) => row.button.visible));
});

test("same dimensions are deterministic and small launcher jitter is quantized", () => {
  assert.deepEqual(createWidgetRowLayout(299, 179, 5), createWidgetRowLayout(299, 179, 5));
  assert.equal(createWidgetRowLayout(298, 178, 5).variant, createWidgetRowLayout(301, 181, 5).variant);
});

test("resize selects the layout and row capacity for the new bounds", () => {
  assert.equal(createWidgetRowLayout(110, 110, 5).variant, "small");
  assert.equal(createWidgetRowLayout(300, 56, 5).variant, "medium");
  assert.equal(createWidgetRowLayout(300, 220, 5).variant, "large");
});

test("portrait landscape portrait recomputes deterministically", () => {
  const portrait = createWidgetRowLayout(180, 250, 5);
  const landscape = createWidgetRowLayout(300, 110, 5);
  const portraitAgain = createWidgetRowLayout(180, 250, 5);
  assert.equal(portrait.variant, "small");
  assert.equal(landscape.variant, "large");
  assert.deepEqual(portraitAgain, portrait);
});
