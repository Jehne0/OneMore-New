import React from "react";
import { useRouter } from "expo-router";
import { IOS_WIDGET_CONFIG_ID } from "../lib/iosWidgetSnapshot";
import { WidgetConfigurationContent } from "../widgets/WidgetConfigurationScreen";

/** The same UID-scoped selection UI and persistence used by Android configuration. */
export default function IosWidgetSettingsScreen() {
  const router = useRouter();
  return <WidgetConfigurationContent
    widgetInfo={{ widgetName: "OneMore", widgetId: IOS_WIDGET_CONFIG_ID, width: 360, height: 360, screenInfo: { screenHeightDp: 800, screenWidthDp: 360, density: 1, densityDpi: 160 } }}
    renderWidget={() => {}}
    setResult={() => router.back()}
  />;
}
