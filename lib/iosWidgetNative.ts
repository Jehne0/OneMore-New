export async function writeIosWidgetSnapshot(_json: string): Promise<void> {}
export async function readIosWidgetOutbox(): Promise<string> { return "[]"; }
export async function acknowledgeIosWidgetOutbox(_mutationIds: string[]): Promise<void> {}
export async function clearIosWidgetData(): Promise<void> {}
export async function prepareIosWidgetAccessKey(): Promise<string | null> { return null; }
export async function readIosWidgetAccessGrant(): Promise<string | null> { return null; }
export async function storeIosWidgetAccessGrant(_json: string): Promise<void> {}
export async function clearIosWidgetAccessGrant(): Promise<void> {}
export function reloadIosWidgets(): void {}
