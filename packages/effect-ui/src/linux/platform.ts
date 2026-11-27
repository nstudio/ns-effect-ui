/**
 * Native Linux GTK4 Effect platform Layers powered by `@nativescript/linux`
 * (V8 runtime) or `@nativescript/linux-napi` (Node-API GTK4 / GLib addon for
 * Node, Bun, and Deno).
 *
 * Provides `Haptics`, `DeviceInfo` (`/etc/os-release` + DMI), `AppLifecycle`
 * (`GTK_THEME` / GTK4 dark-theme preference), and `Clipboard` (GTK4
 * `gdk_display_get_clipboard` / `gdk_clipboard_set_text`).
 */
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import {
  AppLifecycle,
  Clipboard,
  DeviceInfo,
  Haptics,
  type HapticStyle,
} from '../platform/index.js';

let activeGtkModule: Record<string, any> | undefined;

/**
 * Registers a loaded `@nativescript/linux-napi` module so `LinuxPlatformLayer`
 * can call GTK4 / GDK C functions even when they are not installed on `globalThis`.
 */
export function setLinuxNativeModule(mod: Record<string, any> | undefined): void {
  activeGtkModule = mod;
}

function linuxFn<T = any>(name: string): T | undefined {
  if (activeGtkModule && name in activeGtkModule) {
    return activeGtkModule[name] as T;
  }
  return (globalThis as unknown as Record<string, T | undefined>)[name];
}

function readProcOrEtcFile(path: string): string | undefined {
  try {
    const req = (globalThis as unknown as { require?: (id: string) => any }).require;
    if (req) {
      const fs = req('node:fs');
      if (fs?.existsSync?.(path)) {
        return String(fs.readFileSync(path, 'utf8'));
      }
    }
  } catch {
    // Ignore when running inside V8 without Node fs.
  }
  return undefined;
}

function parseOsRelease(): Record<string, string> {
  const raw = readProcOrEtcFile('/etc/os-release') ?? '';
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (match?.[1] && match[2] !== undefined) {
      out[match[1]] = match[2].replace(/^"|"$/g, '');
    }
  }
  return out;
}

function readLinuxDeviceInfo(): { readonly osVersion: string; readonly model: string } {
  const release = parseOsRelease();
  const pretty = release['PRETTY_NAME'];
  const versionId = release['VERSION_ID'];
  const dmiModel = readProcOrEtcFile('/sys/class/dmi/id/product_name')?.trim();
  return {
    osVersion: pretty || (versionId ? `Linux ${versionId}` : 'Linux'),
    model: dmiModel || 'Linux PC (GTK4)',
  };
}

function detectLinuxDarkMode(): boolean {
  try {
    const env = typeof process !== 'undefined' ? process.env : undefined;
    const gtkTheme = env?.['GTK_THEME'] ?? '';
    if (gtkTheme.toLowerCase().includes('dark')) return true;
  } catch {
    // Ignore
  }
  return false;
}

let fallbackClipboard = '';

export const HapticsLinuxLayer: Layer.Layer<Haptics> = Layer.succeed(
  Haptics,
  Haptics.make((_style: HapticStyle) =>
    Effect.sync(() => {
      // Desktop Linux does not expose a standard haptic motor API.
    }),
  ),
);

export const DeviceInfoLinuxLayer: Layer.Layer<DeviceInfo> = Layer.sync(DeviceInfo, () => {
  const { osVersion, model } = readLinuxDeviceInfo();
  return {
    info: {
      platform: 'linux' as const,
      host: 'linux' as const,
      osVersion,
      model,
      isNative: true,
    },
  };
});

export const AppLifecycleLinuxLayer: Layer.Layer<AppLifecycle> = Layer.succeed(AppLifecycle, {
  appearance: Effect.sync(() => (detectLinuxDarkMode() ? 'dark' : 'light')),
  state: Effect.succeed('active' as const),
});

export const ClipboardLinuxLayer: Layer.Layer<Clipboard> = Layer.succeed(Clipboard, {
  copy: (text) =>
    Effect.sync(() => {
      fallbackClipboard = text;
      try {
        const getDisplay = linuxFn<() => any>('gdk_display_get_default');
        const getClipboard = linuxFn<(display: any) => any>('gdk_display_get_clipboard');
        const setText = linuxFn<(clipboard: any, value: string) => void>('gdk_clipboard_set_text');
        const display = getDisplay?.();
        const clipboard = display ? getClipboard?.(display) : null;
        if (clipboard && setText) {
          setText(clipboard, text);
        }
      } catch {
        // Ignore when no Wayland/X11 display is attached.
      }
    }),
  read: Effect.sync(() => fallbackClipboard),
});

/**
 * Combined Linux GTK4 Layer providing `Haptics`, `DeviceInfo`,
 * `AppLifecycle`, and `Clipboard`.
 */
export const LinuxPlatformLayer: Layer.Layer<
  Haptics | DeviceInfo | AppLifecycle | Clipboard
> = Layer.mergeAll(
  HapticsLinuxLayer,
  DeviceInfoLinuxLayer,
  AppLifecycleLinuxLayer,
  ClipboardLinuxLayer,
);
