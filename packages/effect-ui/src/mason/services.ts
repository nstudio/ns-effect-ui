/**
 * NativeScript implementations of `@effect/ui/html` host services:
 * - `Html.Host` (`focus`, `blur`, `scrollIntoView`, `measure`, `select`, `requestSubmit`, `showPicker`)
 * - `HtmlSubscription.AnimationFrames`
 * - `HtmlSubscription.MediaQueries` (dark mode, viewport width/orientation)
 * - `HtmlSubscription.GlobalEvents` (app resume/suspend -> window focus/blur)
 */
import { Html, HtmlSubscription } from '@effect/ui/html';
import { Application, Screen, type View as NSView } from '@nativescript/core';
import type * as Context from 'effect/Context';
import type { EventController } from './events.ts';

/**
 * Ensures lightweight standard JS runtime helpers expected by `@effect/ui`
 * exist on NativeScript's V8/JSC runtime.
 */
export function ensureRuntimeGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  if (typeof g['queueMicrotask'] !== 'function') {
    g['queueMicrotask'] = (fn: () => void) => {
      Promise.resolve().then(fn);
    };
  }
  if (
    typeof g['performance'] !== 'object' ||
    g['performance'] === null ||
    typeof (g['performance'] as { now?: unknown }).now !== 'function'
  ) {
    const start = Date.now();
    g['performance'] = { now: () => Date.now() - start };
  }
}

/**
 * Builds the `Html.Host` service over NativeScript/MasonKit views so shared
 * `Html.component(...)` and `HtmlCommand.*` ref commands work natively.
 */
export function makeNativeHtmlHost(
  events: EventController,
): Context.Service.Shape<typeof Html.Host> {
  return {
    focus(element) {
      const view = element as unknown as NSView & { focus?: () => boolean };
      try {
        view?.focus?.();
      } catch {
        // Ignore non-focusable views.
      }
    },

    blur(element) {
      const view = element as unknown as NSView & {
        dismissSoftInput?: () => void;
        blur?: () => void;
      };
      try {
        view?.dismissSoftInput?.();
        view?.blur?.();
      } catch {
        // Ignore views without blur.
      }
    },

    scrollIntoView(element, options) {
      const view = element as unknown as NSView & {
        scrollIntoView?: (opts?: unknown) => void;
      };
      try {
        view?.scrollIntoView?.(options);
      } catch {
        // Ignore if not inside a scroll container.
      }
    },

    measure(element) {
      const view = element as unknown as NSView;
      try {
        const loc = typeof view.getLocationInWindow === 'function'
          ? view.getLocationInWindow()
          : { x: 0, y: 0 };
        const size = typeof view.getActualSize === 'function'
          ? view.getActualSize()
          : { width: 0, height: 0 };
        const x = loc?.x ?? 0;
        const y = loc?.y ?? 0;
        const width = size?.width ?? 0;
        const height = size?.height ?? 0;
        return {
          x,
          y,
          width,
          height,
          top: y,
          left: x,
          right: x + width,
          bottom: y + height,
        };
      } catch {
        return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
      }
    },

    select(element) {
      const view = element as unknown as NSView & { focus?: () => boolean };
      try {
        view?.focus?.();
      } catch {
        // Ignore non-text views.
      }
    },

    requestSubmit(element) {
      return events.requestFormSubmit(element as unknown as NSView);
    },

    showPicker() {
      return false;
    },
  };
}

/**
 * AnimationFrames service backed by a 60Hz native tick (falls back cleanly to
 * `setTimeout(16)` when running outside a display link).
 */
export function makeNativeAnimationFrames(): HtmlSubscription.AnimationFrames {
  const now = () =>
    typeof globalThis.performance?.now === 'function'
      ? globalThis.performance.now()
      : Date.now();

  return {
    now,
    listen(listener) {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = () => {
        if (stopped) return;
        listener(now());
        if (!stopped) {
          timer = setTimeout(tick, 16);
        }
      };
      timer = setTimeout(tick, 16);
      return () => {
        stopped = true;
        if (timer !== undefined) clearTimeout(timer);
      };
    },
  };
}

function evalMediaQuery(query: string): boolean | undefined {
  const q = query.trim().toLowerCase();
  if (q.includes('prefers-color-scheme: dark')) {
    try {
      return Application.systemAppearance?.() === 'dark';
    } catch {
      return false;
    }
  }
  if (q.includes('prefers-color-scheme: light')) {
    try {
      return Application.systemAppearance?.() !== 'dark';
    } catch {
      return true;
    }
  }
  const minW = q.match(/min-width:\s*(\d+)px/);
  if (minW) {
    try {
      return (Screen.mainScreen?.widthDIPs ?? 0) >= Number(minW[1]);
    } catch {
      return false;
    }
  }
  const maxW = q.match(/max-width:\s*(\d+)px/);
  if (maxW) {
    try {
      return (Screen.mainScreen?.widthDIPs ?? 0) <= Number(maxW[1]);
    } catch {
      return false;
    }
  }
  if (q.includes('orientation: landscape')) {
    try {
      const s = Screen.mainScreen;
      return s ? s.widthDIPs > s.heightDIPs : false;
    } catch {
      return false;
    }
  }
  if (q.includes('orientation: portrait')) {
    try {
      const s = Screen.mainScreen;
      return s ? s.heightDIPs >= s.widthDIPs : true;
    } catch {
      return true;
    }
  }
  return undefined;
}

/**
 * MediaQueries service backed by NativeScript's `Application.systemAppearance()`
 * and `Screen.mainScreen`.
 */
export function makeNativeMediaQueries(): HtmlSubscription.MediaQueries {
  return {
    matches: evalMediaQuery,
    listen(query, listener) {
      const q = query.trim().toLowerCase();
      if (q.includes('prefers-color-scheme')) {
        const handler = (args: { newValue?: string }) => {
          const isDark = args.newValue === 'dark';
          listener(q.includes('dark') ? isDark : !isDark);
        };
        try {
          Application.on(Application.systemAppearanceChangedEvent, handler as never);
          return () => {
            Application.off(Application.systemAppearanceChangedEvent, handler as never);
          };
        } catch {
          return () => {};
        }
      }
      if (q.includes('orientation') || q.includes('width')) {
        const handler = () => {
          const next = evalMediaQuery(query);
          if (next !== undefined) listener(next);
        };
        try {
          Application.on(Application.orientationChangedEvent, handler as never);
          return () => {
            Application.off(Application.orientationChangedEvent, handler as never);
          };
        } catch {
          return () => {};
        }
      }
      return () => {};
    },
  };
}

/**
 * GlobalEvents service bridging NativeScript app resume/suspend to window
 * `focus` / `blur` subscriptions.
 */
export function makeNativeGlobalEvents(): HtmlSubscription.GlobalEvents {
  return {
    listen(target, event, _options, listener) {
      if (target === 'window' && event === 'focus') {
        const handler = () => listener({ defaultPrevented: false }, () => {});
        try {
          Application.on(Application.resumeEvent, handler);
          return () => Application.off(Application.resumeEvent, handler);
        } catch {
          return () => {};
        }
      }
      if (target === 'window' && event === 'blur') {
        const handler = () => listener({ defaultPrevented: false }, () => {});
        try {
          Application.on(Application.suspendEvent, handler);
          return () => Application.off(Application.suspendEvent, handler);
        } catch {
          return () => {};
        }
      }
      return () => {};
    },
  };
}
