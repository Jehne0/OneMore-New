import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { renderInitialWidget } from "../lib/widgetLifecycle";

test("custom entry registers Android widget before starting Expo Router", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const entry = await readFile("index.ts", "utf8");
  const layout = await readFile("app/_layout.tsx", "utf8");
  const androidRegistration = await readFile("widgets/register.android.ts", "utf8");
  const platformStub = await readFile("widgets/register.ts", "utf8");

  assert.equal(packageJson.main, "index.ts");
  assert.match(entry, /import "\.\/widgets\/register"/);
  assert.match(entry, /import "expo-router\/entry"/);
  assert.ok(entry.indexOf("./widgets/register") < entry.indexOf("expo-router/entry"));
  assert.doesNotMatch(layout, /widgets\/register/);
  assert.match(androidRegistration, /registerWidgetTaskHandler/);
  assert.match(androidRegistration, /registerWidgetConfigurationScreen/);
  assert.match(androidRegistration, /if \(!registrationState\[registrationKey\]\)/);
  assert.match(androidRegistration, /if \(!configurationState\[configurationKey\]\)/);
  assert.doesNotMatch(platformStub, /react-native-android-widget/);
});

test("WIDGET_ADDED renders fallback before missing cache fails", async () => {
  const rendered: string[] = [];
  await renderInitialWidget({
    renderWidget: (value) => rendered.push(value),
    fallback: "signed-out",
    load: async () => { throw new Error("missing cache"); },
  });
  assert.deepEqual(rendered, ["signed-out"]);
});

test("Auth or Premium initialization failure leaves fallback attached", async () => {
  const rendered: string[] = [];
  await renderInitialWidget({
    renderWidget: (value) => rendered.push(value),
    fallback: "loading-safe",
    load: async () => Promise.reject(new Error("initialization failed")),
  });
  assert.equal(rendered.at(0), "loading-safe");
  assert.equal(rendered.length, 1);
});

test("WIDGET_ADDED replaces fallback with cached representation", async () => {
  const rendered: string[] = [];
  await renderInitialWidget({
    renderWidget: (value) => rendered.push(value),
    fallback: "signed-out",
    load: async () => "cached-user-widget",
  });
  assert.deepEqual(rendered, ["signed-out", "cached-user-widget"]);
});

