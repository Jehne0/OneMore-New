const { getDefaultConfig } = require("expo/metro-config");

// Fixes Firebase/Metro resolution issues on RN/Expo when dependencies ship .cjs files.
const config = getDefaultConfig(__dirname);

config.resolver.sourceExts = Array.from(
  new Set([...(config.resolver.sourceExts || []), "cjs"])
);

// Expo SDK 53+ / Metro: disable package exports resolution.
// Firebase and some libraries can rely on deep imports that Metro may block.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;