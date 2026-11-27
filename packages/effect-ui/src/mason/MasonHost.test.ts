import { describe, expect, it, vi } from 'vitest';

// Mock NativeScript & MasonKit native modules so MasonHost runs cleanly in Node Vitest.
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
import { Switch } from '@effect/ui-kit';
import type { View as NSView } from '@nativescript/core';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import { MasonHost } from './index.ts';
import {
  createMockDialogPresenter,
  createMockMasonView,
  findViews,
  textContentOf,
} from '../testing/MockMasonHost.ts';

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('MasonHost (HTML-compatible NativeScript host)', () => {
  it('mounts and updates a shared Html.component with click events and live text nodes', async () => {
    const Msg = UiSchema.TaggedEnum({
      ClickedIncrement: {},
      ClickedReset: {},
    });

    const Counter = Html.component({
      name: 'Counter',
      model: Schema.Struct({ count: Schema.Number }),
      message: Msg,
    }).make({
      init: () => ({ count: 0 }),
      update: {
        ClickedIncrement: ($) => $.evolve({ count: (c) => c + 1 }),
        ClickedReset: ($) => $.evolve({ count: 0 }),
      },
      view: (h, model) =>
        h.div.class('counter p-4').children(
          h.h2('Counter'),
          h.p.id('count').children(`Count: ${model.count}`),
          h.button.id('inc').on('click', Msg.ClickedIncrement()).children('+1'),
          h.button.id('reset').on('click', Msg.ClickedReset()).children('Reset'),
        ),
    });

    const rootContainer = createMockMasonView('scroll');

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const mounted = yield* MasonHost.mountEffect(
            Counter,
            {},
            rootContainer as unknown as NSView,
            {
              host: {
                createElement: (tag) => createMockMasonView(tag) as unknown as NSView,
              },
            },
          );

          expect(mounted.model()).toEqual({ count: 0 });
          const countEl = findViews(rootContainer, (v) => v.id === 'count')[0]!;
          expect(textContentOf(countEl)).toBe('Count: 0');

          const incBtn = findViews(rootContainer, (v) => v.id === 'inc')[0]!;
          incBtn.emit('click');
          incBtn.emit('click');
          yield* Effect.promise(flushMicrotasks);

          expect(mounted.model()).toEqual({ count: 2 });
          expect(textContentOf(countEl)).toBe('Count: 2');

          const resetBtn = findViews(rootContainer, (v) => v.id === 'reset')[0]!;
          resetBtn.emit('click');
          yield* Effect.promise(flushMicrotasks);

          expect(mounted.model()).toEqual({ count: 0 });
          expect(textContentOf(countEl)).toBe('Count: 0');
        }),
      ),
    );
  });

  it('supports controlled inputs, form submission, and reverts rejected edits', async () => {
    const Msg = UiSchema.TaggedEnum({
      UpdatedDraft: { value: Schema.String },
      Submitted: { value: Schema.String },
    });

    const FormComp = Html.component({
      name: 'FormComp',
      model: Schema.Struct({ draft: Schema.String, lastSubmitted: Schema.String }),
      message: Msg,
    }).make({
      init: () => ({ draft: '', lastSubmitted: '' }),
      update: {
        // Reject digits to verify controlled input revert.
        UpdatedDraft: ($, { value }) =>
          /\d/.test(value) ? $.model : $.evolve({ draft: value }),
        Submitted: ($, { value }) => $.evolve({ draft: '', lastSubmitted: value }),
      },
      view: (h, model) =>
        h.form
          .on('submit', ({ fields }) => Msg.Submitted({ value: fields['title'] ?? '' }))
          .children(
            h.input
              .id('title-input')
              .attr('name', 'title')
              .value(model.draft)
              .on('input', ({ value }) => Msg.UpdatedDraft({ value })),
            h.button.id('submit-btn').attr('type', 'submit').children('Save'),
          ),
    });

    const rootContainer = createMockMasonView('scroll');

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const mounted = yield* MasonHost.mountEffect(
            FormComp,
            {},
            rootContainer as unknown as NSView,
            {
              host: {
                createElement: (tag) => createMockMasonView(tag) as unknown as NSView,
              },
            },
          );

          const input = findViews(rootContainer, (v) => v.id === 'title-input')[0]!;
          input.value = 'Ship MasonHost';
          input.emit('input', { value: 'Ship MasonHost' });
          yield* Effect.promise(flushMicrotasks);
          expect(mounted.model()?.draft).toBe('Ship MasonHost');

          // Rejected input containing digits reverts back to model value.
          input.value = 'Ship123';
          input.emit('input', { value: 'Ship123' });
          yield* Effect.promise(flushMicrotasks);
          expect(mounted.model()?.draft).toBe('Ship MasonHost');
          expect(input.value).toBe('Ship MasonHost');

          // Clicking submit button dispatches form `submit` with collected fields.
          const submitBtn = findViews(rootContainer, (v) => v.id === 'submit-btn')[0]!;
          submitBtn.emit('click');
          yield* Effect.promise(flushMicrotasks);
          expect(mounted.model()).toEqual({ draft: '', lastSubmitted: 'Ship MasonHost' });
          expect(input.value).toBe('');
        }),
      ),
    );
  });

  it('presents <dialog> natively via DialogPresenter and handles cancel events', async () => {
    const Msg = UiSchema.TaggedEnum({
      ClickedOpen: {},
      CancelledDialog: {},
    });

    const DialogDemo = Html.component({
      name: 'DialogDemo',
      model: Schema.Struct({ open: Schema.Boolean }),
      message: Msg,
    }).make({
      init: () => ({ open: false }),
      update: {
        ClickedOpen: ($) => $.evolve({ open: true }),
        CancelledDialog: ($) => $.evolve({ open: false }),
      },
      view: (h, model) =>
        h.div(
          h.button.id('open-btn').on('click', Msg.ClickedOpen()).children('Open'),
          h.dialog
            .id('modal-dialog')
            .modal(model.open)
            .on('cancel', Msg.CancelledDialog())
            .children(h.p('Native Modal Content')),
        ),
    });

    const rootContainer = createMockMasonView('scroll');
    const mockDialogs = createMockDialogPresenter();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const mounted = yield* MasonHost.mountEffect(
            DialogDemo,
            {},
            rootContainer as unknown as NSView,
            {
              host: {
                createElement: (tag) => createMockMasonView(tag) as unknown as NSView,
                dialogPresenter: mockDialogs.presenter,
              },
            },
          );

          expect(mockDialogs.openDialogs.size).toBe(0);

          const openBtn = findViews(rootContainer, (v) => v.id === 'open-btn')[0]!;
          openBtn.emit('click');
          yield* Effect.promise(flushMicrotasks);

          expect(mounted.model()).toEqual({ open: true });
          expect(mockDialogs.openDialogs.size).toBe(1);

          const [record] = [...mockDialogs.openDialogs.values()];
          expect(record?.mode).toBe('modal');
          expect(textContentOf(record?.dialog)).toBe('Native Modal Content');

          // Simulate tapping backdrop -> cancel event -> Model closes dialog.
          record?.onCancel();
          yield* Effect.promise(flushMicrotasks);

          expect(mounted.model()).toEqual({ open: false });
          expect(mockDialogs.openDialogs.size).toBe(0);
        }),
      ),
    );
  });

  it('renders @effect/ui-kit Switch with data-checked / data-unchecked CSS state notifications', async () => {
    const Msg = UiSchema.TaggedEnum({
      ToggledHaptics: { checked: Schema.Boolean },
    });

    const SettingsComp = Html.component({
      name: 'SettingsComp',
      model: Schema.Struct({ enabled: Schema.Boolean }),
      message: Msg,
    }).make({
      init: () => ({ enabled: false }),
      update: {
        ToggledHaptics: ($, { checked }) => $.evolve({ enabled: checked }),
      },
      view: (h, model) =>
        Switch(h, {
          props: { checked: model.enabled },
          onToggle: ({ checked }) => Msg.ToggledHaptics({ checked }),
          view: (parts) =>
            parts
              .root(h.button.id('haptics-switch').class('switch'))
              .children(parts.thumb(h.span.class('thumb'))),
        }),
    });

    const rootContainer = createMockMasonView('scroll');

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const mounted = yield* MasonHost.mountEffect(
            SettingsComp,
            {},
            rootContainer as unknown as NSView,
            {
              host: {
                createElement: (tag) => createMockMasonView(tag) as unknown as NSView,
              },
            },
          );

          const sw = findViews(rootContainer, (v) => v.id === 'haptics-switch')[0]!;
          expect(sw['role']).toBe('switch');
          expect(sw['data-unchecked']).toBe('');
          expect(sw['data-checked']).toBeUndefined();
          const initialCssTicks = sw.cssStateChanges;

          sw.emit('click');
          yield* Effect.promise(flushMicrotasks);

          expect(mounted.model()).toEqual({ enabled: true });
          expect(sw['data-checked']).toBe('');
          expect(sw['data-unchecked']).toBeUndefined();
          expect(sw.cssStateChanges).toBeGreaterThan(initialCssTicks);
        }),
      ),
    );
  });

  it('keeps @effect/ui-kit Switch hidden input out of nativeChildren while still submitting its form value', async () => {
    const Msg = UiSchema.TaggedEnum({
      ToggledHaptics: { checked: Schema.Boolean },
      Submitted: {},
    });

    const submissions: Array<Record<string, string>> = [];

    const SettingsForm = Html.component({
      name: 'SettingsForm',
      model: Schema.Struct({ enabled: Schema.Boolean }),
      message: Msg,
    }).make({
      init: () => ({ enabled: true }),
      update: {
        ToggledHaptics: ($, { checked }) => $.evolve({ enabled: checked }),
        Submitted: ($) => $.model,
      },
      view: (h, model) =>
        h.form
          .on('submit', ({ fields }) => {
            submissions.push({ ...fields });
            return Msg.Submitted();
          })
          .children(
            Switch(h, {
              props: { checked: model.enabled, name: 'haptics' },
              onToggle: ({ checked }) => Msg.ToggledHaptics({ checked }),
              view: (parts) =>
                parts
                  .root(h.button.id('haptics-switch').class('switch'))
                  .children(parts.thumb(h.span.id('haptics-thumb').class('thumb'))),
            }),
            h.button.id('submit-btn').attr('type', 'submit').children('Save'),
          ),
    });

    const rootContainer = createMockMasonView('scroll');

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const mounted = yield* MasonHost.mountEffect(
            SettingsForm,
            {},
            rootContainer as unknown as NSView,
            {
              host: {
                createElement: (tag) => createMockMasonView(tag) as unknown as NSView,
              },
            },
          );

          const sw = findViews(rootContainer, (v) => v.id === 'haptics-switch')[0]!;
          const thumb = findViews(rootContainer, (v) => v.id === 'haptics-thumb')[0]!;
          const submitBtn = findViews(rootContainer, (v) => v.id === 'submit-btn')[0]!;

          expect(sw.nativeChildren).toEqual([thumb]);
          expect(findViews(rootContainer, (v) => v.tag === 'input')).toEqual([]);

          submitBtn.emit('click');
          yield* Effect.promise(flushMicrotasks);
          expect(submissions).toEqual([{ haptics: 'on' }]);

          sw.emit('click');
          yield* Effect.promise(flushMicrotasks);
          expect(mounted.model()).toEqual({ enabled: false });
          expect(sw.nativeChildren).toEqual([thumb]);

          submitBtn.emit('click');
          yield* Effect.promise(flushMicrotasks);
          expect(submissions).toEqual([{ haptics: 'on' }, {}]);

          sw.emit('click');
          yield* Effect.promise(flushMicrotasks);
          expect(mounted.model()).toEqual({ enabled: true });
          expect(sw.nativeChildren).toEqual([thumb]);

          submitBtn.emit('click');
          yield* Effect.promise(flushMicrotasks);
          expect(submissions).toEqual([{ haptics: 'on' }, {}, { haptics: 'on' }]);
        }),
      ),
    );
  });

  it('detaches and re-attaches <input> in exact sibling order when type transitions to/from hidden', () => {
    const host = MasonHost.makeHost({
      createElement: (tag) => createMockMasonView(tag) as unknown as NSView,
    });

    const parent = createMockMasonView('div');
    const parentNode = parent as unknown as NSView;
    const before = host.createElement('span');
    const input = host.createElement('input');
    const after = host.createElement('span');

    host.insertBefore(parentNode, before, undefined);
    host.insertBefore(parentNode, input, undefined);
    host.insertBefore(parentNode, after, undefined);

    expect(parent.nativeChildren).toEqual([before, input, after]);
    expect(host.parentOf(input)).toBe(parentNode);
    expect(host.nextOf(before)).toBe(input);
    expect(host.nextOf(input)).toBe(after);

    host.setAttr(input, 'type', 'hidden', 'text');
    expect(parent.nativeChildren).toEqual([before, after]);
    expect(host.parentOf(input)).toBe(parentNode);
    expect(host.nextOf(before)).toBe(input);
    expect(host.nextOf(input)).toBe(after);

    host.setAttr(input, 'type', 'text', 'hidden');
    expect(parent.nativeChildren).toEqual([before, input, after]);

    host.setAttr(input, 'type', 'HIDDEN', 'text');
    expect(parent.nativeChildren).toEqual([before, after]);

    host.setAttr(input, 'type', undefined, 'HIDDEN');
    expect(parent.nativeChildren).toEqual([before, input, after]);

    host.dispose();
  });
});
