const fs = require("node:fs");
const path = require("node:path");

// React Native 0.81.5 predates the upstream JSC fixes in these commits:
// - 1033dbd1: break the React-jsc -> React-cxxreact -> React-utils -> React-jsc cycle
// - 2d814379: exclude Hermes and make the default runtime factory compile with JSC
const expectedReactNativeVersion = "0.81.5";
const reactNativeRoot = path.resolve("node_modules/react-native");
const reactUtilsDependency =
  '  add_dependency(s, "React-utils", :additional_framework_paths => ["react/utils/platform/ios"])';

const backportDefinitions = [
  {
    name: "community JSC engine selection",
    relativePath: "scripts/react_native_pods.rb",
    before: "  hermes_enabled= true",
    after: "  hermes_enabled= !use_third_party_jsc()",
  },
  {
    name: "third-party JSC runtime factory fallback",
    relativePath: "Libraries/AppDelegate/RCTDefaultReactNativeFactoryDelegate.mm",
    before: `- (JSRuntimeFactoryRef)createJSRuntimeFactory
{
#if USE_THIRD_PARTY_JSC != 1
  return jsrt_create_hermes_factory();
#endif
}`,
    after: `- (JSRuntimeFactoryRef)createJSRuntimeFactory
{
#if USE_THIRD_PARTY_JSC != 1
  return jsrt_create_hermes_factory();
#else
  [NSException raise:@"JSRuntimeFactory"
              format:@"createJSRuntimeFactory must be overridden when using third-party JSC"];
  return nil;
#endif
}`,
  },
  {
    name: "CoreModules React-utils dependency",
    relativePath: "React/CoreModules/React-CoreModules.podspec",
    before: `  add_dependency(s, "React-NativeModulesApple")

  add_rn_third_party_dependencies(s)`,
    after: `  add_dependency(s, "React-NativeModulesApple")
${reactUtilsDependency}

  add_rn_third_party_dependencies(s)`,
  },
  {
    name: "RCTRuntime React-utils dependency",
    relativePath: "React/Runtime/React-RCTRuntime.podspec",
    before: `  add_dependency(s, "React-RuntimeApple")

  if use_third_party_jsc()`,
    after: `  add_dependency(s, "React-RuntimeApple")
${reactUtilsDependency}

  if use_third_party_jsc()`,
  },
  {
    name: "cxxreact React-utils dependency",
    relativePath: "ReactCommon/cxxreact/React-cxxreact.podspec",
    before: `  s.dependency "React-timing", version

  s.resource_bundles`,
    after: `  s.dependency "React-timing", version
${reactUtilsDependency}

  s.resource_bundles`,
  },
  {
    name: "JSI executor React-utils dependency",
    relativePath: "ReactCommon/jsiexecutor/React-jsiexecutor.podspec",
    before: `  add_dependency(s, "React-jsinspectortracing", :framework_name => 'jsinspector_moderntracing')
  if use_hermes()`,
    after: `  add_dependency(s, "React-jsinspectortracing", :framework_name => 'jsinspector_moderntracing')
${reactUtilsDependency}
  if use_hermes()`,
  },
  {
    name: "JSI tracing Hermes-only dependency",
    relativePath:
      "ReactCommon/jsinspector-modern/tracing/React-jsinspectortracing.podspec",
    before: `  s.dependency "React-timing"

  add_rn_third_party_dependencies(s)`,
    after: `  s.dependency "React-timing"

  if use_hermes()
    s.dependency "hermes-engine"
  end

  add_rn_third_party_dependencies(s)`,
  },
  {
    name: "JSI tooling React-utils dependency",
    relativePath: "ReactCommon/jsitooling/React-jsitooling.podspec",
    before: `  add_dependency(s, "React-jsinspectortracing", :framework_name => 'jsinspector_moderntracing')

  add_rn_third_party_dependencies(s)`,
    after: `  add_dependency(s, "React-jsinspectortracing", :framework_name => 'jsinspector_moderntracing')
${reactUtilsDependency}

  add_rn_third_party_dependencies(s)`,
  },
  {
    name: "React-utils engine-cycle removal",
    relativePath: "ReactCommon/react/utils/React-utils.podspec",
    before: `  s.dependency "React-jsi", version

  depend_on_js_engine(s)
  add_rn_third_party_dependencies(s)`,
    after: `  s.dependency "React-jsi", version

  if use_hermes()
    s.dependency "hermes-engine"
  end
  add_rn_third_party_dependencies(s)`,
  },
];

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function applyBackport(source, definition) {
  const appliedOccurrences = countOccurrences(source, definition.after);
  if (appliedOccurrences === 1) return source;
  if (appliedOccurrences > 1) {
    throw new Error(
      `${definition.name}: expected at most one applied backport, found ${appliedOccurrences}`,
    );
  }

  const originalOccurrences = countOccurrences(source, definition.before);
  if (originalOccurrences !== 1) {
    throw new Error(
      `${definition.name}: expected one React Native 0.81.5 source block, found ${originalOccurrences}`,
    );
  }

  return source.replace(definition.before, definition.after);
}

function getBackport(name) {
  const definition = backportDefinitions.find((candidate) => candidate.name === name);
  if (!definition) throw new Error(`Unknown React Native JSC backport: ${name}`);
  return definition;
}

function patchReactNativePods(source) {
  return applyBackport(source, getBackport("community JSC engine selection"));
}

function patchInstalledReactNative() {
  const packageJsonPath = path.join(reactNativeRoot, "package.json");
  const installedVersion = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).version;
  if (installedVersion !== expectedReactNativeVersion) {
    throw new Error(
      `The iOS JSC backports require React Native ${expectedReactNativeVersion}; found ${installedVersion}`,
    );
  }

  const changedPaths = [];
  for (const definition of backportDefinitions) {
    const targetPath = path.join(reactNativeRoot, definition.relativePath);
    const source = fs.readFileSync(targetPath, "utf8");
    const patched = applyBackport(source, definition);
    if (patched === source) continue;
    fs.writeFileSync(targetPath, patched);
    changedPaths.push(definition.relativePath);
  }
  return changedPaths;
}

if (require.main === module) {
  const changedPaths = patchInstalledReactNative();
  console.log(
    changedPaths.length > 0
      ? `Applied React Native iOS community JSC backports to ${changedPaths.length} files`
      : "React Native iOS community JSC backports are already applied",
  );
}

module.exports = {
  applyBackport,
  backportDefinitions,
  patchInstalledReactNative,
  patchReactNativePods,
};
