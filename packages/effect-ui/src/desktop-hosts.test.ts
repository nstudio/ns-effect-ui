/**
 * Behavioral tests for `WindowsHost`, `WindowsPlatformLayer`, `LinuxHost`,
 * and `LinuxPlatformLayer` mounting real `@effect/ui/html` components.
 */
import { UiSchema } from '@effect/ui';
import { Html } from '@effect/ui/html';
import * as Renderer from '@effect/ui/Renderer';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import { describe, expect, it } from 'vitest';
import { makeDesktopHtmlServices } from './desktop/html-services.js';
import {
  LinuxHost,
  LinuxPlatformLayer,
  type LinuxHostBackend,
  type LinuxWidgetItem,
} from './linux/index.js';
import { AppLifecycle, Clipboard, DeviceInfo, Haptics } from './platform/index.js';
import {
  WindowsHost,
  WindowsPlatformLayer,
  type WindowsHostBackend,
  type WindowsVisualItem,
} from './windows/index.js';

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 10));

const DemoMsg = UiSchema.TaggedEnum({
  Increment: {},
  Draft: { value: Schema.String },
  OpenDialog: {},
  CloseDialog: {},
});

const DesktopDemoApp = Html.component({
  name: 'DesktopDemoApp',
  model: Schema.Struct({
    count: Schema.Number,
    draft: Schema.String,
    dialogOpen: Schema.Boolean,
  }),
  message: DemoMsg,
}).make({
  init: () => ({
    count: 0,
    draft: 'hello',
    dialogOpen: false,
  }),
  update: {
    Increment: ($) => $.evolve({ count: (c) => c + 1 }),
    Draft: ($, { value }) => $.evolve({ draft: value }),
    OpenDialog: ($) => $.evolve({ dialogOpen: true }),
    CloseDialog: ($) => $.evolve({ dialogOpen: false }),
  },
  view: (h, model) =>
    h.div.class('p-4 flex flex-col gap-3').children(
      h.h1.class('text-xl font-bold').children(`Count: ${model.count}`),
      h.input
        .class('w-full')
        .value(model.draft)
        .attr('placeholder', 'Type here')
        .on('input', (ev: any) => DemoMsg.Draft({ value: String(ev?.target?.value ?? '') })),
      h.button
        .id('inc-btn')
        .class('px-4 py-2 rounded-lg bg-zinc-900 text-white')
        .on('click', DemoMsg.Increment())
        .children('Increment'),
      h.button
        .id('open-dlg-btn')
        .class('px-4 py-2 rounded-lg')
        .on('click', DemoMsg.OpenDialog())
        .children('Open Dialog'),
      h.dialog
        .open(model.dialogOpen)
        .on('cancel', DemoMsg.CloseDialog())
        .children(h.p(`Modal draft: ${model.draft}`)),
    ),
});

describe('WindowsHost + WindowsPlatformLayer', () => {
  it('mounts Html.component, computes layout, hit-tests clicks, updates controlled input, and opens/closes modal dialog', async () => {
    const frames: Array<ReadonlyArray<WindowsVisualItem>> = [];
    let openDialogs = 0;
    let closeDialogs = 0;
    let cancelFn: (() => void) | undefined;

    const backend: WindowsHostBackend = {
      mode: 'custom',
      renderFrame: (items) => {
        frames.push(items);
      },
      openDialog: (_dlg, _items, _w, _h, _dark, onClose) => {
        openDialogs += 1;
        cancelFn = onClose;
        return { id: openDialogs };
      },
      closeDialog: () => {
        closeDialogs += 1;
      },
    };

    const win = WindowsHost.makeWindowsHost({
      getViewportWidth: () => 460,
      getDarkMode: () => false,
      backend,
    });

    const scopeLayer: Layer.Layer<never> = Layer.effectDiscard(
      Effect.provideContext(
        Renderer.mount(DesktopDemoApp as any, {}, win.rootContainer),
        Context.make(Renderer.Renderer, { host: win.host }).pipe(
          Context.merge(makeDesktopHtmlServices(() => false)),
        ),
      ),
    ) as Layer.Layer<never>;

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(scopeLayer);
          yield* Effect.promise(flushMicrotasks);

          expect(frames.length).toBeGreaterThan(0);
          const initial = win.getItems();
          expect(initial.some((i) => i.text === 'Count: 0')).toBe(true);

          // Hit-test click on Increment button using computed layout coordinates
          const incBtn = initial.find((i) => i.node.id === 'inc-btn');
          expect(incBtn).toBeDefined();
          const hit = win.clickAt(
            incBtn!.frame.x + incBtn!.frame.width / 2,
            incBtn!.frame.y + incBtn!.frame.height / 2,
          );
          expect(hit).toBe(true);
          yield* Effect.promise(flushMicrotasks);
          expect(win.getItems().some((i) => i.text === 'Count: 1')).toBe(true);

          // Update controlled input
          const inputItem = win.getItems().find((i) => i.isInput);
          expect(inputItem?.inputValue).toBe('hello');
          win.triggerInput(inputItem!.node, 'winui');
          yield* Effect.promise(flushMicrotasks);
          expect(win.getItems().find((i) => i.isInput)?.inputValue).toBe('winui');

          // Open modal dialog and verify cancel callback closes it
          const openBtn = win.getItems().find((i) => i.node.id === 'open-dlg-btn');
          win.triggerClick(openBtn!.node);
          yield* Effect.promise(flushMicrotasks);
          expect(openDialogs).toBe(1);

          cancelFn?.();
          yield* Effect.promise(flushMicrotasks);
          expect(closeDialogs).toBe(0);
          win.dispose();
        }),
      ),
    );
  });

  it('provides WindowsPlatformLayer services cleanly', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const device = yield* DeviceInfo;
        const haptics = yield* Haptics;
        const lifecycle = yield* AppLifecycle;
        const clipboard = yield* Clipboard;

        yield* haptics.tap;
        yield* clipboard.copy('windows-effect-ui');
        const copied = yield* clipboard.read;
        const appearance = yield* lifecycle.appearance;

        return { info: device.info, copied, appearance };
      }).pipe(Effect.provide(WindowsPlatformLayer)),
    );

    expect(result.info.platform).toBe('windows');
    expect(result.info.host).toBe('windows');
    expect(result.info.isNative).toBe(true);
    expect(result.copied).toBe('windows-effect-ui');
    expect(['light', 'dark']).toContain(result.appearance);
  });
});

