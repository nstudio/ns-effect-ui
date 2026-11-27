/**
 * Native keyboard height/phase `Subscription` and docked composer helpers for
 * `@nativescript/effect-ui` — zero plugins.
 *
 * - **iOS:** Subscribes directly to `NSNotificationCenter.defaultCenter`
 *   (`UIKeyboardWillChangeFrameNotification` / `UIKeyboardWillHideNotification`).
 * - **Android:** Reads real IME insets via `androidx.core.view.ViewCompat`
 *   (`WindowInsetsCompat.Type.ime()`), converting pixels to DIPs.
 * - **Tests:** `makeTestKeyboardLayer()` provides deterministic `.emit(...)`
 *   driving `Keyboard.watch(...)` in Node Vitest.
 */
import * as Command from '@effect/ui/Command';
import * as Component from '@effect/ui/Component';
import * as Subscription from '@effect/ui/Subscription';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Queue from 'effect/Queue';
import * as Schema from 'effect/Schema';
import * as Stream from 'effect/Stream';

export const KeyboardPhase = Schema.Literals(['hidden', 'showing', 'visible', 'hiding']);
export type KeyboardPhase = typeof KeyboardPhase.Type;

export const KeyboardState = Schema.Struct({
  visible: Schema.Boolean,
  height: Schema.Number,
  durationMs: Schema.Number,
  phase: KeyboardPhase,
});
export type KeyboardState = typeof KeyboardState.Type;

export const initialKeyboardState: KeyboardState = {
  visible: false,
  height: 0,
  durationMs: 0,
  phase: 'hidden',
};

export interface KeyboardServiceShape {
  readonly current: Effect.Effect<KeyboardState>;
  readonly changes: Stream.Stream<KeyboardState>;
  readonly dismiss: Effect.Effect<void>;
}

/**
 * Host-agnostic Effect `Context.Service` for keyboard visibility, height,
 * animation duration, and programmatic dismissal.
 */
export class Keyboard extends Context.Service<Keyboard, KeyboardServiceShape>()(
  '@nativescript/effect-ui/Keyboard',
) {}

/**
 * Effect UI `Command.Service` that dismisses the native software keyboard.
 */
export class DismissKeyboard extends Command.Service<DismissKeyboard>()('Keyboard/Dismiss', {
  args: {},
  success: Component.Noop,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const kb = yield* Keyboard;
      return () => kb.dismiss.pipe(Effect.as(Component.noop));
    }),
  );
}

/**
 * Effect UI `Subscription` streaming native keyboard state transitions to your
 * component's `update` handler.
 */
export const watchKeyboard = <Msg>(
  toMessage: (state: KeyboardState) => Msg,
): Subscription.Subscription<Msg, Keyboard> =>
  Subscription.make('Keyboard/watch', null, () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const kb = yield* Keyboard;
        return Stream.map(kb.changes, toMessage);
      }),
    ),
  );

/**
 * Computes docked composer styles so an input bar sits cleanly above the
 * active keyboard (or resting safe-area inset when hidden).
 */
export function dockedComposerStyle(
  state: KeyboardState,
  restingBottomInset = 12,
): { readonly marginBottom: number; readonly paddingBottom: number } {
  const bottom = state.visible ? Math.max(0, Math.round(state.height)) : restingBottomInset;
  return {
    marginBottom: bottom,
    paddingBottom: state.visible ? 8 : 12,
  };
}

/**
 * Creates a live NativeScript `Keyboard` Layer using direct iOS
 * `NSNotificationCenter` and Android `WindowInsetsCompat.Type.ime()` APIs.
 */
