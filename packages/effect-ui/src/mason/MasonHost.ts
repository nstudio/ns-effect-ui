/**
 * `MasonHost`: an HTML-compatible NativeScript rendering host for `@effect/ui`,
 * powered by `@triniwiz/nativescript-masonkit`.
 *
 * Mounts unmodified `@effect/ui/html` components (`Html.component(...)`) — and
 * `@effect/ui-kit` headless components — directly onto native iOS & Android
 * views with Rust/Taffy CSS Flexbox & Grid layout, native `<dialog>` modals,
 * controlled inputs, and `h.keepAlive` support.
 *
 * @example
 * ```ts
 * import { MasonHost } from "@nativescript/effect-ui/mason"
 * import { App } from "./App"
 *
 * MasonHost.run(App, {}, {
 *   title: "Effect Studio",
 *   layer: NativePlatformLayer,
 * })
 * ```
 */
import type * as Component from '@effect/ui/Component';
import { Html, HtmlSubscription } from '@effect/ui/html';
import * as Renderer from '@effect/ui/Renderer';
import type * as View from '@effect/ui/View';
import { Application, Frame, Page, type View as NSView } from '@nativescript/core';
import { Scroll, View as MasonView } from '@triniwiz/nativescript-masonkit';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type * as AsyncResult from 'effect/reactivity/AsyncResult';
import type * as Scope from 'effect/Scope';
import { createDialogPresenter, type DialogPresenter } from './dialog.ts';
import {
  createContainerNode,
  createMasonElement,
  createTextNode,
  type ElementConstructor,
  getTagName,
  isContainer,
  isTextNode,
  isViewNode,
  type MasonNode,
} from './elements.ts';
import { createEventController, type EventController } from './events.ts';
import {
  ensureRuntimeGlobals,
  makeNativeAnimationFrames,
  makeNativeGlobalEvents,
  makeNativeHtmlHost,
  makeNativeMediaQueries,
} from './services.ts';
import { applyAttr, applyNonControlledProp } from './styles.ts';

/**
 * Passes when a root renders HTML or is host-neutral, matching `BrowserHost.HtmlRoot`.
 */
export type MasonRoot<V> = [Renderer.HostOf<V>] extends [Html.Host]
  ? unknown
  : {
      readonly 'MasonHost.mount shows HTML elements. This root vocabulary needs': Renderer.HostOf<V>;
    };

export interface MakeHostOptions {
  /** Override or extend the HTML tag -> NativeScript/MasonKit view constructor map. */
  readonly elements?: Readonly<Record<string, ElementConstructor>> | undefined;
  /** Custom element factory (primarily useful for headless/mock testing in Node). */
  readonly createElement?: ((tag: string) => NSView) | undefined;
  /** Custom `<dialog>` presenter (defaults to NativeScript `showModal`). */
  readonly dialogPresenter?: DialogPresenter | undefined;
  /** Called whenever the folded document `<title>` changes. */
  readonly onTitle?: ((title: string) => void) | undefined;
}

export interface MountOptions<V extends View.Elements, RF = never, Events = unknown> {
  readonly onEmit?: ((event: Events) => void) | undefined;
  readonly fallback?:
    | ((
        failure: AsyncResult.Failure<never, unknown>,
        h: View.Helper<never, {}> & View.Tags<V, never>,
      ) => View.Content<never, RF>)
    | undefined;
  readonly query?: Renderer.QueryOptions | undefined;
  readonly head?: boolean | undefined;
  readonly host?: MakeHostOptions | undefined;
}

