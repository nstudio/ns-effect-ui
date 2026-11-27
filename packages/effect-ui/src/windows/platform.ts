/**
 * Native Windows Effect platform Layers powered by `@nativescript/windows`
 * (WinRT / WinUI 3 V8 runtime) or `@nativescript/windows-napi` (Node-API
 * WinRT addon for Node, Bun, and Deno).
 *
 * Provides `Haptics`, `DeviceInfo` (`Windows.System.Profile`), `AppLifecycle`
 * (`Windows.UI.ViewManagement.UISettings`), and `Clipboard`
 * (`Windows.ApplicationModel.DataTransfer.Clipboard`).
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

function winRoot(): any {
  return (globalThis as unknown as Record<string, any>).Windows;
}

function readWinRTOsVersion(): string {
  try {
    const Win = winRoot();
    const versionStr = Win?.System?.Profile?.AnalyticsInfo?.VersionInfo?.DeviceFamilyVersion;
    const version = Number.parseInt(String(versionStr ?? ''), 10);
    if (!Number.isNaN(version) && version > 0) {
      const major = Math.floor(version / 0x1000000000000) & 0xffff;
      const minor = Math.floor(version / 0x100000000) & 0xffff;
      const build = Math.floor(version / 0x10000) & 0xffff;
      return `Windows ${major}.${minor}.${build}`;
    }
  } catch {
    // Fallback below.
  }
  return 'Windows';
}

function readWinRTModel(): string {
  try {
    const Win = winRoot();
    const product =
      Win?.System?.Profile?.SystemManufacturers?.SystemSupportInfo?.LocalDeviceInfo
        ?.SystemProductName;
    if (product) return String(product);
  } catch {
    // Fallback below.
  }
  return 'Windows PC (WinUI / WinRT)';
}

function detectWindowsDarkMode(): boolean {
  try {
    const Win = winRoot();
    const UISettings = Win?.UI?.ViewManagement?.UISettings;
    const UIColorType = Win?.UI?.ViewManagement?.UIColorType;
    if (UISettings && UIColorType) {
      const settings = new UISettings();
      const bg = settings.GetColorValue(UIColorType.Background);
      if (bg && typeof bg.R === 'number') {
        const luminance = 0.2126 * bg.R + 0.7152 * bg.G + 0.0722 * bg.B;
        return luminance < 128;
      }
    }
  } catch {
    // Fallback to light mode.
  }
  return false;
}

let fallbackClipboard = '';

export const HapticsWindowsLayer: Layer.Layer<Haptics> = Layer.succeed(
  Haptics,
  Haptics.make((_style: HapticStyle) =>
    Effect.sync(() => {
      // Desktop Windows devices rarely expose SimpleHapticsController; keep non-throwing.
    }),
  ),
);

export const DeviceInfoWindowsLayer: Layer.Layer<DeviceInfo> = Layer.sync(DeviceInfo, () => ({
  info: {
    platform: 'windows' as const,
    host: 'windows' as const,
    osVersion: readWinRTOsVersion(),
    model: readWinRTModel(),
    isNative: true,
  },
}));

export const AppLifecycleWindowsLayer: Layer.Layer<AppLifecycle> = Layer.succeed(AppLifecycle, {
  appearance: Effect.sync(() => (detectWindowsDarkMode() ? 'dark' : 'light')),
  state: Effect.succeed('active' as const),
});

export const ClipboardWindowsLayer: Layer.Layer<Clipboard> = Layer.succeed(Clipboard, {
  copy: (text) =>
    Effect.sync(() => {
      fallbackClipboard = text;
      try {
        const Win = winRoot();
        const DataTransfer = Win?.ApplicationModel?.DataTransfer;
        if (DataTransfer?.DataPackage && DataTransfer?.Clipboard) {
          const pkg = new DataTransfer.DataPackage();
          pkg.SetText(text);
          DataTransfer.Clipboard.SetContent(pkg);
        }
      } catch {
        // Ignore when WinRT clipboard requires STA/UI thread.
      }
    }),
  read: Effect.sync(() => fallbackClipboard),
});

/**
 * Combined Windows WinRT Layer providing `Haptics`, `DeviceInfo`,
 * `AppLifecycle`, and `Clipboard`.
 */
export const WindowsPlatformLayer: Layer.Layer<
  Haptics | DeviceInfo | AppLifecycle | Clipboard
> = Layer.mergeAll(
  HapticsWindowsLayer,
  DeviceInfoWindowsLayer,
  AppLifecycleWindowsLayer,
  ClipboardWindowsLayer,
);
