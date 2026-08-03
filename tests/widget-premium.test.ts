import assert from "node:assert/strict";
import test from "node:test";
import { applyChallengeCompletion, completeChallengeWithRepository, type CompletionRepository } from "../lib/challengeCompletion";
import { createWidgetModel } from "../lib/widgetModel";
import { authorizeWidgetCompletion, challengeWidgetDeepLink, isWidgetPremiumCacheActiveAt, premiumWidgetDeepLink, premiumWidgetDestination, type WidgetPremiumCache } from "../lib/widgetAccess";
import { defaultState, type AppState } from "../lib/storage";
import { cacheSharedChallenges, completeSharedChallengeForUid, replaySharedCompletionOutbox } from "../lib/sharedCompletion";
import type { SharedChallenge } from "../lib/sharedChallenges";

class Store {
  data = new Map<string, string>();
  async getItem(key: string) { return this.data.get(key) ?? null; }
  async setItem(key: string, value: string) { this.data.set(key, value); }
  async removeItem(key: string) { this.data.delete(key); }
}

const state = (): AppState => ({ ...defaultState, challenges: [{ id: "c1", text: "Run", enabled: true }], history: [], archivedChallenges: [], everCompletedKeys: [], challengeStats: {} });
const premiumCache = (expiresDate: string): WidgetPremiumCache => ({ uid: "u1", isPremium: true, expiresDate });

test("widget completion is independent of Premium expiration", () => {
  assert.equal(isWidgetPremiumCacheActiveAt(premiumCache("2026-07-17T11:00:00.000Z"), "u1", Date.parse("2026-07-17T12:00:00.000Z")), false);
  assert.equal(authorizeWidgetCompletion("u1", "u1"), "u1");
});

test("old completion click is rejected after account switch", () => {
  assert.equal(authorizeWidgetCompletion("u1", "u2"), null);
});

test("spoofed premium and UID payload cannot influence authorization inputs", () => {
  const forgedPayload = { uid: "attacker", premium: true, challengeId: "c1" };
  assert.equal(authorizeWidgetCompletion("u1", "u2"), null);
  assert.equal(forgedPayload.premium, true);
});

test("Free completion inside the app domain remains available", () => {
  assert.equal(applyChallengeCompletion(state(), "c1", "2026-07-17").status, "completed");
});

test("personal repository completion has no Premium dependency", async () => {
  const store = new Store();
  let current = state();
  const repository: CompletionRepository = { store, async load() { return current; }, async save(next) { current = next; } };
  assert.equal((await completeChallengeWithRepository("u1", "c1", "2026-07-17", repository)).status, "completed");
});

test("mutation created while Premium was active replays after expiration", async () => {
  const store = new Store();
  const shared: SharedChallenge = { id: "s1", title: "Together", createdBy: "u1", memberUids: ["u1", "u2"], targetPerDay: 1,
    period: "daily", customDays: [], enabled: true, status: "active", acceptedBy: ["u1", "u2"], leftBy: [] };
  await cacheSharedChallenges("u1", [shared], store);
  await completeSharedChallengeForUid("u1", "s1", "2026-07-17", store);
  assert.equal(authorizeWidgetCompletion("u1", "u1"), "u1");
  assert.equal((await replaySharedCompletionOutbox("u1", async () => 1, store)).confirmed, 1);
});

test("Free user can authorize a widget mutation for the active account", () => {
  assert.equal(authorizeWidgetCompletion("u1", "u1"), "u1");
});

test("Free and Premium widget view-models expose the correct mode", () => {
  assert.equal(createWidgetModel(state(), "en", "2026-07-17", [], "u1", false).premium, false);
  assert.equal(createWidgetModel(state(), "en", "2026-07-17", [], "u1", true).premium, true);
});

test("challenge and Premium actions target existing application flows", () => {
  assert.equal(challengeWidgetDeepLink("a b"), "onemore://challenges?challengeId=a%20b");
  assert.equal(premiumWidgetDeepLink(123), "onemore://profile?open=paywall&t=123&source=widget");
  assert.equal(premiumWidgetDestination("u1", 123), "onemore://profile?open=paywall&t=123&source=widget");
  assert.equal(premiumWidgetDestination(null, 123), "onemore://login");
});

test("signed-out widget never exposes previous account Premium", () => {
  const model = createWidgetModel(null, "cs", "2026-07-17", [], "u1", true);
  assert.equal(model.kind, "signed-out");
  assert.equal(model.premium, false);
  assert.equal(model.challenges.length, 0);
});
