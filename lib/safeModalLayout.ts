export const MODAL_EDGE_GAP = 12;
export const MODAL_TOP_GAP = 24;

export type SafeModalMetrics = {
  windowHeight: number;
  topInset: number;
  bottomInset: number;
  keyboardHeight?: number;
  heightRatio?: number;
};

export function getSafeModalMetrics({
  windowHeight,
  topInset,
  bottomInset,
  keyboardHeight = 0,
  heightRatio = 0.82,
}: SafeModalMetrics) {
  const safeTop = Math.max(0, topInset);
  const safeBottom = Math.max(0, bottomInset);
  const safeKeyboard = Math.max(0, keyboardHeight);
  const bottom = safeBottom + MODAL_EDGE_GAP;
  const availableHeight = Math.max(
    0,
    windowHeight - safeTop - bottom - MODAL_TOP_GAP - safeKeyboard
  );

  return {
    bottom,
    maxHeight: Math.max(0, Math.min(windowHeight * heightRatio, availableHeight)),
    paddingTop: safeTop + MODAL_TOP_GAP,
    paddingBottom: bottom,
  };
}

