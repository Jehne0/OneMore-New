export type WidgetVariant = "small" | "medium" | "large";
export type WidgetOrientation = "portrait" | "landscape";

export type WidgetDimensions = {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  orientation: WidgetOrientation;
  availableWidth: number;
  availableHeight: number;
};

export type WidgetRowLayout = {
  variant: WidgetVariant;
  width: number;
  height: number;
  rowHeight: number;
  visibleRows: number;
  buttonWidth: number;
  showHeader: boolean;
  showStreak: boolean;
  showToday: boolean;
  showWeek: boolean;
  showBest: boolean;
  showType: boolean;
  showExpandedWeek: boolean;
  showWeekLabels: boolean;
  compactSurfaceHeight: number | null;
  rootPadding: number;
  buttonHeight: number;
  minimumTitleWidth: number;
};

function finiteSize(value: number, fallback = 0) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

// Launcher option values can jitter by a few dp during resize. Quantizing only
// for layout decisions prevents flip-flopping without changing the real bounds.
function stableSize(value: number) {
  return Math.floor(finiteSize(value) / 8) * 8;
}

export function dimensionsFromWidgetInfo(width: number, height: number): WidgetDimensions {
  const safeWidth = finiteSize(width);
  const safeHeight = finiteSize(height);
  return {
    minWidth: safeWidth,
    maxWidth: safeWidth,
    minHeight: safeHeight,
    maxHeight: safeHeight,
    orientation: "portrait",
    availableWidth: safeWidth,
    availableHeight: safeHeight,
  };
}

export function createWidgetRowLayout(
  width: number,
  height: number,
  challengeCount: number
): WidgetRowLayout {
  const stableWidth = stableSize(width);
  const stableHeight = stableSize(height);
  const narrow = stableWidth < 220;
  const compact = stableHeight < 96;
  const showExpandedWeek = !narrow && challengeCount === 1 && stableHeight >= 96;
  const showHeader = stableHeight >= 96 && (challengeCount <= 1 || stableHeight >= 160);
  const rowHeight = compact ? 44 : stableHeight < 144 ? 44 : narrow ? 54 : 52;
  const headerAndPadding = 12 + (showHeader ? 20 : 0) + (showExpandedWeek ? 28 : 0);
  const capacity = Math.max(1, Math.floor((stableHeight - headerAndPadding) / rowHeight));
  const visibleRows = Math.max(1, Math.min(5, Math.max(0, challengeCount), capacity));
  const variant: WidgetVariant = narrow ? "small" : visibleRows <= 1 ? "medium" : "large";

  return {
    variant,
    width: finiteSize(width),
    height: finiteSize(height),
    rowHeight,
    visibleRows,
    buttonWidth: narrow ? 64 : 72,
    showHeader,
    showStreak: stableWidth >= 104,
    showToday: !narrow && stableWidth >= 240,
    showWeek: !narrow && stableWidth >= 296 && !showExpandedWeek,
    showBest: stableWidth >= 400,
    showType: stableWidth >= 460,
    showExpandedWeek,
    showWeekLabels: showExpandedWeek && stableHeight >= 96,
    compactSurfaceHeight: compact ? Math.min(52, finiteSize(height, 52)) : null,
    rootPadding: compact ? 4 : 6,
    buttonHeight: compact ? 38 : 34,
    minimumTitleWidth: narrow ? 40 : 72,
  };
}

export function resolveWidgetVariant(width: number, height: number): WidgetVariant {
  return createWidgetRowLayout(width, height, 5).variant;
}
