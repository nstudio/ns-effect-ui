/**
 * Native macOS AppKit Effect platform Layers powered by
 * `@nativescript/macos-node-api` (zero native plugins, zero Xcode build).
 *
 * Provides `Haptics` (MacBook Force Touch `NSHapticFeedbackManager`),
 * `DeviceInfo` (`NSProcessInfo`), `AppLifecycle` (`NSApp.effectiveAppearance`),
 * and `Clipboard` (`NSPasteboard.generalPasteboard`).
 */
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import {
  AppLifecycle,
  Clipboard,
  DeviceInfo,
  Haptics,
  type HapticStyle,
} from '../platform/index.ts';

function macosGlobal<T = any>(name: string): T | undefined {
  return (globalThis as unknown as Record<string, T | undefined>)[name];
}

function triggerMacosHaptic(style: HapticStyle): void {
  try {
    const Mgr = macosGlobal<any>('NSHapticFeedbackManager');
    const performer = Mgr?.defaultPerformer;
    if (!performer) return;
    // NSHapticFeedbackPattern: Generic=0, Alignment=1, LevelChange=2
    // NSHapticFeedbackPerformanceTime: Default=0, Now=1
    const pattern = style === 'tick' ? 1 : style === 'thud' || style === 'error' ? 2 : 0;
    performer.performFeedbackPatternPerformanceTime(pattern, 1);
  } catch {
    // Ignore on Macs without Force Touch trackpad.
  }
}

export const HapticsMacosLayer: Layer.Layer<Haptics> = Layer.succeed(
  Haptics,
  Haptics.make((style) => Effect.sync(() => triggerMacosHaptic(style))),
);

export const DeviceInfoMacosLayer: Layer.Layer<DeviceInfo> = Layer.sync(DeviceInfo, () => {
  let osVersion = 'macOS';
  try {
    const PI = macosGlobal<any>('NSProcessInfo');
    const raw = String(PI?.processInfo?.operatingSystemVersionString ?? '');
    const match = raw.match(/Version\s+([\d.]+)/);
    osVersion = match ? `macOS ${match[1]}` : raw || 'macOS';
  } catch {
    // Fallback
  }
  return {
    info: {
      platform: 'macos' as const,
      host: 'macos' as const,
      osVersion,
      model: 'Mac (AppKit)',
      isNative: true,
    },
  };
});

export const AppLifecycleMacosLayer: Layer.Layer<AppLifecycle> = Layer.succeed(AppLifecycle, {
  appearance: Effect.sync(() => {
    try {
      const app = macosGlobal<any>('NSApp') ?? macosGlobal<any>('NSApplication')?.sharedApplication;
      const name = String(app?.effectiveAppearance?.name ?? '');
      return name.toLowerCase().includes('dark') ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }),
  state: Effect.sync(() => {
    try {
      const app = macosGlobal<any>('NSApp') ?? macosGlobal<any>('NSApplication')?.sharedApplication;
      return app?.isActive ? 'active' : 'background';
    } catch {
      return 'active';
    }
  }),
});

export const ClipboardMacosLayer: Layer.Layer<Clipboard> = Layer.succeed(Clipboard, {
  copy: (text) =>
    Effect.sync(() => {
      try {
        const PB = macosGlobal<any>('NSPasteboard');
        const pb = PB?.generalPasteboard;
        if (!pb) return;
        pb.clearContents();
        pb.setStringForType(text, 'public.utf8-plain-text');
      } catch {
        // Ignore
      }
    }),
  read: Effect.sync(() => {
    try {
      const PB = macosGlobal<any>('NSPasteboard');
      const pb = PB?.generalPasteboard;
      return String(pb?.stringForType?.('public.utf8-plain-text') ?? '');
    } catch {
      return '';
    }
  }),
});

/**
 * Combined macOS AppKit Layer providing `Haptics`, `DeviceInfo`, `AppLifecycle`,
 * and `Clipboard` via direct Objective-C AppKit calls.
 */
export const MacosPlatformLayer: Layer.Layer<
  Haptics | DeviceInfo | AppLifecycle | Clipboard
> = Layer.mergeAll(
  HapticsMacosLayer,
  DeviceInfoMacosLayer,
  AppLifecycleMacosLayer,
  ClipboardMacosLayer,
);
