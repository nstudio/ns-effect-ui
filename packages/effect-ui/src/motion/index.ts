/**
 * UI-thread native motion for `@nstudio/nativescript-effect-ui`: zero Reanimated,
 * zero worklets, zero third-party native animation plugins.
 *
 * - On **iOS**, animations commit directly to Apple's CoreAnimation render
 *   server (`UIView.animateWithDurationDelayUsingSpringWithDamping...` /
 *   `UIView.animateWithDurationDelayOptionsAnimationsCompletion`), keeping
 *   60/120fps motion alive even if JavaScript is blocked for 1+ second.
 * - On **Android**, animations run via `ViewPropertyAnimator` on Android's
 *   hardware RenderThread with native interpolators (`DecelerateInterpolator`,
 *   `OvershootInterpolator`, etc.).
 * - In **Node Vitest**, a deterministic `MotionDriver` records every animation
 *   without touching native globals.
 */
import * as Command from '@effect/ui/Command';
import * as Component from '@effect/ui/Component';
import * as Mount from '@effect/ui/Mount';
import * as Renderer from '@effect/ui/Renderer';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import * as Stream from 'effect/Stream';

export const MotionEasing = Schema.Literals(['linear', 'easeIn', 'easeOut', 'easeInOut']);
export type MotionEasing = typeof MotionEasing.Type;

export const MotionTransform = Schema.Struct({
  opacity: Schema.optional(Schema.Number),
  translateX: Schema.optional(Schema.Number),
  translateY: Schema.optional(Schema.Number),
  scale: Schema.optional(Schema.Number),
  rotate: Schema.optional(Schema.Number),
});
export type MotionTransform = typeof MotionTransform.Type;

export const SpringConfig = Schema.Struct({
  damping: Schema.optional(Schema.Number),
  velocity: Schema.optional(Schema.Number),
});
export type SpringConfig = typeof SpringConfig.Type;

export const MotionSpec = Schema.Struct({
  from: Schema.optional(MotionTransform),
  to: MotionTransform,
  durationMs: Schema.optional(Schema.Number),
  delayMs: Schema.optional(Schema.Number),
  easing: Schema.optional(MotionEasing),
  spring: Schema.optional(Schema.Union([Schema.Boolean, SpringConfig])),
});
export type MotionSpec = typeof MotionSpec.Type;

export type MotionBackend =
  | 'ios-coreanimation'
  | 'android-renderthread'
  | 'nativescript-view'
  | 'test';

export interface MotionDriverService {
  readonly backend: MotionBackend;
  readonly animate: (node: unknown, spec: MotionSpec) => Effect.Effect<void>;
}

/**
 * Injectable motion driver service. Defaults automatically to the live
 * CoreAnimation / Android RenderThread driver when not overridden in tests.
 */
export class MotionDriver extends Context.Service<MotionDriver, MotionDriverService>()(
  '@nstudio/nativescript-effect-ui/MotionDriver',
) {}

/**
 * Reports which UI-thread animation backend is active on the current platform.
 */
export function detectMotionBackend(): MotionBackend {
  if (typeof __APPLE__ !== 'undefined' && __APPLE__) return 'ios-coreanimation';
  if (typeof __ANDROID__ !== 'undefined' && __ANDROID__) return 'android-renderthread';
  return 'nativescript-view';
}

interface NativeAnimatableView {
  ios?: UIView;
  android?: android.view.View;
  isLoaded?: boolean;
  once?: (event: string, cb: () => void) => void;
  opacity?: number;
  translateX?: number;
  translateY?: number;
  scaleX?: number;
  scaleY?: number;
  rotate?: number;
  animate?: (opts: Record<string, unknown>) => Promise<void>;
}

function buildIOSAffineTransform(t: MotionTransform): CGAffineTransform {
  let transform = CGAffineTransformIdentity;
  if (t.translateX !== undefined || t.translateY !== undefined) {
    transform = CGAffineTransformTranslate(transform, t.translateX ?? 0, t.translateY ?? 0);
  }
  if (t.scale !== undefined) {
    transform = CGAffineTransformScale(transform, t.scale, t.scale);
  }
  if (t.rotate !== undefined) {
    transform = CGAffineTransformRotate(transform, (t.rotate * Math.PI) / 180);
  }
  return transform;
}

function applyImmediateIOS(uiView: UIView, t: MotionTransform): void {
  if (t.opacity !== undefined) uiView.alpha = t.opacity;
  if (
    t.translateX !== undefined ||
    t.translateY !== undefined ||
    t.scale !== undefined ||
    t.rotate !== undefined
  ) {
    uiView.transform = buildIOSAffineTransform(t);
  }
}

