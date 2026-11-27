/**
 * NativeScript implementations of the platform Effect services (`Haptics`,
 * `DeviceInfo`, `AppLifecycle`, `Clipboard`) using direct iOS, Android,
 * Windows (WinRT), and Linux (GTK4) native APIs with zero third-party plugins.
 */
import * as core from '@nativescript/core';
import { Application, Device, isAndroid, isIOS, Utils } from '@nativescript/core';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import {
  AppLifecycle,
  Clipboard,
  DeviceInfo,
  Haptics,
  type DeviceInfoData,
  type HapticStyle,
} from './index.js';

function g<T = any>(name: string): T | undefined {
  return (globalThis as unknown as Record<string, T | undefined>)[name];
}

function isWindowsPlatform(): boolean {
  return Boolean((core as unknown as { isWindows?: boolean }).isWindows || g('isWindows'));
}

function isLinuxPlatform(): boolean {
  return Boolean((core as unknown as { isLinux?: boolean }).isLinux || g('isLinux'));
}

function resolveNativePlatform(): DeviceInfoData['platform'] {
  if (isIOS) return 'ios';
  if (isAndroid) return 'android';
  if (isWindowsPlatform()) return 'windows';
  if (isLinuxPlatform()) return 'linux';
  return 'ios';
}

function defaultModelForPlatform(platform: DeviceInfoData['platform']): string {
  switch (platform) {
    case 'ios':
      return 'iPhone (MasonHost)';
    case 'android':
      return 'Android (MasonHost)';
    case 'windows':
      return 'Windows PC (MasonHost)';
    case 'linux':
      return 'Linux PC (MasonHost)';
    default:
      return 'NativeScript (MasonHost)';
  }
}

// Lazily instantiated iOS feedback generators (reused across calls).
let iosSelection: UISelectionFeedbackGenerator | null = null;
let iosLight: UIImpactFeedbackGenerator | null = null;
let iosMedium: UIImpactFeedbackGenerator | null = null;
let iosNotify: UINotificationFeedbackGenerator | null = null;

function androidVibrate(ms: number, amplitude = 80): void {
  try {
    const ctx = Utils.android.getApplicationContext();
    const vibrator = ctx?.getSystemService(
      android.content.Context.VIBRATOR_SERVICE,
    ) as android.os.Vibrator | null;
    if (vibrator?.hasVibrator()) {
      vibrator.vibrate(android.os.VibrationEffect.createOneShot(ms, amplitude));
    }
  } catch {
    // Ignore missing VIBRATE permission or emulator without vibrator.
  }
}

// Numeric constants for iOS UIKit feedback enums (avoids ambient const-enum access under isolatedModules/verbatimModuleSyntax).
const IOS_IMPACT_LIGHT = 0 as UIImpactFeedbackStyle;
const IOS_IMPACT_MEDIUM = 1 as UIImpactFeedbackStyle;
const IOS_NOTIFICATION_SUCCESS = 0 as UINotificationFeedbackType;
const IOS_NOTIFICATION_WARNING = 1 as UINotificationFeedbackType;
const IOS_NOTIFICATION_ERROR = 2 as UINotificationFeedbackType;

function triggerNativeHaptic(style: HapticStyle): void {
  try {
    if (isIOS) {
      switch (style) {
        case 'tick':
          (iosSelection ??= UISelectionFeedbackGenerator.new()).selectionChanged();
          return;
        case 'tap':
          (iosLight ??= UIImpactFeedbackGenerator.alloc().initWithStyle(
            IOS_IMPACT_LIGHT,
          )).impactOccurred();
          return;
        case 'thud':
          (iosMedium ??= UIImpactFeedbackGenerator.alloc().initWithStyle(
            IOS_IMPACT_MEDIUM,
          )).impactOccurred();
          return;
        case 'success':
          (iosNotify ??= UINotificationFeedbackGenerator.new()).notificationOccurred(
            IOS_NOTIFICATION_SUCCESS,
          );
          return;
        case 'warning':
          (iosNotify ??= UINotificationFeedbackGenerator.new()).notificationOccurred(
            IOS_NOTIFICATION_WARNING,
          );
          return;
        case 'error':
          (iosNotify ??= UINotificationFeedbackGenerator.new()).notificationOccurred(
            IOS_NOTIFICATION_ERROR,
          );
          return;
      }
    }
    if (isAndroid) {
      switch (style) {
        case 'tick':
          androidVibrate(8, 40);
          return;
        case 'tap':
          androidVibrate(12, 80);
          return;
        case 'thud':
          androidVibrate(24, 150);
          return;
        case 'success':
          androidVibrate(36, 200);
          return;
        case 'warning':
          androidVibrate(28, 170);
          return;
        case 'error':
          androidVibrate(50, 220);
          return;
      }
    }
  } catch {
    // Simulator / unavailable native haptic engine.
  }
}

