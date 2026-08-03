import { NativeModules } from "react-native";

type NativeWidgetSession = {
  setActiveUid(uid: string | null): Promise<void>;
  getActiveUid(): Promise<string | null>;
  setAccountSnapshot(uid: string, snapshotJson: string | null): Promise<void>;
  getAccountSnapshot(uid: string): Promise<string | null>;
  getWidgetDimensions(widgetId: number): Promise<import("./widgetLayout").WidgetDimensions>;
};

export async function getNativeWidgetDimensions(widgetId: number) {
  return module?.getWidgetDimensions(widgetId);
}

const module = NativeModules.OneMoreWidgetSession as NativeWidgetSession | undefined;

export async function getNativeWidgetActiveUid(): Promise<string | null | undefined> {
  return module?.getActiveUid();
}

export async function setNativeWidgetActiveUid(uid: string | null): Promise<void> {
  await module?.setActiveUid(uid);
}

export async function getNativeAccountSnapshot(uid: string): Promise<string | null | undefined> {
  return module?.getAccountSnapshot(uid);
}

export async function setNativeAccountSnapshot(uid: string, snapshotJson: string | null): Promise<void> {
  await module?.setAccountSnapshot(uid, snapshotJson);
}
