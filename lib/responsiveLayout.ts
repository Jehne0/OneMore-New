export const COMPACT_WIDTH = 360;
export const TABLET_WIDTH = 600;
export const LARGE_TABLET_WIDTH = 840;
export const MAX_CONTENT_WIDTH = 840;
export const MAX_MODAL_WIDTH = 620;

export type ResponsiveLayout = {
  compact: boolean;
  tablet: boolean;
  contentWidth: number;
  modalWidth: number;
  columns: 1 | 2;
};

export function getResponsiveLayout(width: number): ResponsiveLayout {
  const safeWidth = Math.max(1, Number.isFinite(width) ? width : 1);
  const horizontalGap = safeWidth < COMPACT_WIDTH ? 24 : 36;
  return {
    compact: safeWidth < COMPACT_WIDTH,
    tablet: safeWidth >= TABLET_WIDTH,
    contentWidth: Math.min(MAX_CONTENT_WIDTH, Math.max(1, safeWidth - horizontalGap)),
    modalWidth: Math.min(MAX_MODAL_WIDTH, Math.max(1, safeWidth - horizontalGap)),
    columns: safeWidth >= LARGE_TABLET_WIDTH ? 2 : 1,
  };
}
