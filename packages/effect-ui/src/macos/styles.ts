/**
 * Pure TypeScript Tailwind v4 + Effect Pulse semantic style resolver for
 * `MacosHost` (AppKit). Mirrors `packages/shared-app/src/tokens.css` and
 * `styles.css` in crisp black-and-white monochrome (light & dark mode).
 */

export interface RgbaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface ComputedBoxStyle {
  display: 'flex' | 'grid' | 'block' | 'none';
  flexDirection: 'column' | 'row';
  gridCols: number;
  alignItems: 'stretch' | 'center' | 'flex-start' | 'flex-end';
  justifyContent: 'flex-start' | 'center' | 'flex-end' | 'space-between';
  flexGrow: number;
  gap: number;
  padTop: number;
  padRight: number;
  padBottom: number;
  padLeft: number;
  marginTop: number;
  marginBottom: number;
  width?: number | undefined;
  height?: number | undefined;
  fullWidth: boolean;
  backgroundColor?: RgbaColor | undefined;
  borderColor?: RgbaColor | undefined;
  borderWidth: number;
  borderRadius: number;
  color: RgbaColor;
  fontSize: number;
  fontWeight: 'regular' | 'medium' | 'semibold' | 'bold';
  textAlign: 'left' | 'center' | 'right';
  strikethrough: boolean;
}

export function hex(code: string, alpha = 1): RgbaColor {
  const clean = code.replace('#', '');
  const n = Number.parseInt(clean, 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
    a: alpha,
  };
}

export interface ThemePalette {
  readonly background: RgbaColor;
  readonly foreground: RgbaColor;
  readonly card: RgbaColor;
  readonly primary: RgbaColor;
  readonly primaryForeground: RgbaColor;
  readonly secondary: RgbaColor;
  readonly secondaryForeground: RgbaColor;
  readonly mutedForeground: RgbaColor;
  readonly border: RgbaColor;
  readonly input: RgbaColor;
  readonly heroBg: RgbaColor;
  readonly heroBorder: RgbaColor;
  readonly heroFg: RgbaColor;
  readonly heroSub: RgbaColor;
  readonly heroPillBg: RgbaColor;
  readonly heroPillFg: RgbaColor;
}

export const lightPalette: ThemePalette = {
  background: hex('#ffffff'),
  foreground: hex('#09090b'),
  card: hex('#fafafa'),
  primary: hex('#09090b'),
  primaryForeground: hex('#ffffff'),
  secondary: hex('#f4f4f5'),
  secondaryForeground: hex('#18181b'),
  mutedForeground: hex('#71717a'),
  border: hex('#e4e4e7'),
  input: hex('#d4d4d8'),
  heroBg: hex('#09090b'),
  heroBorder: hex('#27272a'),
  heroFg: hex('#ffffff'),
  heroSub: hex('#a1a1aa'),
  heroPillBg: hex('#ffffff', 0.14),
  heroPillFg: hex('#fafafa'),
};

export const darkPalette: ThemePalette = {
  background: hex('#000000'),
  foreground: hex('#fafafa'),
  card: hex('#0c0c0e'),
  primary: hex('#fafafa'),
  primaryForeground: hex('#09090b'),
  secondary: hex('#18181b'),
  secondaryForeground: hex('#fafafa'),
  mutedForeground: hex('#a1a1aa'),
  border: hex('#27272a'),
  input: hex('#3f3f46'),
  heroBg: hex('#111113'),
  heroBorder: hex('#27272a'),
  heroFg: hex('#fafafa'),
  heroSub: hex('#a1a1aa'),
  heroPillBg: hex('#ffffff', 0.14),
  heroPillFg: hex('#fafafa'),
};

const spacingScale = (token: string): number | undefined => {
  const n = Number.parseFloat(token);
  if (!Number.isFinite(n)) return undefined;
  return n * 4;
};

/**
 * Resolves Tailwind classes + HTML tag defaults + semantic `ep-*` classes +
 * attribute selectors (`data-active`, `data-done`, `data-checked`, `data-selected`)
 * into a flat `ComputedBoxStyle` ready for AppKit layout and drawing.
 */
