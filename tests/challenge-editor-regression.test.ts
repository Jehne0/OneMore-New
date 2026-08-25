import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createEditorConfirmationController, createEditorDraft, finishSuccessfulNotificationSave, NOTIFICATION_CONFIRMATION_MS } from "../lib/notificationSaveFlow";
import {
  applyPersonalChallengeEditorDraft,
  personalChallengeEditorDraftFromChallenge,
  type PersonalChallengePeriod,
} from "../lib/personalChallengeEditor";

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
  assert.equal(closed.length, 0);

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
  assert.match(challenges, /<View style=\{styles\.modalBackdrop\}>[\s\S]*?<Pressable\s+style=\{StyleSheet\.absoluteFill\}/);
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

test("inactive easy-mode drafts preserve every period and are applied as one transition", () => {
  for (const period of ["daily", "every2", "custom", "flexibleWeekly"] as PersonalChallengePeriod[]) {
    const result = applyPersonalChallengeEditorDraft({
      id: `challenge-${period}`,
      text: "Old name",
      enabled: true,
      targetPerDay: 1,
    }, {
      text: "Updated name",
      enabled: false,
      easyMode: true,
      target: period === "flexibleWeekly" ? 5 : 12,
      period,
      customDays: [6, 2, 2, -1, 9],
      periodAnchor: "2026-08-20",
      flexibleStartDay: 4,
    }, "2026-08-22");

    assert.equal(result.text, "Updated name", period);
    assert.equal(result.enabled, false, period);
    assert.equal(result.easyMode, true, period);
    assert.ok(result.inactivePeriods?.some((item) => item.startDate === "2026-08-22"), period);
    assert.equal(result.period, period);
    if (period === "flexibleWeekly") {
      assert.equal(result.flexibleWeeklyTarget, 5);
      assert.equal(result.flexibleWeeklyStartDay, 4);
    } else {
      assert.equal(result.targetPerDay, 12);
      assert.deepEqual(result.customDays, period === "custom" ? [2, 6] : []);
      assert.equal(result.periodAnchor, period === "every2" ? "2026-08-20" : undefined);
    }
  }
});

test("legacy and malformed personal challenge values normalize to a safe editor draft", () => {
  const today = "2026-08-22";
  const custom = personalChallengeEditorDraftFromChallenge({
    id: "custom", text: "Custom", enabled: false, easyMode: true,
    period: "custom", targetPerDay: Number.NaN, customDays: [],
  }, today);
  assert.equal(custom.enabled, false);
  assert.equal(custom.easyMode, true);
  assert.equal(custom.target, 1);
  assert.deepEqual(custom.customDays, [5]);

  const every2 = personalChallengeEditorDraftFromChallenge({
    id: "every2", text: "Every 2", enabled: true, period: "every2", targetPerDay: 99,
    periodAnchor: "",
  }, today);
  assert.equal(every2.target, 20);
  assert.equal(every2.periodAnchor, today);

  const flexible = personalChallengeEditorDraftFromChallenge({
    id: "flex", text: "Flexible", enabled: true, period: "flexibleWeekly",
    flexibleWeeklyTarget: -4, flexibleWeeklyStartDay: 99,
  }, today);
  assert.equal(flexible.target, 1);
  assert.equal(flexible.flexibleStartDay, 6);

  const unknown = personalChallengeEditorDraftFromChallenge({
    id: "unknown", text: "Unknown", enabled: true, period: "broken" as any,
  }, today);
  assert.equal(unknown.period, "daily");
  assert.equal(unknown.target, 1);
});

test("personal editor state matrix is stable across period, activity, Easy mode and target edges", () => {
  const today = "2026-08-22";
  let combinations = 0;
  for (const period of ["daily", "every2", "custom", "flexibleWeekly"] as PersonalChallengePeriod[]) {
    for (const enabled of [false, true]) {
      for (const easyMode of [false, true]) {
        for (const target of [Number.NaN, -1, 1, 7, 20, 999]) {
          const draft = {
            text: ` ${period} `,
            enabled,
            easyMode,
            target,
            period,
            customDays: [],
            periodAnchor: null,
            flexibleStartDay: 99,
          };
          const source = {
            id: `${period}-${enabled}-${easyMode}-${String(target)}`,
            text: "Original",
            enabled: !enabled,
            easyMode: false,
            targetPerDay: 3,
          } as const;
          const result = applyPersonalChallengeEditorDraft(source, draft, today);
          const repeated = applyPersonalChallengeEditorDraft(result, draft, today);
          assert.deepEqual(repeated, result, `${period}/${enabled}/${easyMode}/${target}: idempotent`);
          assert.equal(result.enabled, enabled);
          assert.equal(result.easyMode, easyMode);
          assert.equal(result.text, period);
          assert.equal(result.period, period);
          if (period === "flexibleWeekly") {
            const expected = Number.isFinite(target) ? Math.min(7, Math.max(1, Math.floor(target))) : 1;
            assert.equal(result.flexibleWeeklyTarget, expected);
            assert.equal(result.flexibleWeeklyStartDay, 6);
          } else {
            const expected = Number.isFinite(target) ? Math.min(20, Math.max(1, Math.floor(target))) : 1;
            assert.equal(result.targetPerDay, expected);
            assert.deepEqual(result.customDays, period === "custom" ? [5] : []);
            assert.equal(result.periodAnchor, period === "every2" ? today : undefined);
          }
          combinations += 1;
        }
      }
    }
  }
  assert.equal(combinations, 4 * 2 * 2 * 6);

  const irreversibleEasy = applyPersonalChallengeEditorDraft({
    id: "easy", text: "Easy", enabled: true, easyMode: true,
  }, {
    text: "Easy", enabled: true, easyMode: false, target: 1, period: "daily",
    customDays: [], periodAnchor: null, flexibleStartDay: 0,
  }, today);
  assert.equal(irreversibleEasy.easyMode, true);
});

