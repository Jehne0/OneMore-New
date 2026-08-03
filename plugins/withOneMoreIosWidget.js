const { withEntitlementsPlist, withInfoPlist, withXcodeProject } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const GROUP = "group.eu.desigame.onemore";
const KEYCHAIN_GROUP = "$(AppIdentifierPrefix)eu.desigame.onemore.widget";
const TARGET = "OneMoreWidget";
const EXTENSION_SOURCES = [
  "WidgetSharedState.swift",
  "OneMoreWidget.swift",
  "WidgetConfigurationIntent.swift",
  "CompleteChallengeIntent.swift",
  "WidgetNetworkAccess.swift",
];
const APP_SOURCES = [
  "WidgetSharedState.swift",
  "WidgetNetworkAccess.swift",
  "WidgetConfigurationIntent.swift",
  "CompleteChallengeIntent.swift",
  "OneMoreIosWidgetBridge.swift",
  "OneMoreIosWidgetBridge.m",
];
const EXTENSION_RESOURCES = ["Localizable.xcstrings"];
const FRAMEWORKS = ["WidgetKit.framework", "SwiftUI.framework", "AppIntents.framework", "Security.framework"];
const UUID_PATTERN = /^[A-F0-9]{24}$/i;

function unquote(value) {
  return typeof value === "string" ? value.replace(/^"(.*)"$/, "$1") : "";
}

function assertUuid(uuid, description) {
  if (!UUID_PATTERN.test(uuid)) throw new Error(`${description} has an invalid PBX UUID: ${String(uuid)}`);
  return uuid;
}

function validatedSourceFile(sourceRoot, name) {
  const absolutePath = path.join(sourceRoot, name);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`Missing iOS widget source file: ${absolutePath}`);
  }
  return absolutePath;
}

function copyFiles(sourceRoot, targetRoot, names) {
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const name of names) {
    fs.copyFileSync(validatedSourceFile(sourceRoot, name), path.join(targetRoot, name));
  }
}

function relativePosixFile(iosRoot, absolutePath) {
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`Missing generated iOS widget file: ${absolutePath}`);
  }
  const relativePath = path.relative(iosRoot, absolutePath);
  if (!relativePath || path.isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) {
    throw new Error(`iOS widget file is outside the native project: ${absolutePath}`);
  }
  const posixPath = relativePath.split(path.sep).join("/");
  if (posixPath.includes("\\") || posixPath.startsWith("/") || posixPath.split("/").includes("..")) {
    throw new Error(`Invalid iOS widget project path: ${posixPath}`);
  }
  return posixPath;
}

function plist(group) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>com.apple.security.application-groups</key><array><string>${group}</string></array>
<key>keychain-access-groups</key><array><string>${KEYCHAIN_GROUP}</string></array>
</dict></plist>\n`;
}

function infoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>OneMore</string>
<key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string>
<key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
<key>CFBundleName</key><string>$(PRODUCT_NAME)</string>
<key>CFBundlePackageType</key><string>XPC!</string>
<key>CFBundleShortVersionString</key><string>$(MARKETING_VERSION)</string>
<key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string>
<key>OneMoreKeychainAccessGroup</key><string>${KEYCHAIN_GROUP}</string>
<key>NSExtension</key><dict><key>NSExtensionPointIdentifier</key><string>com.apple.widgetkit-extension</string></dict>
</dict></plist>\n`;
}

function findTargetUuid(project, name) {
  const section = project.pbxNativeTargetSection();
  return Object.entries(section).find(([key, target]) =>
    !key.endsWith("_comment") && target && unquote(target.name) === name
  )?.[0] ?? null;
}

function findGroup(project, name) {
  const groups = project.hash.project.objects.PBXGroup ?? {};
  for (const [uuid, group] of Object.entries(groups)) {
    if (uuid.endsWith("_comment") || !group || typeof group !== "object") continue;
    const comment = groups[`${uuid}_comment`];
    if (unquote(group.name) === name || (!group.name && unquote(group.path) === name) || comment === name) {
      return { uuid: assertUuid(uuid, `PBXGroup ${name}`), group };
    }
  }
  return null;
}

