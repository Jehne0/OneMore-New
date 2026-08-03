const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

module.exports = function withOneMoreWidgetResize(config) {
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    const activity = (application.activity ?? []).find((item) => item.$?.["android:name"] === ".WidgetConfigurationActivity");
    if (activity) activity.$["android:resizeableActivity"] = "true";

    const receiver = (application.receiver ?? []).find((item) => item.$?.["android:name"] === ".widget.OneMore");
    const actions = receiver?.["intent-filter"]?.[0]?.action;
    if (actions) {
      for (const name of [
        "android.intent.action.BOOT_COMPLETED",
        "android.intent.action.MY_PACKAGE_REPLACED",
        "android.intent.action.CONFIGURATION_CHANGED",
        "android.intent.action.TIME_SET",
        "android.intent.action.TIMEZONE_CHANGED",
      ]) {
        if (!actions.some((item) => item.$?.["android:name"] === name)) actions.push({ $: { "android:name": name } });
      }
    }

    manifest["uses-permission"] = manifest["uses-permission"] ?? [];
    if (!manifest["uses-permission"].some((item) => item.$?.["android:name"] === "android.permission.RECEIVE_BOOT_COMPLETED")) {
      manifest["uses-permission"].push({ $: { "android:name": "android.permission.RECEIVE_BOOT_COMPLETED" } });
    }
    return mod;
  });

  return withDangerousMod(config, ["android", async (mod) => {
    const file = path.join(mod.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml", "widgetprovider_onemore.xml");
    if (fs.existsSync(file)) {
      let xml = fs.readFileSync(file, "utf8");
      if (!xml.includes("android:minResizeHeight")) {
        xml = xml.replace(
          '    android:minHeight="56dp"',
          '    android:minHeight="56dp"\n    android:minResizeWidth="110dp"\n    android:minResizeHeight="56dp"'
        );
      }
      fs.writeFileSync(file, xml);
    }

    const packageRoot = path.join(
      mod.modRequest.platformProjectRoot,
      "app", "src", "main", "java", "com", "anonymous", "OneMore"
    );
    const templates = path.join(mod.modRequest.projectRoot, "plugins", "android");
    fs.mkdirSync(packageRoot, { recursive: true });
    for (const name of [
      "WidgetSessionContract.kt",
      "WidgetSessionModule.kt",
      "WidgetSessionPackage.kt",
      "WidgetConfigurationActivity.kt",
    ]) {
      fs.copyFileSync(path.join(templates, name), path.join(packageRoot, name));
    }
    const widgetPackage = path.join(packageRoot, "widget");
    fs.mkdirSync(widgetPackage, { recursive: true });
    fs.copyFileSync(path.join(templates, "OneMore.java"), path.join(widgetPackage, "OneMore.java"));
    const duplicateJavaActivity = path.join(packageRoot, "WidgetConfigurationActivity.java");
    if (fs.existsSync(duplicateJavaActivity)) fs.unlinkSync(duplicateJavaActivity);

    const mainApplication = path.join(packageRoot, "MainApplication.kt");
    if (fs.existsSync(mainApplication)) {
      let source = fs.readFileSync(mainApplication, "utf8");
      if (!source.includes("add(WidgetSessionPackage())")) {
        source = source.replace(
          /PackageList\(this\)\.packages\.apply \{([\s\S]*?)\n\s*\}/,
          (match, body) => `PackageList(this).packages.apply {${body}\n              add(WidgetSessionPackage())\n            }`
        );
      }
      fs.writeFileSync(mainApplication, source);
    }

    return mod;
  }]);
};
