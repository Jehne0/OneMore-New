const fs = require("node:fs");
const path = require("node:path");

// React Native 0.81.5 needs targeted iOS JSC backports derived from these commits:
// - 176bed79: compile React Native without Hermes or the built-in JSC when a
//   third-party JSC runtime factory is supplied by the application
// - 1033dbd1: break the React-jsc -> React-cxxreact -> React-utils -> React-jsc cycle
// - 2d814379: exclude Hermes and make the default runtime factory compile with JSC
// React-RCTAppDelegate also needs a separator between its new-architecture and
// JS-engine compiler flags so USE_THIRD_PARTY_JSC is actually defined by Clang.
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
    name: "AppDelegate JSC compiler flag separator",
    relativePath: "Libraries/AppDelegate/React-RCTAppDelegate.podspec",
    before:
      'other_cflags = "$(inherited) " + new_arch_enabled_flag + js_engine_flags()',
    after:
      'other_cflags = "$(inherited) " + new_arch_enabled_flag + " " + js_engine_flags()',
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
    name: "third-party JSC legacy bridge Hermes import guard",
    relativePath: "React/CxxBridge/RCTCxxBridge.mm",
    before: `#if !defined(USE_HERMES) || USE_HERMES == 1
#import <reacthermes/HermesExecutorFactory.h>
#endif`,
    after: `#if USE_THIRD_PARTY_JSC != 1
#import <reacthermes/HermesExecutorFactory.h>
#endif`,
  },
  {
    name: "third-party JSC legacy bridge factory guard",
    relativePath: "React/CxxBridge/RCTCxxBridge.mm",
    before: `#if !defined(USE_HERMES) || USE_HERMES == 1
      executorFactory = std::make_shared<HermesExecutorFactory>(installBindings);
#endif`,
    after: `#if USE_THIRD_PARTY_JSC != 1
      executorFactory = std::make_shared<HermesExecutorFactory>(installBindings);
#else
      throw std::runtime_error("No JSExecutorFactory specified.");
#endif`,
  },
  {
    name: "third-party JSC app setup factory fallbacks",
    relativePath: "Libraries/AppDelegate/RCTAppSetupUtils.mm",
    before: `std::unique_ptr<facebook::react::JSExecutorFactory> RCTAppSetupDefaultJsExecutorFactory(
    RCTBridge *bridge,
    RCTTurboModuleManager *turboModuleManager,
    const std::shared_ptr<facebook::react::RuntimeScheduler> &runtimeScheduler)
{
  // Necessary to allow NativeModules to lookup TurboModules
  [bridge setRCTTurboModuleRegistry:turboModuleManager];

#if RCT_DEV
  /**
   * Instantiating DevMenu has the side-effect of registering
   * shortcuts for CMD + d, CMD + i,  and CMD + n via RCTDevMenu.
   * Therefore, when TurboModules are enabled, we must manually create this
   * NativeModule.
   */
  [turboModuleManager moduleForName:"RCTDevMenu"];
#endif // end RCT_DEV

  auto runtimeInstallerLambda = [turboModuleManager, bridge, runtimeScheduler](facebook::jsi::Runtime &runtime) {
    if (!bridge || !turboModuleManager) {
      return;
    }
    if (runtimeScheduler) {
      facebook::react::RuntimeSchedulerBinding::createAndInstallIfNeeded(runtime, runtimeScheduler);
    }
    [turboModuleManager installJSBindings:runtime];
  };
#if USE_THIRD_PARTY_JSC != 1
  return std::make_unique<facebook::react::HermesExecutorFactory>(
      facebook::react::RCTJSIExecutorRuntimeInstaller(runtimeInstallerLambda));
#endif
}

std::unique_ptr<facebook::react::JSExecutorFactory> RCTAppSetupJsExecutorFactoryForOldArch(
    RCTBridge *bridge,
    const std::shared_ptr<facebook::react::RuntimeScheduler> &runtimeScheduler)
{
  auto runtimeInstallerLambda = [bridge, runtimeScheduler](facebook::jsi::Runtime &runtime) {
    if (!bridge) {
      return;
    }
    if (runtimeScheduler) {
      facebook::react::RuntimeSchedulerBinding::createAndInstallIfNeeded(runtime, runtimeScheduler);
    }
  };
#if USE_THIRD_PARTY_JSC != 1
  return std::make_unique<facebook::react::HermesExecutorFactory>(
      facebook::react::RCTJSIExecutorRuntimeInstaller(runtimeInstallerLambda));
#endif
}`,
    after: `std::unique_ptr<facebook::react::JSExecutorFactory> RCTAppSetupDefaultJsExecutorFactory(
    RCTBridge *bridge,
    RCTTurboModuleManager *turboModuleManager,
    const std::shared_ptr<facebook::react::RuntimeScheduler> &runtimeScheduler)
{
  // Necessary to allow NativeModules to lookup TurboModules
  [bridge setRCTTurboModuleRegistry:turboModuleManager];

#if RCT_DEV
  /**
   * Instantiating DevMenu has the side-effect of registering
   * shortcuts for CMD + d, CMD + i,  and CMD + n via RCTDevMenu.
   * Therefore, when TurboModules are enabled, we must manually create this
   * NativeModule.
   */
  [turboModuleManager moduleForName:"RCTDevMenu"];
#endif // end RCT_DEV

  auto runtimeInstallerLambda = [turboModuleManager, bridge, runtimeScheduler](facebook::jsi::Runtime &runtime) {
    if (!bridge || !turboModuleManager) {
      return;
    }
    if (runtimeScheduler) {
      facebook::react::RuntimeSchedulerBinding::createAndInstallIfNeeded(runtime, runtimeScheduler);
    }
    [turboModuleManager installJSBindings:runtime];
  };
#if USE_THIRD_PARTY_JSC != 1
  return std::make_unique<facebook::react::HermesExecutorFactory>(
      facebook::react::RCTJSIExecutorRuntimeInstaller(runtimeInstallerLambda));
#else
  throw std::runtime_error("No JSExecutorFactory specified.");
  return nullptr;
#endif
}

std::unique_ptr<facebook::react::JSExecutorFactory> RCTAppSetupJsExecutorFactoryForOldArch(
    RCTBridge *bridge,
    const std::shared_ptr<facebook::react::RuntimeScheduler> &runtimeScheduler)
{
  auto runtimeInstallerLambda = [bridge, runtimeScheduler](facebook::jsi::Runtime &runtime) {
    if (!bridge) {
      return;
    }
    if (runtimeScheduler) {
      facebook::react::RuntimeSchedulerBinding::createAndInstallIfNeeded(runtime, runtimeScheduler);
    }
  };
#if USE_THIRD_PARTY_JSC != 1
  return std::make_unique<facebook::react::HermesExecutorFactory>(
      facebook::react::RCTJSIExecutorRuntimeInstaller(runtimeInstallerLambda));
#else
  throw std::runtime_error("No JSExecutorFactory specified.");
  return nullptr;
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
