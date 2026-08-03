import { NativeModules } from "react-native";

type OneMoreIosWidgetBridge = {
  writeSnapshot(json: string): Promise<void>;
  readOutbox(): Promise<string>;
  acknowledgeOutbox(mutationIds: string[]): Promise<void>;
  clearWidgetData(): Promise<void>;
  prepareWidgetAccessKey(): Promise<string>;
  readWidgetAccessGrant(): Promise<string | null>;
  storeWidgetAccessGrant(json: string): Promise<void>;
  clearWidgetAccessGrant(): Promise<void>;
  reloadWidgets(): void;
};

const bridge = NativeModules.OneMoreIosWidgetBridge as OneMoreIosWidgetBridge | undefined;
export async function writeIosWidgetSnapshot(json: string) { await bridge?.writeSnapshot(json); }
export async function readIosWidgetOutbox() { return (await bridge?.readOutbox()) ?? "[]"; }
export async function acknowledgeIosWidgetOutbox(ids: string[]) { await bridge?.acknowledgeOutbox(ids); }
export async function clearIosWidgetData() { await bridge?.clearWidgetData(); }
export async function prepareIosWidgetAccessKey() { return (await bridge?.prepareWidgetAccessKey()) ?? null; }
export async function readIosWidgetAccessGrant() { return (await bridge?.readWidgetAccessGrant()) ?? null; }
export async function storeIosWidgetAccessGrant(json: string) { await bridge?.storeWidgetAccessGrant(json); }
export async function clearIosWidgetAccessGrant() { await bridge?.clearWidgetAccessGrant(); }
export function reloadIosWidgets() { bridge?.reloadWidgets(); }
