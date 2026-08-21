import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const iosJscPlugin = require("../plugins/withOneMoreIosJsc");

const read = (path: string) => readFileSync(path, "utf8");

test("iOS release uses JSC while Android keeps Hermes", () => {
  const config = JSON.parse(read("app.json"));
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(config.expo.jsEngine, "jsc");
  assert.equal(config.expo.ios.jsEngine, undefined);
  assert.equal(config.expo.android.jsEngine, "hermes");
  assert.equal(packageJson.dependencies?.["@react-native-community/javascriptcore"], "0.2.0");
  assert.ok(config.expo.plugins.includes("./plugins/withOneMoreIosJsc"));
});

test("iOS native generation opts into community JSC idempotently", () => {
  const podfile = 'require "react_native_pods"\n';
  const patchedPodfile = iosJscPlugin._test.patchPodfile(podfile);
  assert.match(patchedPodfile, /ENV\['USE_THIRD_PARTY_JSC'\] = '1'/);
  assert.match(patchedPodfile, /ENV\['USE_HERMES'\] = '0'/);
  assert.match(patchedPodfile, /ENV\['RCT_USE_RN_DEP'\] = '0'/);
  assert.equal(iosJscPlugin._test.patchPodfile(patchedPodfile), patchedPodfile);

  const appDelegate = [
    "import Expo",
    "import React",
    "import ReactAppDependencyProvider",
    "",
    "class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {",
    "  // Extension point for config-plugins",
    "}",
    "",
  ].join("\n");
  const patchedDelegate = iosJscPlugin._test.patchAppDelegate(appDelegate);
  assert.match(patchedDelegate, /import ReactJSC/);
  assert.match(patchedDelegate, /override func createJSRuntimeFactory\(\) -> JSRuntimeFactoryRef/);
  assert.match(patchedDelegate, /jsrt_create_jsc_factory\(\)/);
  assert.equal(iosJscPlugin._test.patchAppDelegate(patchedDelegate), patchedDelegate);
});

test("the one-off iOS JSC hotfix profile creates build 39", () => {
  const config = JSON.parse(read("app.json"));
  const eas = JSON.parse(read("eas.json"));

  assert.equal(config.expo.version, "1.0.7");
  assert.equal(config.expo.ios.buildNumber, "39");
  assert.equal(eas.cli.appVersionSource, "remote");
  assert.equal(eas.build["production-ios-build39-jsc-hotfix"].extends, "production");
  assert.equal(eas.build["production-ios-build39-jsc-hotfix"].autoIncrement, true);
  assert.equal(eas.build["production-ios-build38-hotfix"], undefined);
});

test("notification diagnostics do not add an eager Expo clipboard module", () => {
  const packageJson = JSON.parse(read("package.json"));
  const lockfile = read("package-lock.json");
  const screens = [read("app/(tabs)/index.tsx"), read("app/(tabs)/challenges.tsx")];

  assert.equal(packageJson.dependencies?.["expo-clipboard"], undefined);
  assert.doesNotMatch(lockfile, /node_modules\/expo-clipboard/);
  for (const source of screens) {
    assert.doesNotMatch(source, /from ["']expo-clipboard["']/);
    assert.match(source, /Clipboard\.setString\(/);
  }
});

test("cold-start background work never leaves an unhandled rejection", () => {
  const widgetEntry = read("widgets/register.ios.ts");
  const rootLayout = read("app/_layout.tsx");
  const reminders = read("lib/reminders.ts");

  assert.match(widgetEntry, /syncIosWidgetState\(\)\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(widgetEntry, /authStateReady\(\)\.finally/);
  assert.match(rootLayout, /initClock\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(
    reminders,
    /recoverReminderNotificationOperations\(\{ uid: user\.uid \}\)\.catch\(\(\) => undefined\)/,
  );
});
