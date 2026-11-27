import { describe, expect, it, vi } from 'vitest';

vi.mock('@nativescript/core', () => ({
  Application: {
    run: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    getRootView: () => undefined,
    systemAppearance: () => 'light',
    systemAppearanceChangedEvent: 'systemAppearanceChanged',
    orientationChangedEvent: 'orientationChanged',
    resumeEvent: 'resume',
    suspendEvent: 'suspend',
  },
  CSSType: () => (cls: unknown) => cls,
  Frame: class {},
  Page: class {},
  Screen: { mainScreen: { widthDIPs: 390, heightDIPs: 844 } },
}));

vi.mock('@triniwiz/nativescript-masonkit', () => {
  class StubView {}
  const names = [
    'Abbr', 'Address', 'Article', 'Aside', 'B', 'Bdi', 'Bdo', 'Blockquote', 'Br',
    'Cite', 'Code', 'Dd', 'Del', 'Details', 'Dfn', 'Div', 'Dl', 'Dt', 'Em',
    'Fieldset', 'Figcaption', 'Figure', 'Footer', 'Form', 'Header', 'Hgroup', 'Hr',
    'I', 'Img', 'Input', 'Ins', 'Legend', 'Link', 'Main', 'Mark', 'Nav', 'Ol',
    'Output', 'P', 'Picture', 'Pre', 'Q', 'S', 'Samp', 'Scroll', 'Section', 'Small',
    'Span', 'Strong', 'Sub', 'Summary', 'Sup', 'TextArea', 'Time', 'U', 'Ul', 'Var',
  ];
  const mod: Record<string, unknown> = {
    View: Object.assign(class extends StubView {}, { preflight: false }),
  };
  for (const name of names) mod[name] = StubView;
  return mod;
});

import { UiSchema } from '@effect/ui';
import { Html } from '@effect/ui/html';
import * as Renderer from '@effect/ui/Renderer';
import type { View as NSView } from '@nativescript/core';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import { buildCrashReport, formatCrashText, makeHtmlCrashFallback } from './crash/index.ts';
import {
  type DevToolsWebSocketLike,
  makeBridge,
  resolveDevToolsUrl,
} from './devtools/index.ts';
import { layoutTree, type LayoutNode } from './macos/layout.ts';
import { lightPalette, resolveMacosStyle } from './macos/styles.ts';
import {
  DismissKeyboard,
  dockedComposerStyle,
  makeTestKeyboardLayer,
  watchKeyboard,
} from './keyboard/index.ts';
import * as VirtualList from './list/index.ts';
import { MasonHost } from './mason/index.ts';
import { animateTo, makeTestMotionLayer, track } from './motion/index.ts';
import {
  CloseSheet,
  makeTestSheetLayer,
  OpenSheet,
  parseSheetOptionsFromAttributes,
} from './sheet/index.ts';
import {
  createMockDialogPresenter,
  createMockMasonView,
  findViews,
  textContentOf,
} from './testing/MockMasonHost.ts';

function mockHostOptions() {
  return {
    createElement: (tag: string) => createMockMasonView(tag) as unknown as NSView,
    dialogPresenter: createMockDialogPresenter().presenter,
  };
}

describe('NativeMotion (UI-thread animation mount & Command)', () => {
  it('runs initial from->to animation on mount, strips from on updates, and handles animateTo ref Command', async () => {
    const BoxRef = Renderer.ref<HTMLDivElement>('motion-box');
    const Model = Schema.Struct({ shifted: Schema.Boolean });
    const Msg = UiSchema.TaggedEnum({
      Toggle: {},
      Pulse: {},
    });

    const MotionCard = Html.component({
      name: 'MotionCard',
      model: Model,
      message: Msg,
    }).make({
      init: () => ({ shifted: false }),
      update: {
        Toggle: ($) => $.evolve({ shifted: (s) => !s }),
        Pulse: ($) =>
          $.run(
            animateTo(BoxRef, {
              to: { scale: 1.12 },
              spring: { damping: 0.6 },
            }),
          ),
      },
      view: (h, model) =>
        h.div
          .ref(BoxRef)
          .onMount(
            track({
              from: { opacity: 0, translateY: 16 },
              to: { opacity: 1, translateX: model.shifted ? 120 : 0, translateY: 0 },
              spring: true,
            }),
          )
          .children(h.button.id('toggle-btn').on('click', Msg.Toggle()).children('Move')),
    });

    const { layer: motionLayer, recorded } = makeTestMotionLayer();
    const container = createMockMasonView('scroll');

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* MasonHost.mountEffect(
            MotionCard,
            {},
            container as unknown as NSView,
            { host: mockHostOptions() },
          );

          yield* Effect.sleep('25 millis');
          expect(recorded.length).toBeGreaterThanOrEqual(1);
          expect(recorded[0]!.spec.from).toEqual({ opacity: 0, translateY: 16 });
          expect(recorded[0]!.spec.to.translateX).toBe(0);

          root.send(Msg.Toggle());
          yield* Effect.sleep('25 millis');
          const afterToggle = recorded[recorded.length - 1]!;
          expect(afterToggle.spec.from).toBeUndefined();
          expect(afterToggle.spec.to.translateX).toBe(120);

          root.send(Msg.Pulse());
          yield* Effect.sleep('25 millis');
          const afterPulse = recorded[recorded.length - 1]!;
          expect(afterPulse.spec.to.scale).toBe(1.12);
        }).pipe(Effect.provide(motionLayer)),
      ),
    );
  });
});

