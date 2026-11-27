/**
 * Domain Schemas, Commands, and async Queries for the shared Effect Pulse app.
 * 100% host-agnostic — zero platform or browser imports.
 */
import { Command, Query } from '@effect/ui';
import { DeviceInfo, Haptics, type HapticStyle } from '@nativescript/effect-ui/platform';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

export const Priority = Schema.Literals(['high', 'normal', 'low']);
export type Priority = typeof Priority.Type;

export const Filter = Schema.Literals(['all', 'active', 'done']);
export type Filter = typeof Filter.Type;

export const Task = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  tag: Schema.String,
  priority: Priority,
  done: Schema.Boolean,
});
export type Task = typeof Task.Type;

export const PulseSnapshot = Schema.Struct({
  revision: Schema.Number,
  status: Schema.String,
  latencyMs: Schema.Number,
  runtimeLabel: Schema.String,
  hostLabel: Schema.String,
});
export type PulseSnapshot = typeof PulseSnapshot.Type;

export const initialTasks: ReadonlyArray<Task> = [
  {
    id: 't-1',
    title: 'Wire Effect UI Renderer.Host to MasonKit',
    tag: 'Core',
    priority: 'high',
    done: true,
  },
  {
    id: 't-2',
    title: 'Share CSS Grid & Tailwind v4 across Web and iOS',
    tag: 'Layout',
    priority: 'high',
    done: true,
  },
  {
    id: 't-3',
    title: 'Present <dialog> natively via showModal',
    tag: 'Overlay',
    priority: 'normal',
    done: false,
  },
  {
    id: 't-4',
    title: 'Trigger native Haptics through Effect Layers',
    tag: 'Platform',
    priority: 'normal',
    done: false,
  },
  {
    id: 't-5',
    title: 'Run portable HtmlScene tests in Node Vitest',
    tag: 'Testing',
    priority: 'low',
    done: false,
  },
];

let syncCounter = 0;

/**
 * Async `Query.Service` proving Effect's keyed query cache & runtime work
 * identically under `BrowserHost` (Web) and `MasonHost` (iOS/Android).
 */
export class FetchPulseSnapshot extends Query.Service<FetchPulseSnapshot>()(
  'pulse/FetchPulseSnapshot',
  {
    args: { cycle: Schema.Number },
    success: PulseSnapshot,
    error: Schema.Never,
    staleTime: '30 seconds',
  },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const { info } = yield* DeviceInfo;
      return ({ cycle }) =>
        Effect.gen(function* () {
          // Short deterministic async boundary to exercise Effect's fiber scheduler.
          yield* Effect.sleep('120 millis');
          syncCounter++;
          return {
            revision: cycle + syncCounter,
            status: info.isNative ? 'Native UI Thread Healthy' : 'Browser DOM Healthy',
            latencyMs: info.isNative ? 14 : 22,
            runtimeLabel: `${info.platform.toUpperCase()} • ${info.osVersion}`,
            hostLabel: info.model,
          };
        });
    }),
  );
}

/**
 * Silent `Command.Service` triggering tactile feedback through the injected
 * `Haptics` Effect service (native `UIFeedbackGenerator` on iOS, `VibrationEffect`
 * on Android, `navigator.vibrate` on Web, recorded array in tests).
 */
export class TriggerHaptic extends Command.Service<TriggerHaptic>()(
  'pulse/TriggerHaptic',
  {
    args: {
      style: Schema.Literals(['tick', 'tap', 'thud', 'success', 'warning', 'error']),
      enabled: Schema.Boolean,
    },
  },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const haptics = yield* Haptics;
      return ({ style, enabled }) =>
        enabled ? haptics.trigger(style as HapticStyle) : Effect.void;
    }),
  );
}
