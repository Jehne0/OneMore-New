import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createEditorConfirmationController, createEditorDraft, finishSuccessfulNotificationSave, NOTIFICATION_CONFIRMATION_MS } from "../lib/notificationSaveFlow";

test("successful notification save confirms briefly and then closes the editor", async () => {
  const events: string[] = [];
  await finishSuccessfulNotificationSave({
    message: "Notification saved.",
    showConfirmation: (message) => events.push(`show:${message}`),
    delay: async (milliseconds) => { events.push(`wait:${milliseconds}`); },
    closeEditor: () => events.push("close"),
  });
  assert.equal(NOTIFICATION_CONFIRMATION_MS, 900);
  assert.deepEqual(events, ["show:Notification saved.", "wait:900", "close"]);
});

test("a failed save never reaches confirmation or close", async () => {
  const events: string[] = [];
  await assert.rejects(async () => {
    await (async () => { throw new Error("save failed"); })();
    await finishSuccessfulNotificationSave({
      message: "Notification saved.", showConfirmation: () => events.push("show"),
      closeEditor: () => events.push("close"),
    });
  });
  assert.deepEqual(events, []);
});

test("save reads the latest editor draft synchronously even immediately after typing", () => {
  const draft = createEditorDraft("Old title");
  draft.set("Newest title typed just before save");
  assert.equal(draft.readTrimmed(), "Newest title typed just before save");
});

test("an old 900ms confirmation timer cannot close a newly opened editor", async () => {
  let nextTimer = 1;
  const timers = new Map<number, () => void>();
  const controller = createEditorConfirmationController({
    setTimer: (callback) => { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimer: (id) => { timers.delete(Number(id)); },
  });
  const closed: string[] = [];
  const firstSession = controller.beginSession();
  const first = controller.confirm({
    session: firstSession, message: "saved", showConfirmation: () => {}, closeEditor: () => closed.push("first"),
  });
  const secondSession = controller.beginSession();
  assert.equal(await first, false);
  for (const callback of [...timers.values()]) callback();
  assert.deepEqual(closed, []);

  const second = controller.confirm({
    session: secondSession, message: "saved", showConfirmation: () => {}, closeEditor: () => closed.push("second"),
  });
  for (const callback of [...timers.values()]) callback();
  assert.equal(await second, true);
  assert.deepEqual(closed, ["second"]);
});

test("unmount cancellation resolves confirmation without closing the editor", async () => {
  const timers = new Map<number, () => void>();
  const controller = createEditorConfirmationController({
    setTimer: (callback) => { timers.set(1, callback); return 1; },
    clearTimer: (id) => { timers.delete(Number(id)); },
  });
  const session = controller.beginSession();
  let closed = false;
  const confirmation = controller.confirm({
    session, message: "saved", showConfirmation: () => {}, closeEditor: () => { closed = true; },
  });
  controller.cancelSession();
  assert.equal(await confirmation, false);
  assert.equal(closed, false);
  assert.equal(timers.size, 0);
});

test("large title editors retain keyboard sizing, safe area and automatic scroll-to-title", () => {
  const home = readFileSync(join(process.cwd(), "app/(tabs)/index.tsx"), "utf8");
  const challenges = readFileSync(join(process.cwd(), "app/(tabs)/challenges.tsx"), "utf8");
  assert.match(home, /behavior="height"/);
  assert.match(home, /styles\.keyboardBackdrop/);
  assert.match(home, /paddingBottom: safeModal\.bottom/);
  assert.match(home, /manageScrollRef\.current\?\.scrollTo\(\{ y: 0/);
  assert.doesNotMatch(home, /addScrollRef/);
  assert.match(challenges, /behavior=\{Platform\.OS === "ios" \? "height" : undefined\}/);
});

test("notification save buttons are guarded against rapid double taps", () => {
  const home = readFileSync(join(process.cwd(), "app/(tabs)/index.tsx"), "utf8");
  const challenges = readFileSync(join(process.cwd(), "app/(tabs)/challenges.tsx"), "utf8");
  assert.match(home, /manageSaveLock\.current/);
  assert.match(challenges, /remSaveLock\.current/);
});

test("challenge creation is locked and visibly disabled while persistence is running", () => {
  const home = readFileSync(join(process.cwd(), "app/(tabs)/index.tsx"), "utf8");
  assert.match(home, /if \(addSaveLock\.current\) return/);
  assert.match(home, /disabled=\{!addModalText\.trim\(\) \|\| addSaving\}/);
});

test("today hook recalculates on foreground and polls for timezone changes", () => {
  const hook = readFileSync(join(process.cwd(), "lib/useTodayISO.ts"), "utf8");
  assert.match(hook, /AppState\.addEventListener\("change"/);
  assert.match(hook, /nextState === "active"/);
  assert.match(hook, /resolvedOptions\(\)\.timeZone/);
  assert.match(hook, /scheduleMidnight\(\)/);
});

test("Today list keeps native clipping and reminder editors reserve safe bottom space", () => {
  const home = readFileSync(join(process.cwd(), "app/(tabs)/index.tsx"), "utf8");
  const challenges = readFileSync(join(process.cwd(), "app/(tabs)/challenges.tsx"), "utf8");
  assert.doesNotMatch(home, /removeClippedSubviews=\{false\}/);
  assert.doesNotMatch(challenges, /const streakById = useMemo/);
  assert.match(home, /contentContainerStyle=\{\{ flexGrow: 1, paddingBottom: Math\.max\(32, insets\.bottom \+ 20\) \}\}/);
  assert.match(challenges, /contentContainerStyle=\{\{ flexGrow: 1, paddingBottom: Math\.max\(32, insets\.bottom \+ 20\) \}\}/);
  assert.match(home, /manageScrollRef\.current\?\.scrollToEnd/);
  assert.match(challenges, /reminderScrollRef\.current\?\.scrollToEnd/);
});

test("personal editors expose one continuous scroll viewport without nested backdrop Pressables", () => {
  const home = readFileSync(join(process.cwd(), "app/(tabs)/index.tsx"), "utf8");
  const challenges = readFileSync(join(process.cwd(), "app/(tabs)/challenges.tsx"), "utf8");
  assert.match(home, /editorScroll: \{ flex: 1, minHeight: 0 \}/);
  assert.match(home, /<View style=\{styles\.keyboardBackdrop\}>[\s\S]*?<Pressable style=\{StyleSheet\.absoluteFill\}/);
  assert.doesNotMatch(home, /<Pressable style=\{styles\.keyboardBackdrop\} onPress=\{manageSaving/);
  assert.match(challenges, /modalScroll: \{ flex: 1, minHeight: 0 \}/);
  assert.match(challenges, /<View style=\{styles\.modalBackdrop\}>[\s\S]*?<Pressable style=\{StyleSheet\.absoluteFill\}/);
  assert.doesNotMatch(challenges, /<Pressable style=\{styles\.modalBackdrop\} onPress=\{\(\) => setReminderOpen/);
  assert.match(home, /keyboardDismissMode="on-drag"/);
  assert.match(challenges, /keyboardDismissMode="on-drag"/);
});

test("notification save actions live in fixed editor footers", () => {
  const home = readFileSync(join(process.cwd(), "app/(tabs)/index.tsx"), "utf8");
  const challenges = readFileSync(join(process.cwd(), "app/(tabs)/challenges.tsx"), "utf8");
  assert.match(home, /<\/ScrollView>\s*<View style=\{styles\.editorFooter\}>/);
  assert.match(challenges, /<\/ScrollView>\s*<View style=\{\[styles\.modalBtns, styles\.modalFooter\]\}>/);
});