function iosCurveOption(easing: MotionEasing | undefined): number {
  // UIViewAnimationOptions curve bits: EaseInOut = 0<<16, EaseIn = 1<<16, EaseOut = 2<<16, Linear = 3<<16
  // Plus AllowUserInteraction = 1 << 1 (2) and BeginFromCurrentState = 1 << 2 (4)
  const base = 2 | 4;
  switch (easing) {
    case 'linear':
      return base | (3 << 16);
    case 'easeIn':
      return base | (1 << 16);
    case 'easeInOut':
      return base | (0 << 16);
    case 'easeOut':
    default:
      return base | (2 << 16);
  }
}

function animateIOSCoreAnimation(uiView: UIView, spec: MotionSpec): void {
  if (spec.from) {
    applyImmediateIOS(uiView, spec.from);
  }

  const durationSec = (spec.durationMs ?? (spec.spring ? 520 : 280)) / 1000;
  const delaySec = (spec.delayMs ?? 0) / 1000;
  const options = iosCurveOption(spec.easing) as UIViewAnimationOptions;

  if (spec.spring) {
    const damping = typeof spec.spring === 'object' ? (spec.spring.damping ?? 0.68) : 0.68;
    const velocity = typeof spec.spring === 'object' ? (spec.spring.velocity ?? 0.4) : 0.4;
    UIView.animateWithDurationDelayUsingSpringWithDampingInitialSpringVelocityOptionsAnimationsCompletion(
      durationSec,
      delaySec,
      damping,
      velocity,
      options,
      () => {
        applyImmediateIOS(uiView, spec.to);
      },
      null as unknown as (finished: boolean) => void,
    );
  } else {
    UIView.animateWithDurationDelayOptionsAnimationsCompletion(
      durationSec,
      delaySec,
      options,
      () => {
        applyImmediateIOS(uiView, spec.to);
      },
      null as unknown as (finished: boolean) => void,
    );
  }
}

function applyImmediateAndroid(androidView: android.view.View, t: MotionTransform, density: number): void {
  if (t.opacity !== undefined) androidView.setAlpha(t.opacity);
  if (t.translateX !== undefined) androidView.setTranslationX(t.translateX * density);
  if (t.translateY !== undefined) androidView.setTranslationY(t.translateY * density);
  if (t.scale !== undefined) {
    androidView.setScaleX(t.scale);
    androidView.setScaleY(t.scale);
  }
  if (t.rotate !== undefined) androidView.setRotation(t.rotate);
}

function animateAndroidRenderThread(androidView: android.view.View, spec: MotionSpec): void {
  const density = androidView.getResources()?.getDisplayMetrics()?.density ?? 1;
  if (spec.from) {
    applyImmediateAndroid(androidView, spec.from, density);
  }

  const durationMs = spec.durationMs ?? (spec.spring ? 480 : 280);
  const animator = androidView.animate().setDuration(durationMs);

  if (spec.delayMs) {
    animator.setStartDelay(spec.delayMs);
  }

  if (spec.spring) {
    const tension =
      typeof spec.spring === 'object' && spec.spring.damping !== undefined
        ? Math.max(0.5, 2.2 * (1 - Math.min(0.95, spec.spring.damping)))
        : 1.4;
    animator.setInterpolator(new android.view.animation.OvershootInterpolator(tension));
  } else {
    switch (spec.easing) {
      case 'linear':
        animator.setInterpolator(new android.view.animation.LinearInterpolator());
        break;
      case 'easeIn':
        animator.setInterpolator(new android.view.animation.AccelerateInterpolator());
        break;
      case 'easeInOut':
        animator.setInterpolator(new android.view.animation.AccelerateDecelerateInterpolator());
        break;
      case 'easeOut':
      default:
        animator.setInterpolator(new android.view.animation.DecelerateInterpolator());
        break;
    }
  }

  if (spec.to.opacity !== undefined) animator.alpha(spec.to.opacity);
  if (spec.to.translateX !== undefined) animator.translationX(spec.to.translateX * density);
  if (spec.to.translateY !== undefined) animator.translationY(spec.to.translateY * density);
  if (spec.to.scale !== undefined) {
    animator.scaleX(spec.to.scale);
    animator.scaleY(spec.to.scale);
  }
  if (spec.to.rotate !== undefined) animator.rotation(spec.to.rotate);

  animator.start();
}

/**
 * Runs a UI-thread native animation directly on a NativeScript/MasonKit view
 * (CoreAnimation on iOS, RenderThread `ViewPropertyAnimator` on Android).
 */
