/**
 * `NativeHost`: a dedicated NativeScript core `Renderer.Host` for components
 * built with `Native.component(...)` (Strategy A).
 */
import type * as Component from '@effect/ui/Component';
import * as Renderer from '@effect/ui/Renderer';
import type * as View from '@effect/ui/View';
import {
  AbsoluteLayout,
  ActivityIndicator,
  Application,
  Button,
  ContentView,
  DockLayout,
  FlexboxLayout,
  Frame,
  GridLayout,
  Image,
  Label,
  LayoutBase,
  Page,
  Progress,
  ScrollView,
  SearchBar,
  Slider,
  StackLayout,
  Switch,
  TextField,
  TextView,
  type View as NSView,
  WrapLayout,
} from '@nativescript/core';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type * as AsyncResult from 'effect/reactivity/AsyncResult';
import type * as Scope from 'effect/Scope';
import { ensureRuntimeGlobals } from '../mason/services.js';
import * as Native from './Native.js';

export type NativeRoot<V> = [Renderer.HostOf<V>] extends [Native.Host]
  ? unknown
  : {
      readonly 'NativeHost.mount shows NativeScript elements. This root vocabulary needs': Renderer.HostOf<V>;
    };

export interface NativeContainer {
  readonly _kind: 'native-container';
  readonly children: Array<NativeNode>;
}

export type NativeNode = NSView | NativeContainer;

const isNativeContainer = (node: NativeNode): node is NativeContainer =>
  typeof node === 'object' && node !== null && (node as NativeContainer)._kind === 'native-container';

const nativeCatalogue: Readonly<Record<string, new () => NSView>> = {
  stackLayout: StackLayout,
  flexboxLayout: FlexboxLayout,
  gridLayout: GridLayout,
  wrapLayout: WrapLayout,
  absoluteLayout: AbsoluteLayout,
  dockLayout: DockLayout,
  scrollView: ScrollView,
  contentView: ContentView,
  label: Label,
  button: Button,
  textField: TextField,
  textView: TextView,
  switch: Switch,
  slider: Slider,
  progress: Progress,
  activityIndicator: ActivityIndicator,
  image: Image,
  searchBar: SearchBar,
};

const controlledProps: ReadonlySet<string> = new Set(['text', 'checked', 'value']);

interface EventEntry {
  handlers: Readonly<Record<string, View.Handler<unknown, any>>>;
  options: Readonly<Record<string, View.EventOptions>>;
  dispatch: Renderer.Dispatch;
  readonly wired: Set<string>;
}

export interface MakeNativeHostOptions {
  readonly views?: Readonly<Record<string, new () => NSView>> | undefined;
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
  readonly host?: MakeNativeHostOptions | undefined;
}

export function makeNativeHostService(): Context.Service.Shape<typeof Native.Host> {
  return {
    focus(node) {
      try {
        (node as NSView & { focus?: () => boolean }).focus?.();
      } catch {
        // Ignore non-focusable views.
      }
    },
    blur(node) {
      try {
        (node as NSView & { dismissSoftInput?: () => void }).dismissSoftInput?.();
      } catch {
        // Ignore.
      }
    },
    measure(node) {
      const loc = node.getLocationInWindow?.() ?? { x: 0, y: 0 };
      const size = node.getActualSize?.() ?? { width: 0, height: 0 };
      return {
        x: loc.x ?? 0,
        y: loc.y ?? 0,
        width: size.width ?? 0,
        height: size.height ?? 0,
      };
    },
    animate(node, options) {
      return node.animate(options as never);
    },
  };
}

/**
 * Builds a `Renderer.Host<NativeNode>` over NativeScript core views.
 */
