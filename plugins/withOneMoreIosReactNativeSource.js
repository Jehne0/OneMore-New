const { withPodfileProperties, withXcodeProject } = require("expo/config-plugins");

const SOURCE_BUNDLE_BUILD_SETTING = "ONEMORE_IOS_HERMES_SOURCE_BUNDLE";

function enableHermesSourceBundle(project) {
  const mainTarget = project.getFirstTarget();
  const target = project.pbxNativeTargetSection()[mainTarget.uuid];
  const configurationList = project.hash.project.objects.XCConfigurationList?.[
    target?.buildConfigurationList
  ];
  const configurations = project.pbxXCBuildConfigurationSection();

  if (!configurationList || !Array.isArray(configurationList.buildConfigurations)) {
    throw new Error("Unable to find the main iOS target build configurations");
  }

  for (const { value } of configurationList.buildConfigurations) {
    const configuration = configurations[value];
    if (!configuration?.buildSettings) {
      throw new Error(`Unable to find the iOS build settings for ${value}`);
    }
    // Hermes can evaluate UTF-8 source directly. Keeping the Hermes runtime
    // while skipping release HBC avoids the iOS 26 physical-device crash and
    // remains compatible with Reanimated/Worklets.
    configuration.buildSettings[SOURCE_BUNDLE_BUILD_SETTING] = "1";
  }
}

function withOneMoreIosReactNativeSource(config) {
  config = withPodfileProperties(config, (mod) => {
    mod.modResults["ios.buildReactNativeFromSource"] = "true";
    return mod;
  });

  return withXcodeProject(config, (mod) => {
    enableHermesSourceBundle(mod.modResults);
    return mod;
  });
}

module.exports = withOneMoreIosReactNativeSource;
module.exports.__test = { enableHermesSourceBundle, SOURCE_BUNDLE_BUILD_SETTING };
