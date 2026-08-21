import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("iOS release uses JSC while Android keeps Hermes", () => {
  const config = JSON.parse(read("app.json"));
  assert.equal(config.expo.jsEngine, "jsc");
  assert.equal(config.expo.ios.jsEngine, undefined);
  assert.equal(config.expo.android.jsEngine, "hermes");
});

test("the one-off iOS hotfix profile reuses build 38 instead of creating build 39", () => {
  const config = JSON.parse(read("app.json"));
  const eas = JSON.parse(read("eas.json"));

  assert.equal(config.expo.version, "1.0.7");
  assert.equal(config.expo.ios.buildNumber, "38");
  assert.equal(eas.cli.appVersionSource, "remote");
  assert.equal(eas.build["production-ios-build38-hotfix"].extends, "production");
  assert.equal(eas.build["production-ios-build38-hotfix"].autoIncrement, false);
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