export function animateNativeView(node: unknown, spec: MotionSpec): void {
  if (!node || typeof node !== 'object') return;
  const view = node as NativeAnimatableView;

  try {
    if (typeof __APPLE__ !== 'undefined' && __APPLE__) {
      if (view.ios) {
        animateIOSCoreAnimation(view.ios, spec);
        return;
      }
      if (typeof view.once === 'function') {
        view.once('loaded', () => {
          if (view.ios) animateIOSCoreAnimation(view.ios, spec);
        });
        return;
      }
    }
    if (typeof __ANDROID__ !== 'undefined' && __ANDROID__) {
      if (view.android) {
        animateAndroidRenderThread(view.android, spec);
        return;
      }
      if (typeof view.once === 'function') {
        view.once('loaded', () => {
          if (view.android) animateAndroidRenderThread(view.android, spec);
        });
        return;
      }
    }
  } catch {
    // Fall through to NativeScript cross-platform view.animate fallback.
  }

  if (spec.from) {
    if (spec.from.opacity !== undefined) view.opacity = spec.from.opacity;
    if (spec.from.translateX !== undefined) view.translateX = spec.from.translateX;
    if (spec.from.translateY !== undefined) view.translateY = spec.from.translateY;
    if (spec.from.scale !== undefined) {
      view.scaleX = spec.from.scale;
      view.scaleY = spec.from.scale;
    }
    if (spec.from.rotate !== undefined) view.rotate = spec.from.rotate;
  }

  if (typeof view.animate === 'function') {
    const opts: Record<string, unknown> = {
      duration: spec.durationMs ?? (spec.spring ? 480 : 280),
      delay: spec.delayMs ?? 0,
    };
    if (spec.to.opacity !== undefined) opts['opacity'] = spec.to.opacity;
    if (spec.to.translateX !== undefined || spec.to.translateY !== undefined) {
      opts['translate'] = { x: spec.to.translateX ?? 0, y: spec.to.translateY ?? 0 };
    }
    if (spec.to.scale !== undefined) {
      opts['scale'] = { x: spec.to.scale, y: spec.to.scale };
    }
    if (spec.to.rotate !== undefined) opts['rotate'] = spec.to.rotate;
    void view.animate(opts).catch(() => {});
  }
}

export const NativeMotionLayer: Layer.Layer<MotionDriver> = Layer.sync(MotionDriver, () => ({
  backend: detectMotionBackend(),
  animate: (node, spec) => Effect.sync(() => animateNativeView(node, spec)),
}));

export interface RecordedMotion {
  readonly node: unknown;
  readonly spec: MotionSpec;
}

/**
 * Deterministic in-memory `MotionDriver` for Node Vitest suites.
 */
export function makeTestMotionLayer(): {
  readonly layer: Layer.Layer<MotionDriver>;
  readonly recorded: Array<RecordedMotion>;
} {
  const recorded: Array<RecordedMotion> = [];
  const layer = Layer.succeed(MotionDriver, {
    backend: 'test',
    animate: (node, spec) =>
      Effect.sync(() => {
        recorded.push({ node, spec });
      }),
  });
  return { layer, recorded };
}

/**
 * Declarative Effect UI `Mount` that animates any `Html` or `Native` element on
 * mount (`from` -> `to`) and smoothly transitions on the OS render thread
 * whenever `to` changes in subsequent renders.
 *
 * @example
 * ```ts
 * h.div.onMount(
 *   NativeMotion.track({
 *     from: { opacity: 0, translateY: 16 },
 *     to: { opacity: 1, translateX: model.shifted ? 120 : 0, translateY: 0 },
 *     spring: { damping: 0.65 },
 *   })
 * )
 * ```
 */
export const track = Mount.make(
  'NativeMotion/track',
  { args: MotionSpec },
  (node: unknown, initial: MotionSpec, changes: Stream.Stream<MotionSpec>) =>
    Effect.gen(function* () {
      const driver = yield* Effect.serviceOption(MotionDriver);
      const run = (spec: MotionSpec) =>
        driver._tag === 'Some'
          ? driver.value.animate(node, spec)
          : Effect.sync(() => animateNativeView(node, spec));

      yield* run(initial);
      yield* Stream.runForEach(changes, (next) =>
        run({
          ...next,
          // Never replay initial `from` on subsequent reactive updates.
          from: undefined,
        }),
      );
      return Component.noop;
    }),
);

/**
 * Imperative Effect UI Command factory animating a ref'd element directly on
 * the OS render thread (CoreAnimation on iOS, RenderThread on Android).
 */
export const AnimateTo: Command.Factory<
  { readonly ref: Renderer.Ref<any>; readonly spec: MotionSpec },
  Component.Noop
> = Command.make(
  'NativeMotion/animateTo',
  {
    args: {
      ref: Renderer.Ref,
      spec: MotionSpec,
    },
  },
  ({ ref, spec }) =>
    Effect.gen(function* () {
      const refs = yield* Renderer.Refs;
      const found = yield* refs.lookup(ref as Renderer.Ref<unknown>);
      if (Option.isNone(found)) return Component.noop;
      const driver = yield* Effect.serviceOption(MotionDriver);
      if (driver._tag === 'Some') {
        yield* driver.value.animate(found.value, spec);
      } else {
        animateNativeView(found.value, spec);
      }
      return Component.noop;
    }),
);

export const animateTo = <Node>(ref: Renderer.Ref<Node>, spec: MotionSpec) =>
  AnimateTo.make({ ref, spec });

export const NativeMotion = {
  track,
  AnimateTo,
  animateTo,
  animateNativeView,
  detectMotionBackend,
  MotionDriver,
  NativeMotionLayer,
  makeTestMotionLayer,
} as const;