export interface RunOptions<V extends View.Elements, RF = never, Events = unknown, R = never>
  extends MountOptions<V, RF, Events> {
  /** Initial NativeScript ActionBar title (also updated dynamically by `Head.title`). */
  readonly title?: string | undefined;
  /** Hide the native ActionBar for full-bleed custom headers. Defaults to `false`. */
  readonly actionBarHidden?: boolean | undefined;
  /** Enable MasonKit CSS Preflight defaults (`box-sizing: border-box`, `margin: 0`, etc.). Defaults to `true`. */
  readonly preflight?: boolean | undefined;
  /** Additional class names applied to the root MasonKit scroll container. */
  readonly rootClassName?: string | undefined;
  /** Application Effect Layer providing domain/platform services (e.g. `Haptics`, `DeviceInfo`). */
  readonly layer?: Layer.Layer<R, never, never> | undefined;
  /** Optional custom root container factory instead of the default `Page` + `Scroll`. */
  readonly createRoot?: ((mountInto: (container: NSView, page?: Page) => void) => NSView) | undefined;
}

export const controlledProps: ReadonlySet<string> = new Set([
  'value',
  'checked',
  'selected',
  'open',
  'popoverOpen',
]);

type MasonParentView = NSView & {
  insertBefore?: (child: unknown, ref: unknown) => void;
  addChild?: (child: unknown) => void;
  removeChild?: (child: unknown) => void;
  removeChildren?: () => void;
};

/**
 * Builds a `Renderer.Host<MasonNode>` backed by NativeScript + MasonKit, plus
 * its `EventController` and `dispose` cleanup hook.
 */