function ensureGroup(project, name, parentUuid) {
  const existing = findGroup(project, name);
  const uuid = existing?.uuid ?? assertUuid(project.pbxCreateGroup(name), `PBXGroup ${name}`);
  const group = existing?.group ?? project.getPBXGroupByKey(uuid);
  if (!group || !Array.isArray(group.children)) throw new Error(`Unable to create PBXGroup ${name}`);

  const parent = project.getPBXGroupByKey(assertUuid(parentUuid, `parent of PBXGroup ${name}`));
  if (!parent || !Array.isArray(parent.children)) throw new Error(`Unable to find parent PBXGroup for ${name}`);
  if (!parent.children.some((child) => child?.value === uuid)) project.addToPbxGroup(uuid, parentUuid);
  return { uuid, group };
}

function ensureBuildPhase(project, targetUuid, type, comment) {
  assertUuid(targetUuid, `${comment} target`);
  const target = project.pbxNativeTargetSection()[targetUuid];
  if (!target || !Array.isArray(target.buildPhases)) throw new Error(`Missing native target for ${comment}`);
  const section = project.hash.project.objects[type] ?? {};
  const existing = target.buildPhases.find((entry) => section[entry.value] && (entry.comment === comment || section[`${entry.value}_comment`] === comment));
  if (existing) return section[existing.value];
  const added = project.addBuildPhase([], type, comment, targetUuid);
  if (!added?.buildPhase) throw new Error(`Unable to create ${comment} build phase`);
  return added.buildPhase;
}

function findFileReference(project, relativePath) {
  const references = project.pbxFileReferenceSection();
  for (const [uuid, reference] of Object.entries(references)) {
    if (uuid.endsWith("_comment") || !reference || typeof reference !== "object") continue;
    if (unquote(reference.path) === relativePath) return { uuid: assertUuid(uuid, `file reference ${relativePath}`), reference };
  }
  return null;
}

function ensureGroupContainsFile(project, groupUuid, fileRefUuid, basename) {
  const group = project.getPBXGroupByKey(groupUuid);
  if (!group || !Array.isArray(group.children)) throw new Error(`Missing PBXGroup ${groupUuid}`);
  if (!group.children.some((child) => child?.value === fileRefUuid)) {
    project.addToPbxGroup({ fileRef: fileRefUuid, basename }, groupUuid);
  }
}

function ensureReferenceInPhase(project, targetUuid, phaseType, phaseComment, reference, groupName) {
  const phase = ensureBuildPhase(project, targetUuid, phaseType, phaseComment);
  const buildFiles = project.pbxBuildFileSection();
  const matches = phase.files.filter((entry) => buildFiles[entry.value]?.fileRef === reference.uuid);
  if (matches.length === 0) {
    const file = {
      basename: path.posix.basename(unquote(reference.reference.path)),
      path: unquote(reference.reference.path),
      fileRef: reference.uuid,
      uuid: project.generateUuid(),
      group: groupName,
    };
    project.addToPbxBuildFileSection(file);
    if (phaseType === "PBXSourcesBuildPhase") project.addToPbxSourcesBuildPhase({ ...file, target: targetUuid });
    else if (phaseType === "PBXResourcesBuildPhase") project.addToPbxResourcesBuildPhase({ ...file, target: targetUuid });
    else if (phaseType === "PBXFrameworksBuildPhase") project.addToPbxFrameworksBuildPhase({ ...file, target: targetUuid });
  }
}

