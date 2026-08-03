import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseStoredLanguage } from "../lib/languageStorage";
import { readWidgetConfig } from "../lib/widgetConfig";
import { readSharedCache } from "../lib/sharedCompletion";
import { resolveWidgetAuthState } from "../lib/widgetSession";

class MemoryStore {
  values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("configuration stays initializing while currentUser is null, then resolves signed-in", async () => {
  const ready = deferred();
  let uid: string | null = null;
  const resolution = resolveWidgetAuthState({
    activeUid: null,
    waitForAuthReady: () => ready.promise,
    getAuthenticatedUid: () => uid,
    persistActiveUid: async () => {},
  });
  let settled = false;
  void resolution.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  uid = "user-a";
  ready.resolve();
  assert.deepEqual(await resolution, { kind: "authenticated", uid: "user-a" });
});

test("valid active UID survives delayed Firebase Auth initialization", async () => {
  const ready = deferred();
  let writes = 0;
  const resolution = resolveWidgetAuthState({ activeUid: "user-a", waitForAuthReady: () => ready.promise, getAuthenticatedUid: () => "user-a", persistActiveUid: async () => { writes++; } });
  ready.resolve();
  assert.deepEqual(await resolution, { kind: "authenticated", uid: "user-a" });
  assert.equal(writes, 0);
});

test("missing active UID is repaired from the initialized Firebase user", async () => {
  let persisted: string | null = null;
  assert.deepEqual(await resolveWidgetAuthState({ activeUid: null, waitForAuthReady: async () => {}, getAuthenticatedUid: () => "user-a", persistActiveUid: async (uid) => { persisted = uid; } }), { kind: "authenticated", uid: "user-a" });
  assert.equal(persisted, "user-a");
});

test("mismatched account replaces stale active UID without exposing it", async () => {
  let persisted: string | null = null;
  const state = await resolveWidgetAuthState({ activeUid: "old-user", waitForAuthReady: async () => {}, getAuthenticatedUid: () => "new-user", persistActiveUid: async (uid) => { persisted = uid; } });
  assert.deepEqual(state, { kind: "authenticated", uid: "new-user" });
  assert.equal(persisted, "new-user");
});

test("signed-out and initialization error are distinct terminal states", async () => {
  assert.deepEqual(await resolveWidgetAuthState({ activeUid: "old", hasCachedAccount: true, waitForAuthReady: async () => {}, getAuthenticatedUid: () => null, persistActiveUid: async () => {} }), { kind: "cachedAuthenticated", uid: "old" });
  assert.deepEqual(await resolveWidgetAuthState({ activeUid: null, waitForAuthReady: async () => {}, getAuthenticatedUid: () => null, persistActiveUid: async () => {} }), { kind: "confirmedSignedOut" });
  assert.deepEqual(await resolveWidgetAuthState({ activeUid: null, waitForAuthReady: async () => { throw new Error("auth"); }, getAuthenticatedUid: () => null, persistActiveUid: async () => {} }), { kind: "errorWithoutCache" });
});

test("missing and corrupt per-user widget caches are safe empty data, not auth state", async () => {
  const store = new MemoryStore();
  assert.equal(await readWidgetConfig(4, "user-a", store), null);
  assert.deepEqual(await readSharedCache("user-a", store), []);
  store.values.set("onemore_widget_config:user-a:4", "{");
  store.values.set("onemore_shared_widget_cache_user-a", "{");
  assert.equal(await readWidgetConfig(4, "user-a", store), null);
  assert.deepEqual(await readSharedCache("user-a", store), []);
});

test("configuration activity recognizes every stored app language", () => {
  for (const language of ["cs", "en", "pl", "de"] as const) assert.equal(parseStoredLanguage(language), language);
  assert.equal(parseStoredLanguage(null), "cs");
});

test("configuration root owns safe-area provider, scroll content and inset footer", async () => {
  const source = await readFile("widgets/WidgetConfigurationScreen.tsx", "utf8");
  assert.match(source, /<SafeAreaProvider initialMetrics=\{initialWindowMetrics\}>/);
  assert.match(source, /useSafeAreaInsets\(\)/);
  assert.match(source, /<ScrollView[\s\S]*style=\{styles\.scroll\}/);
  assert.match(source, /paddingTop: insets\.top/);
  assert.match(source, /paddingBottom: Math\.max\(insets\.bottom, 12\)/);
  assert.match(source, /footer: \{ flexDirection: "row"/);
});

test("signed-in user without challenge cache renders localized empty state", async () => {
  const source = await readFile("widgets/WidgetConfigurationScreen.tsx", "utf8");
  assert.match(source, /"uid" in authState/);
  assert.match(source, /rows\.length === 0 \? t\.empty/);
  assert.doesNotMatch(source, /rows\.length === 0 \? t\.signedOut/);
});

test("React Native bridge and configuration activity share the widget UID contract", async () => {
  const [session, contract, activity, module] = await Promise.all([
    readFile("lib/widgetSession.ts", "utf8"),
    readFile("android/app/src/main/java/com/anonymous/OneMore/WidgetSessionContract.kt", "utf8"),
    readFile("android/app/src/main/java/com/anonymous/OneMore/WidgetConfigurationActivity.kt", "utf8"),
    readFile("android/app/src/main/java/com/anonymous/OneMore/WidgetSessionModule.kt", "utf8"),
  ]);
  for (const source of [session, contract]) {
    assert.match(source, /onemore_widget_session/);
    assert.match(source, /onemore_widget_active_uid/);
  }
  assert.match(contract, /onemore_account_snapshot:/);
  assert.match(activity, /WidgetSessionContract\.PREFERENCES_NAME/);
  assert.match(activity, /WidgetSessionContract\.ACTIVE_UID_KEY/);
  assert.match(activity, /ACCOUNT_SNAPSHOT_KEY_PREFIX/);
  assert.match(module, /WidgetSessionContract\.PREFERENCES_NAME/);
  assert.match(module, /WidgetSessionContract\.ACTIVE_UID_KEY/);
  assert.match(module, /fun setAccountSnapshot/);
  assert.match(module, /fun getAccountSnapshot/);
  assert.match(module, /check\(editor\.commit\(\)\)/);
  assert.doesNotMatch(module, /Wrote active UID: \$\{normalized/);
});