export function makeHost(
  options?: MakeHostOptions | undefined,
): Renderer.Host<MasonNode> & {
  readonly eventController: EventController;
  readonly dispose: () => void;
} {
  ensureRuntimeGlobals();

  const parents = new WeakMap<MasonNode, MasonNode>();
  const childrenMap = new WeakMap<MasonNode, Array<MasonNode>>();
  const wantedControlled = new WeakMap<NSView, Map<string, unknown>>();
  const pendingDialogs = new Map<NSView, 'modal' | boolean>();
  const activeDialogs = new Set<NSView>();
  const pendingReverts = new Set<NSView>();
  let revertScheduled = false;
  let lastTitle: string | undefined;

  const dialogPresenter = options?.dialogPresenter ?? createDialogPresenter();

  const getChildren = (node: MasonNode): Array<MasonNode> => {
    if (isContainer(node)) return node.children;
    let list = childrenMap.get(node);
    if (list === undefined) {
      list = [];
      childrenMap.set(node, list);
    }
    return list;
  };

  /**
   * `<dialog>` nodes are tracked in the logical tree (so `parentOf`/`nextOf`
   * remain exact for Effect UI reconciliation) but are presented via native
   * `showModal` rather than attached inline into their parent's visual tree.
   */
  const isPortalElement = (node: MasonNode): boolean =>
    isViewNode(node) && getTagName(node) === 'dialog';

  const findNextNativeSibling = (
    siblings: ReadonlyArray<MasonNode>,
    fromIndex: number,
  ): MasonNode | undefined => {
    for (let i = fromIndex; i < siblings.length; i++) {
      const candidate = siblings[i]!;
      if (!isPortalElement(candidate) && !isContainer(candidate)) {
        return candidate;
      }
    }
    return undefined;
  };

  const writeControlledProp = (view: NSView, name: string, value: unknown): boolean => {
    const anyView = view as unknown as Record<string, unknown>;
    if (name === 'value') {
      const next = value == null ? '' : String(value);
      const current = String(anyView['value'] ?? anyView['text'] ?? '');
      if (current === next) return false;
      events.setSuppressing(true);
      try {
        anyView['value'] = next;
        if ('text' in anyView && typeof anyView['text'] === 'string') {
          anyView['text'] = next;
        }
      } finally {
        events.setSuppressing(false);
      }
      return true;
    }
    if (name === 'checked') {
      const next = Boolean(value);
      if (Boolean(anyView['checked']) === next) return false;
      events.setSuppressing(true);
      try {
        anyView['checked'] = next;
      } finally {
        events.setSuppressing(false);
      }
      return true;
    }
    if (name === 'open') {
      if (getTagName(view) === 'dialog') {
        const mode: 'modal' | boolean = value === 'modal' ? 'modal' : Boolean(value);
        pendingDialogs.set(view, mode);
        return false;
      }
      const next = Boolean(value);
      if (Boolean(anyView['open']) === next) return false;
      anyView['open'] = next;
      return true;
    }
    if (anyView[name] === value) return false;
    anyView[name] = value;
    return true;
  };

  const revertControlled = (view: NSView): void => {
    const wanted = wantedControlled.get(view);
    if (!wanted) return;
    for (const [prop, value] of wanted) {
      writeControlledProp(view, prop, value);
    }
  };

  const scheduleRevert = (view: NSView): void => {
    pendingReverts.add(view);
    if (!revertScheduled) {
      revertScheduled = true;
      queueMicrotask(() => {
        revertScheduled = false;
        for (const node of pendingReverts) {
          revertControlled(node);
        }
        pendingReverts.clear();
      });
    }
  };

  const events = createEventController(
    {
      parentOf: (node) => parents.get(node),
      childrenOf: (node) => getChildren(node),
    },
    (node, handled) => {
      if (!wantedControlled.has(node)) return;
      if (handled) scheduleRevert(node);
      else revertControlled(node);
    },
  );

  const detachNative = (parent: MasonNode, child: MasonNode): void => {
    if (isContainer(parent) || isPortalElement(child)) return;
    const p = parent as MasonParentView;
    try {
      if (typeof p.removeChild === 'function') {
        p.removeChild(child);
      }
    } catch {
      // Ignore if native child was already removed.
    }
  };

  const attachNative = (
    parent: MasonNode,
    child: MasonNode,
    nativeRef: MasonNode | undefined,
  ): void => {
    if (isContainer(parent) || isPortalElement(child)) return;
    const p = parent as MasonParentView;
    if (typeof p.insertBefore === 'function') {
      p.insertBefore(child, nativeRef ?? null);
    } else if (typeof p.addChild === 'function' && isViewNode(child)) {
      p.addChild(child);
    }
  };

  const closeDialogsInSubtree = (node: MasonNode): void => {
    if (isViewNode(node) && activeDialogs.has(node)) {
      activeDialogs.delete(node);
      pendingDialogs.delete(node);
      dialogPresenter.dispose(node);
    }
    for (const child of getChildren(node)) {
      closeDialogsInSubtree(child);
    }
  };

  const detachLogical = (node: MasonNode): void => {
    const oldParent = parents.get(node);
    if (oldParent === undefined) return;
    const list = getChildren(oldParent);
    const idx = list.indexOf(node);
    if (idx >= 0) list.splice(idx, 1);
    parents.delete(node);
    detachNative(oldParent, node);
  };

  return {
    eventController: events,

    createElement(tag) {
      const view = options?.createElement
        ? options.createElement(tag)
        : createMasonElement(tag, options?.elements);
      if (getTagName(view) === 'button') {
        events.wireSubmitTrigger(view);
      }
      return view;
    },

    createText(text) {
      return createTextNode(text);
    },

    createContainer() {
      return createContainerNode();
    },

    setText(node, text) {
      if (!isTextNode(node)) return;
      if (node.data === text) return;
      node.text = text;
      // Writing `.data` triggers MasonKit's installed native text-node proxy
      // (see MasonKit `common.js` `_installTextNodeProxy`), updating native text
      // and requesting layout automatically.
      node.data = text;
    },

    setAttr(node, name, value, previous) {
      if (!isViewNode(node)) return;
      applyAttr(node, name, value, previous);
    },

    setProp(node, name, value) {
      if (!isViewNode(node)) return;

      if (controlledProps.has(name)) {
        if (name === 'value' || name === 'checked') {
          events.ensureControlledListener(node);
        }
        let wanted = wantedControlled.get(node);
        if (value === undefined) {
          wanted?.delete(name);
          if (name === 'open' && getTagName(node) === 'dialog') {
            pendingDialogs.set(node, false);
          }
        } else {
          if (wanted === undefined) {
            wanted = new Map();
            wantedControlled.set(node, wanted);
          }
          wanted.set(name, value);
          writeControlledProp(node, name, value);
        }
        return;
      }

      applyNonControlledProp(node, name, value);
    },

    insertBefore(parent, node, ref) {
      // Remove from previous parent first if reparenting or moving.
      if (parents.get(node) !== undefined) {
        detachLogical(node);
      }

      const siblings = getChildren(parent);
      const refIndex = ref === undefined ? -1 : siblings.indexOf(ref);
      const insertIndex = refIndex < 0 ? siblings.length : refIndex;

      // Determine the first real native sibling at or after `insertIndex` BEFORE mutating `siblings`.
      const nativeRef = refIndex < 0 ? undefined : findNextNativeSibling(siblings, refIndex);

      siblings.splice(insertIndex, 0, node);
      parents.set(node, parent);
      attachNative(parent, node, nativeRef);
    },

    remove(node) {
      closeDialogsInSubtree(node);
      detachLogical(node);
    },

    removeChildren(parent, nodes) {
      for (const node of nodes) {
        closeDialogsInSubtree(node);
        detachLogical(node);
      }
    },

    parentOf(node) {
      return parents.get(node);
    },

    nextOf(node) {
      const parent = parents.get(node);
      if (parent === undefined) return undefined;
      const siblings = getChildren(parent);
      const idx = siblings.indexOf(node);
      return idx >= 0 ? siblings[idx + 1] : undefined;
    },

    setEvents(node, handlers, dispatch, eventOptions) {
      if (!isViewNode(node)) return;
      events.setEvents(node, handlers, dispatch, eventOptions);
    },

    elements: [Html.name],
    controlled: controlledProps,
    runsMounts: true,

    commit() {
      if (pendingDialogs.size === 0) return;
      for (const [dialog, desired] of pendingDialogs) {
        const wantOpen = desired === 'modal' || desired === true;
        if (wantOpen) activeDialogs.add(dialog);
        else activeDialogs.delete(dialog);

        dialogPresenter.sync(dialog, desired, {
          onCancel: () => {
            events.fireDirect(dialog, 'cancel', { cancelable: true });
          },
          onClose: () => {
            activeDialogs.delete(dialog);
            events.fireDirect(dialog, 'close', { returnValue: '' });
          },
        });
      }
      pendingDialogs.clear();
    },

    head(head) {
      const title = (head as { readonly title?: string | undefined } | undefined)?.title;
      if (title !== undefined && title !== lastTitle) {
        lastTitle = title;
        options?.onTitle?.(title);
      }
    },

    dispose() {
      pendingDialogs.clear();
      activeDialogs.clear();
      dialogPresenter.disposeAll();
    },
  };
}

