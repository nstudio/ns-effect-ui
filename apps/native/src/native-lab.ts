/**
 * Strategy A + Full Native Capabilities Lab:
 * Demonstrates all 6 zero-bridge pure-TypeScript NativeScript modules on top of
 * `@effect/ui`:
 * 1. `NativeMotion` — UI-thread CoreAnimation / Android RenderThread springs
 * 2. `NativeSheet` — iOS `UISheetPresentationController` / Android bottom sheet
 * 3. `VirtualList` — 1,000-row slot-recycled windowing (5 live native views)
 * 4. `NativeKeyboard` — live IME height/phase Subscription + DismissKeyboard Command
 * 5. `NativeDevTools` — live MessageLog Wire frame counter
 * 6. `NativeCrash` — drop-in recovery boundary wired in `main.ts`
 */
import { UiSchema } from '@effect/ui';
import * as Command from '@effect/ui/Command';
import * as Component from '@effect/ui/Component';
import {
  DismissKeyboard,
  dockedComposerStyle,
  watchKeyboard,
} from '@nativescript/effect-ui/keyboard';
import * as VirtualList from '@nativescript/effect-ui/list';
import { detectMotionBackend, track } from '@nativescript/effect-ui/motion';
import { Native } from '@nativescript/effect-ui/native';
import { presentNativeSheet } from '@nativescript/effect-ui/sheet';
import { Application, Button, Frame, Label, StackLayout, type View as NSView } from '@nativescript/core';
import { TriggerHaptic } from '@ns-effect-ui/shared';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

const THOUSAND_ROWS: ReadonlyArray<{ readonly id: number; readonly label: string; readonly tag: string }> =
  Array.from({ length: 1_000 }, (_, i) => ({
    id: i + 1,
    label: `Effect Native Item #${i + 1}`,
    tag: i % 3 === 0 ? 'UIKit/Views' : i % 3 === 1 ? 'Taffy Grid' : 'Zero Bridge',
  }));

const BlockJsForOneSecond = Command.make('NativeLab/blockJs1s', {}, () =>
  Effect.sync(() => {
    // Wait 32ms so CoreAnimation / RenderThread commits the spring frame first,
    // then block the JS thread for 1,000ms to prove native UI-thread motion stays 60fps.
    setTimeout(() => {
      const end = Date.now() + 1000;
      while (Date.now() < end) {
        // Intentional synchronous JS stall.
      }
    }, 32);
    return Component.noop;
  }),
);

const OpenDetentSheet = Command.make('NativeLab/openDetentSheet', {}, () =>
  Effect.sync(() => {
    const presenter = Frame.topmost()?.currentPage ?? Application.getRootView();
    if (!presenter || typeof presenter.showModal !== 'function') return Component.noop;

    const sheetRoot = new StackLayout();
    sheetRoot.className = 'native-sheet-surface';
    sheetRoot.padding = 24;

    const heading = new Label();
    heading.text = 'Native OS Bottom Sheet';
    heading.className = 'native-lab-title';
    sheetRoot.addChild(heading as unknown as NSView);

    const body = new Label();
    body.text =
      'Presented directly via UISheetPresentationController (medium & large detents, grabber, Liquid Glass on iOS 26+) and bottom-docked sheet window on Android — zero native plugins.';
    body.textWrap = true;
    body.className = 'native-lab-subtitle';
    sheetRoot.addChild(body as unknown as NSView);

    const closeBtn = new Button();
    closeBtn.text = 'Close Sheet';
    closeBtn.className = 'native-lab-btn';
    closeBtn.on('tap', () => sheetRoot.closeModal());
    sheetRoot.addChild(closeBtn as unknown as NSView);

    presentNativeSheet(presenter as never, sheetRoot, {
      detents: ['medium', 'large'],
      grabber: true,
      cornerRadius: 24,
      dismissable: true,
    });
    return Component.noop;
  }),
);

const NativeLabModel = Schema.Struct({
  count: Schema.Number,
  intensity: Schema.Number,
  turbo: Schema.Boolean,
  puckShifted: Schema.Boolean,
  lastBlockedJs: Schema.Boolean,
  virtualList: VirtualList.VirtualListModel,
  kbVisible: Schema.Boolean,
  kbHeight: Schema.Number,
  composerText: Schema.String,
});

const NativeLabMessage = UiSchema.TaggedEnum({
  TappedIncrement: {},
  TappedReset: {},
  ChangedIntensity: { value: Schema.Number },
  ToggledTurbo: { checked: Schema.Boolean },
  TappedSpringGlide: {},
  TappedBlockJsMotion: {},
  TappedOpenSheet: {},
  JumpedVirtualRow: { index: Schema.Number },
  KeyboardChanged: { visible: Schema.Boolean, height: Schema.Number },
  ChangedComposer: { value: Schema.String },
  TappedDismissKeyboard: {},
});

let readDevToolsCount: () => number = () => 0;

export function bindNativeLabDevToolsReader(reader: () => number): void {
  readDevToolsCount = reader;
}

