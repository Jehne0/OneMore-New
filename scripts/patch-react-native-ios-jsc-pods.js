const fs = require("node:fs");
const path = require("node:path");

const targetPath = path.resolve("node_modules/react-native/scripts/react_native_pods.rb");
const forcedHermes = "  hermes_enabled= true";
const communityEngineSelection = "  hermes_enabled= !use_third_party_jsc()";

function patchReactNativePods(source) {
  if (source.includes(communityEngineSelection)) return source;

  const occurrences = source.split(forcedHermes).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Expected one forced Hermes CocoaPods assignment, found ${occurrences}`,
    );
  }

  return source.replace(forcedHermes, communityEngineSelection);
}

function patchInstalledReactNativePods() {
  const source = fs.readFileSync(targetPath, "utf8");
  const patched = patchReactNativePods(source);
  if (patched === source) return false;
  fs.writeFileSync(targetPath, patched);
  return true;
}

if (require.main === module) {
  const changed = patchInstalledReactNativePods();
  console.log(
    changed
      ? "Patched React Native iOS CocoaPods engine selection for community JSC"
      : "React Native iOS CocoaPods engine selection already supports community JSC",
  );
}

module.exports = { patchReactNativePods };