function makeHostContext(
  host: ReturnType<typeof makeHost>,
): Context.Context<Renderer.Renderer | Html.Host> {
  return Context.make(Renderer.Renderer, { host }).pipe(
    Context.add(Html.Host, makeNativeHtmlHost(host.eventController)),
    Context.add(HtmlSubscription.AnimationFrames, makeNativeAnimationFrames()),
    Context.add(HtmlSubscription.MediaQueries, makeNativeMediaQueries()),
    Context.add(HtmlSubscription.GlobalEvents, makeNativeGlobalEvents()),
  );
}

/**
 * Provides `Renderer.Renderer`, `Html.Host`, and native `HtmlSubscription`
 * services for the life of the Layer.
 */
export const layer = (
  options?: MakeHostOptions | undefined,
): Layer.Layer<Renderer.Renderer | Html.Host> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const host = makeHost(options);
      yield* Effect.addFinalizer(() => Effect.sync(host.dispose));
      return makeHostContext(host);
    }),
  );

/**
 * Mounts an Effect UI HTML component tree into a NativeScript/MasonKit
 * container view for the life of the current Scope, returning its `Renderer.Root`.
 */
export const mountEffect = <
  Name extends string,
  Props,
  Model,
  Msg,
  Events,
  R,
  V extends View.Elements,
  RF = never,
  RP = never,
