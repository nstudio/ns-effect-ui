/**
 * Lightweight deterministic Flexbox + CSS Grid layout engine for `MacosHost`.
 *
 * Computes top-down `Rect` frames for every node in an Effect UI HTML tree
 * (column flex, row flex with `flex-1` / `space-between` / `flex-end`, and
 * equal-column CSS Grid) so AppKit `NSView` frames match Web & MasonKit.
 */
import type { ComputedBoxStyle } from './styles.ts';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LayoutNode {
  readonly tag: string;
  readonly isPortal: boolean;
  readonly style: ComputedBoxStyle;
  readonly text: string | undefined;
  readonly children: ReadonlyArray<LayoutNode>;
  frame: Rect;
}

export type TextMeasurer = (
  text: string,
  style: ComputedBoxStyle,
  maxWidth: number,
) => { readonly width: number; readonly height: number };

/**
 * Computes natural/intrinsic width & height of a node given `availableWidth`.
 */
export function measureNode(
  node: LayoutNode,
  availableWidth: number,
  measureText: TextMeasurer,
): { readonly width: number; readonly height: number } {
  const s = node.style;
  if (s.display === 'none' || node.isPortal) {
    return { width: 0, height: 0 };
  }

  const padX = s.padLeft + s.padRight;
  const padY = s.padTop + s.padBottom;
  const maxInnerW = Math.max(
    0,
    (s.width !== undefined ? s.width : availableWidth) - padX,
  );

  // Leaf text or input node
  if (node.tag === 'input') {
    const w = s.width ?? (s.fullWidth ? availableWidth : Math.min(260, availableWidth));
    return { width: w, height: s.height ?? 38 };
  }

  const visibleChildren = node.children.filter(
    (c) => c.style.display !== 'none' && !c.isPortal,
  );

  if (visibleChildren.length === 0) {
    if (node.text && node.text.length > 0) {
      const m = measureText(node.text, s, maxInnerW);
      const w = s.width ?? (s.fullWidth ? availableWidth : Math.min(availableWidth, Math.ceil(m.width) + padX));
      const h = s.height ?? Math.ceil(m.height) + padY;
      return { width: w, height: h };
    }
    return {
      width: s.width ?? (s.fullWidth ? availableWidth : padX),
      height: s.height ?? padY,
    };
  }

  // CSS Grid
  if (s.display === 'grid' && s.gridCols > 0) {
    const cols = s.gridCols;
    const totalGap = s.gap * Math.max(0, cols - 1);
    const colW = Math.max(0, (maxInnerW - totalGap) / cols);
    let totalH = 0;
    const rows = Math.ceil(visibleChildren.length / cols);
    for (let r = 0; r < rows; r++) {
      let rowH = 0;
      for (let c = 0; c < cols; c++) {
        const child = visibleChildren[r * cols + c];
        if (!child) continue;
        const cm = measureNode(child, colW, measureText);
        rowH = Math.max(rowH, cm.height + child.style.marginTop + child.style.marginBottom);
      }
      totalH += rowH;
      if (r < rows - 1) totalH += s.gap;
    }
    return {
      width: s.width ?? availableWidth,
      height: s.height ?? totalH + padY,
    };
  }

  // Flex Row
  if (s.flexDirection === 'row') {
    const totalGaps = s.gap * Math.max(0, visibleChildren.length - 1);
    let fixedW = 0;
    let growTotal = 0;
    const sizes = new Map<LayoutNode, { readonly width: number; readonly height: number }>();

    for (const child of visibleChildren) {
      if (child.style.flexGrow > 0) {
        growTotal += child.style.flexGrow;
      } else {
        const m = measureNode(child, maxInnerW, measureText);
        sizes.set(child, m);
        fixedW += m.width;
      }
    }

    const remaining = Math.max(0, maxInnerW - fixedW - totalGaps);
    for (const child of visibleChildren) {
      if (child.style.flexGrow > 0) {
        const share = (remaining * child.style.flexGrow) / growTotal;
        const m = measureNode(child, share, measureText);
        sizes.set(child, { width: share, height: m.height });
      }
    }

    let sumW = totalGaps;
    let maxH = 0;
    for (const child of visibleChildren) {
      const m = sizes.get(child)!;
      sumW += m.width;
      maxH = Math.max(maxH, m.height + child.style.marginTop + child.style.marginBottom);
    }

    const needFull =
      s.fullWidth ||
      s.justifyContent === 'space-between' ||
      s.justifyContent === 'flex-end' ||
      growTotal > 0;
    return {
      width: s.width ?? (needFull ? availableWidth : Math.min(availableWidth, sumW + padX)),
      height: s.height ?? maxH + padY,
    };
  }

  // Flex Column (default)
  let totalH = 0;
  let maxW = 0;
  visibleChildren.forEach((child, idx) => {
    const m = measureNode(child, maxInnerW, measureText);
    maxW = Math.max(maxW, m.width);
    totalH += m.height + child.style.marginTop + child.style.marginBottom;
    if (idx < visibleChildren.length - 1) totalH += s.gap;
  });

  const w = s.width ?? (s.fullWidth || s.alignItems === 'stretch' ? availableWidth : Math.min(availableWidth, maxW + padX));
  return {
    width: w,
    height: s.height ?? totalH + padY,
  };
}

