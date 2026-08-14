const uidLocks = new Map<string, Promise<void>>();

/** Acquires an explicit lease; callers release it after finalize or rollback. */
export async function acquireReminderMutationLock(uid: string): Promise<() => void> {
  if (!uid) return () => undefined;
  const previous = uidLocks.get(uid) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => { releaseCurrent = resolve; });
  const tail = previous.catch(() => undefined).then(() => current);
  uidLocks.set(uid, tail);
  await previous.catch(() => undefined);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseCurrent();
    if (uidLocks.get(uid) === tail) uidLocks.delete(uid);
  };
}
