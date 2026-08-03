import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getWhatsNewCopy, CURRENT_WHATS_NEW_ID } from "../lib/whatsNew";
import { markWhatsNewSeen, shouldAutoShowWhatsNew } from "../lib/whatsNewStorage";

function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getAllKeys: async () => [...values.keys()],
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
  };
}

test("existing user sees the current What's new item exactly once", async () => {
  const store = memoryStore();
  const oldKeys = ["onemore_state_u1"];
  assert.equal(await shouldAutoShowWhatsNew("u1", store as any, oldKeys), true);
  await markWhatsNewSeen("u1", store as any);
  assert.equal(await shouldAutoShowWhatsNew("u1", store as any, oldKeys), false);
});

test("new user does not see What's new automatically", async () => {
  assert.equal(await shouldAutoShowWhatsNew("new-user", memoryStore() as any, []), false);
});

test("localized data contains the widget entry in all supported languages", () => {
  for (const lang of ["cs", "en", "pl", "de"] as const) {
    const copy = getWhatsNewCopy(lang);
    assert.ok(copy.title);
    assert.ok(copy.popupEyebrow);
    assert.equal(copy.entries[0]?.id, CURRENT_WHATS_NEW_ID);
    assert.equal(copy.entries[0]?.bullets.length, 4);
  }
});

test("Information screen exposes a What's new tile and data-driven list", () => {
  const source = readFileSync("app/(tabs)/profile.tsx", "utf8");
  assert.match(source, /testID="whats-new-tile"/);
  assert.match(source, /setInfoScreen\("whatsnew"\)/);
  assert.match(source, /whatsNew\.entries\.map/);
});

test("widget limits share the standard right-value typography", () => {
  const source = readFileSync("app/(tabs)/profile.tsx", "utf8");
  assert.match(source, /styles\.pmListValue,\s*styles\.pmValueFlexible/);
  assert.match(source, /styles\.pmListValue, styles\.pmPremiumWidgetValue/);
  assert.doesNotMatch(source, /pmWidgetValue/);
});
