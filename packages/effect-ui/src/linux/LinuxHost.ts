/**
 * `LinuxHost`: a native Linux GTK4 `Renderer.Host` for `@effect/ui`, powered by
 * `@nativescript/linux` (V8 runtime) or `@nativescript/linux-napi` (Node-API
 * GTK4 / GLib addon for Node, Bun, and Deno).
 *
 * Mounts unmodified `@effect/ui/html` (`Html.component(...)`) views directly
 * onto real GTK4 widgets (`GtkWindow`, `GtkScrolledWindow`, `GtkFixed`,
 * `GtkBox`, `GtkLabel`, `GtkButton`, `GtkEntry`) with zero WebViews and zero
 * Electron.
 */
import type * as Component from '@effect/ui/Component';
import { Html } from '@effect/ui/html';
import * as Renderer from '@effect/ui/Renderer';
import type * as View from '@effect/ui/View';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type * as AsyncResult from 'effect/reactivity/AsyncResult';
import {
  darkPalette,
  estimateDesktopTextSize,
  layoutTree,
  lightPalette,
  makeDesktopHtmlServices,
  measureNode,
  resolveDesktopStyle,
  toCssRgba,
  type ComputedBoxStyle,
  type LayoutNode,
  type Rect,
  type RgbaColor,
} from '../desktop/html-services.js';
import { setLinuxNativeModule } from './platform.js';

export type LinuxRoot<V> = [Renderer.HostOf<V>] extends [Html.Host]
  ? unknown
  : {
      readonly 'LinuxHost.mount shows HTML elements. This root vocabulary needs': Renderer.HostOf<V>;
    };

export interface LinuxNode {
  readonly kind: 'element' | 'text' | 'container';
  readonly tag: string;
  parent: LinuxNode | undefined;
  readonly children: Array<LinuxNode>;
  text: string;
  className: string;
  id: string;
  readonly attrs: Record<string, string | undefined>;
  readonly props: Record<string, unknown>;
  handlers: Readonly<Record<string, View.Handler<unknown, any>>>;
  dispatch: Renderer.Dispatch | undefined;
  gtkWidget: any;
  dialogWindow: any;
  layoutNode: LayoutNode | undefined;
}

export interface LinuxWidgetItem {
  readonly node: LinuxNode;
  readonly widgetKey: string;
  readonly frame: Rect;
  readonly style: ComputedBoxStyle;
  readonly cssClass: string;
  readonly cssRule: string;
  readonly text: string | undefined;
  readonly isInteractive: boolean;
  readonly isInput: boolean;
  readonly inputValue: string;
  readonly placeholder: string;
}

/**
 * Pluggable rendering backend for `LinuxHost`.
 * Implemented automatically for GTK4 via `@nativescript/linux` or
 * `@nativescript/linux-napi`, or injected directly in unit tests.
 */
export interface LinuxHostBackend {
  readonly mode: 'gtk4' | 'custom';
  readonly renderFrame: (
    items: ReadonlyArray<LinuxWidgetItem>,
    stylesheet: string,
    contentHeight: number,
    viewportWidth: number,
    dark: boolean,
  ) => void;
  readonly openDialog?: (
    dialogNode: LinuxNode,
    items: ReadonlyArray<LinuxWidgetItem>,
    stylesheet: string,
    width: number,
    height: number,
    dark: boolean,
    onClose: () => void,
  ) => any;
  readonly updateDialog?: (
    handle: any,
    items: ReadonlyArray<LinuxWidgetItem>,
    stylesheet: string,
    width: number,
    height: number,
    dark: boolean,
  ) => void;
  readonly closeDialog?: (handle: any) => void;
  readonly setTitle?: (title: string) => void;
  readonly dispose?: () => void;
}

export interface MakeLinuxHostOptions {
  readonly getViewportWidth: () => number;
  readonly getDarkMode: () => boolean;
  readonly backend: LinuxHostBackend;
  readonly onTitle?: ((title: string) => void) | undefined;
}

export interface LinuxRunOptions<
  V extends View.Elements,
  RF = never,
  Events = unknown,
  R = never,
