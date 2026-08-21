export async function startIosBackgroundStartup(): Promise<() => void> {
  const { startIosWidgetRegistration } = await import("../widgets/register.ios");
  return startIosWidgetRegistration();
}
