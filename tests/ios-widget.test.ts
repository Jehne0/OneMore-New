import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  containsSensitiveWidgetData,
  createIosWidgetSnapshot,
  iosWidgetRowsForFamily,
  isIosWidgetPremiumActiveAt,
  limitIosWidgetChallenges,
  nextLocalMidnight,
  nextWidgetTimelineDates,
  normalizeIosWidgetSelectionV2,
  parseIosWidgetSnapshot,
  type IosWidgetConfigurationSnapshot,
} from "../lib/iosWidgetSnapshot";
import { replayIosWidgetMutations } from "../lib/iosWidgetReplay";

const model: any = { language: "cs", premium: false, challenges: [
  { id: "personal", title: "Běh", shared: false, streak: 4, bestStreak: 8, done: 0, target: 1, isActiveToday: true, dayState: "activePending", week: [] },
  { id: "shared", title: "Společná", shared: true, streak: 2, bestStreak: 3, done: 0, target: 1, isActiveToday: false, dayState: "restDay", week: [] },
] };

const recordedPremiumConfig: IosWidgetConfigurationSnapshot = {
  version: 2,
  configurationKey: "instance-a",
  orderedChallengeIds: ["a", "b"],
  premiumSelectedChallengeIds: ["a", "b"],
  premiumSelectionRecorded: true,
  lastPremiumActive: true,
  updatedAtISO: "2026-07-19T10:00:00.000Z",
};

test("shared schema fixture is interpreted as v2 with UID scope by TypeScript and Swift", () => {
  const raw = fs.readFileSync("tests/fixtures/ios-widget-schema-v2.json", "utf8");
  const snapshot = parseIosWidgetSnapshot(raw);
  assert.equal(snapshot?.version, 2);
  assert.equal(snapshot?.activeUid, snapshot?.accountUid);
  assert.equal(snapshot?.challenges[1].challengeType, "shared");
  assert.equal(snapshot?.challenges[1].timelineDays[0].week[0].kind, "partial");
  const swift = fs.readFileSync("ios-widget/WidgetSharedState.swift", "utf8");
  assert.match(swift, /schemaVersion = 2/);
  for (const key of ["snapshotRevision", "sessionState", "accountUid", "premiumExpirationDate", "timelineDays", "expectedDoneBefore"]) {
    assert.match(swift, new RegExp(key));
  }
  assert.match(fs.readFileSync("ios-widget-tests/OneMoreWidgetSchemaTests.swift", "utf8"), /ios-widget-schema-v2\.json/);
});

test("versioned snapshot contains no credentials and preserves types, locale and future day frames", () => {
  const future = { ...model, challenges: model.challenges.map((item: any) => ({ ...item, dayState: "activeCompleted", done: 1 })) };
  const snapshot = createIosWidgetSnapshot(model, "uid", "2026-07-19", "2026-07-19T10:00:00.000Z", {
    timelineModels: [{ date: "2026-07-20", model: future }],
    premiumState: "checking",
  });
  assert.equal(snapshot.locale, "cs");
  assert.equal(snapshot.challenges[1].challengeType, "shared");
  assert.equal(snapshot.challenges[1].dayState, "restDay");
  assert.equal(snapshot.challenges[0].timelineDays[1].date, "2026-07-20");
  assert.equal(snapshot.sessionState, "authenticated");
  assert.equal(containsSensitiveWidgetData(snapshot), false);
  assert.deepEqual(parseIosWidgetSnapshot(JSON.stringify(snapshot)), snapshot);
});

test("Free exposes one row; Premium requires a non-expired entitlement and family caps are 1/2/5", () => {
  const free = createIosWidgetSnapshot(model, "uid", "2026-07-19");
  const premium = createIosWidgetSnapshot({ ...model, premium: true }, "uid", "2026-07-19", "2026-07-19T10:00:00.000Z", {
    premiumState: "premium", premiumExpirationDate: "2026-07-20T10:00:00.000Z",
  });
  assert.equal(limitIosWidgetChallenges(free).length, 1);
  assert.equal(limitIosWidgetChallenges(premium, Date.parse("2026-07-20T09:59:59.000Z")).length, 2);
  assert.equal(isIosWidgetPremiumActiveAt(premium, Date.parse("2026-07-20T10:00:00.000Z")), false);
  assert.equal(limitIosWidgetChallenges(premium, Date.parse("2026-07-20T10:00:00.000Z")).length, 1);
  assert.equal(iosWidgetRowsForFamily("systemSmall", 9), 1);
  assert.equal(iosWidgetRowsForFamily("systemMedium", 9), 2);
  assert.equal(iosWidgetRowsForFamily("systemLarge", 9), 5);
});

