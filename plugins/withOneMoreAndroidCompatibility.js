const {
  AndroidConfig,
  withAndroidManifest,
  withAndroidStyles,
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const R8_MINIFY_KEY = "android.enableMinifyInReleaseBuilds";
const R8_RESOURCES_KEY = "android.enableShrinkResourcesInReleaseBuilds";

function upsertProperty(properties, key, value) {
  const filtered = properties.filter((item) => item.type !== "property" || item.key !== key);
  filtered.push({ type: "property", key, value });
  return filtered;
}

function withResponsiveManifest(config) {
  return withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    for (const activity of application.activity ?? []) {
      const attrs = activity.$ ?? (activity.$ = {});
      delete attrs["android:screenOrientation"];
      delete attrs["android:maxAspectRatio"];
      delete attrs["android:minAspectRatio"];
      attrs["android:resizeableActivity"] = "true";
    }
    delete application.$?.["android:maxAspectRatio"];
    delete application.$?.["android:minAspectRatio"];
    delete application.$?.["android:resizeableActivity"];
    return mod;
  });
}

function withModernSystemBars(config) {
  return withAndroidStyles(config, (mod) => {
    for (const style of mod.modResults.resources.style ?? []) {
      style.item = (style.item ?? []).filter((item) => ![
        "android:statusBarColor",
        "android:navigationBarColor",
        "android:enforceStatusBarContrast",
        "android:enforceNavigationBarContrast",
        "android:windowOptOutEdgeToEdgeEnforcement",
      ].includes(item.$?.name));
    }
    return mod;
  });
}

function withR8Properties(config) {
  return withGradleProperties(config, (mod) => {
    let properties = mod.modResults.filter(
      (item) => item.type !== "property" || item.key !== "expo.edgeToEdgeEnabled"
    );
    properties = upsertProperty(properties, R8_MINIFY_KEY, "true");
    properties = upsertProperty(properties, R8_RESOURCES_KEY, "true");
    mod.modResults = properties;
    return mod;
  });
}

function withOptimizedRelease(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy") return mod;
    let source = mod.modResults.contents;
    source = source.replace(
      /def enableMinifyInReleaseBuilds = .*$/m,
      "def enableMinifyInReleaseBuilds = (findProperty('android.enableMinifyInReleaseBuilds') ?: true).toBoolean() && System.getenv('EAS_BUILD_PROFILE') != 'preview'"
    );
    source = source.replace(
      /def enableShrinkResources = .*$/m,
      "def enableShrinkResources = (findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'true').toBoolean() && System.getenv('EAS_BUILD_PROFILE') != 'preview'"
    );
    source = source.replace(
      /shrinkResources enableShrinkResources\.toBoolean\(\)/,
      "shrinkResources enableShrinkResources"
    );
    source = source.replace(
      /getDefaultProguardFile\(["']proguard-android\.txt["']\)/,
      'getDefaultProguardFile("proguard-android-optimize.txt")'
    );
    mod.modResults.contents = source;
    return mod;
  });
}

function withNarrowProjectRules(config) {
  return withDangerousMod(config, ["android", async (mod) => {
    const file = path.join(mod.modRequest.platformProjectRoot, "app", "proguard-rules.pro");
    const contents = [
      "# OneMore project rules.",
      "# No application-wide keep rules are required: manifest components are retained by AGP,",
      "# WidgetSessionPackage is directly instantiated, and dependencies provide consumer rules.",
      "",
      "# expo-notifications persists these Serializable models in SharedPreferences.",
      "# Preserve only the custom content serializer and the request/trigger graph OneMore schedules.",
      "-keep class expo.modules.notifications.notifications.model.NotificationContent {",
      "  private static final long serialVersionUID;",
      "  private void writeObject(java.io.ObjectOutputStream);",
      "  private void readObject(java.io.ObjectInputStream);",
      "  private void readObjectNoData();",
      "}",
      "-keep class expo.modules.notifications.notifications.model.NotificationRequest { *; }",
      "-keep class expo.modules.notifications.notifications.triggers.ChannelAwareTrigger { *; }",
      "-keep class expo.modules.notifications.notifications.triggers.DailyTrigger { *; }",
      "-keep class expo.modules.notifications.notifications.triggers.DateTrigger { *; }",
      "",
    ].join("\n");
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== contents) {
      fs.writeFileSync(file, contents);
    }
    return mod;
  }]);
}

module.exports = function withOneMoreAndroidCompatibility(config) {
  config = withResponsiveManifest(config);
  config = withModernSystemBars(config);
  config = withR8Properties(config);
  config = withOptimizedRelease(config);
  return withNarrowProjectRules(config);
};
