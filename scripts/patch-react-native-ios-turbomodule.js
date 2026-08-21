const fs = require("node:fs");
const path = require("node:path");

const targetPath = path.resolve(
  "node_modules/react-native/ReactCommon/react/nativemodule/core/platform/ios/ReactCommon/RCTTurboModule.mm",
);

const unsafeCatch = `    } @catch (NSException *exception) {
      throw convertNSExceptionToJSError(runtime, exception, std::string{moduleName}, methodNameStr);
    } @finally {
      [retainedObjectsForInvocation removeAllObjects];
    }`;

const safeCatch = `    } @catch (NSException *exception) {
      // Void methods are always async. Re-throw instead of touching the
      // non-thread-safe JSI runtime from the native method call queue.
      @throw exception;
    } @finally {
      [retainedObjectsForInvocation removeAllObjects];
    }`;

function patchTurboModuleSource(source) {
  if (source.includes(safeCatch)) return source;

  const occurrences = source.split(unsafeCatch).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Expected one unsafe async-void TurboModule exception handler, found ${occurrences}`,
    );
  }

  return source.replace(unsafeCatch, safeCatch);
}

function patchInstalledReactNative() {
  const source = fs.readFileSync(targetPath, "utf8");
  const patched = patchTurboModuleSource(source);
  if (patched === source) return false;
  fs.writeFileSync(targetPath, patched);
  return true;
}

if (require.main === module) {
  const changed = patchInstalledReactNative();
  console.log(
    changed
      ? "Patched React Native iOS async-void TurboModule exception handling"
      : "React Native iOS async-void TurboModule exception handling already patched",
  );
}

module.exports = { patchTurboModuleSource };
