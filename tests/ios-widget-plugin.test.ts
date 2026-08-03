import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const xcode = require("xcode");
const plist = require("simple-plist");
const { __test: plugin } = require("../plugins/withOneMoreIosWidget.js");

function unquote(value: unknown) {
  return String(value ?? "").replace(/^"(.*)"$/, "$1");
}

function entries(section: Record<string, unknown> | undefined) {
  return Object.entries(section ?? {}).filter(([key]) => !key.endsWith("_comment"));
}

function targetUuids(project: any, name: string) {
  return entries(project.pbxNativeTargetSection())
    .filter(([, target]: any) => String(target.name).replaceAll('"', "") === name)
    .map(([uuid]) => uuid);
}

function phaseFor(project: any, targetUuid: string, type: string, comment: string) {
  const target = project.pbxNativeTargetSection()[targetUuid];
  const section = project.hash.project.objects[type] ?? {};
  const reference = target.buildPhases.find((phase: any) => phase.comment === comment && section[phase.value]);
  return reference ? section[reference.value] : null;
}

function phasePaths(project: any, targetUuid: string, type: string, comment: string) {
  const phase = phaseFor(project, targetUuid, type, comment);
  const buildFiles = project.pbxBuildFileSection();
  const fileReferences = project.pbxFileReferenceSection();
  return (phase?.files ?? []).map((item: any) => {
    const fileRef = buildFiles[item.value]?.fileRef;
    return String(fileReferences[fileRef]?.path ?? "").replaceAll('"', "");
  });
}

function projectCounts(project: any) {
  const objects = project.hash.project.objects;
  const mainTarget = project.getFirstTarget().uuid;
  const widgetTarget = plugin.findTargetUuid(project, plugin.TARGET);
  return {
    targets: entries(objects.PBXNativeTarget).length,
    groups: entries(objects.PBXGroup).length,
    fileReferences: entries(objects.PBXFileReference).length,
    buildFiles: entries(objects.PBXBuildFile).length,
    sourcesPhases: entries(objects.PBXSourcesBuildPhase).length,
    resourcesPhases: entries(objects.PBXResourcesBuildPhase).length,
    frameworksPhases: entries(objects.PBXFrameworksBuildPhase).length,
    copyPhases: entries(objects.PBXCopyFilesBuildPhase).length,
    dependencies: entries(objects.PBXTargetDependency).length,
    mainSources: phasePaths(project, mainTarget, "PBXSourcesBuildPhase", "Sources"),
    widgetSources: phasePaths(project, widgetTarget, "PBXSourcesBuildPhase", "Sources"),
    widgetResources: phasePaths(project, widgetTarget, "PBXResourcesBuildPhase", "Resources"),
    widgetFrameworks: phasePaths(project, widgetTarget, "PBXFrameworksBuildPhase", "Frameworks"),
  };
}

function assertBuildSettings(settings: Record<string, unknown>, expected: Record<string, string>) {
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(unquote(settings[key]), value, `${key} must be ${value}`);
  }
}