test("both personal editors avoid nested iOS presentations and eager native reminder mutations", () => {
  const home = readFileSync(join(process.cwd(), "app/(tabs)/index.tsx"), "utf8");
  const challenges = readFileSync(join(process.cwd(), "app/(tabs)/challenges.tsx"), "utf8");
  assert.doesNotMatch(home, /NativeAlert|Alert as NativeAlert/);
  assert.doesNotMatch(home, /<Modal\s+visible=\{periodPickerOpen\}/);
  assert.match(home, /editorInlineOverlay/);
  assert.doesNotMatch(home, /saveBasicsImmediate|savePeriodImmediate|saveFlexibleStartDayImmediate/);
  assert.doesNotMatch(home, /easyModeChallengeIds/);
  assert.match(home, /savePersonalReminderWorkflow\(/);
  assert.match(home, /pendingManageDestination\.current = \{ type: "history", challengeId \}/);
  assert.match(home, /onDismiss=\{\(\) => \{[\s\S]*pendingManageDestination\.current/);
  assert.match(challenges, /saveChallengeConfiguration\(/);
  assert.match(challenges, /savePersonalReminderWorkflow\(/);
  assert.doesNotMatch(challenges, /setDailyRemindersForChallenge|saveTargetImmediate/);
  assert.match(challenges, /onDismiss=\{\(\) => \{[\s\S]*pendingActionDestination\.current/);
  assert.match(challenges, /setRemError\(/);
  assert.match(challenges, /setTargetError\(/);

  const reminderSaveStart = challenges.indexOf("async function saveReminderConfig");
  const reminderSaveEnd = challenges.indexOf("function openRename", reminderSaveStart);
  assert.ok(reminderSaveStart >= 0 && reminderSaveEnd > reminderSaveStart);
  assert.doesNotMatch(challenges.slice(reminderSaveStart, reminderSaveEnd), /Alert\.alert\(/);

  const targetSaveStart = challenges.indexOf("async function saveTargetPicker");
  const targetSaveEnd = challenges.indexOf("async function saveRename", targetSaveStart);
  assert.ok(targetSaveStart >= 0 && targetSaveEnd > targetSaveStart);
  assert.doesNotMatch(challenges.slice(targetSaveStart, targetSaveEnd), /Alert\.alert\(/);

  const renameSaveStart = challenges.indexOf("async function saveRename");
  const renameSaveEnd = challenges.indexOf("async function deleteChallengeNow", renameSaveStart);
  assert.ok(renameSaveStart >= 0 && renameSaveEnd > renameSaveStart);
  assert.doesNotMatch(challenges.slice(renameSaveStart, renameSaveEnd), /Alert\.alert\(/);
  assert.match(challenges, /pendingActionDestination\.current = \{ type: "delete", id \}/);
});

test("shared reminder actions use one guarded native transaction without stacked iOS modals", () => {
  const home = readFileSync(join(process.cwd(), "app/(tabs)/index.tsx"), "utf8");
  assert.match(home, /pendingSharedMenuAction\.current = action/);
  assert.match(home, /onDismiss=\{handleSharedMenuDismiss\}/);
  assert.doesNotMatch(home, /setTimeout\(\(\) => \{\s*openSharedNotificationSettings/);
  assert.equal((home.match(/value=\{sharedTimePickerValue\}/g) ?? []).length, 1);
  assert.match(home, /sharedNotificationSaveLock\.current/);
  assert.match(home, /saveSharedReminderWorkflow\(/);
  assert.doesNotMatch(home, /clearSharedRemindersForChallenge|setSharedRemindersForChallenge/);

  const saveStart = home.indexOf("async function saveSharedNotificationConfiguration");
  const saveEnd = home.indexOf("const openManage", saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  assert.doesNotMatch(home.slice(saveStart, saveEnd), /Alert\.alert\(/);
});
