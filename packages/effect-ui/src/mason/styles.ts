/**
 * Attribute, property, and inline style application for MasonKit / NativeScript views.
 */
import type { View as NSView } from '@nativescript/core';

type MutableView = Record<string, unknown> & {
  className: string;
  id: string;
  visibility: string;
  isEnabled: boolean;
  style?: Record<string, unknown>;
  addSinglePseudoClass?: (name: string) => void;
  deleteSinglePseudoClass?: (name: string) => void;
  _onCssStateChange?: () => void;
};

const hiddenDisplayCache = new WeakMap<MutableView, unknown>();

const kebabToCamel = (name: string): string =>
  name.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());

/**
 * Parses a CSS inline style string (`"color: red; gap: 12px"`) into a map of
 * property name -> raw value. Respects parentheses (e.g. `rgba(...)`, `var(...)`).
 */
export function parseInlineStyle(css: string): Map<string, string> {
  const out = new Map<string, string>();
  let start = 0;
  let depth = 0;
  for (let i = 0; i <= css.length; i++) {
    const ch = css[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if ((ch === ';' && depth === 0) || i === css.length) {
      const decl = css.slice(start, i).trim();
      start = i + 1;
      if (!decl) continue;
      const colon = decl.indexOf(':');
      if (colon <= 0) continue;
      const prop = decl.slice(0, colon).trim();
      const val = decl.slice(colon + 1).trim();
      if (prop) out.set(prop, val);
    }
  }
  return out;
}

/**
 * Normalizes a CSS length value from web inline style syntax for MasonKit.
 * Leaves CSS variables, percentages, keywords, and `calc(...)` intact; converts
 * simple `Npx` values to DIP numbers for NativeScript style setters that expect DIPs.
 */
function normalizeInlineStyleValue(prop: string, value: string): unknown {
  if (prop.startsWith('--')) return value;
  const trimmed = value.trim();
  if (/^-?\d+(?:\.\d+)?px$/.test(trimmed)) {
    return Number.parseFloat(trimmed);
  }
  return trimmed;
}

function applyInlineStyle(
  view: MutableView,
  value: string | undefined,
  previous: string | undefined,
): void {
  const style = view.style;
  if (!style) return;

  const prevMap = previous ? parseInlineStyle(previous) : undefined;
  const nextMap = value ? parseInlineStyle(value) : undefined;

  if (prevMap) {
    for (const prop of prevMap.keys()) {
      if (!nextMap?.has(prop)) {
        const key = prop.startsWith('--') ? prop : kebabToCamel(prop);
        try {
          if (prop.startsWith('--') && typeof style['setProperty'] === 'function') {
            (style['setProperty'] as (k: string, v: unknown) => void)(prop, '');
          } else {
            style[key] = undefined;
          }
        } catch {
          // Ignore unsupported inline property resets.
        }
      }
    }
  }

  if (nextMap) {
    for (const [prop, val] of nextMap) {
      const key = prop.startsWith('--') ? prop : kebabToCamel(prop);
      try {
        if (prop.startsWith('--') && typeof style['setProperty'] === 'function') {
          (style['setProperty'] as (k: string, v: unknown) => void)(prop, val);
        } else {
          style[key] = normalizeInlineStyleValue(prop, val);
        }
      } catch {
        // Ignore unsupported CSS properties gracefully (per-declaration recovery).
      }
    }
  }
}

function setDisabledState(view: MutableView, disabled: boolean): void {
  view.isEnabled = !disabled;
  view['disabled'] = disabled ? '' : undefined;
  if (disabled) {
    view.addSinglePseudoClass?.('disabled');
  } else {
    view.deleteSinglePseudoClass?.('disabled');
  }
  view._onCssStateChange?.();
}

function setHiddenState(view: MutableView, hidden: boolean): void {
  const style = view.style;
  if (hidden) {
    if (style && !hiddenDisplayCache.has(view)) {
      hiddenDisplayCache.set(view, style['display']);
    }
    view.visibility = 'collapse';
    if (style) {
      try {
        style['display'] = 'none';
      } catch {
        // Core views without MasonKit display rely on visibility: collapse.
      }
    }
  } else {
    view.visibility = 'visible';
    if (style && hiddenDisplayCache.has(view)) {
      const prev = hiddenDisplayCache.get(view);
      hiddenDisplayCache.delete(view);
      try {
        style['display'] = prev ?? 'flex';
      } catch {
        // Ignore on core views.
      }
    }
  }
  view['hidden'] = hidden ? '' : undefined;
  view._onCssStateChange?.();
}

/**
 * Applies an HTML attribute mutation (`Renderer.Host.setAttr`) to a MasonKit view.
 */
export function applyAttr(
  rawView: NSView,
  name: string,
  value: string | undefined,
  previous?: string | undefined,
): void {
  const view = rawView as unknown as MutableView;
  const lower = name.toLowerCase();

  switch (lower) {
    case 'class': {
      view.className = value ?? '';
      return;
    }
    case 'id': {
      view.id = value ?? '';
      return;
    }
    case 'style': {
      applyInlineStyle(view, value, previous);
      return;
    }
    case 'hidden': {
      setHiddenState(view, value !== undefined);
      return;
    }
    case 'disabled': {
      setDisabledState(view, value !== undefined);
      return;
    }
    case 'placeholder': {
      view['placeholder'] = value ?? '';
      if ('hint' in view) view['hint'] = value ?? '';
      return;
    }
    case 'type': {
      view['type'] = value ?? 'text';
      return;
    }
    case 'src': {
      view['src'] = value ?? '';
      return;
    }
    case 'href': {
      view['href'] = value ?? '';
      return;
    }
    case 'name': {
      view['name'] = value ?? '';
      return;
    }
    case 'aria-label': {
      view['aria-label'] = value;
      view['accessibilityLabel'] = value ?? '';
      view._onCssStateChange?.();
      return;
    }
    case 'aria-hidden': {
      view['aria-hidden'] = value;
      view['accessibilityHidden'] = value === 'true';
      view._onCssStateChange?.();
      return;
    }
    default: {
      // Store data-*, aria-*, role, min, max, step, etc. directly on the view
      // and notify NativeScript CSS so `[data-checked]`, `[aria-selected="true"]`,
      // `[data-state="active"]` attribute selectors immediately re-evaluate.
      view[name] = value;
      if (lower !== name) view[lower] = value;
      if (
        lower.startsWith('data-') ||
        lower.startsWith('aria-') ||
        lower === 'role' ||
        lower === 'open'
      ) {
        view._onCssStateChange?.();
      }
      return;
    }
  }
}

/**
 * Applies an HTML DOM property mutation (`Renderer.Host.setProp`) to a MasonKit view.
 * Controlled properties (`value`, `checked`, `open`) are handled by `MasonHost`
 * with echo suppression before falling through here.
 */
export function applyNonControlledProp(
  rawView: NSView,
  name: string,
  value: unknown,
): void {
  const view = rawView as unknown as MutableView;
  switch (name) {
    case 'disabled': {
      setDisabledState(view, Boolean(value));
      return;
    }
    case 'hidden': {
      setHiddenState(view, Boolean(value));
      return;
    }
    case 'textContent': {
      view['textContent'] = value == null ? '' : String(value);
      return;
    }
    case 'indeterminate': {
      view['indeterminate'] = Boolean(value);
      view._onCssStateChange?.();
      return;
    }
    case 'readOnly': {
      view['readOnly'] = Boolean(value);
      if ('editable' in view) view['editable'] = !value;
      return;
    }
    default: {
      try {
        view[name] = value;
      } catch {
        // Ignore read-only properties on native wrappers.
      }
    }
  }
}
