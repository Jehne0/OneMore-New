import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function filesNamed(directory: string, fileName: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesNamed(entryPath, fileName);
    return entry.isFile() && entry.name === fileName ? [entryPath] : [];
  });
}

test("app.json, package metadata, Android, iOS, and widget extension use one release version", () => {
  const appConfig = JSON.parse(read("app.json")).expo as {
    version: string;
    android: { versionCode: number };
    ios: { buildNumber: string };
  };
  const appVersion = appConfig.version;
  const packageVersion = JSON.parse(read("package.json")).version as string;
  const packageLock = JSON.parse(read("package-lock.json"));
  assert.equal(packageVersion, appVersion, "package.json must match the public Expo version");
  assert.equal(packageLock.version, appVersion, "package-lock.json must match the public Expo version");
  assert.equal(packageLock.packages?.[""]?.version, appVersion, "the root lockfile package must match app.json");

  const androidGradlePath = path.join(root, "android", "app", "build.gradle");
  if (fs.existsSync(androidGradlePath)) {
    const androidGradle = fs.readFileSync(androidGradlePath, "utf8");
    const androidVersion = androidGradle.match(/^\s*versionName\s+["']([^"']+)["']/m)?.[1];
    const androidVersionCode = Number(androidGradle.match(/^\s*versionCode\s+(\d+)/m)?.[1]);
    assert.ok(androidVersion, "Android versionName must be a literal public version");
    assert.equal(androidVersion, appVersion, "Android versionName must match app.json");
    assert.equal(androidVersionCode, appConfig.android.versionCode, "Android native versionCode must match app.json");
  }

  const iosRoot = path.join(root, "ios");
  if (!fs.existsSync(iosRoot)) {
    const iosPlugin = read("plugins/withOneMoreIosWidget.js");
    assert.match(
      iosPlugin,
      /CFBundleShortVersionString<\/key><string>\$\(MARKETING_VERSION\)<\/string>/,
      "generated iOS Info.plist must resolve CFBundleShortVersionString through MARKETING_VERSION",
    );
    assert.match(
      iosPlugin,
      /marketingVersion:\s*String\(value\.version\s*\?\?\s*["']1\.0\.0["']\)/,
      "the iOS project plugin must derive MARKETING_VERSION from the Expo public version",
    );
    assert.match(
      iosPlugin,
      /buildNumber:\s*String\(value\.ios\?\.buildNumber\s*\?\?\s*["']1["']\)/,
      "the iOS project plugin must derive CURRENT_PROJECT_VERSION from the Expo iOS build number",
    );
    return;
  }

  const projects = filesNamed(iosRoot, "project.pbxproj");
  assert.ok(projects.length > 0, "a native iOS directory must contain project.pbxproj");
  const marketingVersions = projects.flatMap((project) =>
    [...fs.readFileSync(project, "utf8").matchAll(/MARKETING_VERSION\s*=\s*["']?([^;"']+)["']?;/g)]
      .map((match) => match[1].trim()),
  );
  assert.ok(marketingVersions.length > 0, "native iOS targets must define MARKETING_VERSION");
  for (const marketingVersion of marketingVersions) {
    assert.equal(marketingVersion, appVersion, "iOS MARKETING_VERSION must match app.json");
  }
  const buildNumbers = projects.flatMap((project) =>
    [...fs.readFileSync(project, "utf8").matchAll(/CURRENT_PROJECT_VERSION\s*=\s*["']?([^;"']+)["']?;/g)]
      .map((match) => match[1].trim()),
  );
  assert.ok(buildNumbers.length > 0, "native iOS targets must define CURRENT_PROJECT_VERSION");
  for (const buildNumber of buildNumbers) {
    assert.equal(buildNumber, appConfig.ios.buildNumber, "iOS build number must match app.json");
  }

  for (const plist of filesNamed(iosRoot, "Info.plist")) {
    const value = fs.readFileSync(plist, "utf8")
      .match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
    if (!value) continue;
    assert.ok(
      value === "$(MARKETING_VERSION)" || value === appVersion,
      `CFBundleShortVersionString in ${path.relative(root, plist)} must match app.json or use $(MARKETING_VERSION)`,
    );
  }
});