test("temporary startup auth null never signs out or clears the persisted widget session", async () => {
  const [layout, cloud] = await Promise.all([
    readFile("app/_layout.tsx", "utf8"),
    readFile("lib/cloudSync.ts", "utf8"),
  ]);
  assert.doesNotMatch(layout, /signOut\(auth\)/);
  assert.match(cloud, /if \(!user\) \{[\s\S]*_bootstrapPromise = Promise\.resolve\(\);[\s\S]*return;/);
  assert.doesNotMatch(cloud, /setWidgetActiveUid\(uid\)/);
});

test("only explicit logout and account deletion clear widget session", async () => {
  const [profile, cloud, session] = await Promise.all([
    readFile("app/(tabs)/profile.tsx", "utf8"),
    readFile("lib/cloudSync.ts", "utf8"),
    readFile("lib/widgetSession.ts", "utf8"),
  ]);
  assert.match(session, /clearWidgetSessionForExplicitSignOut/);
  assert.match(cloud, /clearSessionAfterExplicitLogout/);
  assert.ok(profile.match(/clearSessionAfterExplicitLogout\(\)/g)?.length === 2);
});

test("phone reboot preserves session and requests widget refresh from persisted data", async () => {
  const [manifest, provider, service] = await Promise.all([
    readFile("android/app/src/main/AndroidManifest.xml", "utf8"),
    readFile("android/app/src/main/java/com/anonymous/OneMore/widget/OneMore.java", "utf8"),
    readFile("widgets/widgetService.tsx", "utf8"),
  ]);
  assert.match(manifest, /android\.permission\.RECEIVE_BOOT_COMPLETED/);
  assert.match(manifest, /android\.intent\.action\.BOOT_COMPLETED/);
  assert.match(provider, /Intent\.ACTION_BOOT_COMPLETED/);
  assert.match(provider, /onUpdate\(context, manager, widgetIds\)/);
  assert.match(service, /const uid = cachedUid;/);
  assert.doesNotMatch(service, /cachedUid && auth\.currentUser/);
});

test("explicit midnight alarm, clock and timezone changes refresh widgets without opening the app", async () => {
  const [manifest, provider, plugin] = await Promise.all([
    readFile("android/app/src/main/AndroidManifest.xml", "utf8"),
    readFile("android/app/src/main/java/com/anonymous/OneMore/widget/OneMore.java", "utf8"),
    readFile("plugins/withOneMoreWidgetResize.js", "utf8"),
  ]);
  for (const action of ["TIME_SET", "TIMEZONE_CHANGED"]) {
    assert.match(manifest, new RegExp(`android\\.intent\\.action\\.${action}`));
    assert.match(plugin, new RegExp(`android\\.intent\\.action\\.${action}`));
  }
  assert.doesNotMatch(manifest, /DATE_CHANGED/);
  assert.doesNotMatch(plugin, /DATE_CHANGED/);
  for (const constant of ["ACTION_TIME_CHANGED", "ACTION_TIMEZONE_CHANGED"]) {
    assert.match(provider, new RegExp(`Intent\\.${constant}`));
  }
  assert.match(provider, /new Intent\(context, OneMore\.class\)\.setAction\(ACTION_MIDNIGHT_REFRESH\)/);
  assert.match(provider, /PendingIntent\.getBroadcast/);
  assert.match(provider, /AlarmManager\.RTC_WAKEUP/);
  assert.match(provider, /setAndAllowWhileIdle/);
  assert.doesNotMatch(provider, /setExact|setAlarmClock/);
  assert.match(provider, /new OneMore\(\)\.onUpdate\(context, manager, widgetIds\)/);
});

test("midnight alarm is one-shot, rescheduled for 00:01 and recalculated on every lifecycle trigger", async () => {
  const provider = await readFile("android/app/src/main/java/com/anonymous/OneMore/widget/OneMore.java", "utf8");
  assert.match(provider, /next\.add\(Calendar\.DAY_OF_YEAR, 1\)/);
  assert.match(provider, /next\.set\(Calendar\.HOUR_OF_DAY, 0\)/);
  assert.match(provider, /next\.set\(Calendar\.MINUTE, 1\)/);
  const alarmBranch = provider.slice(
    provider.indexOf("if (ACTION_MIDNIGHT_REFRESH.equals(action))"),
    provider.indexOf("super.onReceive(context, intent)"),
  );
  assert.ok(alarmBranch.indexOf("refreshAllWidgets(context)") < alarmBranch.indexOf("scheduleOrCancelMidnightRefresh(context)"));
  for (const callback of ["onEnabled", "onUpdate", "onDeleted"]) {
    const start = provider.indexOf(`void ${callback}`);
    assert.notEqual(start, -1);
    assert.match(provider.slice(start, start + 350), /scheduleOrCancelMidnightRefresh\(context\)/);
  }
  for (const signal of ["ACTION_BOOT_COMPLETED", "ACTION_MY_PACKAGE_REPLACED", "ACTION_TIME_CHANGED", "ACTION_TIMEZONE_CHANGED"]) {
    assert.match(provider, new RegExp(signal));
  }
});

test("all instances are refreshed and removing the final widget cancels its alarm", async () => {
  const provider = await readFile("android/app/src/main/java/com/anonymous/OneMore/widget/OneMore.java", "utf8");
  assert.match(provider, /getAppWidgetIds\(new ComponentName\(context, OneMore\.class\)\)/);
  assert.match(provider, /new OneMore\(\)\.onUpdate\(context, manager, widgetIds\)/);
  assert.match(provider, /if \(widgetIds\.length == 0\) \{\s*cancelMidnightRefresh\(context\)/);
  assert.match(provider, /void onDisabled[\s\S]*cancelMidnightRefresh\(context\)/);
  assert.match(provider, /alarms\.cancel\(pending\)/);
  assert.match(provider, /PendingIntent\.FLAG_NO_CREATE/);
  assert.doesNotMatch(provider, /SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM/);
});
