const { withPodfileProperties } = require("expo/config-plugins");

function withOneMoreIosReactNativeSource(config) {
  return withPodfileProperties(config, (mod) => {
    mod.modResults["ios.buildReactNativeFromSource"] = "true";
    return mod;
  });
}

module.exports = withOneMoreIosReactNativeSource;
