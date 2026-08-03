export function requestIosWidgetStateSync(): void {
  void import("./iosWidgetService")
    .then(({ syncIosWidgetState }) => syncIosWidgetState())
    .catch(() => {});
}
