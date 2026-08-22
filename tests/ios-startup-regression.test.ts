import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const turboModulePatch = require("../scripts/patch-react-native-ios-turbomodule");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const jscPodsPatch = require("../scripts/patch-react-native-ios-jsc-pods");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __test: iosJscPlugin } = require("../plugins/withOneMoreIosJsc");

const read = (path: string) => readFileSync(path, "utf8");

test("iOS uses community JSC while Android keeps Hermes", () => {
  const config = JSON.parse(read("app.json"));
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(config.expo.jsEngine, "jsc");
  assert.equal(config.expo.ios.jsEngine, undefined);
  assert.equal(config.expo.android.jsEngine, "hermes");
  assert.equal(packageJson.dependencies?.["@react-native-community/javascriptcore"], "0.2.0");
  assert.ok(config.expo.plugins.includes("./plugins/withOneMoreIosJsc"));
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

test("iOS community JSC integration disables every Hermes and prebuilt RN path", () => {
  const packageJson = JSON.parse(read("package.json"));
  const podfile = `require "react_native_pods"\ntarget 'OneMore' do\nend\n`;
  const appDelegate = `import Expo\nimport ReactAppDependencyProvider\n\nclass ReactNativeDelegate {\n  // Extension point for config-plugins\n}\n`;
  const patchedPodfile = iosJscPlugin.patchPodfile(podfile);
  const patchedDelegate = iosJscPlugin.patchAppDelegate(appDelegate);
  const rnPods = "def use_react_native!\n  hermes_enabled= true\nend\n";
  const patchedRnPods = jscPodsPatch.patchReactNativePods(rnPods);

  assert.match(packageJson.scripts.postinstall, /patch-react-native-ios-jsc-pods\.js/);
  assert.doesNotMatch(packageJson.scripts.postinstall, /hermes-source-bundle/);
  assert.match(patchedPodfile, /ENV\['USE_THIRD_PARTY_JSC'\] = '1'/);
  assert.match(patchedPodfile, /ENV\['USE_HERMES'\] = '0'/);
  assert.match(patchedPodfile, /ENV\['RCT_USE_RN_DEP'\] = '0'/);
  assert.match(patchedPodfile, /ENV\['RCT_USE_PREBUILT_RNCORE'\] = '0'/);
  assert.equal(iosJscPlugin.patchPodfile(patchedPodfile), patchedPodfile);
  assert.match(patchedDelegate, /import ReactJSC/);
  assert.match(patchedDelegate, /override func createJSRuntimeFactory\(\) -> JSRuntimeFactoryRef/);
  assert.match(patchedDelegate, /jsrt_create_jsc_factory\(\)/);
  assert.equal(iosJscPlugin.patchAppDelegate(patchedDelegate), patchedDelegate);
  assert.match(patchedRnPods, /hermes_enabled= !use_third_party_jsc\(\)/);
  assert.equal(jscPodsPatch.patchReactNativePods(patchedRnPods), patchedRnPods);
});

test("the one-off iOS JSC startup hotfix profile creates build 41", () => {
  const config = JSON.parse(read("app.json"));
  const eas = JSON.parse(read("eas.json"));

  assert.equal(config.expo.version, "1.0.7");
  assert.equal(config.expo.ios.buildNumber, "41");
  assert.equal(eas.cli.appVersionSource, "local");
  assert.equal(eas.build["production-ios-build41-jsc-hotfix"].extends, "production");
  assert.equal(eas.build["production-ios-build41-jsc-hotfix"].autoIncrement, false);
  assert.equal(eas.build["production-ios-build40-startup-hotfix"], undefined);
  assert.equal(eas.build["production-ios-build39-startup-hotfix"], undefined);
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
  assert.match(reminders, /import\("react-native"\)[\s\S]*\.catch\(\(\) => undefined\)/);
});
