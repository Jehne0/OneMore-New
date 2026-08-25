import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSharedNotificationSetting } from "../lib/sharedNotificationSettings";
import { saveSharedReminderWorkflow, type SharedReminderWorkflowRuntime } from "../lib/sharedReminders";

test("malformed shared notification settings normalize without large renders", () => {
  assert.deepEqual(normalizeSharedNotificationSetting({
    enabled: "yes",
    count: 100_000,
    times: ["08:00", "08:00", "25:99", null, "09:30"],
    friendCompletedSharedChallenge: 0,
  }), {
    enabled: false,
    count: 10,
    times: ["08:00", "09:30"],
    friendCompletedSharedChallenge: true,
  });
});

test("shared reminder workflow performs one native mutation and restores settings on failure", async () => {
  const events: string[] = [];
  const previous = normalizeSharedNotificationSetting({ enabled: false, count: 1, times: [] });
  const runtime: SharedReminderWorkflowRuntime = {
    loadSetting: async () => previous,
    persistSetting: async (_id, setting) => { events.push(`persist:${setting.enabled}`); },
    setReminders: async () => { events.push("schedule"); throw new Error("native failed"); },
    clearReminders: async () => { events.push("clear"); },
  };
  await assert.rejects(() => saveSharedReminderWorkflow({
    challenge: { id: "shared-1", title: "Together" } as any,
    setting: { enabled: true, count: 1, times: ["08:00"], friendCompletedSharedChallenge: true },
    runtime,
  }), /native failed/);
  assert.deepEqual(events, ["persist:true", "schedule", "persist:false"]);
});

test("disabling shared reminders never schedules a replacement", async () => {
  const events: string[] = [];
  const runtime: SharedReminderWorkflowRuntime = {
    loadSetting: async () => normalizeSharedNotificationSetting({ enabled: true, count: 1, times: ["08:00"] }),
    persistSetting: async (_id, setting) => { events.push(`persist:${setting.enabled}`); },
    setReminders: async () => { events.push("schedule"); },
    clearReminders: async () => { events.push("clear"); },
  };
  await saveSharedReminderWorkflow({
    challenge: { id: "shared-1", title: "Together" } as any,
    setting: { enabled: false, count: 1, times: [], friendCompletedSharedChallenge: true },
    runtime,
  });
  assert.deepEqual(events, ["persist:false", "clear"]);
});
