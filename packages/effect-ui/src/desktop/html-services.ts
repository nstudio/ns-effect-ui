/**
 * Shared desktop host utilities reused across `MacosHost`, `WindowsHost`,
 * and `LinuxHost`: Effect UI HTML services (`Html.Host` + `HtmlSubscription`),
 * RGBA formatting helpers, and deterministic fallback text measurement.
 */
import { Html, HtmlSubscription } from '@effect/ui/html';
import * as Context from 'effect/Context';
import type { ComputedBoxStyle, RgbaColor } from '../macos/styles.js';

export {
  layoutTree,
  measureNode,
  type LayoutNode,
  type Rect,
  type TextMeasurer,
} from '../macos/layout.js';
export {
  darkPalette,
  hex,
  lightPalette,
  resolveMacosStyle as resolveDesktopStyle,
  type ComputedBoxStyle,
  type RgbaColor,
  type ThemePalette,
} from '../macos/styles.js';

/**
 * Provides the standard `@effect/ui/html` host services (`Html.Host`,
 * `AnimationFrames`, `MediaQueries`, `GlobalEvents`) on desktop runtimes.
 */
export function makeDesktopHtmlServices(
  getDarkMode?: () => boolean,
): Context.Context<Html.Host> {
  return Context.make(Html.Host, {
    focus: () => {},
    blur: () => {},
    scrollIntoView: () => {},
    measure: (el: any) => {
      const f = el?.layoutNode?.frame;
      return {
        x: f?.x ?? 0,
        y: f?.y ?? 0,
        width: f?.width ?? 0,
        height: f?.height ?? 0,
        top: f?.y ?? 0,
        left: f?.x ?? 0,
        right: (f?.x ?? 0) + (f?.width ?? 0),
        bottom: (f?.y ?? 0) + (f?.height ?? 0),
      };
    },
    select: () => {},
    requestSubmit: () => false,
    showPicker: () => false,
  }).pipe(
    Context.add(HtmlSubscription.AnimationFrames, {
      now: () => Date.now(),
      listen: (cb) => {
        let stopped = false;
        let id: ReturnType<typeof setTimeout> | undefined;
        const tick = () => {
          if (stopped) return;
          cb(Date.now());
          if (!stopped) id = setTimeout(tick, 16);
        };
        id = setTimeout(tick, 16);
        return () => {
          stopped = true;
          if (id !== undefined) clearTimeout(id);
        };
      },
    }),
    Context.add(HtmlSubscription.MediaQueries, {
      matches: (query) => {
        if (query.includes('prefers-color-scheme: dark')) {
          return Boolean(getDarkMode?.());
        }
        return undefined;
      },
      listen: () => () => {},
    }),
    Context.add(HtmlSubscription.GlobalEvents, {
      listen: () => () => {},
    }),
  ) as unknown as Context.Context<Html.Host>;
}

/**
 * Deterministic cross-platform text size estimator used by desktop hosts when
 * a native platform text layout engine is unavailable or in headless tests.
 */
export function estimateDesktopTextSize(
  text: string,
  style: ComputedBoxStyle,
  maxWidth: number,
): { readonly width: number; readonly height: number } {
  if (!text) return { width: 0, height: Math.ceil(style.fontSize * 1.35) };
  const charW =
    style.fontSize * (style.fontWeight === 'bold' || style.fontWeight === 'semibold' ? 0.6 : 0.55);
  const lineH = Math.ceil(style.fontSize * 1.38);
  const paragraphs = text.split('\n');
  const limit = Math.max(24, maxWidth);
  let lines = 0;
  let widest = 0;

  for (const para of paragraphs) {
    const rawW = para.length * charW;
    if (rawW <= limit) {
      lines += 1;
      widest = Math.max(widest, rawW);
    } else {
      const wrapped = Math.max(1, Math.ceil(rawW / limit));
      lines += wrapped;
      widest = limit;
    }
  }

  return {
    width: Math.min(limit, Math.ceil(widest) + 4),
    height: Math.max(lineH, lines * lineH + 2),
  };
}

/** Converts normalized `[0..1]` RGBA to 8-bit `{ A, R, G, B }` (WinRT / WinUI `Color`). */
export function toByteArgb(c: RgbaColor): {
  readonly A: number;
  readonly R: number;
  readonly G: number;
  readonly B: number;
} {
  return {
    A: Math.max(0, Math.min(255, Math.round(c.a * 255))),
    R: Math.max(0, Math.min(255, Math.round(c.r * 255))),
    G: Math.max(0, Math.min(255, Math.round(c.g * 255))),
    B: Math.max(0, Math.min(255, Math.round(c.b * 255))),
  };
}

/** Converts normalized `[0..1]` RGBA to CSS `rgba(r, g, b, a)` (GTK4 CSS provider). */
export function toCssRgba(c: RgbaColor): string {
  const r = Math.max(0, Math.min(255, Math.round(c.r * 255)));
  const g = Math.max(0, Math.min(255, Math.round(c.g * 255)));
  const b = Math.max(0, Math.min(255, Math.round(c.b * 255)));
  const a = Number(Math.max(0, Math.min(1, c.a)).toFixed(3));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