export const HapticsNativeLayer: Layer.Layer<Haptics> = Layer.succeed(
  Haptics,
  Haptics.make((style) => Effect.sync(() => triggerNativeHaptic(style))),
);

export const DeviceInfoNativeLayer: Layer.Layer<DeviceInfo> = Layer.sync(DeviceInfo, () => {
  const platform = resolveNativePlatform();
  return {
    info: {
      platform,
      host: 'mason' as const,
      osVersion: `${Device.os} ${Device.osVersion}`,
      model: Device.model || defaultModelForPlatform(platform),
      isNative: true,
    },
  };
});

export const AppLifecycleNativeLayer: Layer.Layer<AppLifecycle> = Layer.succeed(AppLifecycle, {
  appearance: Effect.sync(() =>
    Application.systemAppearance?.() === 'dark' ? 'dark' : 'light',
  ),
  state: Effect.sync(() => (Application.inBackground ? 'background' : 'active')),
});

let lastDesktopClipboard = '';

export const ClipboardNativeLayer: Layer.Layer<Clipboard> = Layer.succeed(Clipboard, {
  copy: (text) =>
    Effect.sync(() => {
      if (isIOS) {
        UIPasteboard.generalPasteboard.string = text;
        return;
      }
      if (isAndroid) {
        const ctx = Utils.android.getApplicationContext();
        const mgr = ctx?.getSystemService(
          android.content.Context.CLIPBOARD_SERVICE,
        ) as android.content.ClipboardManager | null;
        mgr?.setPrimaryClip(android.content.ClipData.newPlainText('text', text));
        return;
      }
      if (isWindowsPlatform()) {
        try {
          const Win = g<any>('Windows');
          const DataTransfer = Win?.ApplicationModel?.DataTransfer;
          if (DataTransfer?.DataPackage && DataTransfer?.Clipboard) {
            const pkg = new DataTransfer.DataPackage();
            pkg.SetText(text);
            DataTransfer.Clipboard.SetContent(pkg);
            lastDesktopClipboard = text;
            return;
          }
        } catch {
          // Ignore unavailable WinRT clipboard.
        }
      }
      if (isLinuxPlatform()) {
        try {
          const getDisplay = g<() => any>('gdk_display_get_default');
          const getClipboard = g<(display: any) => any>('gdk_display_get_clipboard');
          const setText = g<(clipboard: any, value: string) => void>('gdk_clipboard_set_text');
          const display = getDisplay?.();
          const clipboard = display ? getClipboard?.(display) : null;
          if (clipboard && setText) {
            setText(clipboard, text);
            lastDesktopClipboard = text;
            return;
          }
        } catch {
          // Ignore unavailable GTK4 clipboard.
        }
      }
      lastDesktopClipboard = text;
    }),
  read: Effect.sync(() => {
    if (isIOS) {
      return UIPasteboard.generalPasteboard.string ?? '';
    }
    if (isAndroid) {
      const ctx = Utils.android.getApplicationContext();
      const mgr = ctx?.getSystemService(
        android.content.Context.CLIPBOARD_SERVICE,
      ) as android.content.ClipboardManager | null;
      const item = mgr?.getPrimaryClip()?.getItemAt(0);
      return item?.getText()?.toString() ?? '';
    }
    return lastDesktopClipboard;
  }),
});

/**
 * Combined NativeScript Layer providing `Haptics`, `DeviceInfo`, `AppLifecycle`,
 * and `Clipboard` using direct iOS, Android, Windows, and Linux native APIs.
 */
export const NativePlatformLayer: Layer.Layer<
  Haptics | DeviceInfo | AppLifecycle | Clipboard
> = Layer.mergeAll(
  HapticsNativeLayer,
  DeviceInfoNativeLayer,
  AppLifecycleNativeLayer,
  ClipboardNativeLayer,
);
