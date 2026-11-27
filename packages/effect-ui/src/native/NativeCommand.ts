/**
 * Ref Commands for the dedicated NativeScript vocabulary (`Native.component`).
 */
import * as Command from '@effect/ui/Command';
import * as Component from '@effect/ui/Component';
import * as Renderer from '@effect/ui/Renderer';
import type { View as NSView } from '@nativescript/core';
import type * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import * as Native from './Native.ts';

export interface Found {
  readonly found: boolean;
}

const withNode = <N, A>(
  ref: Renderer.Ref<N>,
  f: (host: Context.Service.Shape<typeof Native.Host>, node: N) => A,
): Effect.Effect<Option.Option<A>, never, Renderer.Refs | Native.Host> =>
  Renderer.Refs.use((refs) =>
    Effect.flatMap(refs.lookup(ref), (node) =>
      Option.isNone(node)
        ? Effect.succeed(Option.none())
        : Native.Host.useSync((host) => Option.some(f(host, node.value))),
    ),
  );

const found = <N>(
  ref: Renderer.Ref<N>,
  f: (host: Context.Service.Shape<typeof Native.Host>, node: N) => void,
): Effect.Effect<Found, never, Renderer.Refs | Native.Host> =>
  Effect.map(withNode(ref, f), (done): Found => ({ found: Option.isSome(done) }));

export const Focus: Command.Factory<{ readonly ref: Renderer.Ref<any> }, Found> = Command.make(
  'NativeCommand.focus',
  { args: { ref: Renderer.Ref } },
  ({ ref }) => found(ref, (host, node) => host.focus(node as NSView)),
);

export const Blur: Command.Factory<{ readonly ref: Renderer.Ref<any> }, Found> = Command.make(
  'NativeCommand.blur',
  { args: { ref: Renderer.Ref } },
  ({ ref }) => found(ref, (host, node) => host.blur(node as NSView)),
);

export const Measure: Command.Factory<
  { readonly ref: Renderer.Ref<any> },
  Option.Option<Native.NativeRect>
> = Command.make(
  'NativeCommand.measure',
  { args: { ref: Renderer.Ref } },
  ({ ref }) => withNode(ref, (host, node) => host.measure(node as NSView)),
);

export const Animate: Command.Factory<
  {
    readonly ref: Renderer.Ref<any>;
    readonly opacity?: number | undefined;
    readonly duration?: number | undefined;
    readonly rotate?: number | undefined;
  },
  Component.Noop
> = Command.make(
  'NativeCommand.animate',
  {
    args: {
      ref: Renderer.Ref,
      opacity: Schema.optional(Schema.Number),
      duration: Schema.optional(Schema.Number),
      rotate: Schema.optional(Schema.Number),
    },
  },
  ({ ref, opacity, duration, rotate }) =>
    Effect.gen(function* () {
      const refs = yield* Renderer.Refs;
      const host = yield* Native.Host;
      const node = yield* refs.lookup(ref as Renderer.Ref<NSView>);
      if (Option.isSome(node)) {
        yield* Effect.promise(() => host.animate(node.value, { opacity, duration, rotate }));
      }
      return Component.noop;
    }),
);

export const focus = (ref: Renderer.Ref<NSView>) => Command.asNoop(Focus.make({ ref }));
export const blur = (ref: Renderer.Ref<NSView>) => Command.asNoop(Blur.make({ ref }));
export const measure = <Msg>(
  ref: Renderer.Ref<NSView>,
  f: (rect: Option.Option<Native.NativeRect>) => Msg,
) => Command.map(Measure.make({ ref }), f);
export const animate = (
  ref: Renderer.Ref<NSView>,
  options: {
    readonly opacity?: number | undefined;
    readonly duration?: number | undefined;
    readonly rotate?: number | undefined;
  },
) => Animate.make({ ref, ...options });
