import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

function attr(xml: string, name: string) {
  return xml.match(new RegExp(`android:${name}="([^"]+)"`))?.[1] ?? null;
}

test("native provider metadata permits a one-row widget and vertical resize", async () => {
  const xml = await readFile("android/app/src/main/res/xml/widgetprovider_onemore.xml", "utf8");
  assert.equal(attr(xml, "minHeight"), "56dp");
  assert.equal(attr(xml, "minResizeHeight"), "56dp");
  assert.equal(attr(xml, "targetCellHeight"), "1");
  assert.equal(attr(xml, "resizeMode"), "horizontal|vertical");
});

test("Expo source configuration regenerates the same one-cell target", async () => {
  const app = JSON.parse(await readFile("app.json", "utf8"));
  const plugin = app.expo.plugins.find((entry: unknown) => Array.isArray(entry) && entry[0] === "react-native-android-widget");
  const widget = plugin[1].widgets[0];
  assert.equal(widget.minHeight, "56dp");
  assert.equal(widget.targetCellHeight, 1);
  assert.ok(app.expo.plugins.includes("./plugins/withOneMoreWidgetResize"));
});