/**
 * Lays out `node` inside `(x, y, width, height)` and recursively assigns
 * `child.frame` in parent-local top-down coordinates (`isFlipped = true`).
 */
export function layoutTree(
  node: LayoutNode,
  x: number,
  y: number,
  width: number,
  height: number,
  measureText: TextMeasurer,
): void {
  node.frame = { x, y, width, height };
  const s = node.style;
  if (s.display === 'none' || node.isPortal) return;

  const visibleChildren = node.children.filter(
    (c) => c.style.display !== 'none' && !c.isPortal,
  );
  if (visibleChildren.length === 0) return;

  const innerX = s.padLeft;
  const innerY = s.padTop;
  const innerW = Math.max(0, width - s.padLeft - s.padRight);
  const innerH = Math.max(0, height - s.padTop - s.padBottom);

  // CSS Grid
  if (s.display === 'grid' && s.gridCols > 0) {
    const cols = s.gridCols;
    const totalGap = s.gap * Math.max(0, cols - 1);
    const colW = Math.max(0, (innerW - totalGap) / cols);
    const rows = Math.ceil(visibleChildren.length / cols);
    let curY = innerY;

    for (let r = 0; r < rows; r++) {
      let rowH = 0;
      const rowMetrics: Array<{ child: LayoutNode; h: number }> = [];
      for (let c = 0; c < cols; c++) {
        const child = visibleChildren[r * cols + c];
        if (!child) continue;
        const m = measureNode(child, colW, measureText);
        rowH = Math.max(rowH, m.height);
        rowMetrics.push({ child, h: m.height });
      }
      for (let c = 0; c < rowMetrics.length; c++) {
        const entry = rowMetrics[c]!;
        const cx = innerX + c * (colW + s.gap);
        layoutTree(entry.child, cx, curY + entry.child.style.marginTop, colW, rowH, measureText);
      }
      curY += rowH + s.gap;
    }
    return;
  }

  // Flex Row
  if (s.flexDirection === 'row') {
    const totalGaps = s.gap * Math.max(0, visibleChildren.length - 1);
    let fixedW = 0;
    let growTotal = 0;
    const measured = new Map<LayoutNode, { readonly width: number; readonly height: number }>();

    for (const child of visibleChildren) {
      if (child.style.flexGrow > 0) {
        growTotal += child.style.flexGrow;
      } else {
        const m = measureNode(child, innerW, measureText);
        measured.set(child, m);
        fixedW += m.width;
      }
    }

    const remaining = Math.max(0, innerW - fixedW - totalGaps);
    for (const child of visibleChildren) {
      if (child.style.flexGrow > 0) {
        const share = (remaining * child.style.flexGrow) / growTotal;
        const m = measureNode(child, share, measureText);
        measured.set(child, { width: share, height: m.height });
      }
    }

    const totalChildrenW = visibleChildren.reduce((acc, c) => acc + measured.get(c)!.width, 0);
    let curX = innerX;
    let gap = s.gap;

    if (s.justifyContent === 'space-between' && visibleChildren.length > 1) {
      gap = Math.max(s.gap, (innerW - totalChildrenW) / (visibleChildren.length - 1));
    } else if (s.justifyContent === 'flex-end') {
      curX = innerX + Math.max(0, innerW - (totalChildrenW + totalGaps));
    } else if (s.justifyContent === 'center') {
      curX = innerX + Math.max(0, (innerW - (totalChildrenW + totalGaps)) / 2);
    }

    for (const child of visibleChildren) {
      const m = measured.get(child)!;
      let cy = innerY + child.style.marginTop;
      const ch = s.alignItems === 'stretch' ? innerH : m.height;
      if (s.alignItems === 'center') {
        cy = innerY + Math.max(0, (innerH - ch) / 2);
      } else if (s.alignItems === 'flex-end') {
        cy = innerY + Math.max(0, innerH - ch);
      }
      layoutTree(child, curX, cy, m.width, ch, measureText);
      curX += m.width + gap;
    }
    return;
  }

  // Flex Column
  let curY = innerY;
  for (const child of visibleChildren) {
    const m = measureNode(child, innerW, measureText);
    const cw =
      child.style.width !== undefined
        ? child.style.width
        : s.alignItems === 'stretch' || child.style.fullWidth
          ? innerW
          : m.width;
    let cx = innerX;
    if (s.alignItems === 'center') {
      cx = innerX + Math.max(0, (innerW - cw) / 2);
    } else if (s.alignItems === 'flex-end') {
      cx = innerX + Math.max(0, innerW - cw);
    }
    curY += child.style.marginTop;
    layoutTree(child, cx, curY, cw, m.height, measureText);
    curY += m.height + child.style.marginBottom + s.gap;
  }
}