export const KeyboardNativeLayer: Layer.Layer<Keyboard> = Layer.sync(Keyboard, () => {
  let latest: KeyboardState = initialKeyboardState;

  const dismiss = Effect.sync(() => {
    try {
      if (typeof __APPLE__ !== 'undefined' && __APPLE__) {
        UIApplication.sharedApplication.sendActionToFromForEvent(
          'resignFirstResponder',
          null,
          null,
          null,
        );
        return;
      }
      if (typeof __ANDROID__ !== 'undefined' && __ANDROID__) {
        // Lazy-import `@nativescript/core` only when running on native Android.
        void import('@nativescript/core').then(({ Application, Utils }) => {
          const activity =
            Application.android?.foregroundActivity ?? Application.android?.startActivity;
          const focus = activity?.getCurrentFocus?.();
          const imm = Utils.android
            .getApplicationContext()
            ?.getSystemService(
              android.content.Context.INPUT_METHOD_SERVICE,
            ) as android.view.inputmethod.InputMethodManager | null;
          if (focus && imm) {
            imm.hideSoftInputFromWindow(focus.getWindowToken(), 0);
          }
        });
      }
    } catch {
      // Ignore on simulator / unavailable native window.
    }
  });

  const changes: Stream.Stream<KeyboardState> = Stream.callback<KeyboardState>((queue) =>
    Effect.gen(function* () {
      const push = (next: KeyboardState) => {
        latest = next;
        Queue.offerUnsafe(queue, next);
      };

      if (typeof __APPLE__ !== 'undefined' && __APPLE__) {
        const center = NSNotificationCenter.defaultCenter;
        const onFrameChange = (notification: NSNotification) => {
          try {
            const info = notification.userInfo;
            const endValue = info?.objectForKey(UIKeyboardFrameEndUserInfoKey) as NSValue | null;
            const durValue = info?.objectForKey(
              UIKeyboardAnimationDurationUserInfoKey,
            ) as NSNumber | null;
            const screenH = UIScreen.mainScreen.bounds.size.height;
            const endRect = endValue?.CGRectValue;
            const height = endRect ? Math.max(0, Math.round(screenH - endRect.origin.y)) : 0;
            const durationMs = durValue ? Math.round(durValue.doubleValue * 1000) : 250;
            push({
              visible: height > 0,
              height,
              durationMs,
              phase: height > 0 ? 'visible' : 'hidden',
            });
          } catch {
            // Ignore malformed notification payload.
          }
        };

        const showObs = center.addObserverForNameObjectQueueUsingBlock(
          UIKeyboardWillChangeFrameNotification,
          null,
          NSOperationQueue.mainQueue,
          onFrameChange,
        );
        const hideObs = center.addObserverForNameObjectQueueUsingBlock(
          UIKeyboardWillHideNotification,
          null,
          NSOperationQueue.mainQueue,
          () => {
            push({ visible: false, height: 0, durationMs: 250, phase: 'hidden' });
          },
        );

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            center.removeObserver(showObs);
            center.removeObserver(hideObs);
          }),
        );
        return;
      }

      if (typeof __ANDROID__ !== 'undefined' && __ANDROID__) {
        const { Application, Utils } = yield* Effect.promise(() => import('@nativescript/core'));
        const activity =
          Application.android?.foregroundActivity ?? Application.android?.startActivity;
        const decorView = activity?.getWindow?.()?.getDecorView?.();
        if (decorView && typeof androidx !== 'undefined') {
          const listener = new androidx.core.view.OnApplyWindowInsetsListener({
            onApplyWindowInsets(v, insets) {
              try {
                const imeType = androidx.core.view.WindowInsetsCompat.Type.ime();
                const visible = insets.isVisible(imeType);
                const px = insets.getInsets(imeType).bottom;
                const height = visible
                  ? Math.max(0, Math.round(Utils.layout.toDeviceIndependentPixels(px)))
                  : 0;
                push({
                  visible,
                  height,
                  durationMs: 220,
                  phase: visible ? 'visible' : 'hidden',
                });
              } catch {
                // Ignore insets read failure.
              }
              return androidx.core.view.ViewCompat.onApplyWindowInsets(v, insets);
            },
          });
          androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(decorView, listener);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(
                decorView,
                null as unknown as androidx.core.view.OnApplyWindowInsetsListener,
              );
            }),
          );
        }
      }
    }),
  );

  return {
    current: Effect.sync(() => latest),
    changes,
    dismiss,
  };
});

/**
 * Deterministic in-memory `Keyboard` test Layer for Node Vitest suites.
 */
export function makeTestKeyboardLayer(): {
  readonly layer: Layer.Layer<Keyboard>;
  readonly emit: (state: KeyboardState) => void;
  readonly getDismissCount: () => number;
} {
  let latest: KeyboardState = initialKeyboardState;
  let dismissCount = 0;
  const listeners = new Set<(state: KeyboardState) => void>();

  const emit = (state: KeyboardState) => {
    latest = state;
    for (const listener of listeners) {
      listener(state);
    }
  };

  const layer = Layer.succeed(Keyboard, {
    current: Effect.sync(() => latest),
    changes: Stream.callback<KeyboardState>((queue) =>
      Effect.gen(function* () {
        const listener = (state: KeyboardState) => {
          Queue.offerUnsafe(queue, state);
        };
        listeners.add(listener);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            listeners.delete(listener);
          }),
        );
      }),
    ),
    dismiss: Effect.sync(() => {
      dismissCount += 1;
      if (latest.visible) {
        emit({ visible: false, height: 0, durationMs: 0, phase: 'hidden' });
      }
    }),
  });

  return {
    layer,
    emit,
    getDismissCount: () => dismissCount,
  };
}

export const NativeKeyboard = {
  Keyboard,
  KeyboardPhase,
  KeyboardState,
  initialKeyboardState,
  DismissKeyboard,
  watchKeyboard,
  dockedComposerStyle,
  KeyboardNativeLayer,
  makeTestKeyboardLayer,
} as const;