> {
  readonly title?: string | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly appearance?: 'system' | 'light' | 'dark' | undefined;
  readonly layer?: Layer.Layer<R, never, never> | undefined;
  readonly onEmit?: ((event: Events) => void) | undefined;
  readonly fallback?:
    | ((
        failure: AsyncResult.Failure<never, unknown>,
        h: View.Helper<never, {}> & View.Tags<V, never>,
      ) => View.Content<never, RF>)
    | undefined;
  /** Optional auto-close timeout in milliseconds (useful for CI/smoke verification). */
  readonly autoCloseMs?: number | undefined;
}

function collectElementChildren(node: LinuxNode): Array<LinuxNode> {
  const out: Array<LinuxNode> = [];
  for (const child of node.children) {
    if (child.kind === 'container') {
      out.push(...collectElementChildren(child));
    } else if (child.kind === 'element') {
      out.push(child);
    }
  }
  return out;
}

function collectText(node: LinuxNode): string {
  if (node.kind === 'text') return node.text;
  let out = '';
  for (const child of node.children) {
    if (child.kind === 'text') {
      out += child.text;
    } else if (child.kind === 'container') {
      out += collectText(child);
    } else if (child.kind === 'element' && child.tag === 'span') {
      out += collectText(child);
    }
  }
  return out;
}

function hasDirectBlockElements(node: LinuxNode): boolean {
  for (const child of collectElementChildren(node)) {
    if (child.tag !== 'span') return true;
  }
  return false;
}

function isInteractiveNode(node: LinuxNode): boolean {
  if (node.tag === 'button' || node.tag === 'a') return true;
  return Boolean(node.handlers['click']);
}

export function fireLinuxEvent(
  start: LinuxNode,
  eventName: string,
  eventPayload: Record<string, unknown>,
): void {
  let stopped = false;
  let cur: LinuxNode | undefined = start;
  const ev = {
    type: eventName,
    target: start,
    currentTarget: start,
    preventDefault() {},
    stopPropagation() {
      stopped = true;
    },
    ...eventPayload,
  };
  while (cur && !stopped) {
    const handler = cur.handlers[eventName];
    if (handler && cur.dispatch) {
      ev.currentTarget = cur;
      cur.dispatch(eventName, handler, ev);
    }
    cur = cur.parent;
  }
}

function buildGtkCssRule(className: string, style: ComputedBoxStyle): string {
  const decls: Array<string> = [
    `color: ${toCssRgba(style.color)};`,
    `font-size: ${Math.round(style.fontSize)}px;`,
    `font-weight: ${
      style.fontWeight === 'bold'
        ? 700
        : style.fontWeight === 'semibold'
          ? 600
          : style.fontWeight === 'medium'
            ? 500
            : 400
    };`,
  ];
  if (style.backgroundColor) {
    decls.push(`background-color: ${toCssRgba(style.backgroundColor)};`);
    decls.push('background-image: none;');
  } else {
    decls.push('background-color: transparent;');
    decls.push('background-image: none;');
  }
  if (style.borderColor && style.borderWidth > 0) {
    decls.push(`border: ${style.borderWidth}px solid ${toCssRgba(style.borderColor)};`);
  } else {
    decls.push('border: none;');
  }
  if (style.borderRadius > 0) {
    decls.push(`border-radius: ${style.borderRadius}px;`);
  }
  if (style.padTop || style.padRight || style.padBottom || style.padLeft) {
    decls.push(
      `padding: ${style.padTop}px ${style.padRight}px ${style.padBottom}px ${style.padLeft}px;`,
    );
  } else {
    decls.push('padding: 0px;');
  }
  decls.push('box-shadow: none;');
  return `.${className} { ${decls.join(' ')} }`;
}

/**
 * Creates a `Renderer.Host<LinuxNode>` bound to any `LinuxHostBackend`
 * (GTK4 via `@nativescript/linux` / `@nativescript/linux-napi`, or test backend).
 */