test("iOS CNG plugin creates a real widget PBXGroup and is idempotent over a minimal pbxproj", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onemore-ios-plugin-"));
  try {
    const iosRoot = path.join(temporaryRoot, "ios");
    const projectPath = path.join(iosRoot, "OneMore.xcodeproj", "project.pbxproj");
    fs.mkdirSync(path.dirname(projectPath), { recursive: true });
    fs.copyFileSync("tests/fixtures/minimal-ios-project.pbxproj", projectPath);

    let project = xcode.project(projectPath).parseSync();
    assert.equal(plugin.findGroup(project, plugin.TARGET), null, "fixture must cover the missing-group regression");
    plugin.applyWidgetXcodeProject({
      project,
      iosRoot,
      appName: "OneMore",
      sourceRoot: path.resolve("ios-widget"),
      bundleIdentifier: "eu.desigame.onemore",
      buildNumber: "30",
      marketingVersion: "1.0.1",
    });

    const widgetGroup = plugin.findGroup(project, plugin.TARGET);
    assert.ok(widgetGroup);
    assert.match(widgetGroup.uuid, /^[A-F0-9]{24}$/);
    assert.equal(targetUuids(project, plugin.TARGET).length, 1);
    const first = projectCounts(project);
    for (const intent of ["WidgetConfigurationIntent.swift", "CompleteChallengeIntent.swift"]) {
      assert.ok(plugin.APP_SOURCES.includes(intent));
      assert.ok(plugin.EXTENSION_SOURCES.includes(intent));
    }
    assert.deepEqual([...first.mainSources].sort(), plugin.APP_SOURCES.map((name: string) => `OneMore/${name}`).sort());
    assert.deepEqual([...first.widgetSources].sort(), plugin.EXTENSION_SOURCES.map((name: string) => `${plugin.TARGET}/${name}`).sort());
    assert.deepEqual(first.widgetResources, [`${plugin.TARGET}/Localizable.xcstrings`]);
    assert.equal([...first.mainSources, ...first.widgetSources, ...first.widgetResources].some((item) => item.endsWith(".entitlements")), false);
    assert.equal(first.copyPhases, 1, "the app extension must have exactly one embed phase");

    const widgetTargetUuid = plugin.findTargetUuid(project, plugin.TARGET);
    const widgetTarget = project.pbxNativeTargetSection()[widgetTargetUuid];
    assert.equal(unquote(widgetTarget.productType), "com.apple.product-type.app-extension");
    const widgetProduct = project.pbxFileReferenceSection()[widgetTarget.productReference];
    assert.equal(unquote(widgetProduct.explicitFileType), "wrapper.app-extension");
    assert.equal(unquote(widgetProduct.path), "OneMoreWidget.appex");

    const widgetInfo = plist.readFileSync(path.join(iosRoot, plugin.TARGET, "Info.plist"));
    assert.equal(widgetInfo.CFBundleExecutable, "$(EXECUTABLE_NAME)");
    assert.equal(widgetInfo.CFBundleIdentifier, "$(PRODUCT_BUNDLE_IDENTIFIER)");
    assert.equal(widgetInfo.CFBundlePackageType, "XPC!");
    assert.equal(widgetInfo.CFBundleShortVersionString, "$(MARKETING_VERSION)");
    assert.equal(widgetInfo.CFBundleVersion, "$(CURRENT_PROJECT_VERSION)");
    assert.equal(widgetInfo.NSExtension?.NSExtensionPointIdentifier, "com.apple.widgetkit-extension");

    const versionSettings = {
      MARKETING_VERSION: "1.0.1",
      CURRENT_PROJECT_VERSION: "30",
    };
    for (const configuration of plugin.targetBuildConfigurations(project, project.getFirstTarget().uuid)) {
      assertBuildSettings(configuration.buildSettings, versionSettings);
    }
    for (const configuration of plugin.targetBuildConfigurations(project, widgetTargetUuid)) {
      assertBuildSettings(configuration.buildSettings, {
        ...versionSettings,
        APPLICATION_EXTENSION_API_ONLY: "YES",
        EXECUTABLE_NAME: "$(PRODUCT_NAME)",
        INFOPLIST_FILE: "OneMoreWidget/Info.plist",
        MACH_O_TYPE: "mh_execute",
        PRODUCT_BUNDLE_IDENTIFIER: "eu.desigame.onemore.OneMoreWidget",
        SKIP_INSTALL: "YES",
        WRAPPER_EXTENSION: "appex",
      });
    }

    const widgetMainSources = plugin.EXTENSION_SOURCES.filter((name: string) =>
      /@main\s+struct\s+OneMoreWidgetBundle\b/.test(fs.readFileSync(path.join("ios-widget", name), "utf8")),
    );
    assert.deepEqual(widgetMainSources, ["OneMoreWidget.swift"]);
    assert.equal(plugin.APP_SOURCES.includes("OneMoreWidget.swift"), false, "@main source must not belong to the app target");
    assert.equal(first.widgetSources.filter((item: string) => item.endsWith("/OneMoreWidget.swift")).length, 1);

    fs.writeFileSync(projectPath, project.writeSync());
    project = xcode.project(projectPath).parseSync();
    plugin.applyWidgetXcodeProject({
      project,
      iosRoot,
      appName: "OneMore",
      sourceRoot: path.resolve("ios-widget"),
      bundleIdentifier: "eu.desigame.onemore",
      buildNumber: "30",
      marketingVersion: "1.0.1",
    });

    assert.deepEqual(projectCounts(project), first);
    assert.equal(targetUuids(project, plugin.TARGET).length, 1);
    assert.equal(entries(project.hash.project.objects.PBXGroup).filter(([, group]: any) => group.name === plugin.TARGET).length, 1);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
