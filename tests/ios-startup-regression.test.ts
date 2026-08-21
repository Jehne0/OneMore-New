import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const turboModulePatch = require("../scripts/patch-react-native-ios-turbomodule");

const read = (path: string) => readFileSync(path, "utf8");

test("both mobile platforms use the supported Hermes engine", () => {
  const config = JSON.parse(read("app.json"));
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(config.expo.jsEngine, "hermes");
  assert.equal(config.expo.ios.jsEngine, undefined);
  assert.equal(config.expo.android.jsEngine, "hermes");
  assert.equal(packageJson.dependencies?.["@react-native-community/javascriptcore"], undefined);
  assert.ok(!config.expo.plugins.includes("./plugins/withOneMoreIosJsc"));
  assert.ok(config.expo.plugins.includes("./plugins/withOneMoreIosReactNativeSource"));
});

test("iOS async void TurboModule exceptions never touch Hermes off-thread", () => {
  const source = `void ObjCTurboModule::performVoidMethodInvocation() {
    @try {
      [inv invokeWithTarget:strongModule];
    } @catch (NSException *exception) {
      throw convertNSExceptionToJSError(runtime, exception, std::string{moduleName}, methodNameStr);
    } @finally {
      [retainedObjectsForInvocation removeAllObjects];
    }
  }`;
  const patched = turboModulePatch.patchTurboModuleSource(source);
  assert.doesNotMatch(patched, /throw convertNSExceptionToJSError/);
  assert.match(patched, /@throw exception/);
  assert.equal(turboModulePatch.patchTurboModuleSource(patched), patched);
});

test("the one-off iOS startup hotfix profile creates build 39", () => {
  const config = JSON.parse(read("app.json"));
  const eas = JSON.parse(read("eas.json"));

  assert.equal(config.expo.version, "1.0.7");
  assert.equal(config.expo.ios.buildNumber, "39");
  assert.equal(eas.cli.appVersionSource, "local");
  assert.equal(eas.build["production-ios-build39-startup-hotfix"].extends, "production");
  assert.equal(eas.build["production-ios-build39-startup-hotfix"].autoIncrement, false);
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

  assert.doesNotMatch(widgetEntry, /^import .*firebase/m);
  assert.match(widgetEntry, /syncIosWidgetState\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(rootLayout, /BACKGROUND_START_DELAY_MS = 750/);
  assert.doesNotMatch(rootLayout, /^Notifications\.setNotificationHandler/m);
  assert.match(rootLayout, /initClock\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(
    reminders,
    /recoverReminderNotificationOperations\(\{ uid: user\.uid \}\)\.catch\(\(\) => undefined\)/,
  );
});