describe('NativeSheet (UISheetPresentationController & Android sheet options/Commands)', () => {
  it('parses data-* sheet attributes from <dialog data-presentation="sheet">', () => {
    const parsed = parseSheetOptionsFromAttributes({
      'data-presentation': 'sheet',
      'data-detents': 'medium, large',
      'data-grabber': 'true',
      'data-corner-radius': '28',
      'data-undimmed-medium': 'true',
      'data-dismissable': 'false',
    });

    expect(parsed).toEqual({
      detents: ['medium', 'large'],
      grabber: true,
      cornerRadius: 28,
      undimmedMedium: true,
      dismissable: false,
    });
  });

  it('dispatches OpenSheet and CloseSheet Effect Commands through SheetService', async () => {
    const { layer: sheetLayer, events, openIds } = makeTestSheetLayer();
    const Model = Schema.Struct({ open: Schema.Boolean });
    const Msg = UiSchema.TaggedEnum({ Open: {}, Close: {} });

    const SheetDemo = Html.component({
      name: 'SheetDemo',
      model: Model,
      message: Msg,
    }).make({
      init: () => ({ open: false }),
      update: {
        Open: ($) =>
          $.evolve({ open: true }).run(
            OpenSheet.make({ id: 'composer', options: { detents: ['medium', 'large'] } }),
          ),
        Close: ($) => $.evolve({ open: false }).run(CloseSheet.make({ id: 'composer' })),
      },
      view: (h, model) => h.div.children(model.open ? 'open' : 'closed'),
    });

    const fullLayer = Layer.mergeAll(OpenSheet.layer, CloseSheet.layer).pipe(
      Layer.provide(sheetLayer),
    );
    const container = createMockMasonView('scroll');

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* MasonHost.mountEffect(
            SheetDemo,
            {},
            container as unknown as NSView,
            { host: mockHostOptions() },
          );
          root.send(Msg.Open());
          yield* Effect.sleep('20 millis');
          expect(openIds.has('composer')).toBe(true);
          expect(events[0]?.action).toBe('open');

          root.send(Msg.Close());
          yield* Effect.sleep('20 millis');
          expect(openIds.has('composer')).toBe(false);
          expect(events[1]?.action).toBe('close');
        }).pipe(Effect.provide(fullLayer)),
      ),
    );
  });
});

describe('VirtualList (1,000-row slot-recycled windowing)', () => {
  it('recycles a constant slot pool across 1,000 items and skips unchanged windows', () => {
    const items = Array.from({ length: 1_000 }, (_, i) => `Row #${i + 1}`);
    const model0 = VirtualList.init({
      totalCount: items.length,
      viewportHeight: 600,
      estimatedItemHeight: 60,
      overscanPx: 180,
      recycle: true,
    });

    const win0 = VirtualList.computeWindow(model0, items);
    expect(win0.startIndex).toBe(0);
    expect(win0.visibleItems.length).toBeLessThan(25);
    expect(win0.totalHeight).toBe(60_000);
    expect(win0.topSpacerPx).toBe(0);
    expect(win0.visibleItems[0]!.key).toBe('vslot-0');

    // Tiny scroll inside the same window returns exact same reference (0 re-renders).
    const same = VirtualList.scrolled(model0, 12);
    expect(same).toBe(model0);

    // Jump deep into the 1,000-row list -> slot keys recycle within [0, poolSize).
    const deep = VirtualList.scrolled(model0, 30_000);
    const winDeep = VirtualList.computeWindow(deep, items);
    expect(winDeep.startIndex).toBeGreaterThan(480);
    expect(winDeep.visibleItems.length).toBeLessThan(25);
    for (const row of winDeep.visibleItems) {
      expect(row.slot).toBeGreaterThanOrEqual(0);
      expect(row.slot).toBeLessThan(deep.poolSize);
      expect(row.key).toBe(`vslot-${row.slot}`);
    }

    // Variable measured heights shift totalHeight accurately.
    const measured = VirtualList.measureHeight(deep, winDeep.startIndex, 120);
    const winMeasured = VirtualList.computeWindow(measured, items);
    expect(winMeasured.totalHeight).toBe(60_060);
  });
});