describe('LinuxHost + LinuxPlatformLayer', () => {
  it('mounts Html.component, emits GTK4 CSS stylesheet, handles clicks/inputs, and manages modal dialog', async () => {
    let lastCss = '';
    let lastItems: ReadonlyArray<LinuxWidgetItem> = [];
    let opened = 0;
    let closed = 0;

    const backend: LinuxHostBackend = {
      mode: 'custom',
      renderFrame: (items, css) => {
        lastItems = items;
        lastCss = css;
      },
      openDialog: () => {
        opened += 1;
        return { id: opened };
      },
      closeDialog: () => {
        closed += 1;
      },
    };

    const linux = LinuxHost.makeLinuxHost({
      getViewportWidth: () => 460,
      getDarkMode: () => true,
      backend,
    });

    const scopeLayer: Layer.Layer<never> = Layer.effectDiscard(
      Effect.provideContext(
        Renderer.mount(DesktopDemoApp as any, {}, linux.rootContainer),
        Context.make(Renderer.Renderer, { host: linux.host }).pipe(
          Context.merge(makeDesktopHtmlServices(() => true)),
        ),
      ),
    ) as Layer.Layer<never>;

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(scopeLayer);
          yield* Effect.promise(flushMicrotasks);

          expect(lastItems.some((i) => i.text === 'Count: 0')).toBe(true);
          expect(lastCss).toContain('window.efui-root');
          expect(lastCss).toContain('.efui-n0');

          const incBtn = linux.getItems().find((i) => i.node.id === 'inc-btn');
          expect(incBtn).toBeDefined();
          linux.triggerClick(incBtn!.node);
          yield* Effect.promise(flushMicrotasks);
          expect(linux.getItems().some((i) => i.text === 'Count: 1')).toBe(true);

          const inputItem = linux.getItems().find((i) => i.isInput);
          linux.triggerInput(inputItem!.node, 'gtk4');
          yield* Effect.promise(flushMicrotasks);
          expect(linux.getItems().find((i) => i.isInput)?.inputValue).toBe('gtk4');

          const openBtn = linux.getItems().find((i) => i.node.id === 'open-dlg-btn');
          linux.triggerClick(openBtn!.node);
          yield* Effect.promise(flushMicrotasks);
          expect(opened).toBe(1);

          linux.dispose();
          expect(closed).toBe(1);
        }),
      ),
    );
  });

  it('provides LinuxPlatformLayer services cleanly', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const device = yield* DeviceInfo;
        const haptics = yield* Haptics;
        const lifecycle = yield* AppLifecycle;
        const clipboard = yield* Clipboard;

        yield* haptics.tick;
        yield* clipboard.copy('linux-gtk4-effect-ui');
        const copied = yield* clipboard.read;
        const appearance = yield* lifecycle.appearance;

        return { info: device.info, copied, appearance };
      }).pipe(Effect.provide(LinuxPlatformLayer)),
    );

    expect(result.info.platform).toBe('linux');
    expect(result.info.host).toBe('linux');
    expect(result.info.isNative).toBe(true);
    expect(result.copied).toBe('linux-gtk4-effect-ui');
    expect(['light', 'dark']).toContain(result.appearance);
  });
});