>(
  component: Component.Members<Name, Props, Model, Msg, Events, R, V, any> & MasonRoot<V>,
  props: Props | Effect.Effect<Props, never, RP>,
  container: NSView,
  options?: MountOptions<V, RF, Events> | undefined,
): Effect.Effect<
  Renderer.Root<Model, Msg>,
  never,
  Exclude<R | RF | RP, Html.Host> | Scope.Scope
> =>
  Effect.gen(function* () {
    const host = makeHost(options?.host);
    yield* Effect.addFinalizer(() => Effect.sync(host.dispose));
    return yield* Effect.provideContext(
      Renderer.mount(component as any, props as any, container, {
        fallback: options?.fallback as any,
        query: options?.query,
        head: options?.head,
        onEmit: options?.onEmit,
      }),
      makeHostContext(host),
    );
  }) as any;

/**
 * A Layer that mounts an Effect UI HTML component tree into a NativeScript /
 * MasonKit container view for as long as the Layer is built.
 */
export const mount = <
  Name extends string,
  Props,
  Model,
  Msg,
  Events,
  R,
  V extends View.Elements,
  RF = never,
  RP = never,
>(
  component: Component.Members<Name, Props, Model, Msg, Events, R, V, any> & MasonRoot<V>,
  props: Props | Effect.Effect<Props, never, RP>,
  container: NSView,
  options?: MountOptions<V, RF, Events> | undefined,
): Layer.Layer<never, never, Exclude<R | RF | RP, Html.Host>> =>
  Layer.effectDiscard(mountEffect(component, props, container, options)) as any;

/**
 * Launches a NativeScript application rendering an Effect UI HTML component
 * through `MasonHost` inside a `Frame` -> `Page` -> MasonKit `Scroll` root.
 *
 * Updates the NativeScript `ActionBar` title automatically whenever the
 * component tree updates `Head.title(...)`.
 */
export function run<
  Name extends string,
  Props,
  Model,
  Msg,
  Events,
  R,
  V extends View.Elements,
  RF = never,
  RP = never,
>(
  component: Component.Members<Name, Props, Model, Msg, Events, R, V, any> & MasonRoot<V>,
  props: Props | Effect.Effect<Props, never, RP>,
  options?: RunOptions<V, RF, Events, Exclude<R | RF | RP, Html.Host>> | undefined,
): void {
  ensureRuntimeGlobals();
  if (options?.preflight !== false) {
    MasonView.preflight = true;
  }

  const mountInto = (container: NSView, page?: Page): void => {
    const onTitle = (title: string) => {
      if (page?.actionBar) {
        page.actionBar.title = title;
      }
      options?.host?.onTitle?.(title);
    };

    const appLayer = mount(component, props, container, {
      ...options,
      host: {
        ...options?.host,
        onTitle,
      },
    });

    const provided = options?.layer
      ? Layer.provide(appLayer, options.layer)
      : appLayer;

    Effect.runFork(Layer.launch(provided as Layer.Layer<never, never, never>));
  };

  Application.run({
    create: () => {
      if (options?.createRoot) {
        return options.createRoot(mountInto);
      }

      const frame = new Frame();
      frame.navigate({
        create: () => {
          const page = new Page();
          page.actionBarHidden = options?.actionBarHidden ?? false;
          if (options?.title && page.actionBar) {
            page.actionBar.title = options.title;
          }

          const scroll = new Scroll() as unknown as NSView;
          scroll.className = options?.rootClassName ?? 'mason-root';
          const scrollStyle = scroll.style as unknown as Record<string, unknown>;
          scrollStyle['width'] = '100%';
          scrollStyle['height'] = '100%';

          page.content = scroll;
          mountInto(scroll, page);
          return page;
        },
        animated: false,
      });
      return frame;
    },
  });
}
