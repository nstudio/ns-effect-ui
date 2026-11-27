/**
 * Host-agnostic slot-recycled `VirtualList` for `@nstudio/nativescript-effect-ui`.
 *
 * Works identically across `MasonHost`, `NativeHost`, and `BrowserHost`:
 * - Keeps a small bounded window of visible + overscan rows in the Effect UI Model.
 * - Supports variable measured row heights (`measureHeight`).
 * - When `recycle: true`, keys rows by `slot = index % poolSize` so scrolling
 *   through 1,000+ items reuses the exact same native views with **zero native
 *   view allocations** after initial fill.
 * - Returns the exact same Model reference when the visible window has not
 *   moved (`scrolled`), so Effect UI skips re-rendering completely on quiet ticks.
 */
import * as Schema from 'effect/Schema';

export const VirtualListModel = Schema.Struct({
  totalCount: Schema.Number,
  viewportHeight: Schema.Number,
  estimatedItemHeight: Schema.Number,
  overscanPx: Schema.Number,
  scrollOffset: Schema.Number,
  startIndex: Schema.Number,
  endIndex: Schema.Number,
  poolSize: Schema.Number,
  recycle: Schema.Boolean,
  measuredHeights: Schema.Record(Schema.String, Schema.Number),
});
export type VirtualListModel = typeof VirtualListModel.Type;

export interface VirtualListInitOptions {
  readonly totalCount: number;
  readonly viewportHeight?: number | undefined;
  readonly estimatedItemHeight?: number | undefined;
  readonly overscanPx?: number | undefined;
  readonly recycle?: boolean | undefined;
}

export interface VirtualWindow<A> {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly totalHeight: number;
  readonly topSpacerPx: number;
  readonly bottomSpacerPx: number;
  readonly visibleItems: ReadonlyArray<{
    readonly index: number;
    readonly key: string;
    readonly slot: number;
    readonly offsetY: number;
    readonly height: number;
    readonly item: A;
  }>;
}

function heightOf(
  index: number,
  measured: Readonly<Record<string, number>>,
  estimated: number,
): number {
  const h = measured[String(index)];
  return h !== undefined && h > 0 ? h : estimated;
}

function computeRange(
  totalCount: number,
  scrollOffset: number,
  viewportHeight: number,
  overscanPx: number,
  estimatedItemHeight: number,
  measuredHeights: Readonly<Record<string, number>>,
): { readonly startIndex: number; readonly endIndex: number; readonly poolSize: number } {
  if (totalCount <= 0) {
    return { startIndex: 0, endIndex: -1, poolSize: 0 };
  }

  const minY = Math.max(0, scrollOffset - overscanPx);
  const maxY = scrollOffset + Math.max(1, viewportHeight) + overscanPx;

  let y = 0;
  let startIndex = 0;
  let foundStart = false;
  let endIndex = totalCount - 1;

  for (let i = 0; i < totalCount; i++) {
    const h = heightOf(i, measuredHeights, estimatedItemHeight);
    const nextY = y + h;
    if (!foundStart && nextY >= minY) {
      startIndex = i;
      foundStart = true;
    }
    if (foundStart && y > maxY) {
      endIndex = Math.max(startIndex, i - 1);
      break;
    }
    y = nextY;
  }

  const visibleSpan = endIndex - startIndex + 1;
  const maxPool = Math.ceil((viewportHeight + overscanPx * 2) / Math.max(1, estimatedItemHeight)) + 4;
  return {
    startIndex,
    endIndex,
    poolSize: Math.max(visibleSpan, maxPool),
  };
}

/**
 * Initializes a `VirtualListModel` ready for 1,000+ rows.
 */
export function init(options: VirtualListInitOptions): VirtualListModel {
  const viewportHeight = Math.max(1, options.viewportHeight ?? 640);
  const estimatedItemHeight = Math.max(1, options.estimatedItemHeight ?? 68);
  const overscanPx = Math.max(0, options.overscanPx ?? 320);
  const range = computeRange(
    options.totalCount,
    0,
    viewportHeight,
    overscanPx,
    estimatedItemHeight,
    {},
  );
  return {
    totalCount: options.totalCount,
    viewportHeight,
    estimatedItemHeight,
    overscanPx,
    scrollOffset: 0,
    startIndex: range.startIndex,
    endIndex: range.endIndex,
    poolSize: range.poolSize,
    recycle: options.recycle ?? true,
    measuredHeights: {},
  };
}