export function makeLinuxHost(options: MakeLinuxHostOptions): {
  readonly host: Renderer.Host<LinuxNode>;
  readonly rootContainer: LinuxNode;
  readonly relayout: () => void;
  readonly getItems: () => ReadonlyArray<LinuxWidgetItem>;
  readonly getStylesheet: () => string;
  readonly getDialogItems: (dialog: LinuxNode) => ReadonlyArray<LinuxWidgetItem>;
  readonly triggerClick: (node: LinuxNode) => void;
  readonly triggerInput: (node: LinuxNode, value: string) => void;
  readonly dispose: () => void;
} {
  const activeDialogs = new Map<LinuxNode, { handle: any; items: Array<LinuxWidgetItem> }>();
  let latestItems: Array<LinuxWidgetItem> = [];
  let latestStylesheet = '';
  let lastTitle: string | undefined;

  const createNode = (
    kind: LinuxNode['kind'],
    tag: string,
    text = '',
  ): LinuxNode => ({
    kind,
    tag,
    parent: undefined,
    children: [],
    text,
    className: '',
    id: '',
    attrs: {},
    props: {},
    handlers: {},
    dispatch: undefined,
    gtkWidget: undefined,
    dialogWindow: undefined,
    layoutNode: undefined,
  });

  const rootContainer = createNode('container', '#root');

  const buildLayoutNode = (
    node: LinuxNode,
    inheritedColor: RgbaColor,
    dark: boolean,
    isDialogRoot: boolean,
  ): LayoutNode => {
    const style = resolveDesktopStyle(node.tag, node.className, node.attrs, inheritedColor, dark);
    if (isDialogRoot) {
      style.display = 'flex';
      style.flexDirection = 'column';
      style.padTop = 20;
      style.padRight = 20;
      style.padBottom = 20;
      style.padLeft = 20;
      style.gap = 12;
      style.fullWidth = true;
    }

    const isPortal = !isDialogRoot && node.tag === 'dialog';
    const hasBlocks = hasDirectBlockElements(node);
    const leafText = !hasBlocks && node.tag !== 'input' ? collectText(node).trim() : undefined;

    const childLayouts: Array<LayoutNode> = [];
    if (hasBlocks && !isPortal) {
      for (const child of collectElementChildren(node)) {
        childLayouts.push(buildLayoutNode(child, style.color, dark, false));
      }
    }

    const ln: LayoutNode = {
      tag: node.tag,
      isPortal,
      style,
      text: leafText && leafText.length > 0 ? leafText : undefined,
      children: childLayouts,
      frame: { x: 0, y: 0, width: 0, height: 0 },
    };
    node.layoutNode = ln;
    return ln;
  };

  const flattenItems = (
    node: LinuxNode,
    offsetX: number,
    offsetY: number,
    out: Array<LinuxWidgetItem>,
    isDialogRoot: boolean,
  ): void => {
    const ln = node.layoutNode;
    if (!ln || ln.style.display === 'none' || (ln.isPortal && !isDialogRoot)) return;
    const absFrame: Rect = {
      x: offsetX + ln.frame.x,
      y: offsetY + ln.frame.y,
      width: ln.frame.width,
      height: ln.frame.height,
    };
    const index = out.length;
    const cssClass = `efui-n${index}`;
    const cssRule = buildGtkCssRule(cssClass, ln.style);
    const isInput = node.tag === 'input';
    const rawVal = node.props['value'] ?? node.attrs['value'] ?? '';

    out.push({
      node,
      widgetKey: `${node.tag}-${index}`,
      frame: absFrame,
      style: ln.style,
      cssClass,
      cssRule,
      text: ln.text,
      isInteractive: isInteractiveNode(node),
      isInput,
      inputValue: typeof rawVal === 'string' ? rawVal : String(rawVal),
      placeholder: node.attrs['placeholder'] ?? '',
    });

    if (hasDirectBlockElements(node)) {
      for (const child of collectElementChildren(node)) {
        flattenItems(child, absFrame.x, absFrame.y, out, false);
      }
    }
  };

  const buildStylesheet = (items: ReadonlyArray<LinuxWidgetItem>, dark: boolean): string => {
    const pal = dark ? darkPalette : lightPalette;
    const rootRule = `window.efui-root { background-color: ${toCssRgba(pal.background)}; color: ${toCssRgba(pal.foreground)}; }`;
    return [rootRule, ...items.map((i) => i.cssRule)].join('\n');
  };

  const syncDialogs = (dark: boolean): void => {
    const found: Array<LinuxNode> = [];
    const walk = (n: LinuxNode) => {
      if (n.kind === 'element' && n.tag === 'dialog') found.push(n);
      for (const c of n.children) walk(c);
    };
    walk(rootContainer);

    const pal = dark ? darkPalette : lightPalette;
    for (const dlg of found) {
      const openVal = dlg.props['open'];
      const wantOpen = openVal === 'modal' || openVal === true;
      const existing = activeDialogs.get(dlg);

      if (wantOpen) {
        const dlgW = 420;
        const ln = buildLayoutNode(dlg, pal.foreground, dark, true);
        const m = measureNode(ln, dlgW, estimateDesktopTextSize);
        const dlgH = Math.max(240, m.height + 16);
        layoutTree(ln, 0, 0, dlgW, dlgH, estimateDesktopTextSize);
        const items: Array<LinuxWidgetItem> = [];
        flattenItems(dlg, 0, 0, items, true);
        const css = buildStylesheet(items, dark);

        if (!existing) {
          const handle = options.backend.openDialog?.(dlg, items, css, dlgW, dlgH, dark, () => {
            activeDialogs.delete(dlg);
            dlg.dialogWindow = undefined;
            fireLinuxEvent(dlg, 'cancel', { cancelable: true });
          });
          dlg.dialogWindow = handle;
          activeDialogs.set(dlg, { handle, items });
        } else {
          existing.items = items;
          options.backend.updateDialog?.(existing.handle, items, css, dlgW, dlgH, dark);
        }
      } else if (existing) {
        activeDialogs.delete(dlg);
        dlg.dialogWindow = undefined;
        options.backend.closeDialog?.(existing.handle);
      }
    }
  };

  const relayout = (): void => {
    const dark = options.getDarkMode();
    const pal = dark ? darkPalette : lightPalette;
    const viewportW = Math.max(320, options.getViewportWidth());

    const topElements = collectElementChildren(rootContainer);
    const primary = topElements[0];
    if (!primary) return;

    const ln = buildLayoutNode(primary, pal.foreground, dark, false);
    const m = measureNode(ln, viewportW, estimateDesktopTextSize);
    const totalH = Math.max(m.height, 100);
    layoutTree(ln, 0, 0, viewportW, totalH, estimateDesktopTextSize);

    const items: Array<LinuxWidgetItem> = [];
    flattenItems(primary, 0, 0, items, false);
    const css = buildStylesheet(items, dark);

    latestItems = items;
    latestStylesheet = css;
    options.backend.renderFrame(items, css, totalH, viewportW, dark);
    syncDialogs(dark);
  };

  const detach = (node: LinuxNode): void => {
    const oldParent = node.parent;
    if (!oldParent) return;
    const idx = oldParent.children.indexOf(node);
    if (idx >= 0) oldParent.children.splice(idx, 1);
    node.parent = undefined;
  };

  const host: Renderer.Host<LinuxNode> = {
    createElement(tag) {
      return createNode('element', tag.toLowerCase());
    },
    createText(text) {
      return createNode('text', '#text', text);
    },
    createContainer() {
      return createNode('container', '#container');
    },
    setText(node, text) {
      node.text = text;
    },
    setAttr(node, name, value) {
      if (name === 'class') node.className = value ?? '';
      else if (name === 'id') node.id = value ?? '';
      node.attrs[name] = value;
    },
    setProp(node, name, value) {
      node.props[name] = value;
    },
    insertBefore(parent, node, ref) {
      if (node.parent) detach(node);
      const refIdx = ref === undefined ? -1 : parent.children.indexOf(ref);
      if (refIdx < 0) parent.children.push(node);
      else parent.children.splice(refIdx, 0, node);
      node.parent = parent;
    },
    remove(node) {
      detach(node);
    },
    removeChildren(_parent, nodes) {
      for (const n of nodes) detach(n);
    },
    parentOf(node) {
      return node.parent;
    },
    nextOf(node) {
      const p = node.parent;
      if (!p) return undefined;
      const idx = p.children.indexOf(node);
      return idx >= 0 ? p.children[idx + 1] : undefined;
    },
    setEvents(node, handlers, dispatch) {
      node.handlers = handlers;
      node.dispatch = dispatch;
    },
    elements: [Html.name],
    controlled: new Set(['value', 'checked', 'open']),
    runsMounts: true,
    commit() {
      relayout();
    },
    head(head) {
      const title = (head as { readonly title?: string | undefined } | undefined)?.title;
      if (title !== undefined && title !== lastTitle) {
        lastTitle = title;
        options.backend.setTitle?.(title);
        options.onTitle?.(title);
      }
    },
  };

  const triggerClick = (node: LinuxNode): void => {
    fireLinuxEvent(node, 'click', { button: 0 });
  };

  const triggerInput = (node: LinuxNode, value: string): void => {
    node.props['value'] = value;
    fireLinuxEvent(node, 'input', { target: { value } });
    fireLinuxEvent(node, 'change', { target: { value } });
  };

  return {
    host,
    rootContainer,
    relayout,
    getItems: () => latestItems,
    getStylesheet: () => latestStylesheet,
    getDialogItems: (dialog) => activeDialogs.get(dialog)?.items ?? [],
    triggerClick,
    triggerInput,
    dispose: () => {
      for (const [, entry] of activeDialogs) {
        options.backend.closeDialog?.(entry.handle);
      }
      activeDialogs.clear();
      options.backend.dispose?.();
    },
  };
}