test("configuration v2 mirrors Free, Premium, expiration, renewal and corrupted Free repair", () => {
  const free = normalizeIosWidgetSelectionV2({
    configuration: null, configurationKey: "new-free", requestedIds: ["a", "b"], availableIds: ["a", "b", "c"], premiumState: "free", premiumActive: false,
  });
  assert.deepEqual(free.orderedIds, ["a"]);
  assert.deepEqual(free.frozenIds, []);
  assert.equal(free.configuration.premiumSelectionRecorded, false);

  const premium = normalizeIosWidgetSelectionV2({
    configuration: null, configurationKey: "instance-a", requestedIds: ["a", "b"], availableIds: ["a", "b", "c"], premiumState: "premium", premiumActive: true,
  });
  assert.deepEqual(premium.orderedIds, ["a", "b"]);
  assert.deepEqual(premium.configuration.premiumSelectedChallengeIds, ["a", "b"]);

  const expired = normalizeIosWidgetSelectionV2({
    configuration: premium.configuration, configurationKey: "instance-a", requestedIds: ["a", "b"], availableIds: ["a", "b", "c"], premiumState: "free", premiumActive: false,
  });
  assert.deepEqual(expired.activeIds, ["a"]);
  assert.deepEqual(expired.frozenIds, ["b"]);

  const newAfterExpiry = normalizeIosWidgetSelectionV2({
    configuration: null, configurationKey: "changed-free", requestedIds: ["b", "c"], availableIds: ["a", "b", "c"], premiumState: "free", premiumActive: false,
  });
  assert.deepEqual(newAfterExpiry.orderedIds, ["b"]);
  assert.deepEqual(newAfterExpiry.frozenIds, []);

  const renewed = normalizeIosWidgetSelectionV2({
    configuration: expired.configuration, configurationKey: "instance-a", requestedIds: ["a", "b", "c"], availableIds: ["a", "b", "c"], premiumState: "premium", premiumActive: true,
  });
  assert.deepEqual(renewed.orderedIds, ["a", "b"]);
});

test("deletion prunes selection and Premium proof, while independent widget keys do not overwrite each other", () => {
  const afterDelete = normalizeIosWidgetSelectionV2({
    configuration: recordedPremiumConfig, configurationKey: "instance-a", requestedIds: ["a", "b"], availableIds: ["a", "c"], premiumState: "free", premiumActive: false,
  });
  assert.deepEqual(afterDelete.orderedIds, ["a"]);
  assert.deepEqual(afterDelete.configuration.premiumSelectedChallengeIds, ["a"]);
  const other = normalizeIosWidgetSelectionV2({
    configuration: null, configurationKey: "instance-b", requestedIds: ["c"], availableIds: ["a", "c"], premiumState: "free", premiumActive: false,
  });
  assert.equal(afterDelete.configuration.configurationKey, "instance-a");
  assert.equal(other.configuration.configurationKey, "instance-b");
  assert.deepEqual(other.orderedIds, ["c"]);
});

test("checking keeps last proven state and never converts missing Premium data to Free", () => {
  const result = normalizeIosWidgetSelectionV2({
    configuration: recordedPremiumConfig, configurationKey: "instance-a", requestedIds: ["a", "b"], availableIds: ["a", "b"], premiumState: "checking", premiumActive: false,
  });
  assert.deepEqual(result.orderedIds, ["a", "b"]);
  assert.equal(result.configuration.lastPremiumActive, true);
});

