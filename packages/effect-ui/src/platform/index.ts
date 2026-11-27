/**
 * Host-agnostic Effect services for platform capabilities (`Haptics`,
 * `DeviceInfo`, `AppLifecycle`, `Clipboard`).
 *
 * This module has ZERO platform-specific imports, so shared Effect UI
 * components, web apps, and Node Vitest suites can import it safely.
 * NativeScript implementations live in `@nstudio/nativescript-effect-ui/platform/native`.
 */
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

// ---------------------------------------------------------------------------
// Haptics
// ---------------------------------------------------------------------------

export type HapticStyle = 'tick' | 'tap' | 'thud' | 'success' | 'warning' | 'error';

export class Haptics extends Context.Service<
  Haptics,
  {
    readonly trigger: (style: HapticStyle) => Effect.Effect<void>;
    readonly tick: Effect.Effect<void>;
    readonly tap: Effect.Effect<void>;
    readonly thud: Effect.Effect<void>;
    readonly success: Effect.Effect<void>;
    readonly warning: Effect.Effect<void>;
    readonly error: Effect.Effect<void>;
  }
>()('@nstudio/nativescript-effect-ui/platform/Haptics') {
  static make(trigger: (style: HapticStyle) => Effect.Effect<void>) {
    return {
      trigger,
      tick: trigger('tick'),
      tap: trigger('tap'),
      thud: trigger('thud'),
      success: trigger('success'),
      warning: trigger('warning'),
      error: trigger('error'),
    };
  }

  /** Browser implementation using `navigator.vibrate` where available. */
  static readonly webLayer: Layer.Layer<Haptics> = Layer.succeed(
    Haptics,
    Haptics.make((style) =>
      Effect.sync(() => {
        const nav = typeof navigator !== 'undefined' ? navigator : undefined;
        if (typeof nav?.vibrate !== 'function') return;
        const patterns: Record<HapticStyle, number | Array<number>> = {
          tick: 8,
          tap: 12,
          thud: 25,
          success: [15, 30, 25],
          warning: [20, 40, 20],
          error: [30, 30, 30, 30, 30],
        };
        try {
          nav.vibrate(patterns[style]);
        } catch {
          // Ignore browsers blocking vibration without gesture.
        }
      }),
    ),
  );

  /** Deterministic in-memory test Layer recording every triggered haptic style. */
  static readonly testLayer = (
    recorded: Array<HapticStyle> = [],
  ): Layer.Layer<Haptics> =>
    Layer.succeed(
      Haptics,
      Haptics.make((style) =>
        Effect.sync(() => {
          recorded.push(style);
        }),
      ),
    );
}

// ---------------------------------------------------------------------------
// DeviceInfo
// ---------------------------------------------------------------------------

export interface DeviceInfoData {
  readonly platform: 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'web' | 'test';
  readonly host: 'mason' | 'native' | 'macos' | 'windows' | 'linux' | 'browser' | 'test';
  readonly osVersion: string;
  readonly model: string;
  readonly isNative: boolean;
}

export class DeviceInfo extends Context.Service<
  DeviceInfo,
  {
    readonly info: DeviceInfoData;
  }
>()('@nstudio/nativescript-effect-ui/platform/DeviceInfo') {
  static readonly webLayer: Layer.Layer<DeviceInfo> = Layer.sync(DeviceInfo, () => ({
    info: {
      platform: 'web' as const,
      host: 'browser' as const,
      osVersion: typeof navigator !== 'undefined' ? navigator.platform || 'Browser' : 'Browser',
      model: 'BrowserHost (DOM)',
      isNative: false,
    },
  }));

  static readonly testLayer = (
    overrides?: Partial<DeviceInfoData>,
  ): Layer.Layer<DeviceInfo> =>
    Layer.succeed(DeviceInfo, {
      info: {
        platform: 'test',
        host: 'test',
        osVersion: '1.0',
        model: 'TestHost',
        isNative: false,
        ...overrides,
      },
    });
}

// ---------------------------------------------------------------------------
// AppLifecycle
// ---------------------------------------------------------------------------

export type AppAppearance = 'light' | 'dark';
export type AppState = 'active' | 'background';

export class AppLifecycle extends Context.Service<
  AppLifecycle,
  {
    readonly appearance: Effect.Effect<AppAppearance>;
    readonly state: Effect.Effect<AppState>;
  }
>()('@nstudio/nativescript-effect-ui/platform/AppLifecycle') {
  static readonly webLayer: Layer.Layer<AppLifecycle> = Layer.succeed(AppLifecycle, {
    appearance: Effect.sync(() => {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      return 'light';
    }),
    state: Effect.sync(() => {
      if (typeof document !== 'undefined') {
        return document.visibilityState === 'hidden' ? 'background' : 'active';
      }
      return 'active';
    }),
  });

  static readonly testLayer = (
    initial?: { readonly appearance?: AppAppearance; readonly state?: AppState },
  ): Layer.Layer<AppLifecycle> =>
    Layer.succeed(AppLifecycle, {
      appearance: Effect.succeed(initial?.appearance ?? 'light'),
      state: Effect.succeed(initial?.state ?? 'active'),
    });
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

export class Clipboard extends Context.Service<
  Clipboard,
  {
    readonly copy: (text: string) => Effect.Effect<void>;
    readonly read: Effect.Effect<string>;
  }
>()('@nstudio/nativescript-effect-ui/platform/Clipboard') {
  static readonly webLayer: Layer.Layer<Clipboard> = Layer.succeed(Clipboard, {
    copy: (text) =>
      Effect.promise(async () => {
        try {
          await navigator.clipboard?.writeText(text);
        } catch {
          // Ignore permission denial in non-secure contexts.
        }
      }),
    read: Effect.promise(async () => {
      try {
        return (await navigator.clipboard?.readText()) ?? '';
      } catch {
        return '';
      }
    }),
  });

  static readonly testLayer = (initial = ''): Layer.Layer<Clipboard> => {
    let value = initial;
    return Layer.succeed(Clipboard, {
      copy: (text) =>
        Effect.sync(() => {
          value = text;
        }),
      read: Effect.sync(() => value),
    });
  };
}

/**
 * Combined browser Layer providing `Haptics`, `DeviceInfo`, `AppLifecycle`,
 * and `Clipboard` for web targets (`BrowserHost`).
 */
export const WebPlatformLayer: Layer.Layer<
  Haptics | DeviceInfo | AppLifecycle | Clipboard
> = Layer.mergeAll(
  Haptics.webLayer,
  DeviceInfo.webLayer,
  AppLifecycle.webLayer,
  Clipboard.webLayer,
);

/**
 * Combined deterministic test Layer for shared Vitest / `HtmlScene` tests.
 */
export const makeTestPlatformLayer = (options?: {
  readonly haptics?: Array<HapticStyle>;
  readonly device?: Partial<DeviceInfoData>;
  readonly appearance?: AppAppearance;
}): Layer.Layer<Haptics | DeviceInfo | AppLifecycle | Clipboard> =>
  Layer.mergeAll(
    Haptics.testLayer(options?.haptics),
    DeviceInfo.testLayer(options?.device),
    AppLifecycle.testLayer(
      options?.appearance !== undefined ? { appearance: options.appearance } : undefined,
    ),
    Clipboard.testLayer(),
  );
