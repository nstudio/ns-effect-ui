/**
 * Strategy A demonstration: a dedicated `Native.component(...)` built directly
 * with NativeScript core controls (`stackLayout`, `label`, `button`, `switch`,
 * `slider`, `progress`) and wired to the `TriggerHaptic` Effect Command!
 */
import { UiSchema } from '@effect/ui';
import { Native } from '@nativescript/effect-ui/native';
import { TriggerHaptic } from '@ns-effect-ui/shared';
import * as Schema from 'effect/Schema';

const NativeLabModel = Schema.Struct({
  count: Schema.Number,
  intensity: Schema.Number,
  turbo: Schema.Boolean,
});

const NativeLabMessage = UiSchema.TaggedEnum({
  TappedIncrement: {},
  TappedReset: {},
  ChangedIntensity: { value: Schema.Number },
  ToggledTurbo: { checked: Schema.Boolean },
});

export const NativeControlLab = Native.component({
  name: 'NativeControlLab',
  model: NativeLabModel,
  message: NativeLabMessage,
}).make({
  init: () => ({
    count: 0,
    intensity: 65,
    turbo: true,
  }),

  update: {
    TappedIncrement: ($) =>
      $.evolve({
        count: (c) => c + ($.model.turbo ? 5 : 1),
      }).run(TriggerHaptic.make({ style: 'tap', enabled: true })),

    TappedReset: ($) =>
      $.evolve({ count: 0 }).run(TriggerHaptic.make({ style: 'thud', enabled: true })),

    ChangedIntensity: ($, { value }) =>
      $.evolve({ intensity: Math.round(value) }),

    ToggledTurbo: ($, { checked }) =>
      $.evolve({ turbo: checked }).run(
        TriggerHaptic.make({ style: 'tick', enabled: true }),
      ),
  },

  view: (h, model) =>
    h.stackLayout.style({ padding: 16 }).children(
      h.stackLayout.class('native-lab-card').children(
        h.label.class('native-lab-title').text('Native.component() Vocabulary'),
        h.label
          .class('native-lab-subtitle')
          .textWrap(true)
          .text(
            'Strategy A: Direct NativeScript core views (UIKit / Android Views) driven by Effect UI state, Commands, and Haptics Layers.',
          ),
        h.label.class('native-lab-value').text(`Score: ${model.count}`),
        h.button
          .class('native-lab-btn')
          .text(model.turbo ? 'Increment (+5 Turbo)' : 'Increment (+1)')
          .on('tap', NativeLabMessage.TappedIncrement()),
        h.button
          .class('native-lab-btn-secondary')
          .text('Reset Score')
          .on('tap', NativeLabMessage.TappedReset()),
      ),

      h.stackLayout.class('native-lab-card').children(
        h.label.class('native-lab-title').text('Native Controls'),
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
          .style({ marginTop: 12, marginBottom: 16 }),
        h.gridLayout.columns('*, auto').rows('auto').children(
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
      ),
    ),
});
