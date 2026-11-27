/**
 * Portable Effect UI Play tests for the shared PulseApp!
 * Proves that the exact same application logic, async Query, headless Switch,
 * <dialog> composer, and Haptics Effect Layer are 100% deterministically
 * testable in Node without a browser or simulator.
 */
import { Locator, Play, TestHost } from '@effect/ui/testing';
import {
  type HapticStyle,
  makeTestPlatformLayer,
} from '@nativescript/effect-ui/platform';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { describe, expect, it } from 'vitest';
import { PulseApp } from './App.ts';
import { FetchPulseSnapshot, TriggerHaptic } from '../domain/Task.ts';

const byId = (id: string) => Locator.attr('id', id);

const makeAppTestLayer = (hapticsLog: Array<HapticStyle>) => {
  const platform = makeTestPlatformLayer({
    haptics: hapticsLog,
    device: {
      platform: 'ios',
      host: 'mason',
      osVersion: 'iOS 27',
      model: 'iPhone Duo',
      isNative: true,
    },
  });
  const domain = Layer.mergeAll(
    FetchPulseSnapshot.toLayer(({ cycle }) =>
      Effect.succeed({
        revision: cycle + 10,
        status: 'Native UI Thread Healthy',
        latencyMs: 12,
        runtimeLabel: 'IOS • iOS 27',
        hostLabel: 'iPhone Duo',
      }),
    ),
    TriggerHaptic.layer,
  ).pipe(Layer.provide(platform));

  return Layer.mergeAll(TestHost.layer(), platform, domain);
};

describe('Shared PulseApp (portable across BrowserHost & MasonHost)', () => {
  it('filters tasks, toggles @effect/ui-kit Switch, creates a task via <dialog>, and dispatches Haptics', async () => {
    const hapticsLog: Array<HapticStyle> = [];

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const play = yield* Play.make(PulseApp, {});

          yield* play.expect(Locator.text('Effect Pulse')).toExist();
          yield* play.expect(Locator.text('5 shown')).toExist();
          yield* play.expect(byId('telemetry-status')).toHaveText('Native UI Thread Healthy');

          // Switch to Active filter -> only 3 incomplete tasks remain.
          yield* play.click(byId('filter-active'));
          yield* play.expect(Locator.text('3 shown')).toExist();

          // Toggle "@effect/ui-kit" Compact Density Switch.
          yield* play.click(byId('switch-compact'));
          yield* play.expect(byId('switch-compact')).toHaveAttribute('aria-checked', 'true');

          // Open <dialog> composer, enter a title, submit the form.
          yield* play.click(byId('new-task-btn'));
          yield* play.fire(byId('draft-title-input'), 'input', {
            value: 'Verify on iPhone Simulator',
            checked: false,
            files: [],
            composing: false,
            inputType: 'insertText',
          });
          yield* play.fire(Locator.tag('form'), 'submit', {
            fields: { title: 'Verify on iPhone Simulator', tag: 'Feature' },
            entries: [
              ['title', 'Verify on iPhone Simulator'],
              ['tag', 'Feature'],
            ],
          });

          yield* play.expect(Locator.text('Verify on iPhone Simulator')).toExist();
          yield* play.expect(Locator.text('4 shown')).toExist();
        }),
      ).pipe(Effect.provide(makeAppTestLayer(hapticsLog))),
    );

    // Deterministic verification of the Haptics Effect Layer calls!
    expect(hapticsLog).toEqual(['tick', 'tick', 'tap', 'success']);
  });

  it('silences Haptics when the @effect/ui-kit Haptics Switch is turned off', async () => {
    const hapticsLog: Array<HapticStyle> = [];

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const play = yield* Play.make(PulseApp, {});

          // Disable haptics via @effect/ui-kit Switch.
          yield* play.click(byId('switch-haptics'));
          yield* play.expect(byId('switch-haptics')).toHaveAttribute('aria-checked', 'false');

          // Subsequent filter tap should NOT trigger haptics.
          yield* play.click(byId('filter-done'));
          yield* play.expect(Locator.text('2 shown')).toExist();
        }),
      ).pipe(Effect.provide(makeAppTestLayer(hapticsLog))),
    );

    expect(hapticsLog).toEqual([]);
  });
});