/**
 * Connects a GTK4 GObject signal using the `interop.callback` trampoline
 * shared by `@nativescript/linux` and `@nativescript/linux-napi`.
 */
function connectGtkSignal(
  gtk: Record<string, any>,
  instance: any,
  signal: string,
  handler: () => boolean | void,
  returnsBool = false,
): () => void {
  const interop = gtk['interop'] ?? (globalThis as unknown as Record<string, any>)['interop'];
  const ptrType = interop.types.pointer;
  const cb = interop.callback(
    () => {
      const res = handler();
      return returnsBool ? (res ? 1 : 0) : undefined;
    },
    {
      returns: returnsBool ? interop.types.int32 : interop.types.void,
      args: [ptrType, ptrType],
    },
  );
  const handlerId = gtk['g_signal_connect_data'](instance, signal, cb, null, null, 0);
  // Keep callback pinned while connected.
  const keepAlive = cb;
  return () => {
    void keepAlive;
    try {
      gtk['g_signal_handler_disconnect']?.(instance, handlerId);
    } catch {
      // Ignore
    }
  };
}

/**
 * Builds a live GTK4 backend using `@nativescript/linux` globals or
 * `@nativescript/linux-napi` C bindings.
 */
function createGtk4Backend(
  gtk: Record<string, any>,
  rootWindow: any,
  scroller: any,
  onClickNode: (node: LinuxNode) => void,
  onInputNode: (node: LinuxNode, value: string) => void,
): LinuxHostBackend {
  const cssProvider = gtk['gtk_css_provider_new']();
  const display = gtk['gdk_display_get_default']?.();
  if (display && cssProvider) {
    // GTK_STYLE_PROVIDER_PRIORITY_APPLICATION = 600
    gtk['gtk_style_context_add_provider_for_display']?.(display, cssProvider, 600);
  }

  let activeDisconnects: Array<() => void> = [];

  const clearDisconnects = (list: Array<() => void>) => {
    for (const fn of list) fn();
    list.length = 0;
  };

  const renderIntoFixed = (
    items: ReadonlyArray<LinuxWidgetItem>,
    width: number,
    height: number,
    disconnects: Array<() => void>,
  ): any => {
    const fixed = gtk['gtk_fixed_new']();
    gtk['gtk_widget_set_size_request']?.(fixed, Math.round(width), Math.round(height));

    for (const item of items) {
      let widget: any;
      if (item.isInput) {
        widget = gtk['gtk_entry_new']();
        if (item.placeholder) {
          gtk['gtk_entry_set_placeholder_text']?.(widget, item.placeholder);
        }
        if (item.inputValue) {
          gtk['gtk_editable_set_text']?.(widget, item.inputValue);
        }
        disconnects.push(
          connectGtkSignal(gtk, widget, 'changed', () => {
            const text = String(gtk['gtk_editable_get_text']?.(widget) ?? '');
            onInputNode(item.node, text);
          }),
        );
      } else if (item.isInteractive) {
        widget = gtk['gtk_button_new']();
        if (item.text) {
          const lbl = gtk['gtk_label_new'](item.text);
          gtk['gtk_label_set_wrap']?.(lbl, 1);
          gtk['gtk_button_set_child']?.(widget, lbl);
        }
        disconnects.push(
          connectGtkSignal(gtk, widget, 'clicked', () => {
            onClickNode(item.node);
          }),
        );
      } else if (item.text && item.text.length > 0) {
        widget = gtk['gtk_label_new'](item.text);
        gtk['gtk_label_set_wrap']?.(widget, 1);
        gtk['gtk_label_set_xalign']?.(
          widget,
          item.style.textAlign === 'center' ? 0.5 : item.style.textAlign === 'right' ? 1.0 : 0.0,
        );
      } else {
        // GTK_ORIENTATION_VERTICAL = 1
        widget = gtk['gtk_box_new'](1, 0);
      }

      gtk['gtk_widget_add_css_class']?.(widget, item.cssClass);
      gtk['gtk_widget_set_size_request']?.(
        widget,
        Math.max(1, Math.round(item.frame.width)),
        Math.max(1, Math.round(item.frame.height)),
      );
      gtk['gtk_fixed_put'](fixed, widget, item.frame.x, item.frame.y);
    }

    return fixed;
  };

  return {
    mode: 'gtk4',
    renderFrame: (items, stylesheet, contentHeight, viewportWidth) => {
      clearDisconnects(activeDisconnects);
      if (cssProvider && gtk['gtk_css_provider_load_from_string']) {
        gtk['gtk_css_provider_load_from_string'](cssProvider, stylesheet);
      }
      const fixed = renderIntoFixed(items, viewportWidth, contentHeight, activeDisconnects);
      gtk['gtk_scrolled_window_set_child'](scroller, fixed);
    },
    openDialog: (_dlg, items, stylesheet, width, height, _dark, onClose) => {
      const dialogWin = gtk['gtk_window_new']();
      gtk['gtk_window_set_title']?.(dialogWin, 'Dialog');
      gtk['gtk_window_set_default_size']?.(dialogWin, Math.round(width), Math.round(height));
      gtk['gtk_window_set_modal']?.(dialogWin, 1);
      gtk['gtk_window_set_transient_for']?.(dialogWin, rootWindow);
      gtk['gtk_widget_add_css_class']?.(dialogWin, 'efui-root');
      if (cssProvider && gtk['gtk_css_provider_load_from_string']) {
        gtk['gtk_css_provider_load_from_string'](cssProvider, stylesheet);
      }
      const disconnects: Array<() => void> = [];
      disconnects.push(
        connectGtkSignal(
          gtk,
          dialogWin,
          'close-request',
          () => {
            onClose();
            return false;
          },
          true,
        ),
      );
      const fixed = renderIntoFixed(items, width, height, disconnects);
      gtk['gtk_window_set_child'](dialogWin, fixed);
      gtk['gtk_window_present'](dialogWin);
      return { dialogWin, disconnects };
    },
    updateDialog: (handle, items, stylesheet, width, height) => {
      if (!handle?.dialogWin) return;
      clearDisconnects(handle.disconnects);
      if (cssProvider && gtk['gtk_css_provider_load_from_string']) {
        gtk['gtk_css_provider_load_from_string'](cssProvider, stylesheet);
      }
      const fixed = renderIntoFixed(items, width, height, handle.disconnects);
      gtk['gtk_window_set_child'](handle.dialogWin, fixed);
    },
    closeDialog: (handle) => {
      if (!handle) return;
      clearDisconnects(handle.disconnects);
      try {
        gtk['gtk_window_destroy']?.(handle.dialogWin);
      } catch {
        // Ignore
      }
    },
    setTitle: (title) => {
      try {
        gtk['gtk_window_set_title']?.(rootWindow, title);
      } catch {
        // Ignore
      }
    },
    dispose: () => {
      clearDisconnects(activeDisconnects);
    },
  };
}