export const NativeControlLab = Native.component({
  name: 'NativeControlLab',
  model: NativeLabModel,
  message: NativeLabMessage,
}).make({
  init: () => ({
    count: 0,
    intensity: 65,
    turbo: true,
    puckShifted: false,
    lastBlockedJs: false,
    virtualList: VirtualList.init({
      totalCount: THOUSAND_ROWS.length,
      viewportHeight: 220,
      estimatedItemHeight: 44,
      overscanPx: 0,
      recycle: true,
    }),
    kbVisible: false,
    kbHeight: 0,
    composerText: '',
  }),

  subscriptions: () => [
    watchKeyboard((state) =>
      NativeLabMessage.KeyboardChanged({
        visible: state.visible,
        height: state.height,
      }),
    ),
  ],

  update: {
    TappedIncrement: ($) =>
      $.evolve({
        count: (c) => c + ($.model.turbo ? 5 : 1),
      }).run(TriggerHaptic.make({ style: 'tap', enabled: true })),

    TappedReset: ($) =>
      $.evolve({ count: 0 }).run(TriggerHaptic.make({ style: 'thud', enabled: true })),

    ChangedIntensity: ($, { value }) => $.evolve({ intensity: Math.round(value) }),

    ToggledTurbo: ($, { checked }) =>
      $.evolve({ turbo: checked }).run(TriggerHaptic.make({ style: 'tick', enabled: true })),

    TappedSpringGlide: ($) =>
      $.evolve({
        puckShifted: (s) => !s,
        lastBlockedJs: false,
      }).run(TriggerHaptic.make({ style: 'tick', enabled: true })),

    TappedBlockJsMotion: ($) =>
      $.evolve({
        puckShifted: (s) => !s,
        lastBlockedJs: true,
      })
        .run(TriggerHaptic.make({ style: 'tap', enabled: true }))
        .run(BlockJsForOneSecond.make({})),

    TappedOpenSheet: ($) =>
      $.run(TriggerHaptic.make({ style: 'tap', enabled: true })).run(OpenDetentSheet.make({})),

    JumpedVirtualRow: ($, { index }) =>
      $.evolve({
        virtualList: (vl) => VirtualList.scrolled(vl, index * vl.estimatedItemHeight),
      }).run(TriggerHaptic.make({ style: 'tick', enabled: true })),

    KeyboardChanged: ($, { visible, height }) =>
      $.evolve({ kbVisible: visible, kbHeight: height }),

    ChangedComposer: ($, { value }) => $.evolve({ composerText: value }),

    TappedDismissKeyboard: ($) => $.run(DismissKeyboard.make({})),
  },

  view: (h, model) => {
    const win = VirtualList.computeWindow(model.virtualList, THOUSAND_ROWS);
    const backend = detectMotionBackend();
    const wireCount = readDevToolsCount();
    const composerDock = dockedComposerStyle(
      {
        visible: model.kbVisible,
        height: model.kbHeight,
        durationMs: 250,
        phase: model.kbVisible ? 'visible' : 'hidden',
      },
      0,
    );

    return h.stackLayout.style({ padding: 16, paddingBottom: 48 }).children(
      // 1. UI-Thread Motion (CoreAnimation / Android RenderThread)
      h.stackLayout.class('native-lab-card').children(
        h.label.class('native-lab-title').text('UI-Thread Native Motion'),
        h.label
          .class('native-lab-subtitle')
          .textWrap(true)
          .text(
            `Backend: ${backend} · Runs on OS render server even when JS is stalled 1s (zero Reanimated).`,
          ),
        h.stackLayout
          .style({
            height: 56,
            borderRadius: 12,
            backgroundColor: '#ebe5d8',
            padding: 8,
            marginBottom: 10,
          })
          .children(
            h.stackLayout
              .onMount(
                track({
                  from: { opacity: 0.4, scale: 0.92 },
                  to: {
                    opacity: 1,
                    translateX: model.puckShifted ? 190 : 0,
                    scale: model.puckShifted ? 1.08 : 1,
                  },
                  spring: { damping: 0.62, velocity: 0.6 },
                  durationMs: 700,
                }),
              )
              .style({
                width: 96,
                height: 40,
                borderRadius: 10,
                backgroundColor: '#1f6f63',
                horizontalAlignment: 'left',
              })
              .children(
                h.label
                  .text(model.puckShifted ? 'Spring →' : '← Spring')
                  .style({
                    color: '#ffffff',
                    fontSize: 13,
                    fontWeight: '700',
                    textAlignment: 'center',
                    marginTop: 10,
                  }),
              ),
          ),
        h.gridLayout.columns('*, *').rows('auto').children(
          h.button
            .col(0)
            .class('native-lab-btn')
            .style({ marginRight: 6 })
            .text('Spring Glide')
            .on('tap', NativeLabMessage.TappedSpringGlide()),
          h.button
            .col(1)
            .class('native-lab-btn-secondary')
            .style({ marginLeft: 6 })
            .text('Glide + Block JS 1s')
            .on('tap', NativeLabMessage.TappedBlockJsMotion()),
        ),
      ),

      // 2. Native OS Bottom Sheet + DevTools Wire Counter
      h.stackLayout.class('native-lab-card').children(
        h.label.class('native-lab-title').text('Native Detent Sheet & DevTools'),
        h.label
          .class('native-lab-subtitle')
          .textWrap(true)
          .text(
            `UISheetPresentationController / Material Sheet + MessageLog Wire bridge (${wireCount} frames encoded).`,
          ),
        h.button
          .class('native-lab-btn')
          .text('Open Native Detent Sheet')
          .on('tap', NativeLabMessage.TappedOpenSheet()),
      ),

      // 3. 1,000-Row Recycled VirtualList
      h.stackLayout.class('native-lab-card').children(
        h.label.class('native-lab-title').text('Recycled VirtualList (1,000 Rows)'),
        h.label
          .class('native-lab-subtitle')
          .text(
            `Showing rows ${win.startIndex + 1}–${win.endIndex + 1} of 1,000 · ${win.visibleItems.length} recycled native views`,
          ),
        h.gridLayout.columns('*, *, *, *').rows('auto').style({ marginBottom: 10 }).children(
          h.button
            .col(0)
            .class('native-lab-chip')
            .text('#1')
            .on('tap', NativeLabMessage.JumpedVirtualRow({ index: 0 })),
          h.button
            .col(1)
            .class('native-lab-chip')
            .text('#250')
            .on('tap', NativeLabMessage.JumpedVirtualRow({ index: 249 })),
          h.button
            .col(2)
            .class('native-lab-chip')
            .text('#500')
            .on('tap', NativeLabMessage.JumpedVirtualRow({ index: 499 })),
          h.button
            .col(3)
            .class('native-lab-chip')
            .text('#995')
            .on('tap', NativeLabMessage.JumpedVirtualRow({ index: 994 })),
        ),
        ...win.visibleItems.map((entry) =>
          h.gridLayout
            .key(entry.key)
            .columns('*, auto')
            .rows('auto')
            .class('native-lab-vrow')
            .children(
              h.label
                .col(0)
                .text(entry.item.label)
                .style({ fontSize: 14, fontWeight: '600', color: '#1b1d1b' }),
              h.label
                .col(1)
                .text(`slot ${entry.slot} · ${entry.item.tag}`)
                .style({ fontSize: 12, color: '#1f6f63', fontWeight: '600' }),
            ),
        ),
      ),

      // 4. Native Keyboard Subscription & Docked Composer
      h.stackLayout
        .class('native-lab-card')
        .style({ marginBottom: composerDock.marginBottom + 14 })
        .children(
          h.label.class('native-lab-title').text('Native Keyboard Subscription'),
          h.label
            .class('native-lab-subtitle')
            .text(
              `IME state: ${model.kbVisible ? `visible (${model.kbHeight}dp)` : 'hidden (0dp)'} · Direct OS insets`,
            ),
          h.textField
            .class('native-lab-input')
            .hint('Type to test native keyboard subscription...')
            .text(model.composerText)
            .on('textChange', ({ value }) => NativeLabMessage.ChangedComposer({ value })),
          h.button
            .class('native-lab-btn-secondary')
            .text('Dismiss Keyboard')
            .on('tap', NativeLabMessage.TappedDismissKeyboard()),
        ),

      // 5. Strategy A Native Controls
      h.stackLayout.class('native-lab-card').children(
        h.label.class('native-lab-title').text('Native Controls & Haptics'),
        h.label.class('native-lab-value').text(`Score: ${model.count}`),
        h.label
          .class('native-lab-subtitle')
          .text(`Native UISlider / SeekBar value: ${model.intensity}%`),
        h.slider
          .minValue(0)
          .maxValue(100)
          .value(model.intensity)
          .on('valueChange', ({ value }) => NativeLabMessage.ChangedIntensity({ value })),
        h.progress
          .value(model.intensity)
          .maxValue(100)
          .style({ marginTop: 12, marginBottom: 14 }),
        h.gridLayout.columns('*, auto').rows('auto').style({ marginBottom: 10 }).children(
          h.label
            .col(0)
            .text('Turbo Mode (+5 per tap)')
            .style({ fontSize: 15, fontWeight: '600', verticalAlignment: 'center' }),
          h.switch
            .col(1)
            .checked(model.turbo)
            .on('checkedChange', ({ checked }) =>
              NativeLabMessage.ToggledTurbo({ checked }),
            ),
        ),
        h.gridLayout.columns('*, *').rows('auto').children(
          h.button
            .col(0)
            .class('native-lab-btn')
            .style({ marginRight: 6 })
            .text(model.turbo ? '+5 Turbo' : '+1')
            .on('tap', NativeLabMessage.TappedIncrement()),
          h.button
            .col(1)
            .class('native-lab-btn-secondary')
            .style({ marginLeft: 6 })
            .text('Reset')
            .on('tap', NativeLabMessage.TappedReset()),
        ),
      ),
    );
  },
});