describe('NativeKeyboard (Subscription + DismissKeyboard Command + dockedComposerStyle)', () => {
  it('streams native keyboard heights into component state and handles dismiss Command', async () => {
    const { layer: kbLayer, emit, getDismissCount } = makeTestKeyboardLayer();
    const Model = Schema.Struct({ kbHeight: Schema.Number, visible: Schema.Boolean });
    const Msg = UiSchema.TaggedEnum({
      KeyboardChanged: { height: Schema.Number, visible: Schema.Boolean },
      TappedDismiss: {},
    });

    const Composer = Html.component({
      name: 'Composer',
      model: Model,
      message: Msg,
    }).make({
      init: () => ({ kbHeight: 0, visible: false }),
      subscriptions: () => [
        watchKeyboard((state) =>
          Msg.KeyboardChanged({ height: state.height, visible: state.visible }),
        ),
      ],
      update: {
        KeyboardChanged: ($, { height, visible }) => $.evolve({ kbHeight: height, visible }),
        TappedDismiss: ($) => $.run(DismissKeyboard.make({})),
      },
      view: (h, model) => h.div.children(`kb:${model.kbHeight}:${model.visible}`),
    });

    const fullLayer = Layer.mergeAll(kbLayer, DismissKeyboard.layer.pipe(Layer.provide(kbLayer)));
    const container = createMockMasonView('scroll');

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* MasonHost.mountEffect(
            Composer,
            {},
            container as unknown as NSView,
            { host: mockHostOptions() },
          );
          yield* Effect.sleep('20 millis');

          emit({ visible: true, height: 336, durationMs: 250, phase: 'visible' });
          yield* Effect.sleep('25 millis');
          expect(textContentOf(container)).toContain('kb:336:true');

          expect(
            dockedComposerStyle({ visible: true, height: 336, durationMs: 250, phase: 'visible' }),
          ).toEqual({ marginBottom: 336, paddingBottom: 8 });

          root.send(Msg.TappedDismiss());
          yield* Effect.sleep('25 millis');
          expect(getDismissCount()).toBe(1);
          expect(textContentOf(container)).toContain('kb:0:false');
        }).pipe(Effect.provide(fullLayer)),
      ),
    );
  });
});

describe('NativeCrash (CrashReport + fallback recovery renderer)', () => {
  it('formats Effect Cause failures and renders an interactive recovery fallback on crash', async () => {
    const report = buildCrashReport(
      { _tag: 'Failure', cause: Cause.die(new Error('Simulated native crash')) },
      'PulseApp',
      () => new Date('2026-11-26T00:00:00.000Z'),
    );
    expect(report.title).toBe('PulseApp encountered an error');
    expect(report.message).toContain('Simulated native crash');
    const formatted = formatCrashText(report);
    expect(formatted).toContain('[PulseApp]');
    expect(formatted).toContain('Simulated native crash');

    let copied = '';
    let restarted = 0;

    const Broken = Html.component({
      name: 'Broken',
      model: Schema.Struct({ boom: Schema.Boolean }),
      message: UiSchema.TaggedEnum({ Explode: {} }),
    }).make({
      init: () => ({ boom: false }),
      update: {
        Explode: () => {
          throw new Error('Boom in update');
        },
      },
      view: (h) => h.div.children('healthy'),
    });

    const container = createMockMasonView('scroll');

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* MasonHost.mountEffect(
            Broken,
            {},
            container as unknown as NSView,
            {
              host: mockHostOptions(),
              fallback: makeHtmlCrashFallback({
                componentName: 'Broken',
                onCopy: (txt) => {
                  copied = txt;
                },
                onRestart: () => {
                  restarted += 1;
                },
              }),
            },
          );

          expect(textContentOf(container)).toContain('healthy');
          root.send({ _tag: 'Explode' });
          yield* Effect.sleep('25 millis');

          expect(textContentOf(container)).toContain('Broken encountered an error');
          expect(textContentOf(container)).toContain('Boom in update');

          const copyBtn = findViews(container, (v) => v.id === 'crash-copy-btn')[0];
          const restartBtn = findViews(container, (v) => v.id === 'crash-restart-btn')[0];
          expect(copyBtn).toBeDefined();
          expect(restartBtn).toBeDefined();

          copyBtn!.emit('click', {});
          restartBtn!.emit('click', {});
          expect(copied).toContain('Boom in update');
          expect(restarted).toBe(1);
        }),
      ),
    );
  });
});

