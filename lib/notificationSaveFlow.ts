export const NOTIFICATION_CONFIRMATION_MS = 900;

export async function scheduleBatchWithRollback<T>(options: {
  items: T[];
  schedule(item: T): Promise<string>;
  cancel(id: string): Promise<void>;
}): Promise<string[]> {
  const ids: string[] = [];
  try {
    for (const item of options.items) {
      ids.push(await options.schedule(item));
    }
    return ids;
  } catch (error) {
    await Promise.all(ids.map((id) => options.cancel(id).catch(() => undefined)));
    throw error;
  }
}

export async function commitPreparedNotificationChange(options: {
  persist(): Promise<void>;
  restore?: () => Promise<void>;
  rollback(): Promise<void>;
  finalize(): Promise<void>;
}): Promise<void> {
  try {
    await options.persist();
  } catch (error) {
    try {
      await options.restore?.();
    } catch {}
    await options.rollback();
    throw error;
  }
  await options.finalize();
}

export async function finishSuccessfulNotificationSave(options: {
  message: string;
  showConfirmation(message: string): void;
  closeEditor(): void;
  delay?: (milliseconds: number) => Promise<void>;
}): Promise<void> {
  options.showConfirmation(options.message);
  const wait = options.delay ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  await wait(NOTIFICATION_CONFIRMATION_MS);
  options.closeEditor();
}

export type EditorConfirmationController = {
  beginSession(): number;
  cancelSession(): void;
  confirm(options: {
    session: number;
    message: string;
    showConfirmation(message: string): void;
    closeEditor(): void;
  }): Promise<boolean>;
};

export function createEditorDraft(initialValue = "") {
  let value = initialValue;
  return {
    set(nextValue: string) { value = nextValue; },
    read() { return value; },
    readTrimmed() { return value.trim(); },
  };
}

/** A cancellable confirmation delay scoped to one concrete editor instance. */
export function createEditorConfirmationController(runtime: {
  setTimer?: (callback: () => void, milliseconds: number) => unknown;
  clearTimer?: (timer: unknown) => void;
} = {}): EditorConfirmationController {
  const setTimer = runtime.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
  const clearTimer = runtime.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let generation = 0;
  let timer: unknown;
  let resolvePending: ((closed: boolean) => void) | undefined;

  const cancelPending = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    resolvePending?.(false);
    resolvePending = undefined;
  };

  return {
    beginSession() {
      cancelPending();
      generation += 1;
      return generation;
    },
    cancelSession() {
      cancelPending();
      generation += 1;
    },
    async confirm(options) {
      if (options.session !== generation) return false;
      cancelPending();
      options.showConfirmation(options.message);
      return new Promise<boolean>((resolve) => {
        resolvePending = resolve;
        timer = setTimer(() => {
          timer = undefined;
          resolvePending = undefined;
          if (options.session !== generation) {
            resolve(false);
            return;
          }
          options.closeEditor();
          resolve(true);
        }, NOTIFICATION_CONFIRMATION_MS);
      });
    },
  };
}
