import { registerWidgetConfigurationScreen, registerWidgetTaskHandler } from "react-native-android-widget";
import { oneMoreWidgetTaskHandler } from "./widgetService";
import { WidgetConfigurationScreen } from "./WidgetConfigurationScreen";

const registrationKey = "__onemoreWidgetTaskHandlerRegistered" as const;
const registrationState = globalThis as typeof globalThis & { [registrationKey]?: boolean };
const configurationKey = "__onemoreWidgetConfigurationRegistered" as const;
const configurationState = globalThis as typeof globalThis & { [configurationKey]?: boolean };

if (!registrationState[registrationKey]) {
  registerWidgetTaskHandler(oneMoreWidgetTaskHandler);
  registrationState[registrationKey] = true;
}

if (!configurationState[configurationKey]) {
  registerWidgetConfigurationScreen(WidgetConfigurationScreen);
  configurationState[configurationKey] = true;
}
