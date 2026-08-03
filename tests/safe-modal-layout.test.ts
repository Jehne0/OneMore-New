import assert from "node:assert/strict";
import test from "node:test";
import { getSafeModalMetrics, MODAL_EDGE_GAP } from "../lib/safeModalLayout";

test("adds the real Android navigation inset to the modal edge gap", () => {
  assert.equal(getSafeModalMetrics({ windowHeight: 800, topInset: 24, bottomInset: 48 }).bottom, 48 + MODAL_EDGE_GAP);
});

test("keeps the normal visual gap when the bottom inset is zero", () => {
  assert.equal(getSafeModalMetrics({ windowHeight: 800, topInset: 0, bottomInset: 0 }).bottom, MODAL_EDGE_GAP);
});

test("three-button navigation with a tall inset reduces available height", () => {
  const gesture = getSafeModalMetrics({ windowHeight: 800, topInset: 24, bottomInset: 16, heightRatio: 1 });
  const buttons = getSafeModalMetrics({ windowHeight: 800, topInset: 24, bottomInset: 72, heightRatio: 1 });
  assert.ok(buttons.bottom > gesture.bottom);
  assert.ok(buttons.maxHeight < gesture.maxHeight);
});

test("small displays retain a visible top gap and a reachable bottom edge", () => {
  const result = getSafeModalMetrics({ windowHeight: 480, topInset: 24, bottomInset: 48 });
  assert.ok(result.maxHeight <= 480 - result.paddingTop - result.bottom);
  assert.ok(result.maxHeight > 0);
});

test("keyboard height is removed from the usable modal height", () => {
  const closed = getSafeModalMetrics({ windowHeight: 800, topInset: 24, bottomInset: 24 });
  const open = getSafeModalMetrics({ windowHeight: 800, topInset: 24, bottomInset: 24, keyboardHeight: 280 });
  assert.ok(open.maxHeight < closed.maxHeight);
});

test("larger text can scroll because content height is not used as fixed modal height", () => {
  const viewport = getSafeModalMetrics({ windowHeight: 640, topInset: 32, bottomInset: 48 });
  const enlargedContentHeight = viewport.maxHeight * 2;
  assert.ok(enlargedContentHeight > viewport.maxHeight);
  assert.equal(Math.min(enlargedContentHeight, viewport.maxHeight), viewport.maxHeight);
});
