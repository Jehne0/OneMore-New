const fs = require("node:fs");
const path = require("node:path");

// Expo Modules Core 3.0.30 selects React-jsc in its podspec when Hermes is
// disabled, but EXJavaScriptRuntime.mm still imports the Hermes runtime header
// unconditionally. Keep the existing engine detection and import the matching
// runtime declaration so the JSC-only pod graph can compile.
const expectedExpoModulesCoreVersion = "3.0.30";
const expoModulesCoreRoot = path.resolve("node_modules/expo-modules-core");
const targetPath = path.join(
  expoModulesCoreRoot,
  "ios/JSI/EXJavaScriptRuntime.mm",
);

const hermesOnlyImports = `#import <jsi/jsi.h>
#import <hermes/hermes.h>`;

const engineSpecificImports = `#import <jsi/jsi.h>
#if __has_include(<reacthermes/HermesExecutorFactory.h>)
#import <hermes/hermes.h>
#else
#import <ReactJSC/JSCRuntime.h>
#endif`;

function patchExpoModulesCoreSource(source) {
  if (source.includes(engineSpecificImports)) return source;

  const occurrences = source.split(hermesOnlyImports).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Expected one unconditional Expo Modules Core Hermes import, found ${occurrences}`,
    );
  }

  return source.replace(hermesOnlyImports, engineSpecificImports);
}

function patchInstalledExpoModulesCore() {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(expoModulesCoreRoot, "package.json"), "utf8"),
  );
  if (packageJson.version !== expectedExpoModulesCoreVersion) {
    throw new Error(
      `The iOS JSC import patch requires Expo Modules Core ${expectedExpoModulesCoreVersion}; found ${packageJson.version}`,
    );
  }

  const source = fs.readFileSync(targetPath, "utf8");
  const patched = patchExpoModulesCoreSource(source);
  if (patched === source) return false;
  fs.writeFileSync(targetPath, patched);
  return true;
}

if (require.main === module) {
  const changed = patchInstalledExpoModulesCore();
  console.log(
    changed
      ? "Patched Expo Modules Core for an iOS community JSC build"
      : "Expo Modules Core iOS community JSC import is already patched",
  );
}

module.exports = {
  engineSpecificImports,
  patchExpoModulesCoreSource,
};
