import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { OfferingCache } from "../lib/offeringCache";
import { resolveWidgetVariant } from "../lib/widgetLayout";
import { widgetCompletionLabel } from "../lib/widgetCopy";
import { createWidgetCompletionActionData } from "../lib/widgetAction";

test("shared listener waits for both queries and never clears UI on request error", async () => {
  const [feed, screen] = await Promise.all([
    readFile("lib/sharedChallenges.ts", "utf8"),
    readFile("app/(tabs)/index.tsx", "utf8"),
  ]);
  assert.match(feed, /if \(!memberSettled \|\| !pendingSettled\) return/);
  assert.match(screen, /readSharedCache\(uid\)/);
  assert.match(screen, /preserving last valid data/);
  assert.doesNotMatch(screen, /cloud request failed[\s\S]{0,160}setSharedChallenges\(\[\]\)/);
  assert.match(screen, /RNAppState\.addEventListener\("change"/);
});

test("leftBy membership remains excluded from shared UI and cache", async () => {
  const source = await readFile("lib/sharedChallenges.ts", "utf8");
  assert.match(source, /leftByMe/);
  assert.match(source, /pendingForMe \|\| !leftByMe/);
});

test("offering cache supports first load, repeat open, retry, missing and cached fallback", async () => {
  const cache = new OfferingCache<string>();
  let calls = 0;
  assert.deepEqual(await cache.get("u", async () => { calls++; return ["monthly"]; }), ["monthly"]);
  assert.deepEqual(await cache.get("u", async () => { calls++; return []; }), ["monthly"]);
  assert.equal(calls, 1);
  assert.deepEqual(await cache.get("u", async () => { calls++; throw new Error("temporary"); }, true), ["monthly"]);
  cache.clear();
  await assert.rejects(cache.get("u", async () => { calls++; throw new Error("temporary"); }));
  assert.deepEqual(await cache.get("u", async () => { calls++; return ["monthly"]; }), ["monthly"]);
  cache.clear();
  assert.deepEqual(await cache.get("u", async () => []), []);
});

test("widget root is inert and only explicit completion control has click action", async () => {
  const source = await readFile("widgets/OneMoreWidget.tsx", "utf8");
  assert.doesNotMatch(source, /OPEN_APP|OPEN_URI/);
  assert.match(source, /clickAction=\{actionable \?/);
  assert.match(source, /const actionable = item\.dayState === "activePending"/);
  assert.match(source, /WIDGET_COMPLETE_SHARED_CHALLENGE : WIDGET_COMPLETE_CHALLENGE/);
  assert.deepEqual(createWidgetCompletionActionData(42, "challenge-a", "personal"), {
    widgetId: 42, challengeId: "challenge-a", challengeType: "personal", actionId: "42:personal:challenge-a",
  });
});

test("small medium and large sizes resolve deterministically", () => {
  assert.equal(resolveWidgetVariant(110, 110), "small");
  assert.equal(resolveWidgetVariant(180, 180), "small");
  assert.equal(resolveWidgetVariant(250, 56), "medium");
  assert.equal(resolveWidgetVariant(250, 110), "large");
  assert.equal(resolveWidgetVariant(300, 180), "large");
  assert.equal(resolveWidgetVariant(250, 250), "large");
  assert.equal(resolveWidgetVariant(320, 320), "large");
});

test("completion button has exact labels in every supported locale", () => {
  assert.deepEqual(["cs", "en", "pl", "de"].map((lang) => [
    widgetCompletionLabel(lang as "cs" | "en" | "pl" | "de", false),
    widgetCompletionLabel(lang as "cs" | "en" | "pl" | "de", true),
  ]), [["Splnit", "Splněno"], ["Complete", "Completed"], ["Wykonaj", "Wykonano"], ["Erledigen", "Erledigt"]]);
});