function ensureProjectFile(project, { iosRoot, relativePath, absolutePath, groupUuid, targetUuid, resource = false }) {
  const checkedPath = relativePosixFile(iosRoot, absolutePath);
  if (checkedPath !== relativePath) throw new Error(`Unexpected iOS widget path: ${checkedPath} (expected ${relativePath})`);

  let reference = findFileReference(project, relativePath);
  if (!reference) {
    const options = { target: targetUuid, sourceTree: "SOURCE_ROOT" };
    const added = resource
      ? project.addResourceFile(relativePath, options, groupUuid)
      : project.addSourceFile(relativePath, options, groupUuid);
    if (!added) throw new Error(`Unable to add ${relativePath} to the Xcode project`);
    reference = findFileReference(project, relativePath);
    if (!reference) throw new Error(`Missing PBXFileReference after adding ${relativePath}`);
  } else {
    ensureGroupContainsFile(project, groupUuid, reference.uuid, path.posix.basename(relativePath));
    ensureReferenceInPhase(
      project,
      targetUuid,
      resource ? "PBXResourcesBuildPhase" : "PBXSourcesBuildPhase",
      resource ? "Resources" : "Sources",
      reference,
      resource ? "Resources" : "Sources",
    );
  }
}

function ensureFramework(project, framework, targetUuid) {
  const frameworkPath = `System/Library/Frameworks/${framework}`;
  let reference = findFileReference(project, frameworkPath);
  if (!reference) {
    project.addFramework(framework, { target: targetUuid, weak: false });
    reference = findFileReference(project, frameworkPath);
  }
  if (!reference) throw new Error(`Unable to add framework ${framework}`);
  ensureReferenceInPhase(project, targetUuid, "PBXFrameworksBuildPhase", "Frameworks", reference, "Frameworks");
}

function targetBuildConfigurations(project, targetUuid) {
  const target = project.pbxNativeTargetSection()[assertUuid(targetUuid, "build configuration target")];
  if (!target?.buildConfigurationList) throw new Error(`Missing build configuration list for target ${targetUuid}`);
  const configurationList = project.hash.project.objects.XCConfigurationList?.[target.buildConfigurationList];
  if (!configurationList || !Array.isArray(configurationList.buildConfigurations)) {
    throw new Error(`Missing build configurations for target ${targetUuid}`);
  }
  const configurations = project.pbxXCBuildConfigurationSection();
  return configurationList.buildConfigurations.map(({ value }) => {
    const configuration = configurations[value];
    if (!configuration?.buildSettings) throw new Error(`Missing build settings for configuration ${value}`);
    return configuration;
  });
}

