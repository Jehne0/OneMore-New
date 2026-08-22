import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { COMPACT_WIDTH, LARGE_TABLET_WIDTH, MAX_CONTENT_WIDTH, MAX_MODAL_WIDTH, TABLET_WIDTH, getResponsiveLayout } from "../lib/responsiveLayout";

test("responsive breakpoints cover phones, split-screen, tablets and runtime resize", () => {
  const widths = [320, 360, 411, 300, 600, 800, 1280, 411];
  const layouts = widths.map(getResponsiveLayout);
  assert.equal(layouts[0].compact, true);
  assert.equal(layouts[1].compact, false);
  assert.equal(layouts[4].tablet, true);
  assert.equal(layouts[5].columns, 1);
  assert.equal(layouts[6].columns, 2);
  assert.equal(layouts[7].contentWidth, getResponsiveLayout(411).contentWidth);
  for (const layout of layouts) {
    assert.ok(layout.contentWidth > 0 && layout.contentWidth <= MAX_CONTENT_WIDTH);
    assert.ok(layout.modalWidth > 0 && layout.modalWidth <= MAX_MODAL_WIDTH);
  }
  assert.deepEqual([COMPACT_WIDTH, TABLET_WIDTH, LARGE_TABLET_WIDTH], [360, 600, 840]);
});

test("CNG Android compatibility plugin removes restrictions and enables production R8 narrowly", () => {
  const plugin = readFileSync("plugins/withOneMoreAndroidCompatibility.js", "utf8");
  const app = JSON.parse(readFileSync("app.json", "utf8"));
  assert.equal(app.expo.orientation, "default");
  assert.equal(app.expo.android.edgeToEdgeEnabled, undefined);
  assert.equal(app.expo.androidStatusBar, undefined);
  assert.ok(app.expo.plugins.includes("./plugins/withOneMoreAndroidCompatibility"));
  assert.match(plugin, /delete attrs\["android:screenOrientation"\]/);
  assert.match(plugin, /"android:resizeableActivity"\] = "true"/);
  assert.match(plugin, /proguard-android-optimize\.txt/);
  assert.match(plugin, /EAS_BUILD_PROFILE'\) != 'preview'/);
  assert.doesNotMatch(plugin, /-keep class \*\*/);
});

test("Android CNG widget templates are versioned and not hidden by the generated-project ignore", () => {
  const ignore = readFileSync(".gitignore", "utf8");
  assert.match(ignore, /^\/android\/$/m);
  assert.doesNotMatch(ignore, /^android\/$/m);
  for (const name of [
    "WidgetSessionContract.kt",
    "WidgetSessionModule.kt",
    "WidgetSessionPackage.kt",
    "WidgetConfigurationActivity.kt",
    "OneMore.java",
  ]) {
    assert.equal(existsSync(`plugins/android/${name}`), true, name);
  }
});

test("generated Android manifest is resizable and preserves widget lifecycle integration", () => {
  const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
  assert.doesNotMatch(manifest, /android:screenOrientation|android:maxAspectRatio|android:minAspectRatio/);
  assert.match(manifest, /android:name="\.MainActivity"[^>]*android:resizeableActivity="true"/);
  assert.match(manifest, /android:name="\.WidgetConfigurationActivity"[^>]*android:resizeableActivity="true"/);
  for (const required of [
    "android.permission.RECEIVE_BOOT_COMPLETED",
    "android.intent.action.BOOT_COMPLETED",
    "android.intent.action.MY_PACKAGE_REPLACED",
    "android.intent.action.CONFIGURATION_CHANGED",
    "android.intent.action.TIME_SET",
    "android.intent.action.TIMEZONE_CHANGED",
  ]) assert.ok(manifest.includes(required), required);
  assert.doesNotMatch(manifest, /android\.intent\.action\.DATE_CHANGED/);
  assert.doesNotMatch(manifest, /SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM/);
  assert.equal(existsSync("android/app/src/main/java/com/anonymous/OneMore/WidgetConfigurationActivity.java"), false);
  assert.equal(existsSync("android/app/src/main/java/com/anonymous/OneMore/WidgetConfigurationActivity.kt"), true);
});