describe('NativeDevTools (MessageLog Wire encoding + WebSocket bridge)', () => {
  it('encodes Wire frames off the update path and streams Hello + Update frames over WebSocket', async () => {
    expect(resolveDevToolsUrl(4774)).toBe('ws://127.0.0.1:4774');

    const sentPayloads: Array<string> = [];
    let activeSocket: MockSocket | null = null;

    class MockSocket implements DevToolsWebSocketLike {
      readyState = 0;
      onopen: ((ev?: unknown) => void) | null = null;
      onclose: ((ev?: unknown) => void) | null = null;
      onerror: ((ev?: unknown) => void) | null = null;
      constructor(public readonly url: string) {
        activeSocket = this;
      }
      send(data: string): void {
        sentPayloads.push(data);
      }
      close(): void {
        this.readyState = 3;
      }
      openNow(): void {
        this.readyState = 1;
        this.onopen?.();
      }
    }

    const bridge = makeBridge({
      serverUrl: 'ws://127.0.0.1:4774',
      bufferSize: 50,
      WebSocketCtor: MockSocket,
    });

    const Counter = Html.component({
      name: 'DevToolsCounter',
      model: Schema.Struct({ count: Schema.Number }),
      message: UiSchema.TaggedEnum({ Inc: {} }),
    }).make({
      init: () => ({ count: 0 }),
      update: { Inc: ($) => $.evolve({ count: (c) => c + 1 }) },
      view: (h, model) => h.div.children(String(model.count)),
    });

    const container = createMockMasonView('scroll');

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* MasonHost.mountEffect(
            Counter,
            {},
            container as unknown as NSView,
            { host: mockHostOptions() },
          );
          yield* Effect.sleep('25 millis');

          expect(activeSocket).not.toBeNull();
          activeSocket!.openNow();
          expect(bridge.getStats().connected).toBe(true);

          root.send({ _tag: 'Inc' });
          yield* Effect.sleep('25 millis');

          const frames = bridge.getFrames();
          expect(frames.some((f) => f._tag === 'Mounted')).toBe(true);
          expect(frames.some((f) => f._tag === 'Update')).toBe(true);

          const parsedSent = sentPayloads.map((raw) => JSON.parse(raw) as { _tag: string });
          expect(parsedSent[0]?._tag).toBe('Hello');
          expect(parsedSent.some((m) => m._tag === 'Update')).toBe(true);
        }).pipe(Effect.provide(bridge.layer)),
      ),
    );
  });
});

describe('MacosHost (AppKit monochrome styles & CSS Grid/Flex layout engine)', () => {
  it('resolves Tailwind + semantic monochrome classes and lays out a 3-column CSS Grid', () => {
    const doneTitle = resolveMacosStyle(
      'p',
      'ep-task-title text-sm font-semibold text-foreground text-left',
      { 'data-done': 'true' },
      lightPalette.foreground,
      false,
    );
    expect(doneTitle.strikethrough).toBe(true);
    expect(doneTitle.color).toEqual(lightPalette.mutedForeground);

    const gridStyle = resolveMacosStyle('section', 'grid grid-cols-3 gap-3', {}, lightPalette.foreground, false);
    const cellStyle = resolveMacosStyle('div', 'flex flex-col gap-1 p-3 rounded-xl bg-card border border-border', {}, lightPalette.foreground, false);
    const makeCell = (label: string): LayoutNode => ({
      tag: 'div',
      isPortal: false,
      style: cellStyle,
      text: label,
      children: [],
      frame: { x: 0, y: 0, width: 0, height: 0 },
    });

    const root: LayoutNode = {
      tag: 'section',
      isPortal: false,
      style: gridStyle,
      text: undefined,
      children: [makeCell('Tasks'), makeCell('Done'), makeCell('Progress')],
      frame: { x: 0, y: 0, width: 0, height: 0 },
    };

    layoutTree(root, 0, 0, 384, 80, (txt, s) => ({ width: txt.length * 8, height: s.fontSize * 1.4 }));
    // (384 - 2*12) / 3 = 120px per column
    expect(root.children[0]!.frame.width).toBeCloseTo(120, 1);
    expect(root.children[1]!.frame.x).toBeCloseTo(132, 1);
    expect(root.children[2]!.frame.x).toBeCloseTo(264, 1);
  });
});