export function makeHost(options?: MakeNativeHostOptions | undefined): Renderer.Host<NativeNode> {
  ensureRuntimeGlobals();

  const catalogue: Record<string, new () => NSView> = {
    ...nativeCatalogue,
    ...options?.views,
  };

  const parents = new WeakMap<NativeNode, NativeNode>();
  const childrenMap = new WeakMap<NativeNode, Array<NativeNode>>();
  const events = new WeakMap<NSView, EventEntry>();
  let suppressing = false;
  let lastTitle: string | undefined;

  const getChildren = (node: NativeNode): Array<NativeNode> => {
    if (isNativeContainer(node)) return node.children;
    let list = childrenMap.get(node);
    if (list === undefined) {
      list = [];
      childrenMap.set(node, list);
    }
    return list;
  };

  const detachChild = (node: NativeNode): void => {
    const parent = parents.get(node);
    if (parent === undefined) return;
    const siblings = getChildren(parent);
    const idx = siblings.indexOf(node);
    if (idx >= 0) siblings.splice(idx, 1);
    parents.delete(node);

    if (isNativeContainer(parent) || isNativeContainer(node)) return;
    if (parent instanceof LayoutBase) {
      parent.removeChild(node);
    } else if (parent instanceof ContentView) {
      if (parent.content === node) parent.content = null as unknown as NSView;
    }
  };

  const fire = (view: NSView, name: string, payload: unknown): boolean => {
    const entry = events.get(view);
    if (!entry) return false;
    const handler = entry.handlers[name];
    if (handler === undefined) return false;
    return entry.dispatch(name, handler, payload);
  };

  return {
    createElement(tag) {
      const Ctor = catalogue[tag];
      if (!Ctor) throw new Error(`Unknown NativeScript tag: <${tag}>`);
      return new Ctor();
    },

    createText() {
      // NativeScript layout containers do not accept raw text nodes directly.
      return { _kind: 'native-container', children: [] };
    },

    createContainer() {
      return { _kind: 'native-container', children: [] };
    },

    setText() {},

    setAttr(node, name, value) {
      if (isNativeContainer(node)) return;
      if (name === 'class') node.className = value ?? '';
      else if (name === 'id') node.id = value ?? '';
      else (node as unknown as Record<string, unknown>)[name] = value;
    },

    setProp(node, name, value) {
      if (isNativeContainer(node)) return;
      const target = node as unknown as Record<string, unknown>;
      if (name === 'style' && typeof value === 'object' && value !== null) {
        const style = node.style as unknown as Record<string, unknown>;
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          style[k] = v;
        }
        return;
      }
      if (name === 'row' && typeof value === 'number') {
        GridLayout.setRow(node, value);
        return;
      }
      if (name === 'col' && typeof value === 'number') {
        GridLayout.setColumn(node, value);
        return;
      }
      if (name === 'rowSpan' && typeof value === 'number') {
        GridLayout.setRowSpan(node, value);
        return;
      }
      if (name === 'colSpan' && typeof value === 'number') {
        GridLayout.setColumnSpan(node, value);
        return;
      }
      if (name === 'dock' && typeof value === 'string') {
        DockLayout.setDock(node, value as 'left' | 'top' | 'right' | 'bottom');
        return;
      }
      if (name === '__onNativeAction') {
        const prev = target['__nsNativeActionCb'] as ((ev?: unknown) => void) | undefined;
        if (prev && typeof node.off === 'function') node.off('tap', prev);
        if (typeof value === 'function') {
          const fn = value as () => void;
          const cb = () => fn();
          target['__nsNativeActionCb'] = cb;
          if (typeof node.on === 'function') node.on('tap', cb);
        } else {
          target['__nsNativeActionCb'] = undefined;
        }
        return;
      }
      if (controlledProps.has(name)) {
        if (target[name] === value) return;
        suppressing = true;
        try {
          target[name] = value;
        } finally {
          suppressing = false;
        }
        return;
      }
      target[name] = value;
    },

    insertBefore(parent, node, ref) {
      if (parents.get(node) !== undefined) detachChild(node);
      const siblings = getChildren(parent);
      const refIndex = ref === undefined ? -1 : siblings.indexOf(ref);
      const insertIndex = refIndex < 0 ? siblings.length : refIndex;
      siblings.splice(insertIndex, 0, node);
      parents.set(node, parent);

      if (isNativeContainer(parent) || isNativeContainer(node)) return;
      if (parent instanceof LayoutBase) {
        if (insertIndex >= parent.getChildrenCount()) parent.addChild(node);
        else parent.insertChild(node, insertIndex);
      } else if (parent instanceof ContentView) {
        parent.content = node;
      }
    },

    remove(node) {
      detachChild(node);
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
      if (isNativeContainer(node)) return;
      let entry = events.get(node);
      if (entry === undefined) {
        entry = { handlers, options: eventOptions, dispatch, wired: new Set() };
        events.set(node, entry);
      } else {
        entry.handlers = handlers;
        entry.options = eventOptions;
        entry.dispatch = dispatch;
      }

      for (const name in handlers) {
        if (entry.wired.has(name)) continue;
        entry.wired.add(name);
        if (name === 'textChange') {
          node.on('textChange', () => {
            if (suppressing) return;
            fire(node, 'textChange', {
              value: String((node as unknown as { text?: string }).text ?? ''),
            });
          });
        } else if (name === 'checkedChange') {
          node.on('checkedChange', () => {
            if (suppressing) return;
            fire(node, 'checkedChange', {
              checked: Boolean((node as unknown as { checked?: boolean }).checked),
            });
          });
        } else if (name === 'valueChange') {
          node.on('valueChange', () => {
            if (suppressing) return;
            fire(node, 'valueChange', {
              value: Number((node as unknown as { value?: number }).value ?? 0),
            });
          });
        } else if (name === 'returnPress' || name === 'submit') {
          node.on(name, () => {
            fire(node, name, {
              value: String((node as unknown as { text?: string }).text ?? ''),
            });
          });
        } else {
          node.on(name, () => {
            fire(node, name, {});
          });
        }
      }
    },

    elements: [Native.name],
    controlled: controlledProps,
    runsMounts: true,

    head(head) {
      const title = (head as { readonly title?: string | undefined } | undefined)?.title;
      if (title !== undefined && title !== lastTitle) {
        lastTitle = title;
        options?.onTitle?.(title);
      }
    },
  };
}