test("production R8 preserves the directly registered native account snapshot bridge", () => {
  const plugin = readFileSync("plugins/withOneMoreAndroidCompatibility.js", "utf8");
  const buildGradle = readFileSync("android/app/build.gradle", "utf8");
  const mainApplication = readFileSync("android/app/src/main/java/com/anonymous/OneMore/MainApplication.kt", "utf8");
  const module = readFileSync("android/app/src/main/java/com/anonymous/OneMore/WidgetSessionModule.kt", "utf8");
  const contract = readFileSync("android/app/src/main/java/com/anonymous/OneMore/WidgetSessionContract.kt", "utf8");
  const reactNativeRules = readFileSync("node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/bridge/reactnative.pro", "utf8");
  const projectRules = readFileSync("android/app/proguard-rules.pro", "utf8");
  const eas = JSON.parse(readFileSync("eas.json", "utf8"));

  assert.match(buildGradle, /minifyEnabled enableMinifyInReleaseBuilds/);
  assert.match(buildGradle, /shrinkResources enableShrinkResources/);
  assert.match(mainApplication, /add\(WidgetSessionPackage\(\)\)/);
  assert.match(module, /@ReactMethod[\s\S]*fun getAccountSnapshot/);
  assert.match(module, /@ReactMethod[\s\S]*fun setAccountSnapshot/);
  assert.match(reactNativeRules, /@com\.facebook\.react\.bridge\.ReactMethod \*;/);
  assert.doesNotMatch(projectRules, /-keep class \*\*/);
  assert.match(projectRules, /-keep class expo\.modules\.notifications\.notifications\.model\.NotificationContent \{/);
  assert.match(projectRules, /private static final long serialVersionUID;/);
  assert.match(projectRules, /private void writeObject\(java\.io\.ObjectOutputStream\);/);
  assert.match(projectRules, /private void readObject\(java\.io\.ObjectInputStream\);/);
  assert.match(projectRules, /private void readObjectNoData\(\);/);
  assert.match(projectRules, /-keep class expo\.modules\.notifications\.notifications\.model\.NotificationRequest \{ \*; \}/);
  assert.match(projectRules, /-keep class expo\.modules\.notifications\.notifications\.triggers\.ChannelAwareTrigger \{ \*; \}/);
  assert.match(projectRules, /-keep class expo\.modules\.notifications\.notifications\.triggers\.DailyTrigger \{ \*; \}/);
  assert.match(projectRules, /-keep class expo\.modules\.notifications\.notifications\.triggers\.DateTrigger \{ \*; \}/);
  assert.doesNotMatch(projectRules, /notifications\.triggers\.\*\*/);
  for (const rule of projectRules.split(/\r?\n/).filter((line) => line.startsWith("-keep class expo.modules.notifications"))) {
    assert.equal(projectRules.split(rule).length - 1, 1, `duplicate rule: ${rule}`);
    assert.ok(plugin.includes(JSON.stringify(rule)), `CNG plugin must generate: ${rule}`);
  }
  assert.match(contract, /onemore_account_snapshot:/);
  assert.equal(eas.build.preview.env, undefined);
  assert.equal(eas.build.production.env, undefined);
  assert.equal(eas.build["cold-start-verification"].distribution, "internal");
  assert.equal(eas.build["cold-start-verification"].developmentClient, false);
  assert.equal(eas.build["cold-start-verification"].android.buildType, "apk");
  assert.equal(eas.build["cold-start-verification"].android.gradleCommand, ":app:assembleRelease");
  assert.notEqual("cold-start-verification", "preview");
});

test("Expo notification persistence source stringifies Uri and data when R8 keeps its serialization contract", () => {
  const content = readFileSync(
    "node_modules/expo-notifications/android/src/main/java/expo/modules/notifications/notifications/model/NotificationContent.java",
    "utf8",
  );
  const store = readFileSync(
    "node_modules/expo-notifications/android/src/main/java/expo/modules/notifications/service/delegates/SharedPreferencesNotificationsStore.kt",
    "utf8",
  );
  const serializer = readFileSync(
    "node_modules/expo-notifications/android/src/main/java/expo/modules/notifications/service/delegates/Base64Serialization.kt",
    "utf8",
  );
  assert.match(content, /private void writeObject\(java\.io\.ObjectOutputStream out\)/);
  assert.match(content, /mSound == null \? null : mSound\.toString\(\)/);
  assert.match(content, /mBody != null \? mBody\.toString\(\) : null/);
  assert.match(store, /notificationRequest\.encodedInBase64\(\)/);
  assert.match(serializer, /objectOutputStream\.writeObject\(this\)/);
});
