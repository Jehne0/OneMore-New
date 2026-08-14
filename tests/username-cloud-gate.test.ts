import assert from "node:assert/strict";
import test from "node:test";

import { setCloudAccessStatus } from "../lib/cloudAccessGate";
import {
  changeUsername,
  type ChangeUsernameRuntime,
} from "../lib/usernames";

function usernameRuntime(onGet?: (getIndex: number) => void) {
  let runCalls = 0;
  let getCalls = 0;
  let writes = 0;
  const runtime: ChangeUsernameRuntime = {
    runTransaction: async (update) => {
      runCalls += 1;
      await update({
        get: async () => {
          getCalls += 1;
          onGet?.(getCalls);
          if (getCalls === 1) {
            return {
              exists: () => true,
              data: () => ({ profile: { usernameLower: "old_name" } }),
            };
          }
          return { exists: () => false, data: () => undefined };
        },
        delete: () => { writes += 1; },
        set: () => { writes += 1; },
      });
    },
  };
  return {
    runtime,
    counts: () => ({ runCalls, getCalls, writes }),
  };
}

test("verified changeUsername runs the production transaction path", async () => {
  setCloudAccessStatus("verified");
  const harness = usernameRuntime();
  await changeUsername("u1", "new_name", harness.runtime);
  assert.equal(harness.counts().runCalls, 1);
  assert.equal(harness.counts().writes, 4);
});
test("unverified changeUsername performs no Firestore transaction", async () => {
  setCloudAccessStatus("unverified");
  const harness = usernameRuntime();
  await assert.rejects(
    changeUsername("u1", "new_name", harness.runtime),
    /CLOUD_ACCESS_UNVERIFIED/,
  );
  assert.deepEqual(harness.counts(), { runCalls: 0, getCalls: 0, writes: 0 });
});

test("updateRequired changeUsername performs no Firestore transaction", async () => {
  setCloudAccessStatus("updateRequired");
  const harness = usernameRuntime();
  await assert.rejects(
    changeUsername("u1", "new_name", harness.runtime),
    /CLOUD_ACCESS_UNVERIFIED/,
  );
  assert.deepEqual(harness.counts(), { runCalls: 0, getCalls: 0, writes: 0 });
});

test("gate revision change during changeUsername prevents every transaction write", async () => {
  setCloudAccessStatus("verified");
  const harness = usernameRuntime((getIndex) => {
    if (getIndex === 2) setCloudAccessStatus("unverified");
  });
  await assert.rejects(
    changeUsername("u1", "new_name", harness.runtime),
    /CLOUD_ACCESS_(?:UNVERIFIED|STALE_SESSION)/,
  );
  assert.deepEqual(harness.counts(), { runCalls: 1, getCalls: 2, writes: 0 });
});

test("changeUsername can be retried after a later verified decision", async () => {
  setCloudAccessStatus("unverified");
  const harness = usernameRuntime();
  await assert.rejects(changeUsername("u1", "new_name", harness.runtime));
  setCloudAccessStatus("verified");
  await changeUsername("u1", "new_name", harness.runtime);
  assert.equal(harness.counts().runCalls, 1);
  assert.equal(harness.counts().writes, 4);
});
