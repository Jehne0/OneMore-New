const { getDefaultConfig } = require("@expo/metro-config");

// Fixes Firebase/Metro resolution issues on RN/Expo when dependencies ship .cjs files.
// Without this, some setups can crash with: "Component auth has not been registered yet".
const config = getDefaultConfig(__dirname);

config.resolver.sourceExts = Array.from(
  new Set([...(config.resolver.sourceExts || []), "cjs"])
);

// ✅ Expo SDK 53+ / Metro: disable "package exports" resolution.
// Firebase (and some other libs) rely on deep imports (e.g. firebase/auth/dist/rn)
// which Metro can block when package exports are enabled.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
