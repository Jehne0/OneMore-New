export async function getNativeWidgetActiveUid(): Promise<string | null | undefined> {
  return undefined;
}

export async function setNativeWidgetActiveUid(_uid: string | null): Promise<void> {}
export async function getNativeAccountSnapshot(_uid: string): Promise<string | null | undefined> { return undefined; }
export async function setNativeAccountSnapshot(_uid: string, _snapshotJson: string | null): Promise<void> {}

export async function getNativeWidgetDimensions(_widgetId: number) {
  return undefined;
}
