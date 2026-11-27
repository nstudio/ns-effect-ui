/**
 * Shared Effect Pulse application: ONE Effect UI `Html.component` + shared CSS
 * running identically on:
 *   1. Web (`BrowserHost`)
 *   2. iOS (`MasonHost` + MasonKit Rust/Taffy native views)
 *   3. Android (`MasonHost` + MasonKit Rust/Taffy native views)
 *   4. Node Vitest (`HtmlScene` + deterministic `Haptics.testLayer`)
 */
import { Head, UiSchema } from '@effect/ui';
import { Html } from '@effect/ui/html';
import { Switch } from '@effect/ui-kit';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import * as Schema from 'effect/Schema';
import {
  FetchPulseSnapshot,
  Filter,
  initialTasks,
  Priority,
  Task,
  TriggerHaptic,
} from '../domain/Task.ts';

export const PulseModel = Schema.Struct({
  tasks: Schema.Array(Task),
  filter: Filter,
  hapticsEnabled: Schema.Boolean,
  compactMode: Schema.Boolean,
  composerOpen: Schema.Boolean,
  draftTitle: Schema.String,
  draftTag: Schema.String,
  draftPriority: Priority,
  syncCycle: Schema.Number,
  nextId: Schema.Number,
});
export type PulseModel = typeof PulseModel.Type;

export const PulseMessage = UiSchema.TaggedEnum({
  SelectedFilter: { filter: Filter },
  ToggledTask: { id: Schema.String },
  DeletedTask: { id: Schema.String },
  ToggledHaptics: { checked: Schema.Boolean },
  ToggledCompactMode: { checked: Schema.Boolean },
  ClickedOpenComposer: {},
  RequestedCloseComposer: {},
  UpdatedDraftTitle: { value: Schema.String },
  UpdatedDraftTag: { value: Schema.String },
  SelectedDraftPriority: { priority: Priority },
  SubmittedComposer: {},
  ClickedSyncFeed: {},
});
export type PulseMessage = typeof PulseMessage.Type;