/**
 * Updates the scroll offset and recalculates the visible window.
 *
 * Returns the **exact same object reference** when `[startIndex, endIndex]` is
 * unchanged, allowing Effect UI to skip view reconciliation completely.
 */
export function scrolled(model: VirtualListModel, scrollOffset: number): VirtualListModel {
  const clamped = Math.max(0, scrollOffset);
  const range = computeRange(
    model.totalCount,
    clamped,
    model.viewportHeight,
    model.overscanPx,
    model.estimatedItemHeight,
    model.measuredHeights,
  );
  if (range.startIndex === model.startIndex && range.endIndex === model.endIndex) {
    return model;
  }
  return {
    ...model,
    scrollOffset: clamped,
    startIndex: range.startIndex,
    endIndex: range.endIndex,
    poolSize: Math.max(model.poolSize, range.poolSize),
  };
}

/**
 * Records a measured native layout height for an item index.
 */
export function measureHeight(
  model: VirtualListModel,
  index: number,
  height: number,
): VirtualListModel {
  const rounded = Math.max(1, Math.round(height));
  if (model.measuredHeights[String(index)] === rounded) return model;
  const nextMeasured = { ...model.measuredHeights, [String(index)]: rounded };
  const range = computeRange(
    model.totalCount,
    model.scrollOffset,
    model.viewportHeight,
    model.overscanPx,
    model.estimatedItemHeight,
    nextMeasured,
  );
  return {
    ...model,
    measuredHeights: nextMeasured,
    startIndex: range.startIndex,
    endIndex: range.endIndex,
    poolSize: Math.max(model.poolSize, range.poolSize),
  };
}

/**
 * Updates total item count (e.g. after filtering or appending rows).
 */
export function setCount(model: VirtualListModel, totalCount: number): VirtualListModel {
  if (totalCount === model.totalCount) return model;
  const range = computeRange(
    totalCount,
    model.scrollOffset,
    model.viewportHeight,
    model.overscanPx,
    model.estimatedItemHeight,
    model.measuredHeights,
  );
  return {
    ...model,
    totalCount,
    startIndex: range.startIndex,
    endIndex: range.endIndex,
    poolSize: Math.max(model.poolSize, range.poolSize),
  };
}

/**
 * Computes spacer heights and slot-recycled visible items for the current window.
 */
export function computeWindow<A>(
  model: VirtualListModel,
  items: ReadonlyArray<A>,
): VirtualWindow<A> {
  const count = Math.min(model.totalCount, items.length);
  if (count <= 0 || model.endIndex < model.startIndex) {
    return {
      startIndex: 0,
      endIndex: -1,
      totalHeight: 0,
      topSpacerPx: 0,
      bottomSpacerPx: 0,
      visibleItems: [],
    };
  }

  const start = Math.max(0, Math.min(model.startIndex, count - 1));
  const end = Math.max(start, Math.min(model.endIndex, count - 1));
  const pool = Math.max(1, model.poolSize);

  let topSpacerPx = 0;
  for (let i = 0; i < start; i++) {
    topSpacerPx += heightOf(i, model.measuredHeights, model.estimatedItemHeight);
  }

  let offsetY = topSpacerPx;
  const visibleItems: Array<{
    readonly index: number;
    readonly key: string;
    readonly slot: number;
    readonly offsetY: number;
    readonly height: number;
    readonly item: A;
  }> = [];

  for (let i = start; i <= end; i++) {
    const h = heightOf(i, model.measuredHeights, model.estimatedItemHeight);
    const slot = i % pool;
    visibleItems.push({
      index: i,
      key: model.recycle ? `vslot-${slot}` : `vitem-${i}`,
      slot,
      offsetY,
      height: h,
      item: items[i]!,
    });
    offsetY += h;
  }

  let bottomSpacerPx = 0;
  for (let i = end + 1; i < count; i++) {
    bottomSpacerPx += heightOf(i, model.measuredHeights, model.estimatedItemHeight);
  }

  return {
    startIndex: start,
    endIndex: end,
    totalHeight: offsetY + bottomSpacerPx,
    topSpacerPx,
    bottomSpacerPx,
    visibleItems,
  };
}

export const VirtualList = {
  VirtualListModel,
  init,
  scrolled,
  measureHeight,
  setCount,
  computeWindow,
} as const;