export function resolveMacosStyle(
  tag: string,
  className: string,
  attrs: Readonly<Record<string, string | undefined>>,
  inheritedColor: RgbaColor,
  dark: boolean,
): ComputedBoxStyle {
  const pal = dark ? darkPalette : lightPalette;

  const isInlineText = tag === 'span' || tag === 'p' || tag === 'h1' || tag === 'h2' || tag === 'label';
  const style: ComputedBoxStyle = {
    display: 'flex',
    flexDirection: tag === 'button' ? 'row' : 'column',
    gridCols: 1,
    alignItems: tag === 'button' ? 'center' : 'stretch',
    justifyContent: tag === 'button' ? 'center' : 'flex-start',
    flexGrow: 0,
    gap: 0,
    padTop: 0,
    padRight: 0,
    padBottom: 0,
    padLeft: 0,
    marginTop: 0,
    marginBottom: 0,
    width: undefined,
    height: undefined,
    fullWidth: tag === 'main' || tag === 'section' || tag === 'form',
    backgroundColor: undefined,
    borderColor: undefined,
    borderWidth: 0,
    borderRadius: 0,
    color: inheritedColor,
    fontSize: tag === 'h1' ? 24 : tag === 'h2' ? 16 : 14,
    fontWeight: tag === 'h1' || tag === 'h2' ? 'bold' : 'regular',
    textAlign: tag === 'button' ? 'center' : 'left',
    strikethrough: false,
  };

  if (tag === 'input') {
    style.height = 38;
    style.fullWidth = true;
    style.padLeft = 10;
    style.padRight = 10;
    style.borderWidth = 1;
    style.borderColor = pal.border;
    style.borderRadius = 10;
    style.backgroundColor = pal.background;
    style.color = pal.foreground;
  }

  if (attrs['hidden'] !== undefined) {
    style.display = 'none';
  }

  const classes = className.split(/\s+/).filter(Boolean);

  for (const cls of classes) {
    // Layout
    if (cls === 'flex') style.display = 'flex';
    else if (cls === 'flex-col') style.flexDirection = 'column';
    else if (cls === 'flex-row') {
      style.flexDirection = 'row';
      if (style.alignItems === 'stretch') style.alignItems = 'center';
    } else if (cls === 'grid') style.display = 'grid';
    else if (cls.startsWith('grid-cols-')) {
      const cols = Number.parseInt(cls.slice('grid-cols-'.length), 10);
      if (cols > 0) {
        style.display = 'grid';
        style.gridCols = cols;
      }
    } else if (cls === 'items-center') style.alignItems = 'center';
    else if (cls === 'items-start') style.alignItems = 'flex-start';
    else if (cls === 'items-end') style.alignItems = 'flex-end';
    else if (cls === 'justify-between') style.justifyContent = 'space-between';
    else if (cls === 'justify-center') {
      style.justifyContent = 'center';
      style.textAlign = 'center';
    }
    else if (cls === 'justify-end') style.justifyContent = 'flex-end';
    else if (cls === 'flex-1') style.flexGrow = 1;
    else if (cls === 'w-full') style.fullWidth = true;
    // Fixed width/height
    else if (cls.startsWith('w-')) {
      const v = spacingScale(cls.slice(2));
      if (v !== undefined) style.width = v;
    } else if (cls.startsWith('h-')) {
      const v = spacingScale(cls.slice(2));
      if (v !== undefined) style.height = v;
    }
    // Gap
    else if (cls.startsWith('gap-')) {
      const v = spacingScale(cls.slice(4));
      if (v !== undefined) style.gap = v;
    }
    // Padding
    else if (cls.startsWith('p-')) {
      const v = spacingScale(cls.slice(2));
      if (v !== undefined) {
        style.padTop = style.padRight = style.padBottom = style.padLeft = v;
      }
    } else if (cls.startsWith('px-')) {
      const v = spacingScale(cls.slice(3));
      if (v !== undefined) {
        style.padLeft = style.padRight = v;
      }
    } else if (cls.startsWith('py-')) {
      const v = spacingScale(cls.slice(3));
      if (v !== undefined) {
        style.padTop = style.padBottom = v;
      }
    } else if (cls.startsWith('pb-')) {
      const v = spacingScale(cls.slice(3));
      if (v !== undefined) style.padBottom = Math.min(v, 32);
    } else if (cls.startsWith('mb-')) {
      const v = spacingScale(cls.slice(3));
      if (v !== undefined) style.marginBottom = v;
    } else if (cls.startsWith('mt-')) {
      const v = spacingScale(cls.slice(3));
      if (v !== undefined) style.marginTop = v;
    }
    // Radius
    else if (cls === 'rounded-full') style.borderRadius = 999;
    else if (cls === 'rounded-2xl') style.borderRadius = 16;
    else if (cls === 'rounded-xl') style.borderRadius = 12;
    else if (cls === 'rounded-lg') style.borderRadius = 8;
    // Border
    else if (cls === 'border') style.borderWidth = 1;
    else if (cls === 'border-2') style.borderWidth = 2;
    else if (cls === 'border-border') style.borderColor = pal.border;
    // Surfaces
    else if (cls === 'bg-background') style.backgroundColor = pal.background;
    else if (cls === 'bg-card') style.backgroundColor = pal.card;
    else if (cls === 'bg-primary') style.backgroundColor = pal.primary;
    else if (cls === 'bg-secondary') style.backgroundColor = pal.secondary;
    // Text colors
    else if (cls === 'text-foreground' || cls === 'text-card-foreground') style.color = pal.foreground;
    else if (cls === 'text-primary-foreground') style.color = pal.primaryForeground;
    else if (cls === 'text-secondary-foreground') style.color = pal.secondaryForeground;
    else if (cls === 'text-muted-foreground') style.color = pal.mutedForeground;
    else if (cls === 'text-brand' || cls === 'text-primary') style.color = pal.primary;
    // Typography
    else if (cls === 'text-xs') style.fontSize = 12;
    else if (cls === 'text-sm') style.fontSize = 14;
    else if (cls === 'text-base') style.fontSize = 15;
    else if (cls === 'text-lg') style.fontSize = 18;
    else if (cls === 'text-2xl') style.fontSize = 24;
    else if (cls === 'font-medium') style.fontWeight = 'medium';
    else if (cls === 'font-semibold') style.fontWeight = 'semibold';
    else if (cls === 'font-bold') style.fontWeight = 'bold';
    else if (cls === 'text-left') {
      style.textAlign = 'left';
      if (tag === 'button') style.justifyContent = 'flex-start';
    } else if (cls === 'text-center') style.textAlign = 'center';
    // Semantic Effect Pulse monochrome classes
    else if (cls === 'ep-hero-banner') {
      style.backgroundColor = pal.heroBg;
      style.borderColor = pal.heroBorder;
      style.borderWidth = 1;
      style.color = pal.heroFg;
    } else if (cls === 'ep-hero-subtitle') {
      style.color = pal.heroSub;
    } else if (cls === 'ep-hero-pill') {
      style.backgroundColor = pal.heroPillBg;
      style.color = pal.heroPillFg;
    } else if (cls === 'ep-filter-btn') {
      if (attrs['data-active'] === 'true') {
        style.backgroundColor = pal.primary;
        style.color = pal.primaryForeground;
      } else {
        style.backgroundColor = pal.secondary;
        style.color = pal.mutedForeground;
      }
    } else if (cls === 'ep-priority-high') {
      style.backgroundColor = pal.primary;
      style.color = pal.primaryForeground;
    } else if (cls === 'ep-priority-normal') {
      style.backgroundColor = pal.secondary;
      style.color = pal.foreground;
    } else if (cls === 'ep-priority-low') {
      style.backgroundColor = pal.secondary;
      style.color = pal.mutedForeground;
    } else if (cls === 'ep-check-circle') {
      style.textAlign = 'center';
      if (attrs['data-done'] === 'true') {
        style.backgroundColor = pal.primary;
        style.borderColor = pal.primary;
        style.color = pal.primaryForeground;
      } else {
        style.borderColor = pal.input;
      }
    } else if (cls === 'ep-task-title') {
      if (attrs['data-done'] === 'true') {
        style.color = pal.mutedForeground;
        style.strikethrough = true;
      }
    } else if (cls === 'ep-switch-track') {
      style.display = 'flex';
      style.flexDirection = 'row';
      style.alignItems = 'center';
      if (attrs['data-checked'] !== undefined) {
        style.justifyContent = 'flex-end';
        style.backgroundColor = pal.primary;
      } else {
        style.justifyContent = 'flex-start';
        style.backgroundColor = pal.input;
      }
    } else if (cls === 'ep-switch-thumb') {
      style.backgroundColor = pal.primaryForeground;
    } else if (cls === 'ep-priority-pick') {
      if (attrs['data-selected'] === 'true') {
        style.backgroundColor = pal.primary;
        style.color = pal.primaryForeground;
        style.borderColor = pal.primary;
      } else {
        style.backgroundColor = pal.secondary;
        style.color = pal.secondaryForeground;
        style.borderColor = pal.border;
      }
    } else if (cls === 'ep-dot-live') {
      style.backgroundColor = pal.primary;
    }
  }

  // Ensure semantic state overrides win over base utility classes regardless of order.
  if (classes.includes('ep-task-title') && attrs['data-done'] === 'true') {
    style.color = pal.mutedForeground;
    style.strikethrough = true;
  }

  // Inline labels/pills shouldn't stretch to full width unless explicitly requested.
  if (isInlineText && !classes.includes('w-full') && style.flexGrow === 0) {
    style.fullWidth = false;
  }

  return style;
}