const priorityLabel: Record<Priority, string> = {
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

const priorityBadgeClass: Record<Priority, string> = {
  high: 'ep-priority-high',
  normal: 'ep-priority-normal',
  low: 'ep-priority-low',
};

const filterLabels: ReadonlyArray<readonly [Filter, string]> = [
  ['all', 'All'],
  ['active', 'Active'],
  ['done', 'Done'],
];

const priorities: ReadonlyArray<Priority> = ['high', 'normal', 'low'];

export const PulseApp = Html.component({
  name: 'PulseApp',
  model: PulseModel,
  message: PulseMessage,
  queries: {
    snapshot: {
      query: FetchPulseSnapshot,
      args: ({ model }) => ({ cycle: model.syncCycle }),
    },
  },
}).make({
  init: () => ({
    tasks: [...initialTasks],
    filter: 'all' as const,
    hapticsEnabled: true,
    compactMode: false,
    composerOpen: false,
    draftTitle: '',
    draftTag: 'Feature',
    draftPriority: 'normal' as const,
    syncCycle: 1,
    nextId: initialTasks.length + 1,
  }),

  head: ({ model }) => {
    const remaining = model.tasks.filter((t) => !t.done).length;
    return [Head.title(remaining > 0 ? `Effect Pulse (${remaining})` : 'Effect Pulse')];
  },

  update: {
    SelectedFilter: ($, { filter }) =>
      $.evolve({ filter }).run(
        TriggerHaptic.make({ style: 'tick', enabled: $.model.hapticsEnabled }),
      ),

    ToggledTask: ($, { id }) => {
      const target = $.model.tasks.find((t) => t.id === id);
      const nextDone = target ? !target.done : false;
      return $.evolve({
        tasks: (tasks) => tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
      }).run(
        TriggerHaptic.make({
          style: nextDone ? 'success' : 'tap',
          enabled: $.model.hapticsEnabled,
        }),
      );
    },

    DeletedTask: ($, { id }) =>
      $.evolve({
        tasks: (tasks) => tasks.filter((t) => t.id !== id),
      }).run(
        TriggerHaptic.make({ style: 'thud', enabled: $.model.hapticsEnabled }),
      ),

    ToggledHaptics: ($, { checked }) =>
      $.evolve({ hapticsEnabled: checked }).run(
        TriggerHaptic.make({ style: 'tick', enabled: checked }),
      ),

    ToggledCompactMode: ($, { checked }) =>
      $.evolve({ compactMode: checked }).run(
        TriggerHaptic.make({ style: 'tick', enabled: $.model.hapticsEnabled }),
      ),

    ClickedOpenComposer: ($) =>
      $.evolve({
        composerOpen: true,
        draftTitle: '',
        draftTag: 'Feature',
        draftPriority: 'normal' as const,
      }).run(
        TriggerHaptic.make({ style: 'tap', enabled: $.model.hapticsEnabled }),
      ),

    RequestedCloseComposer: ($) =>
      $.evolve({ composerOpen: false }).run(
        TriggerHaptic.make({ style: 'tick', enabled: $.model.hapticsEnabled }),
      ),

    UpdatedDraftTitle: ($, { value }) => $.evolve({ draftTitle: value }),

    UpdatedDraftTag: ($, { value }) => $.evolve({ draftTag: value }),

    SelectedDraftPriority: ($, { priority }) =>
      $.evolve({ draftPriority: priority }).run(
        TriggerHaptic.make({ style: 'tick', enabled: $.model.hapticsEnabled }),
      ),

    SubmittedComposer: ($) => {
      const title = $.model.draftTitle.trim();
      if (!title) {
        return $.run(
          TriggerHaptic.make({ style: 'warning', enabled: $.model.hapticsEnabled }),
        );
      }
      const tag = $.model.draftTag.trim() || 'General';
      const created: Task = {
        id: `t-${$.model.nextId}`,
        title,
        tag,
        priority: $.model.draftPriority,
        done: false,
      };
      return $.evolve({
        tasks: (tasks) => [created, ...tasks],
        composerOpen: false,
        draftTitle: '',
        nextId: (n) => n + 1,
      }).run(
        TriggerHaptic.make({ style: 'success', enabled: $.model.hapticsEnabled }),
      );
    },

    ClickedSyncFeed: ($) =>
      $.evolve({ syncCycle: (c) => c + 1 }).run(
        TriggerHaptic.make({ style: 'tap', enabled: $.model.hapticsEnabled }),
      ),
  },

  view: (h, model) => {
    const total = model.tasks.length;
    const completed = model.tasks.filter((t) => t.done).length;
    const rate = total === 0 ? 0 : Math.round((completed / total) * 100);

    const visibleTasks = model.tasks.filter((t) => {
      if (model.filter === 'active') return !t.done;
      if (model.filter === 'done') return t.done;
      return true;
    });

    const snapshot = AsyncResult.isSuccess(h.queries.snapshot)
      ? h.queries.snapshot.value
      : undefined;
    const syncing = AsyncResult.isWaiting(h.queries.snapshot);

    const rowPad = model.compactMode ? 'px-3 py-2' : 'px-4 py-3';

    return h.main
      .class('flex flex-col gap-4 p-4 pb-24 bg-background text-foreground w-full')
      .children(
        // 1. Hero Header Banner
        h.section
          .class('ep-hero-banner flex flex-col gap-3 p-5 rounded-2xl')
          .children(
            h.div.class('flex flex-row items-center justify-between gap-2').children(
              h.span
                .class('ep-hero-pill px-3 py-1 rounded-full text-xs font-semibold')
                .children(snapshot ? snapshot.runtimeLabel : 'Connecting...'),
              h.span
                .class('ep-hero-pill px-3 py-1 rounded-full text-xs font-semibold')
                .children(snapshot ? `Rev #${snapshot.revision}` : 'Syncing'),
            ),
            h.h1.class('text-2xl font-bold').children('Effect Pulse'),
            h.p
              .class('ep-hero-subtitle text-sm')
              .children(
                'One Effect UI component tree and shared Tailwind CSS, rendered natively with MasonKit on iOS/Android and BrowserHost on Web.',
              ),
          ),

        // 2. KPI Bento Grid (CSS Grid via MasonKit Rust/Taffy!)
        h.section.class('grid grid-cols-3 gap-3').children(
          h.div
            .class('flex flex-col gap-1 p-3 rounded-xl bg-card border border-border')
            .children(
              h.span.class('text-xs font-medium text-muted-foreground').children('Tasks'),
              h.p
                .id('stat-total')
                .class('text-2xl font-bold text-foreground')
                .children(String(total)),
            ),
          h.div
            .class('flex flex-col gap-1 p-3 rounded-xl bg-card border border-border')
            .children(
              h.span.class('text-xs font-medium text-muted-foreground').children('Done'),
              h.p
                .id('stat-done')
                .class('text-2xl font-bold text-brand')
                .children(String(completed)),
            ),
          h.div
            .class('flex flex-col gap-1 p-3 rounded-xl bg-card border border-border')
            .children(
              h.span.class('text-xs font-medium text-muted-foreground').children('Progress'),
              h.p
                .id('stat-rate')
                .class('text-2xl font-bold text-foreground')
                .children(`${rate}%`),
            ),
        ),

        // 3. Action Bar + Filter Tabs
        h.section.class('flex flex-row items-center justify-between gap-2').children(
          h.div.class('flex flex-row items-center gap-2').children(
            ...filterLabels.map(([key, label]) =>
              h.button
                .key(key)
                .id(`filter-${key}`)
                .attr('type', 'button')
                .attr('data-active', String(model.filter === key))
                .class('ep-filter-btn px-3 py-2 rounded-lg text-xs font-semibold')
                .on('click', PulseMessage.SelectedFilter({ filter: key }))
                .children(label),
            ),
          ),
          h.button
            .id('new-task-btn')
            .attr('type', 'button')
            .class('px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold')
            .on('click', PulseMessage.ClickedOpenComposer())
            .children('+ New Task'),
        ),

        // 4. Task List Card
        h.section
          .class('flex flex-col gap-2 p-4 rounded-2xl bg-card border border-border')
          .children(
            h.div.class('flex flex-row items-center justify-between mb-1').children(
              h.h2.class('text-base font-bold text-foreground').children('Active Milestones'),
              h.span
                .class('text-xs font-medium text-muted-foreground')
                .children(`${visibleTasks.length} shown`),
            ),
            visibleTasks.length === 0
              ? h.p
                  .class('py-6 text-center text-sm text-muted-foreground')
                  .children('No tasks in this view. Tap "+ New Task" to add one.')
              : visibleTasks.map((task) =>
                  h.div
                    .key(task.id)
                    .class(
                      `flex flex-row items-center justify-between gap-3 ${rowPad} rounded-xl bg-background border border-border`,
                    )
                    .children(
                      h.button
                        .attr('type', 'button')
                        .class('flex flex-row items-center gap-3 flex-1 min-w-0 text-left')
                        .on('click', PulseMessage.ToggledTask({ id: task.id }))
                        .children(
                          h.span
                            .attr('data-done', String(task.done))
                            .class(
                              'ep-check-circle flex items-center justify-center w-6 h-6 rounded-full border-2 text-xs font-bold',
                            )
                            .children(task.done ? '✓' : ''),
                          h.div.class('flex flex-col gap-1 flex-1 min-w-0 text-left').children(
                            h.p
                              .attr('data-done', String(task.done))
                              .class('ep-task-title text-sm font-semibold text-foreground text-left')
                              .children(task.title),
                            h.div.class('flex flex-row items-center gap-2').children(
                              h.span
                                .class(
                                  `${priorityBadgeClass[task.priority]} px-2 py-0.5 rounded-full text-xs font-semibold`,
                                )
                                .children(priorityLabel[task.priority]),
                              h.span
                                .class('text-xs text-muted-foreground')
                                .children(task.tag),
                            ),
                          ),
                        ),
                      h.button
                        .attr('type', 'button')
                        .attr('aria-label', `Delete ${task.title}`)
                        .class('px-2 py-1 rounded-lg bg-secondary text-muted-foreground text-xs font-semibold')
                        .on('click', PulseMessage.DeletedTask({ id: task.id }))
                        .children('✕'),
                    ),
                ),
          ),

        // 5. @effect/ui-kit Headless Switch Controls Card
        h.section
          .class('flex flex-col gap-3 p-4 rounded-2xl bg-card border border-border')
          .children(
            h.h2
              .class('text-base font-bold text-foreground')
              .children('Effect UI Kit + Platform Layers'),
            h.div.class('flex flex-row items-center justify-between gap-3').children(
              h.div.class('flex flex-col flex-1 min-w-0').children(
                h.p.class('text-sm font-semibold text-foreground').children('Native Haptics Layer'),
                h.p
                  .class('text-xs text-muted-foreground')
                  .children('Dispatches UIFeedbackGenerator on iOS & VibrationEffect on Android'),
              ),
              Switch(h, {
                props: { checked: model.hapticsEnabled, name: 'haptics' },
                onToggle: ({ checked }) => PulseMessage.ToggledHaptics({ checked }),
                view: (parts) =>
                  parts
                    .root(
                      h.button
                        .id('switch-haptics')
                        .attr('aria-label', 'Native Haptics Layer')
                        .class('ep-switch-track w-12 h-7 p-1 rounded-full'),
                    )
                    .children(
                      parts.thumb(h.span.class('ep-switch-thumb w-5 h-5 rounded-full')),
                    ),
              }),
            ),
            h.div.class('flex flex-row items-center justify-between gap-3').children(
              h.div.class('flex flex-col flex-1 min-w-0').children(
                h.p.class('text-sm font-semibold text-foreground').children('Compact Density'),
                h.p
                  .class('text-xs text-muted-foreground')
                  .children('Powered by @effect/ui-kit headless Switch state'),
              ),
              Switch(h, {
                props: { checked: model.compactMode, name: 'compact' },
                onToggle: ({ checked }) => PulseMessage.ToggledCompactMode({ checked }),
                view: (parts) =>
                  parts
                    .root(
                      h.button
                        .id('switch-compact')
                        .attr('aria-label', 'Compact Density')
                        .class('ep-switch-track w-12 h-7 p-1 rounded-full'),
                    )
                    .children(
                      parts.thumb(h.span.class('ep-switch-thumb w-5 h-5 rounded-full')),
                    ),
              }),
            ),
          ),

        // 6. Async Query Telemetry Card
        h.section
          .class('flex flex-col gap-3 p-4 rounded-2xl bg-card border border-border')
          .children(
            h.div.class('flex flex-row items-center justify-between gap-2').children(
              h.div.class('flex flex-row items-center gap-2').children(
                h.span.class('ep-dot-live w-2.5 h-2.5 rounded-full'),
                h.h2.class('text-base font-bold text-foreground').children('Effect Query Runtime'),
              ),
              h.button
                .id('sync-feed-btn')
                .attr('type', 'button')
                .class('px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-xs font-semibold')
                .on('click', PulseMessage.ClickedSyncFeed())
                .children(syncing ? 'Syncing...' : 'Refresh'),
            ),
            snapshot
              ? h.div.class('flex flex-col gap-1').children(
                  h.p
                    .id('telemetry-status')
                    .class('text-sm font-semibold text-foreground')
                    .children(snapshot.status),
                  h.p
                    .class('text-xs text-muted-foreground')
                    .children(`Host: ${snapshot.hostLabel} • Frame budget: ${snapshot.latencyMs}ms`),
                )
              : h.p
                  .class('text-sm text-muted-foreground')
                  .children('Querying Effect fiber runtime...'),
          ),

        // 7. Native <dialog> Composer Modal (Browser top-layer on Web, showModal on NativeScript!)
        h.dialog
          .id('task-composer-dialog')
          .modal(model.composerOpen)
          .class('p-0 rounded-2xl bg-card text-card-foreground border border-border w-full max-w-md')
          .on('cancel', PulseMessage.RequestedCloseComposer())
          .children(
            h.form
              .class('flex flex-col gap-4 p-5')
              .on('submit', PulseMessage.SubmittedComposer())
              .children(
                h.div.class('flex flex-row items-center justify-between').children(
                  h.h2.class('text-lg font-bold text-foreground').children('New Milestone'),
                  h.button
                    .id('close-composer-btn')
                    .attr('type', 'button')
                    .class('px-2 py-1 rounded-lg bg-secondary text-muted-foreground text-xs font-semibold')
                    .on('click', PulseMessage.RequestedCloseComposer())
                    .children('Close'),
                ),
                h.div.class('flex flex-col gap-1.5').children(
                  h.label
                    .class('text-xs font-semibold text-muted-foreground')
                    .children('Milestone Title'),
                  h.input
                    .id('draft-title-input')
                    .attr('name', 'title')
                    .attr('placeholder', 'e.g. Ship Effect UI on iOS')
                    .class(
                      'w-full px-3 py-2.5 rounded-xl bg-background text-foreground border border-border text-sm',
                    )
                    .value(model.draftTitle)
                    .on('input', ({ value }) => PulseMessage.UpdatedDraftTitle({ value })),
                ),
                h.div.class('flex flex-col gap-1.5').children(
                  h.label
                    .class('text-xs font-semibold text-muted-foreground')
                    .children('Category Tag'),
                  h.input
                    .id('draft-tag-input')
                    .attr('name', 'tag')
                    .attr('placeholder', 'Core, Layout, Platform...')
                    .class(
                      'w-full px-3 py-2.5 rounded-xl bg-background text-foreground border border-border text-sm',
                    )
                    .value(model.draftTag)
                    .on('input', ({ value }) => PulseMessage.UpdatedDraftTag({ value })),
                ),
                h.div.class('flex flex-col gap-1.5').children(
                  h.label
                    .class('text-xs font-semibold text-muted-foreground')
                    .children('Priority'),
                  h.div.class('grid grid-cols-3 gap-2').children(
                    ...priorities.map((p) =>
                      h.button
                        .key(p)
                        .attr('type', 'button')
                        .attr('data-selected', String(model.draftPriority === p))
                        .class('ep-priority-pick py-2 rounded-lg border text-xs font-semibold')
                        .on('click', PulseMessage.SelectedDraftPriority({ priority: p }))
                        .children(priorityLabel[p]),
                    ),
                  ),
                ),
                h.div.class('flex flex-row items-center justify-end gap-2 mt-1').children(
                  h.button
                    .attr('type', 'button')
                    .class('px-4 py-2.5 rounded-xl bg-secondary text-secondary-foreground text-xs font-semibold')
                    .on('click', PulseMessage.RequestedCloseComposer())
                    .children('Cancel'),
                  h.button
                    .id('submit-task-btn')
                    .attr('type', 'submit')
                    .class('px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold')
                    .children('Create Task'),
                ),
              ),
          ),
      );
  },
});
