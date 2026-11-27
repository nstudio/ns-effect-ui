/**
 * NativeScript implementations of the platform Effect services (`Haptics`,
 * `DeviceInfo`, `AppLifecycle`, `Clipboard`) using direct iOS & Android native
 * APIs: zero third-party native plugins required.
 */
import { Application, Device, isAndroid, isIOS, Utils } from '@nativescript/core';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import {
  AppLifecycle,
  Clipboard,
  DeviceInfo,
  Haptics,
  type HapticStyle,
} from './index.ts';

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

export const DeviceInfoNativeLayer: Layer.Layer<DeviceInfo> = Layer.sync(DeviceInfo, () => ({
  info: {
    platform: (isIOS ? 'ios' : isAndroid ? 'android' : 'ios') as 'ios' | 'android',
    host: 'mason' as const,
    osVersion: `${Device.os} ${Device.osVersion}`,
    model: Device.model || (isIOS ? 'iPhone (MasonHost)' : 'Android (MasonHost)'),
    isNative: true,
  },
}));

export const AppLifecycleNativeLayer: Layer.Layer<AppLifecycle> = Layer.succeed(AppLifecycle, {
  appearance: Effect.sync(() =>
    Application.systemAppearance?.() === 'dark' ? 'dark' : 'light',
  ),
  state: Effect.sync(() => (Application.inBackground ? 'background' : 'active')),
});

export const ClipboardNativeLayer: Layer.Layer<Clipboard> = Layer.succeed(Clipboard, {
  copy: (text) =>
    Effect.sync(() => {
      if (isIOS) {
        UIPasteboard.generalPasteboard.string = text;
      } else if (isAndroid) {
        const ctx = Utils.android.getApplicationContext();
        const mgr = ctx?.getSystemService(
          android.content.Context.CLIPBOARD_SERVICE,
        ) as android.content.ClipboardManager | null;
        mgr?.setPrimaryClip(android.content.ClipData.newPlainText('text', text));
      }
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
    return '';
  }),
});

/**
 * Combined NativeScript Layer providing `Haptics`, `DeviceInfo`, `AppLifecycle`,
 * and `Clipboard` using direct iOS & Android APIs.
 */
export const NativePlatformLayer: Layer.Layer<
  Haptics | DeviceInfo | AppLifecycle | Clipboard
> = Layer.mergeAll(
  HapticsNativeLayer,
  DeviceInfoNativeLayer,
  AppLifecycleNativeLayer,
  ClipboardNativeLayer,
);
