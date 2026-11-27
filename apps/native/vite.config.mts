import { typescriptConfig } from '@nativescript/vite/typescript';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { defineConfig, mergeConfig, type UserConfig } from 'vite';

const require = createRequire(import.meta.url);
const appDir = import.meta.dirname;
const workspaceRoot = resolve(appDir, '../..');
const appPkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
const rootPkg = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8'));
const appDeps = Object.keys(appPkg.dependencies ?? {});
const rootDeps = Object.keys(rootPkg.dependencies ?? {});

// Exclude any root-only packages (e.g. vitest/happy-dom) from NativeScript vendor pre-bundling.
process.env['NS_VENDOR_EXCLUDE'] = rootDeps.filter((dep) => !appDeps.includes(dep)).join(',');

/**
 * MasonKit natively supports modern CSS Grid, Flexbox, `gap`, positioning, and
 * overflow via Rust/Taffy. `@nativescript/tailwind@4.0.10` strips those
 * declarations by default; we stash them into custom properties before
 * `@nativescript/tailwind` runs and restore them right after with DIP units —
 * zero `node_modules` patches required.
 */
const MASON_PROPS = new Set([
  'display',
  'gap',
  'row-gap',
  'column-gap',
  'grid-template-columns',
  'grid-template-rows',
  'grid-column',
  'grid-row',
  'grid-auto-flow',
  'grid-auto-columns',
  'grid-auto-rows',
  'flex-basis',
  'max-width',
  'max-height',
  'overflow',
  'overflow-x',
  'overflow-y',
  'position',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'aspect-ratio',
  'box-sizing',
]);

const PREFIX = '--ns-mason-preserve-';

function convertMasonValue(prop: string, raw: string): string {
  // Tailwind v4 emits `calc(var(--spacing) * N)` where `--spacing: 0.25rem` (= 4 DIPs).
  let val = raw.replace(/calc\(\s*var\(--spacing\)\s*\*\s*(-?[\d.]+)\s*\)/g, (_, n: string) =>
    String(Math.round(Number(n) * 4 * 100) / 100),
  );
  // Convert `Nrem` to DIPs (`N * 16`).
  val = val.replace(/(-?[\d.]+)rem\b/g, (_, n: string) =>
    String(Math.round(Number(n) * 16 * 100) / 100),
  );
  // Tailwind v4 emits `repeat(N, minmax(0, 1fr))` -> MasonKit/Taffy accepts `repeat(N, 1fr)` or `1fr 1fr 1fr`.
  if (prop === 'grid-template-columns' || prop === 'grid-template-rows') {
    val = val.replace(/repeat\(\s*(\d+)\s*,\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*\)/g, (_, count: string) =>
      Array.from({ length: Number(count) }, () => '1fr').join(' '),
    );
  }
  return val;
}

function makeMasonPostcssPlugins() {
  const tailwindcssPostcss = require('@tailwindcss/postcss');
  const nsTailwind = require('@nativescript/tailwind');
  const postcssPresetEnv = require('postcss-preset-env');

  const stashMasonProps = {
    postcssPlugin: 'ns-mason-stash',
    Once(root: { walkDecls: (fn: (decl: { prop: string; value: string; remove: () => void }) => void) => void }) {
      root.walkDecls((decl) => {
        if (MASON_PROPS.has(decl.prop)) {
          decl.prop = `${PREFIX}${decl.prop}`;
        }
        // Remove Tailwind's browser-only `line-height` from `text-*` utilities so
        // NativeScript's additive line-height semantics don't inflate wrapped labels.
        if (decl.prop === 'line-height' && decl.value.includes('var(--tw-leading')) {
          decl.remove();
        }
      });
    },
  };

  const restoreMasonProps = {
    postcssPlugin: 'ns-mason-restore',
    OnceExit(root: { walkDecls: (fn: (decl: { prop: string; value: string }) => void) => void }) {
      root.walkDecls((decl) => {
        if (decl.prop.startsWith(PREFIX)) {
          const original = decl.prop.slice(PREFIX.length);
          decl.prop = original;
          decl.value = convertMasonValue(original, decl.value);
        }
      });
    },
  };

  return [
    postcssPresetEnv(),
    tailwindcssPostcss({ optimize: false }),
    stashMasonProps,
    nsTailwind,
    restoreMasonProps,
  ];
}

export default defineConfig(({ mode }): UserConfig => {
  const base = typescriptConfig({ mode });
  return mergeConfig(base, {
    define: {
      __WINDOWS__: false,
      __LINUX__: false,
    },
    plugins: [
      {
        name: 'ns-mason-postcss',
        enforce: 'post',
        config(cfg) {
          // Runs after `@nativescript/vite`'s `externalConfigsPlugin` (normal
          // phase) and replaces PostCSS before Vite caches CSS options.
          cfg.css = {
            ...cfg.css,
            postcss: {
              plugins: makeMasonPostcssPlugins(),
            },
          };
        },
      },
    ],
    resolve: {
      dedupe: ['@nativescript/core', '@triniwiz/nativescript-masonkit', 'effect', '@effect/ui'],
    },
    server: {
      fs: {
        allow: [workspaceRoot],
      },
    },
    build: {
      rolldownOptions: {
        output: {
          keepNames: true,
        },
      },
    },
  });
});
