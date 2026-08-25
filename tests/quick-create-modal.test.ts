import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const home = readFileSync(join(process.cwd(), "app/(tabs)/index.tsx"), "utf8");

function styleBody(name: string): string {
  const match = home.match(new RegExp(`${name}: \\{([\\s\\S]*?)\\},?\\r?\\n`));
  assert.ok(match, `${name} style must exist`);
  return match[1];
}

function quickCreateMarkup(): string {
  const start = home.indexOf("visible={addModalOpen}");
  const end = home.indexOf("visible={manageOpen}", start);
  assert.ok(start >= 0 && end > start, "quick-create modal markup must be isolated from manager");
  return home.slice(start, end);
}

test("quick-create sheet is intrinsically sized instead of inheriting the full-height manager layout", () => {
  const sheet = styleBody("quickCreateSheet");
  assert.match(sheet, /flexGrow: 0/);
  assert.match(sheet, /flexShrink: 1/);
  assert.doesNotMatch(sheet, /(?:^|\s)flex:\s*1/);
  assert.doesNotMatch(sheet, /height:\s*(?:"100%"|safeModal\.maxHeight)/);
  assert.doesNotMatch(sheet, /position:\s*"absolute"/);
  assert.match(quickCreateMarkup(), /style=\{styles\.quickCreateSheet\}/);
  assert.doesNotMatch(quickCreateMarkup(), /styles\.keyboardSheet/);
});

test("quick-create overlay anchors the compact card to the safe bottom edge", () => {
  const backdrop = styleBody("quickCreateBackdrop");
  assert.match(backdrop, /flex: 1/);
  assert.match(backdrop, /justifyContent: "flex-end"/);
  assert.match(backdrop, /paddingTop: safeModal\.paddingTop/);
  assert.match(backdrop, /paddingBottom: safeModal\.bottom/);
});

test("opening quick-create neither focuses the input nor performs an automatic scroll", () => {
  const markup = quickCreateMarkup();
  assert.match(markup, /autoFocus=\{false\}/);
  assert.doesNotMatch(markup, /onFocus=/);
  assert.doesNotMatch(markup, /scrollTo/);
  assert.doesNotMatch(home, /addScrollRef/);
  assert.match(home, /const openQuickCreate = useCallback\(\(\) => \{[\s\S]*?Keyboard\.dismiss\(\);[\s\S]*?setAddKeyboardVisible\(false\);[\s\S]*?setAddModalOpen\(true\)/);
});

test("quick-create persists a stable production challenge before registering it for notification editing", () => {
  const createStart = home.indexOf("const addChallengeFromHero");
  const createEnd = home.indexOf("const showManageDialog", createStart);
  const createFlow = home.slice(createStart, createEnd);
  assert.match(createFlow, /const newChallenge = createQuickChallenge\(trimmed, todayISO\)/);
  assert.match(createFlow, /await persist\([\s\S]*?challenges: \[newChallenge,/);
  assert.ok(createFlow.indexOf("await persist") < createFlow.indexOf("newlyCreatedChallengeIds.current.add"));
  assert.match(createFlow, /newlyCreatedChallengeIds\.current\.add\(newChallenge\.id\)/);
});

test("real keyboard show and hide events alone enable and reset quick-create avoidance", () => {
  const markup = quickCreateMarkup();
  assert.match(home, /Keyboard\.addListener\(showEvent, \(\) => setAddKeyboardVisible\(true\)\)/);
  assert.match(home, /Keyboard\.addListener\(hideEvent, \(\) => setAddKeyboardVisible\(false\)\)/);
  assert.match(markup, /enabled=\{addKeyboardVisible\}/);
  assert.match(markup, /addKeyboardVisible && styles\.quickCreateBackdropKeyboard/);
  assert.equal(styleBody("quickCreateBackdropKeyboard").includes("paddingBottom: 8"), true);
  assert.doesNotMatch(home.match(/Keyboard\.addListener\(hideEvent[\s\S]*?\}, \[addModalOpen\]\);/)?.[0] ?? "", /setAddModalText/);
});

test("keyboard-open quick-create remains compact, scrollable for large text and clear of the status bar", () => {
  const sheet = styleBody("quickCreateSheet");
  const scroll = styleBody("quickCreateScroll");
  assert.match(sheet, /maxHeight: safeModal\.maxHeight/);
  assert.match(sheet, /flexShrink: 1/);
  assert.match(scroll, /flexGrow: 0/);
  assert.match(scroll, /flexShrink: 1/);
  assert.match(quickCreateMarkup(), /automaticallyAdjustKeyboardInsets=\{false\}/);
  assert.match(styleBody("quickCreateBackdrop"), /paddingTop: safeModal\.paddingTop/);
});

test("the large challenge manager keeps its independent full-height scroll layout", () => {
  const managerStart = home.lastIndexOf("<Modal", home.indexOf("visible={manageOpen}"));
  const manager = home.slice(managerStart, home.indexOf("</Modal>", managerStart));
  assert.match(manager, /styles\.keyboardBackdrop/);
  assert.match(manager, /styles\.keyboardSheet/);
  assert.match(manager, /style=\{styles\.editorScroll\}/);
  assert.match(manager, /manageScrollRef\.current\?\.scrollTo/);
  assert.match(styleBody("keyboardSheet"), /flex: 1/);
  assert.match(styleBody("editorScroll"), /flex: 1/);
});