function applyWidgetXcodeProject({ project, iosRoot, appName, sourceRoot, bundleIdentifier, buildNumber, marketingVersion }) {
  const appRoot = path.join(iosRoot, appName);
  const extensionRoot = path.join(iosRoot, TARGET);
  copyFiles(sourceRoot, appRoot, APP_SOURCES);
  copyFiles(sourceRoot, extensionRoot, [...EXTENSION_SOURCES, ...EXTENSION_RESOURCES]);
  fs.writeFileSync(path.join(extensionRoot, `${TARGET}.entitlements`), plist(GROUP));
  fs.writeFileSync(path.join(extensionRoot, "Info.plist"), infoPlist());

  const mainTarget = assertUuid(project.getFirstTarget().uuid, "main target");
  const mainGroup = assertUuid(project.getFirstProject().firstProject.mainGroup, "main PBXGroup");
  const widgetGroup = ensureGroup(project, TARGET, mainGroup);
  // xcode@3.0.1 dereferences these conventional groups even when a caller
  // supplies a different, explicit group UUID.
  ensureGroup(project, "Resources", mainGroup);
  ensureGroup(project, "Frameworks", mainGroup);

  let targetUuid = findTargetUuid(project, TARGET);
  if (!targetUuid) {
    targetUuid = project.addTarget(TARGET, "app_extension", TARGET, `${bundleIdentifier}.${TARGET}`).uuid;
  }
  assertUuid(targetUuid, `${TARGET} target`);
  ensureBuildPhase(project, targetUuid, "PBXSourcesBuildPhase", "Sources");
  ensureBuildPhase(project, targetUuid, "PBXResourcesBuildPhase", "Resources");
  ensureBuildPhase(project, targetUuid, "PBXFrameworksBuildPhase", "Frameworks");

  for (const name of APP_SOURCES) {
    const absolutePath = path.join(appRoot, name);
    ensureProjectFile(project, {
      iosRoot, relativePath: relativePosixFile(iosRoot, absolutePath), absolutePath, groupUuid: mainGroup, targetUuid: mainTarget,
    });
  }
  for (const name of EXTENSION_SOURCES) {
    const absolutePath = path.join(extensionRoot, name);
    ensureProjectFile(project, {
      iosRoot, relativePath: relativePosixFile(iosRoot, absolutePath), absolutePath, groupUuid: widgetGroup.uuid, targetUuid,
    });
  }
  for (const name of EXTENSION_RESOURCES) {
    const absolutePath = path.join(extensionRoot, name);
    ensureProjectFile(project, {
      iosRoot, relativePath: relativePosixFile(iosRoot, absolutePath), absolutePath, groupUuid: widgetGroup.uuid, targetUuid, resource: true,
    });
  }
  for (const framework of FRAMEWORKS) ensureFramework(project, framework, targetUuid);

  targetBuildConfigurations(project, mainTarget).forEach((entry) => Object.assign(entry.buildSettings, {
    MARKETING_VERSION: `"${marketingVersion}"`,
    CURRENT_PROJECT_VERSION: `"${buildNumber}"`,
  }));
  targetBuildConfigurations(project, targetUuid).forEach((entry) => Object.assign(entry.buildSettings, {
      SWIFT_VERSION: "5.0",
      IPHONEOS_DEPLOYMENT_TARGET: "16.0",
      APPLICATION_EXTENSION_API_ONLY: "YES",
      TARGETED_DEVICE_FAMILY: `"1,2"`,
      CODE_SIGN_ENTITLEMENTS: `"${TARGET}/${TARGET}.entitlements"`,
      INFOPLIST_FILE: `"${TARGET}/Info.plist"`,
      PRODUCT_BUNDLE_IDENTIFIER: `"${bundleIdentifier}.${TARGET}"`,
      MARKETING_VERSION: `"${marketingVersion}"`,
      CURRENT_PROJECT_VERSION: `"${buildNumber}"`,
      EXECUTABLE_NAME: `"$(PRODUCT_NAME)"`,
      MACH_O_TYPE: "mh_execute",
      SKIP_INSTALL: "YES",
      WRAPPER_EXTENSION: "appex",
    }));
}

function withOneMoreIosWidget(config) {
  config = withEntitlementsPlist(config, (value) => {
    const groups = new Set(value.modResults["com.apple.security.application-groups"] ?? []);
    groups.add(GROUP);
    value.modResults["com.apple.security.application-groups"] = [...groups];
    const keychainGroups = new Set(value.modResults["keychain-access-groups"] ?? []);
    keychainGroups.add(KEYCHAIN_GROUP);
    value.modResults["keychain-access-groups"] = [...keychainGroups];
    return value;
  });
  config = withInfoPlist(config, (value) => {
    value.modResults.OneMoreKeychainAccessGroup = KEYCHAIN_GROUP;
    return value;
  });

  return withXcodeProject(config, (value) => {
    applyWidgetXcodeProject({
      project: value.modResults,
      iosRoot: value.modRequest.platformProjectRoot,
      appName: value.modRequest.projectName,
      sourceRoot: path.join(value.modRequest.projectRoot, "ios-widget"),
      bundleIdentifier: value.ios.bundleIdentifier,
      buildNumber: String(value.ios?.buildNumber ?? "1"),
      marketingVersion: String(value.version ?? "1.0.0"),
    });
    return value;
  });
}

module.exports = withOneMoreIosWidget;
module.exports.__test = {
  APP_SOURCES,
  EXTENSION_RESOURCES,
  EXTENSION_SOURCES,
  TARGET,
  applyWidgetXcodeProject,
  findGroup,
  findTargetUuid,
  targetBuildConfigurations,
};
