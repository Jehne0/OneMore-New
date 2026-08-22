import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("SDK 57 uses its supported Hermes-only runtime on both platforms", () => {
  const config = JSON.parse(read("app.json"));
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(packageJson.dependencies?.expo, "~57.0.15");
  assert.equal(packageJson.dependencies?.["react-native"], "0.86.2");
  assert.equal(packageJson.dependencies?.react, "19.2.3");
  assert.equal(config.expo.jsEngine, undefined);
  assert.equal(config.expo.ios.jsEngine, undefined);
  assert.equal(config.expo.android.jsEngine, undefined);
  assert.equal(packageJson.dependencies?.["@react-native-community/javascriptcore"], undefined);
  assert.equal(config.expo.newArchEnabled, undefined);
  assert.equal(config.expo.android.edgeToEdgeEnabled, undefined);
});

test("startup no longer patches React Native, Expo Modules Core, or JSC", () => {
  const config = JSON.parse(read("app.json"));
  const packageJson = JSON.parse(read("package.json"));
  const plugins = config.expo.plugins as unknown[];

  assert.equal(packageJson.scripts.postinstall, undefined);
  assert.ok(!plugins.includes("./plugins/withOneMoreIosJsc"));
  assert.ok(!plugins.includes("./plugins/withOneMoreIosReactNativeSource"));
  assert.equal(packageJson.dependencies?.["@react-native-community/javascriptcore"], undefined);
});

test("the SDK 57 Hermes profile remains pinned to build 43", () => {
  const config = JSON.parse(read("app.json"));
  const eas = JSON.parse(read("eas.json"));

  assert.equal(config.expo.version, "1.0.7");
  assert.equal(config.expo.ios.buildNumber, "43");
  assert.equal(eas.cli.appVersionSource, "local");
  assert.equal(
    eas.build["production-ios-build43-hermes-sdk57"].extends,
    "production",
  );
  assert.equal(
    eas.build["production-ios-build43-hermes-sdk57"].autoIncrement,
    false,
  );
  assert.equal(eas.build["production-ios-build42-jsc-cocoapods-hotfix"], undefined);
  assert.equal(eas.build["production-ios-build41-jsc-hotfix"], undefined);
  assert.equal(eas.build["production-ios-build40-startup-hotfix"], undefined);
  assert.equal(eas.build["production-ios-build39-startup-hotfix"], undefined);
  assert.equal(eas.build["production-ios-build38-hotfix"], undefined);
});

test("audio is loaded lazily and uses the SDK 57 audio module", () => {
  const packageJson = JSON.parse(read("package.json"));
  const sound = read("lib/sound.ts");

  assert.equal(packageJson.dependencies?.["expo-av"], undefined);
  assert.equal(packageJson.dependencies?.["expo-audio"], "~57.0.4");
  assert.equal(packageJson.dependencies?.["expo-asset"], "~57.0.13");
  assert.doesNotMatch(sound, /^import .*expo-audio/m);
  assert.match(sound, /await import\("expo-audio"\)/);
  assert.match(sound, /await sound\.seekTo\(0\)/);
  assert.match(sound, /sound\.play\(\)/);
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
  assert.match(reminders, /import\("react-native"\)[\s\S]*\.catch\(\(\) => undefined\)/);
});
