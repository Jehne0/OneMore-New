const fs = require("node:fs");
const path = require("node:path");

const targetPath = path.resolve("node_modules/react-native/scripts/react-native-xcode.sh");

const bytecodeOnlyBranch = "if [[ $USE_HERMES == false ]]; then";
const sourceBundleBranch =
  "if [[ $USE_HERMES == false || $ONEMORE_IOS_HERMES_SOURCE_BUNDLE == 1 ]]; then";

function patchReactNativeXcodeScript(source) {
  if (source.includes(sourceBundleBranch)) return source;

  const occurrences = source.split(bytecodeOnlyBranch).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Expected one React Native iOS Hermes bytecode branch, found ${occurrences}`,
    );
  }

  return source.replace(bytecodeOnlyBranch, sourceBundleBranch);
}

function patchInstalledReactNativeXcodeScript() {
  const source = fs.readFileSync(targetPath, "utf8");
  const patched = patchReactNativeXcodeScript(source);
  if (patched === source) return false;
  fs.writeFileSync(targetPath, patched);
  return true;
}

if (require.main === module) {
  const changed = patchInstalledReactNativeXcodeScript();
  console.log(
    changed
      ? "Patched React Native iOS bundling to support the OneMore Hermes source bundle"
      : "React Native iOS Hermes source-bundle support already patched",
  );
}

module.exports = { patchReactNativeXcodeScript };
