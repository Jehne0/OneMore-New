export type InitialWidgetRender<T> = {
  renderWidget: (value: T) => void;
  fallback: T;
  load: () => Promise<T>;
};

/** Always attaches a widget immediately, then replaces it with cached data when available. */
export async function renderInitialWidget<T>({ renderWidget, fallback, load }: InitialWidgetRender<T>): Promise<void> {
  renderWidget(fallback);
  try {
    renderWidget(await load());
  } catch {
    // The already-rendered safe fallback must remain attached on corrupt or unavailable caches.
  }
}
