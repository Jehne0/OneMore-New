import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { premiumWidgetDeepLink, premiumWidgetDestination } from "../lib/widgetAccess";

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

test("canonical public /profile has no competing root route", async () => {
  assert.equal(await exists("app/(tabs)/profile.tsx"), true);
  assert.equal(await exists("app/profile.tsx"), false);
});

test("widget Premium destination targets canonical /profile paywall", () => {
  assert.equal(premiumWidgetDeepLink(123), "onemore://profile?open=paywall&t=123&source=widget");
  assert.equal(premiumWidgetDestination("u1", 123), "onemore://profile?open=paywall&t=123&source=widget");
  assert.equal(premiumWidgetDestination(null, 123), "onemore://login");
});

test("canonical profile handles cold and repeated open=paywall parameters", async () => {
  const source = await readFile("app/(tabs)/profile.tsx", "utf8");
  assert.match(source, /useLocalSearchParams<\{ open\?: string; t\?: string \}>\(\)/);
  assert.match(source, /if \(open === "paywall"\) \{\s*openPayments\(\)/);
  assert.match(source, /router\.setParams\(\{ open: undefined, t: undefined \}/);
  assert.match(source, /\}, \[open, t\]\);/);
  assert.match(source, /setInfoScreen\(destination === "premium" \? "paywall" : "menu"\)/);
  assert.match(source, /setInfoOpen\(true\)/);
});

test("statistics screen is reachable at /statistics and retains history navigation", async () => {
  assert.equal(await exists("app/statistics.tsx"), true);
  const source = await readFile("app/statistics.tsx", "utf8");
  assert.match(source, /router\.push\("\/history"\)/);
});

test("repository contains no stale navigation to the former statistics /profile route", async () => {
  const files = [
    "app/(tabs)/index.tsx",
    "app/(tabs)/profile.tsx",
    "app/friend-invite/[inviteId].tsx",
    "lib/widgetAccess.ts",
    "widgets/widgetService.tsx",
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /router\.(?:push|replace|navigate)\("\/profile"\)/, file);
    assert.doesNotMatch(source, /href=["']\/profile["']/, file);
  }
});

