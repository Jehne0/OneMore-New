import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  canUpgradePremium,
  describeRevenueCatPackages,
  selectMonthlyRevenueCatPackage,
} from "../lib/premiumOfferingSelection";
import { PremiumOfferingFlow } from "../lib/premiumOfferingFlow";
import { premiumWidgetDeepLink } from "../lib/widgetAccess";

const pkg = (overrides: Record<string, unknown> = {}) => ({
  identifier: "custom-month",
  packageType: "MONTHLY",
  product: {
    identifier: "onemore_monthly",
    priceString: "99 Kč",
    subscriptionPeriod: "P1M",
    title: "OneMore monthly",
  },
  ...overrides,
});

test("MONTHLY package becomes ready and is upgradeable", () => {
  const monthly = pkg();
  assert.equal(selectMonthlyRevenueCatPackage([monthly]), monthly);
  assert.equal(canUpgradePremium("ready", monthly), true);
});

test("standard $rc_monthly identifier is selected", () => {
  const monthly = pkg({ identifier: "$rc_monthly", packageType: "CUSTOM" });
  assert.equal(selectMonthlyRevenueCatPackage([monthly]), monthly);
});

test("one differently named usable P1M package is a safe fallback", () => {
  const monthly = pkg({ identifier: "one_more_month", packageType: "CUSTOM" });
  assert.equal(selectMonthlyRevenueCatPackage([monthly]), monthly);
});

test("empty offering and missing Google Play product are unavailable", () => {
  assert.equal(selectMonthlyRevenueCatPackage([]), null);
  const missingProduct = pkg({ product: { identifier: "onemore_monthly", priceString: "", subscriptionPeriod: "P1M" } });
  assert.equal(selectMonthlyRevenueCatPackage([missingProduct]), null);
  assert.equal(describeRevenueCatPackages([missingProduct])[0].hasPriceString, false);
});

test("unavailable state cannot enable Upgrade without a real package", () => {
  assert.equal(canUpgradePremium("unavailable", null), false);
  assert.equal(canUpgradePremium("unavailable", pkg()), false);
});

test("older empty request cannot replace newer ready package", async () => {
  const flow = new PremiumOfferingFlow<ReturnType<typeof pkg>>();
  flow.beginOpen();
  let resolveOld!: (value: ReturnType<typeof pkg>[]) => void;
  const old = flow.load(() => new Promise((resolve) => { resolveOld = resolve; }), 0);
  const monthly = pkg();
  const latest = await flow.load(async () => [monthly], 0);
  resolveOld([]);
  assert.equal(latest.status, "ready");
  assert.equal((await old).status, "stale");
  assert.equal(flow.currentPackages()[0], monthly);
});

test("purchase and rendered card use the same real package source", async () => {
  const source = await readFile("app/(tabs)/profile.tsx", "utf8");
  assert.match(source, /selectedPremiumPackage\.product\.title/);
  assert.match(source, /selectedPremiumPackage\.product\.priceString/);
  assert.match(source, /await purchasePackage\(selectedPackage,/);
  assert.doesNotMatch(source, /premiumSubscriptionPeriodText \?\? p\.monthlySubscription/);
  const loadingFlow = source.slice(
    source.indexOf("const loadPremiumPackages"),
    source.indexOf("const buyPremium")
  );
  assert.doesNotMatch(loadingFlow, /Alert\.alert/);
  assert.match(source, /selectedPremiumPackage \? \(/);
  assert.match(source, /onPress=\{\(\) => void loadPremiumPackages\(\)\}/);
});

test("widget configuration and profile use the same canonical paywall", () => {
  assert.match(premiumWidgetDeepLink(1), /\/profile\?open=paywall/);
});

test("retry can move unavailable flow to ready without closing", async () => {
  const flow = new PremiumOfferingFlow<ReturnType<typeof pkg>>();
  flow.beginOpen();
  assert.equal((await flow.load(async () => [], 0)).status, "unavailable");
  assert.equal((await flow.load(async () => [pkg()], 0)).status, "ready");
});

test("static copy alone cannot create a ready state", () => {
  assert.equal(canUpgradePremium("ready", null), false);
});