export const layer = (
  options?: MakeNativeHostOptions | undefined,
): Layer.Layer<Renderer.Renderer | Native.Host> =>
  Layer.succeedContext(
    Context.make(Renderer.Renderer, { host: makeHost(options) }).pipe(
      Context.add(Native.Host, makeNativeHostService()),
    ),
  );

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
  component: Component.Members<Name, Props, Model, Msg, Events, R, V, any> & NativeRoot<V>,
  props: Props | Effect.Effect<Props, never, RP>,
  container: NSView,
  options?: MountOptions<V, RF, Events> | undefined,
): Effect.Effect<
  Renderer.Root<Model, Msg>,
  never,
  Exclude<R | RF | RP, Native.Host> | Scope.Scope
> =>
  Effect.provideContext(
    Renderer.mount(component as any, props as any, container, {
      fallback: options?.fallback as any,
      query: options?.query,
      head: options?.head,
      onEmit: options?.onEmit,
    }),
    Context.make(Renderer.Renderer, { host: makeHost(options?.host) }).pipe(
      Context.add(Native.Host, makeNativeHostService()),
    ),
  ) as any;

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
  component: Component.Members<Name, Props, Model, Msg, Events, R, V, any> & NativeRoot<V>,
  props: Props | Effect.Effect<Props, never, RP>,
  container: NSView,
  options?: MountOptions<V, RF, Events> | undefined,
): Layer.Layer<never, never, Exclude<R | RF | RP, Native.Host>> =>
  Layer.effectDiscard(mountEffect(component, props, container, options)) as any;

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
  component: Component.Members<Name, Props, Model, Msg, Events, R, V, any> & NativeRoot<V>,
  props: Props | Effect.Effect<Props, never, RP>,
  options?: MountOptions<V, RF, Events> & {
    readonly title?: string | undefined;
    readonly layer?: Layer.Layer<Exclude<R | RF | RP, Native.Host>, never, never> | undefined;
  },
): void {
  ensureRuntimeGlobals();
  Application.run({
    create: () => {
      const frame = new Frame();
      frame.navigate({
        create: () => {
          const page = new Page();
          if (options?.title && page.actionBar) page.actionBar.title = options.title;
          const root = new ContentView();
          page.content = root;

          const appLayer = mount(component, props, root, {
            ...options,
            host: {
              ...options?.host,
              onTitle: (title) => {
                if (page.actionBar) page.actionBar.title = title;
                options?.host?.onTitle?.(title);
              },
            },
          });
          const provided = options?.layer ? Layer.provide(appLayer, options.layer) : appLayer;
          Effect.runFork(Layer.launch(provided as Layer.Layer<never, never, never>));
          return page;
        },
        animated: false,
      });
      return frame;
    },
  });
}