test("timeline uses local midnight, precomputed days, expiration and autoupdating timezone", () => {
  assert.equal(nextLocalMidnight(new Date(2026, 6, 19, 22, 30)).getDate(), 20);
  assert.equal(nextWidgetTimelineDates(new Date(2026, 6, 19, 23, 30), 2)[1], "2026-07-20");
  const widget = fs.readFileSync("ios-widget/OneMoreWidget.swift", "utf8");
  assert.match(widget, /Calendar\.autoupdatingCurrent/);
  assert.match(widget, /premiumExpirationDate/);
  assert.match(widget, /matching: DateComponents\(hour: 0/);
  assert.doesNotMatch(widget, /widgetURL|\bLink\s*\(/);
});

test("native state uses one coordinated atomic envelope, account isolation and confirmed logout", () => {
  const state = fs.readFileSync("ios-widget/WidgetSharedState.swift", "utf8");
  const bridge = fs.readFileSync("ios-widget/OneMoreIosWidgetBridge.swift", "utf8");
  assert.match(state, /NSFileCoordinator/);
  assert.match(state, /options: \.atomic/);
  assert.match(state, /activeUid == accountUid/);
  assert.match(state, /switchedAccount/);
  assert.match(state, /markConfirmedSignedOut/);
  assert.match(state, /envelope\.outbox\.removeAll\(\)/);
  assert.match(bridge, /markConfirmedSignedOut/);
  assert.doesNotMatch(state, /token|password|apiKey|refreshToken/i);
});

test("iOS 17 completion is Premium-only, UID is not caller-controlled, and double taps share an expected-progress id", () => {
  const intent = fs.readFileSync("ios-widget/CompleteChallengeIntent.swift", "utf8");
  const state = fs.readFileSync("ios-widget/WidgetSharedState.swift", "utf8");
  const widget = fs.readFileSync("ios-widget/OneMoreWidget.swift", "utf8");
  assert.match(intent, /static var openAppWhenRun = false/);
  assert.doesNotMatch(intent, /@Parameter\(title: "User"\)/);
  assert.match(intent, /expectedDoneBefore/);
  assert.match(state, /snapshot\.isPremiumActive/);
  assert.match(state, /challenge\.todayDone == expectedDoneBefore/);
  assert.match(state, /envelope\.outbox\.first\(where:/);
  assert.match(widget, /entry\.selection\?\.premiumActive == true/);
  assert.match(intent, /WidgetNetworkClient\.complete\(mutation\)/);
  assert.match(intent, /WidgetNetworkError\.rejected/);
});

test("AppIntent immediately uses a signed native gateway and retains an idempotent offline outbox", () => {
  const network = fs.readFileSync("ios-widget/WidgetNetworkAccess.swift", "utf8");
  const state = fs.readFileSync("ios-widget/WidgetSharedState.swift", "utf8");
  const backend = fs.readFileSync("functions/src/index.ts", "utf8");
  assert.match(network, /URLSession\.shared\.data/);
  assert.match(network, /ecdsaSignatureMessageX962SHA256/);
  assert.match(network, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
  assert.match(network, /synchronizeBeforeTimeline/);
  assert.match(state, /pendingMutations\(\)/);
  assert.match(state, /mutationId = "ios:/);
  assert.doesNotMatch(network, /refreshToken|idToken|apiKey|REVENUECAT_SECRET/i);
  for (const check of [
    "verifySignature", "recentNonces", "revenueCatPremium", "expectedDoneBefore",
    "localDateInTimeZone", "personalDateIsActive", "completeSharedChallengeForWidget",
    "rotateAfterISO", "revokeIosWidgetAccessGrants",
  ]) assert.match(backend, new RegExp(check));
});

test("Premium renewal is queried natively at expiration without treating missing data as Free", () => {
  const network = fs.readFileSync("ios-widget/WidgetNetworkAccess.swift", "utf8");
  const state = fs.readFileSync("ios-widget/WidgetSharedState.swift", "utf8");
  const widget = fs.readFileSync("ios-widget/OneMoreWidget.swift", "utf8");
  const backend = fs.readFileSync("functions/src/index.ts", "utf8");
  assert.match(network, /action: "status"/);
  assert.match(network, /refreshPremiumIfNeeded/);
  assert.match(state, /markPremiumCheckingIfExpired/);
  assert.match(state, /Expiration is not proof of Free/);
  assert.match(widget, /premiumState == "checking"/);
  assert.match(widget, /15 \* 60/);
  assert.match(backend, /REVENUECAT_SECRET_API_KEY/);
  assert.match(backend, /subscriber\?\.entitlements\?\.premium/);
});

test("personal/shared outbox replay is canonical, account-scoped and deduplicated", async () => {
  const calls: string[] = [];
  const mutations: any[] = [
    { mutationId: "p", uid: "u", challengeId: "p1", challengeType: "personal", date: "2026-07-19", expectedDoneBefore: 0, createdAtISO: "x" },
    { mutationId: "p", uid: "u", challengeId: "p1", challengeType: "personal", date: "2026-07-19", expectedDoneBefore: 0, createdAtISO: "x" },
    { mutationId: "s", uid: "u", challengeId: "s1", challengeType: "shared", date: "2026-07-19", expectedDoneBefore: 0, createdAtISO: "x" },
    { mutationId: "other", uid: "other", challengeId: "p2", challengeType: "personal", date: "2026-07-19", expectedDoneBefore: 0, createdAtISO: "x" },
  ];
  const result = await replayIosWidgetMutations(mutations, "u", {
    completePersonal: async (_u, id) => { calls.push(`p:${id}`); return { status: "already-completed" }; },
    completeShared: async (_u, id) => { calls.push(`s:${id}`); return "completed"; },
  });
  assert.deepEqual(calls, ["p:p1", "s:s1"]);
  assert.deepEqual(result.acknowledged, ["p", "p", "s"]);
  assert.equal(result.changed, true);
});

test("shared completion sync crosses a callable that rechecks auth, membership, acceptance, leave and schedule", () => {
  const backend = fs.readFileSync("functions/src/index.ts", "utf8");
  const client = fs.readFileSync("lib/sharedChallenges.ts", "utf8");
  assert.match(backend, /completeSharedChallengeFromWidget = onCall/);
  for (const check of ["memberUids.includes(uid)", "acceptedBy.includes(uid)", "pending.includes(uid)", "left.includes(uid)", "widgetDateIsActive"]) {
    assert.match(backend, new RegExp(check.replace(/[()]/g, "\\$&")));
  }
  assert.match(client, /httpsCallable\(functions, "completeSharedChallengeFromWidget"\)/);
});

test("WidgetKit/AppIntent strings cover CS, EN, DE and PL and native layout supports appearance/Dynamic Type", () => {
  const catalog = JSON.parse(fs.readFileSync("ios-widget/Localizable.xcstrings", "utf8"));
  assert.equal(catalog.sourceLanguage, "en");
  for (const value of Object.values<any>(catalog.strings)) {
    assert.ok(value.localizations.cs);
    assert.ok(value.localizations.de);
    assert.ok(value.localizations.pl);
  }
  const widget = fs.readFileSync("ios-widget/OneMoreWidget.swift", "utf8");
  assert.match(widget, /colorScheme/);
  assert.match(widget, /dynamicTypeSize/);
  assert.match(widget, /truncationMode\(\.tail\)/);
  assert.match(widget, /AppIntentConfiguration/);
  assert.match(widget, /StaticConfiguration/);
});

test("CNG plugin is target-idempotent and app extension declarations share App Group and versions", () => {
  const plugin = fs.readFileSync("plugins/withOneMoreIosWidget.js", "utf8");
  const app = JSON.parse(fs.readFileSync("app.json", "utf8")).expo;
  assert.match(plugin, /findTargetUuid/);
  assert.match(plugin, /if \(!targetUuid\)/);
  assert.match(plugin, /WidgetSharedState\.swift/);
  assert.match(plugin, /WidgetNetworkAccess\.swift/);
  assert.match(plugin, /CURRENT_PROJECT_VERSION/);
  const extension = app.extra.eas.build.experimental.ios.appExtensions[0];
  assert.equal(extension.targetName, "OneMoreWidget");
  assert.equal(extension.bundleIdentifier, "eu.desigame.onemore.OneMoreWidget");
  assert.deepEqual(extension.entitlements["com.apple.security.application-groups"], app.ios.entitlements["com.apple.security.application-groups"]);
  assert.deepEqual(extension.entitlements["keychain-access-groups"], app.ios.entitlements["keychain-access-groups"]);
  assert.match(extension.entitlements["keychain-access-groups"][0], /AppIdentifierPrefix/);
});

test("widget configuration unwraps optional AppEntity IDs without SwiftUI key-path ambiguity", () => {
  const intent = fs.readFileSync("ios-widget/WidgetConfigurationIntent.swift", "utf8");
  assert.match(intent, /\.compactMap\s*\{\s*\$0\?\.id\s*\}/);
  assert.doesNotMatch(intent, /\.compactMap\(\\\.id\)/);
});

test("iOS 17 AppIntent APIs use iOS availability while the iOS 16 widget remains static", () => {
  const configuration = fs.readFileSync("ios-widget/WidgetConfigurationIntent.swift", "utf8");
  const completion = fs.readFileSync("ios-widget/CompleteChallengeIntent.swift", "utf8");
  const widget = fs.readFileSync("ios-widget/OneMoreWidget.swift", "utf8");
  for (const source of [configuration, completion, widget]) {
    assert.doesNotMatch(source, /iOSApplicationExtension\s+17\.0/);
  }
  assert.match(configuration, /@available\(iOS 17\.0, \*\)[\s\S]*WidgetConfigurationIntent/);
  assert.match(completion, /@available\(iOS 17\.0, \*\)[\s\S]*CompleteChallengeIntent: AppIntent/);
  assert.match(widget, /struct OneMoreWidget: Widget[\s\S]*func makeWidgetConfiguration\(\) -> some WidgetConfiguration/);
  assert.match(widget, /if #available\(iOS 17\.0, \*\) \{\s*return AppIntentConfiguration[\s\S]*?\} else \{\s*return StaticConfiguration/);
  assert.match(widget, /#available\(iOS 17\.0, \*\)[\s\S]*Button\(intent:/);
});

test("WidgetBundleBuilder contains one widget and availability control flow stays in the configuration helper", () => {
  const widget = fs.readFileSync("ios-widget/OneMoreWidget.swift", "utf8");
  const bundle = widget.match(/struct OneMoreWidgetBundle: WidgetBundle \{[\s\S]*?@WidgetBundleBuilder\s*var body: some Widget \{([\s\S]*?)\n  \}\n\}/);
  assert.ok(bundle, "Widget bundle body must exist");
  assert.doesNotMatch(bundle[1], /\b(?:if|switch|for|while|guard)\b/);
  assert.equal(bundle[1].match(/\bOneMoreWidget\(\)/g)?.length, 1);

  const helper = widget.match(/func makeWidgetConfiguration\(\) -> some WidgetConfiguration \{([\s\S]*?)\n  \}\n\n  var body:/);
  assert.ok(helper, "configuration helper must exist");
  assert.match(helper[1], /if #available\(iOS 17\.0, \*\)/);
  assert.match(helper[1], /return AppIntentConfiguration/);
  assert.match(helper[1], /return StaticConfiguration/);

  const body = widget.match(/var body: some WidgetConfiguration \{([\s\S]*?)\n  \}\n\}/);
  assert.ok(body, "widget configuration body must exist");
  assert.match(body[1], /^\s*makeWidgetConfiguration\(\)/);
  assert.match(body[1], /\.configurationDisplayName\("OneMore"\)/);
  assert.match(body[1], /\.description\("Challenges, progress and streaks"\)/);
  assert.match(body[1], /\.supportedFamilies\(\[\.systemSmall, \.systemMedium, \.systemLarge\]\)/);
});

test("Swift Codable snapshot fields and primitive types match the shared JSON fixture", () => {
  const swift = fs.readFileSync("ios-widget/WidgetSharedState.swift", "utf8");
  const fixture = JSON.parse(fs.readFileSync("tests/fixtures/ios-widget-schema-v2.json", "utf8"));

  const storedFields = (name: string): Map<string, string> => {
    const marker = `struct ${name}`;
    const markerIndex = swift.indexOf(marker);
    assert.notEqual(markerIndex, -1, `${name} must exist`);
    const opening = swift.indexOf("{", markerIndex);
    let depth = 1;
    let line = "";
    const fields = new Map<string, string>();
    for (let index = opening + 1; index < swift.length && depth > 0; index += 1) {
      const character = swift[index];
      if (character === "\n") {
        if (depth === 1) {
          const match = line.match(/^\s*var\s+(\w+)\s*:\s*([^\{]+?)\s*$/);
          if (match) fields.set(match[1], match[2].trim());
        }
        line = "";
        continue;
      }
      line += character;
      if (character === "{") depth += 1;
      if (character === "}") depth -= 1;
    }
    return fields;
  };

  const contracts: [string, Record<string, unknown>][] = [
    ["WidgetWeekDay", fixture.challenges[0].week[0]],
    ["WidgetDailyState", fixture.challenges[0].timelineDays[0]],
    ["WidgetChallengeSnapshot", fixture.challenges[0]],
    ["WidgetConfigurationSnapshot", fixture.defaultConfiguration],
    ["OneMoreWidgetSnapshot", fixture],
  ];
  const valueMatches = (type: string, value: unknown): boolean => {
    const normalized = type.endsWith("?") ? type.slice(0, -1) : type;
    if (value === null) return type.endsWith("?");
    if (normalized.startsWith("[") && normalized.endsWith("]")) {
      return Array.isArray(value) && value.every((item) => valueMatches(normalized.slice(1, -1), item));
    }
    if (normalized === "String") return typeof value === "string";
    if (normalized === "Int") return typeof value === "number" && Number.isInteger(value);
    if (normalized === "Bool") return typeof value === "boolean";
    return typeof value === "object" && value !== null;
  };

  for (const [name, json] of contracts) {
    const fields = storedFields(name);
    assert.deepEqual([...fields.keys()].sort(), Object.keys(json).sort(), `${name} keys differ from fixture`);
    for (const [field, type] of fields) {
      assert.equal(valueMatches(type, json[field]), true, `${name}.${field} does not match ${type}`);
    }
  }
});