/**
 * Launches a native Linux GTK4 desktop application rendering any shared
 * `@effect/ui` HTML component (`PulseApp`, `@effect/ui-kit`, etc.) via
 * `@nativescript/linux` (V8 runtime) or `@nativescript/linux-napi` (Node/Bun/Deno).
 */
export async function run<
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
  component: Component.Members<Name, Props, Model, Msg, Events, R, V, any> & LinuxRoot<V>,
  props: Props | Effect.Effect<Props, never, RP>,
  options?: LinuxRunOptions<V, RF, Events, Exclude<R | RF | RP, Html.Host>>,
): Promise<void> {
  const width = options?.width ?? 460;
  const height = options?.height ?? 840;
  const title = options?.title ?? 'Effect Pulse';
  const isDark = (): boolean => options?.appearance === 'dark';

  const gLin = globalThis as unknown as Record<string, any>;
  let gtk: Record<string, any>;
  let usingNapi = false;

  if (typeof gLin['gtk_window_new'] === 'function') {
    // Running inside `@nativescript/linux` V8 runtime.
    gtk = gLin;
  } else {
    // Running inside Node.js, Bun, or Deno via `@nativescript/linux-napi`.
    usingNapi = true;
    const modName = '@nativescript/linux-napi';
    const loaded: any = await import(modName);
    gtk = (loaded.default ?? loaded) as Record<string, any>;
    setLinuxNativeModule(gtk);
  }

  gtk['gtk_init']?.();

  const window = gtk['gtk_window_new']();
  gtk['gtk_window_set_title']?.(window, title);
  gtk['gtk_window_set_default_size']?.(window, width, height);
  gtk['gtk_widget_add_css_class']?.(window, 'efui-root');

  const scroller = gtk['gtk_scrolled_window_new']();
  gtk['gtk_window_set_child'](window, scroller);

  let hostHandle: ReturnType<typeof makeLinuxHost> | undefined;
  const backend = createGtk4Backend(
    gtk,
    window,
    scroller,
    (node) => hostHandle?.triggerClick(node),
    (node, val) => hostHandle?.triggerInput(node, val),
  );

  hostHandle = makeLinuxHost({
    getViewportWidth: () => width,
    getDarkMode: isDark,
    backend,
  });

  const mountLayer = Layer.effectDiscard(
    Effect.provideContext(
      Renderer.mount(component as any, props as any, hostHandle.rootContainer, {
        fallback: options?.fallback as any,
        onEmit: options?.onEmit,
      }),
      Context.make(Renderer.Renderer, { host: hostHandle.host }).pipe(
        Context.merge(makeDesktopHtmlServices(isDark)),
      ),
    ),
  );

  const provided = options?.layer ? Layer.provide(mountLayer, options.layer) : mountLayer;
  Effect.runFork(Layer.launch(provided as Layer.Layer<never, never, never>));

  gtk['gtk_window_present'](window);

  if (usingNapi && typeof gtk['runGLib'] === 'function') {
    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        hostHandle?.dispose();
        gtk['stopGLib']?.();
        resolve();
      };

      connectGtkSignal(
        gtk,
        window,
        'close-request',
        () => {
          finish();
          return false;
        },
        true,
      );

      if (options?.autoCloseMs) {
        setTimeout(() => {
          gtk['gtk_window_destroy']?.(window);
          finish();
        }, options.autoCloseMs);
      }

      gtk['runGLib']();
    });
  }
}

export const LinuxHost = {
  makeLinuxHost,
  run,
} as const;
