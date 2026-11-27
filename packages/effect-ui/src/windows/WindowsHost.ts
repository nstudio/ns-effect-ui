/**
 * `WindowsHost`: a native Windows `Renderer.Host` for `@effect/ui`, powered by
 * `@nativescript/windows` (WinUI 3 / `Microsoft.UI.Xaml`) or
 * `@nativescript/windows-napi` (Node-API WinRT / `Windows.UI.Xaml` XAML Islands
 * and `Windows.UI.Composition`).
 *
 * Mounts unmodified `@effect/ui/html` (`Html.component(...)`) views directly
 * onto native Windows views with zero WebViews and zero Electron.
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
  toByteArgb,
  type ComputedBoxStyle,
  type LayoutNode,
  type Rect,
  type RgbaColor,
} from '../desktop/html-services.js';

export type WindowsRoot<V> = [Renderer.HostOf<V>] extends [Html.Host]
  ? unknown
  : {
      readonly 'WindowsHost.mount shows HTML elements. This root vocabulary needs': Renderer.HostOf<V>;
    };

export interface WindowsNode {
  readonly kind: 'element' | 'text' | 'container';
  readonly tag: string;
  parent: WindowsNode | undefined;
  readonly children: Array<WindowsNode>;
  text: string;
  className: string;
  id: string;
  readonly attrs: Record<string, string | undefined>;
  readonly props: Record<string, unknown>;
  handlers: Readonly<Record<string, View.Handler<unknown, any>>>;
  dispatch: Renderer.Dispatch | undefined;
  nativeHandle: any;
  dialogHandle: any;
  layoutNode: LayoutNode | undefined;
}

export interface WindowsVisualItem {
  readonly node: WindowsNode;
  readonly frame: Rect;
  readonly style: ComputedBoxStyle;
  readonly text: string | undefined;
  readonly isInteractive: boolean;
  readonly isInput: boolean;
  readonly inputValue: string;
  readonly placeholder: string;
}

/**
 * Pluggable rendering backend for `WindowsHost`.
 * Implemented automatically for WinUI 3 (`Microsoft.UI.Xaml`), XAML Islands
 * (`Windows.UI.Xaml`), WinRT Composition (`Windows.UI.Composition`), or
 * injected directly in unit tests.
 */
export interface WindowsHostBackend {
  readonly mode: 'winui' | 'xaml-islands' | 'composition' | 'custom';
  readonly renderFrame: (
    items: ReadonlyArray<WindowsVisualItem>,
    contentHeight: number,
    viewportWidth: number,
    dark: boolean,
  ) => void;
  readonly openDialog?: (
    dialogNode: WindowsNode,
    items: ReadonlyArray<WindowsVisualItem>,
    width: number,
    height: number,
    dark: boolean,
    onClose: () => void,
  ) => any;
  readonly updateDialog?: (
    handle: any,
    items: ReadonlyArray<WindowsVisualItem>,
    width: number,
    height: number,
    dark: boolean,
  ) => void;
  readonly closeDialog?: (handle: any) => void;
  readonly setTitle?: (title: string) => void;
  readonly dispose?: () => void;
}

export interface MakeWindowsHostOptions {
  readonly getViewportWidth: () => number;
  readonly getDarkMode: () => boolean;
  readonly backend: WindowsHostBackend;
  readonly onTitle?: ((title: string) => void) | undefined;
}

export interface WindowsRunOptions<
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

function collectElementChildren(node: WindowsNode): Array<WindowsNode> {
  const out: Array<WindowsNode> = [];
  for (const child of node.children) {
    if (child.kind === 'container') {
      out.push(...collectElementChildren(child));
    } else if (child.kind === 'element') {
      out.push(child);
    }
  }
  return out;
}

function collectText(node: WindowsNode): string {
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

function hasDirectBlockElements(node: WindowsNode): boolean {
  for (const child of collectElementChildren(node)) {
    if (child.tag !== 'span') return true;
  }
  return false;
}

function isInteractiveNode(node: WindowsNode): boolean {
  if (node.tag === 'button' || node.tag === 'a') return true;
  return Boolean(node.handlers['click']);
}

export function fireWindowsEvent(
  start: WindowsNode,
  eventName: string,
  eventPayload: Record<string, unknown>,
): void {
  let stopped = false;
  let cur: WindowsNode | undefined = start;
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

export function hitTestWindowsItems(
  items: ReadonlyArray<WindowsVisualItem>,
  x: number,
  y: number,
): WindowsVisualItem | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (!item.isInteractive && !item.isInput) continue;
    const f = item.frame;
    if (x >= f.x && x <= f.x + f.width && y >= f.y && y <= f.y + f.height) {
      return item;
    }
  }
  return undefined;
}

/**
 * Creates a `Renderer.Host<WindowsNode>` bound to any `WindowsHostBackend`
 * (WinUI 3, XAML Islands, WinRT Composition, or test backend).
 */
export function makeWindowsHost(options: MakeWindowsHostOptions): {
  readonly host: Renderer.Host<WindowsNode>;
  readonly rootContainer: WindowsNode;
  readonly relayout: () => void;
  readonly getItems: () => ReadonlyArray<WindowsVisualItem>;
  readonly getDialogItems: (dialog: WindowsNode) => ReadonlyArray<WindowsVisualItem>;
  readonly clickAt: (x: number, y: number) => boolean;
  readonly triggerClick: (node: WindowsNode) => void;
  readonly triggerInput: (node: WindowsNode, value: string) => void;
  readonly dispose: () => void;
} {
  const activeDialogs = new Map<WindowsNode, { handle: any; items: Array<WindowsVisualItem> }>();
  let latestItems: Array<WindowsVisualItem> = [];
  let lastTitle: string | undefined;

  const createNode = (
    kind: WindowsNode['kind'],
    tag: string,
    text = '',
  ): WindowsNode => ({
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
    nativeHandle: undefined,
    dialogHandle: undefined,
    layoutNode: undefined,
  });

  const rootContainer = createNode('container', '#root');

  const buildLayoutNode = (
    node: WindowsNode,
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

  const flattenVisualItems = (
    node: WindowsNode,
    offsetX: number,
    offsetY: number,
    out: Array<WindowsVisualItem>,
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

    const isInput = node.tag === 'input';
    const rawVal = node.props['value'] ?? node.attrs['value'] ?? '';

    out.push({
      node,
      frame: absFrame,
      style: ln.style,
      text: ln.text,
      isInteractive: isInteractiveNode(node),
      isInput,
      inputValue: typeof rawVal === 'string' ? rawVal : String(rawVal),
      placeholder: node.attrs['placeholder'] ?? '',
    });

    if (hasDirectBlockElements(node)) {
      for (const child of collectElementChildren(node)) {
        flattenVisualItems(child, absFrame.x, absFrame.y, out, false);
      }
    }
  };

  const syncDialogs = (dark: boolean): void => {
    const found: Array<WindowsNode> = [];
    const walk = (n: WindowsNode) => {
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
        const items: Array<WindowsVisualItem> = [];
        flattenVisualItems(dlg, 0, 0, items, true);

        if (!existing) {
          const handle = options.backend.openDialog?.(dlg, items, dlgW, dlgH, dark, () => {
            activeDialogs.delete(dlg);
            dlg.dialogHandle = undefined;
            fireWindowsEvent(dlg, 'cancel', { cancelable: true });
          });
          dlg.dialogHandle = handle;
          activeDialogs.set(dlg, { handle, items });
        } else {
          existing.items = items;
          options.backend.updateDialog?.(existing.handle, items, dlgW, dlgH, dark);
        }
      } else if (existing) {
        activeDialogs.delete(dlg);
        dlg.dialogHandle = undefined;
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

    const items: Array<WindowsVisualItem> = [];
    flattenVisualItems(primary, 0, 0, items, false);
    latestItems = items;

    options.backend.renderFrame(items, totalH, viewportW, dark);
    syncDialogs(dark);
  };

  const detach = (node: WindowsNode): void => {
    const oldParent = node.parent;
    if (!oldParent) return;
    const idx = oldParent.children.indexOf(node);
    if (idx >= 0) oldParent.children.splice(idx, 1);
    node.parent = undefined;
  };

  const host: Renderer.Host<WindowsNode> = {
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

  const triggerClick = (node: WindowsNode): void => {
    fireWindowsEvent(node, 'click', { button: 0 });
  };

  const triggerInput = (node: WindowsNode, value: string): void => {
    node.props['value'] = value;
    fireWindowsEvent(node, 'input', { target: { value } });
    fireWindowsEvent(node, 'change', { target: { value } });
  };

  return {
    host,
    rootContainer,
    relayout,
    getItems: () => latestItems,
    getDialogItems: (dialog) => activeDialogs.get(dialog)?.items ?? [],
    clickAt: (x, y) => {
      const hit = hitTestWindowsItems(latestItems, x, y);
      if (!hit) return false;
      triggerClick(hit.node);
      return true;
    },
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
 * Builds a live WinUI 3 / XAML Islands backend when `Microsoft.UI.Xaml`
 * (`@nativescript/windows`) or `Windows.UI.Xaml` (`@nativescript/windows-napi`
 * `XamlWindow`) is available on the host thread.
 */
function createXamlBackend(
  xamlNs: any,
  rootScrollViewer: any,
  onClickNode: (node: WindowsNode) => void,
  onInputNode: (node: WindowsNode, value: string) => void,
  setWindowTitle: (title: string) => void,
  xamlWindowCtor?: any,
): WindowsHostBackend {
  const Controls = xamlNs.Controls;
  const Media = xamlNs.Media;
  const NSWinRT = (globalThis as unknown as Record<string, any>).NSWinRT;

  const makeBrush = (c: RgbaColor) => {
    const brush = new Media.SolidColorBrush();
    brush.Color = toByteArgb(c);
    return brush;
  };

  const renderIntoCanvas = (
    canvas: any,
    items: ReadonlyArray<WindowsVisualItem>,
    width: number,
    height: number,
    dark: boolean,
  ): void => {
    const pal = dark ? darkPalette : lightPalette;
    canvas.Width = width;
    canvas.Height = height;
    canvas.Background = makeBrush(pal.background);
    canvas.Children.Clear();

    for (const item of items) {
      const { frame, style, node } = item;
      let element: any;

      if (item.isInput) {
        const box = new Controls.TextBox();
        box.Text = item.inputValue;
        box.PlaceholderText = item.placeholder;
        box.FontSize = style.fontSize;
        box.Foreground = makeBrush(style.color);
        if (style.backgroundColor) box.Background = makeBrush(style.backgroundColor);
        const onChanged = () => onInputNode(node, String(box.Text ?? ''));
        box.TextChanged = NSWinRT?.asDelegate
          ? NSWinRT.asDelegate(`${xamlNs.__typeName__ ?? 'Microsoft.UI.Xaml'}.Controls.TextChangedEventHandler`, onChanged)
          : onChanged;
        element = box;
      } else if (item.isInteractive) {
        const btn = new Controls.Button();
        btn.Content = item.text ?? '';
        btn.FontSize = style.fontSize;
        btn.Foreground = makeBrush(style.color);
        if (style.backgroundColor) btn.Background = makeBrush(style.backgroundColor);
        if (style.borderColor && style.borderWidth > 0) {
          btn.BorderBrush = makeBrush(style.borderColor);
          btn.BorderThickness = {
            Left: style.borderWidth,
            Top: style.borderWidth,
            Right: style.borderWidth,
            Bottom: style.borderWidth,
          };
        }
        if (style.borderRadius > 0) {
          btn.CornerRadius = {
            TopLeft: style.borderRadius,
            TopRight: style.borderRadius,
            BottomRight: style.borderRadius,
            BottomLeft: style.borderRadius,
          };
        }
        const onClick = () => onClickNode(node);
        btn.Click = NSWinRT?.asDelegate
          ? NSWinRT.asDelegate(`${xamlNs.__typeName__ ?? 'Microsoft.UI.Xaml'}.RoutedEventHandler`, onClick)
          : onClick;
        element = btn;
      } else if (item.text && item.text.length > 0 && !style.backgroundColor && style.borderWidth === 0) {
        const tb = new Controls.TextBlock();
        tb.Text = item.text;
        tb.FontSize = style.fontSize;
        tb.Foreground = makeBrush(style.color);
        tb.TextWrapping = 2; // TextWrapping.Wrap
        element = tb;
      } else {
        const border = new Controls.Border();
        if (style.backgroundColor) border.Background = makeBrush(style.backgroundColor);
        if (style.borderColor && style.borderWidth > 0) {
          border.BorderBrush = makeBrush(style.borderColor);
          border.BorderThickness = {
            Left: style.borderWidth,
            Top: style.borderWidth,
            Right: style.borderWidth,
            Bottom: style.borderWidth,
          };
        }
        if (style.borderRadius > 0) {
          border.CornerRadius = {
            TopLeft: style.borderRadius,
            TopRight: style.borderRadius,
            BottomRight: style.borderRadius,
            BottomLeft: style.borderRadius,
          };
        }
        if (item.text && item.text.length > 0) {
          const tb = new Controls.TextBlock();
          tb.Text = item.text;
          tb.FontSize = style.fontSize;
          tb.Foreground = makeBrush(style.color);
          tb.TextWrapping = 2;
          tb.Margin = {
            Left: style.padLeft,
            Top: style.padTop,
            Right: style.padRight,
            Bottom: style.padBottom,
          };
          border.Child = tb;
        }
        element = border;
      }

      element.Width = Math.max(1, frame.width);
      element.Height = Math.max(1, frame.height);
      Controls.Canvas.SetLeft(element, frame.x);
      Controls.Canvas.SetTop(element, frame.y);
      canvas.Children.Append(element);
    }
  };

  const rootCanvas = new Controls.Canvas();
  rootScrollViewer.Content = rootCanvas;

  return {
    mode: xamlWindowCtor ? 'xaml-islands' : 'winui',
    renderFrame: (items, contentHeight, viewportWidth, dark) => {
      renderIntoCanvas(rootCanvas, items, viewportWidth, contentHeight, dark);
    },
    openDialog: (_dlg, items, width, height, dark, onClose) => {
      if (!xamlWindowCtor) return undefined;
      const win = new xamlWindowCtor({ style: 'dialog', title: 'Dialog', theme: dark ? 'dark' : 'light' });
      const canvas = new Controls.Canvas();
      renderIntoCanvas(canvas, items, width, height, dark);
      win.content = canvas;
      win.on?.('closed', onClose);
      win.place({ width, height });
      win.show();
      return { win, canvas };
    },
    updateDialog: (handle, items, width, height, dark) => {
      if (handle?.canvas) {
        renderIntoCanvas(handle.canvas, items, width, height, dark);
      }
    },
    closeDialog: (handle) => {
      try {
        handle?.win?.close?.();
      } catch {
        // Ignore
      }
    },
    setTitle: setWindowTitle,
  };
}

/**
 * Builds a WinRT Composition backend using `@nativescript/windows-napi`
 * `createWindow` + `attachCompositorToWindow` (`Windows.UI.Composition`).
 * Works in plain Node.js, Bun, and Deno on Windows without a XAML manifest.
 */
function createCompositionBackend(
  Windows: any,
  native: any,
  hwnd: unknown,
): WindowsHostBackend {
  const compositor = new Windows.UI.Composition.Compositor();
  const target = native.attachCompositorToWindow(compositor, hwnd);
  const rootVisual = compositor.CreateSpriteVisual();
  target.Root = rootVisual;

  return {
    mode: 'composition',
    renderFrame: (items, contentHeight, viewportWidth, dark) => {
      const pal = dark ? darkPalette : lightPalette;
      rootVisual.Size = { X: viewportWidth, Y: Math.max(contentHeight, 100) };
      rootVisual.Brush = compositor.CreateColorBrush(toByteArgb(pal.background));
      rootVisual.Children.RemoveAll();

      for (const item of items) {
        if (!item.style.backgroundColor && item.style.borderWidth === 0) continue;
        const visual = compositor.CreateSpriteVisual();
        visual.Offset = { X: item.frame.x, Y: item.frame.y, Z: 0 };
        visual.Size = { X: Math.max(1, item.frame.width), Y: Math.max(1, item.frame.height) };
        const fill = item.style.backgroundColor ?? item.style.borderColor ?? pal.card;
        visual.Brush = compositor.CreateColorBrush(toByteArgb(fill));
        rootVisual.Children.InsertAtTop(visual);
      }
    },
    setTitle: (title) => {
      try {
        native.setWindowTitle(hwnd, title);
      } catch {
        // Ignore
      }
    },
  };
}

/**
 * Launches a native Windows desktop application rendering any shared
 * `@effect/ui` HTML component (`PulseApp`, `@effect/ui-kit`, etc.) via
 * `@nativescript/windows` (WinUI 3) or `@nativescript/windows-napi`
 * (XAML Islands / WinRT Composition).
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
  component: Component.Members<Name, Props, Model, Msg, Events, R, V, any> & WindowsRoot<V>,
  props: Props | Effect.Effect<Props, never, RP>,
  options?: WindowsRunOptions<V, RF, Events, Exclude<R | RF | RP, Html.Host>>,
): Promise<void> {
  const width = options?.width ?? 460;
  const height = options?.height ?? 840;
  const title = options?.title ?? 'Effect Pulse';
  const isDark = (): boolean => options?.appearance === 'dark';

  const gWin = globalThis as unknown as Record<string, any>;
  let api: any;
  let winuiMode = false;

  if (gWin.Microsoft?.UI?.Xaml?.Controls?.Canvas) {
    // Running inside `@nativescript/windows` V8 WinUI 3 app runtime.
    winuiMode = true;
    api = { Microsoft: gWin.Microsoft, Windows: gWin.Windows };
  } else {
    // Running inside Node.js, Bun, or Deno via `@nativescript/windows-napi`.
    const modName = '@nativescript/windows-napi';
    api = await import(modName);
    if (api.Windows && !gWin.Windows) gWin.Windows = api.Windows;
  }

  let currentViewportW = width;
  let hostHandle: ReturnType<typeof makeWindowsHost> | undefined;
  let hwnd: unknown;
  let nativeMod: any;

  let backend: WindowsHostBackend;

  if (winuiMode) {
    const win = new api.Microsoft.UI.Xaml.Window();
    win.Title = title;
    const scroller = new api.Microsoft.UI.Xaml.Controls.ScrollViewer();
    win.Content = scroller;
    backend = createXamlBackend(
      api.Microsoft.UI.Xaml,
      scroller,
      (node) => hostHandle?.triggerClick(node),
      (node, val) => hostHandle?.triggerInput(node, val),
      (t) => {
        win.Title = t;
      },
    );
    win.Activate();
  } else {
    const Windows = api.Windows ?? api.default?.Windows;
    const XamlWindow = api.XamlWindow ?? api.default?.XamlWindow;
    nativeMod = api.native ?? api.default?.native ?? api;

    let xamlWindow: any;
    if (XamlWindow && Windows?.UI?.Xaml?.Controls?.ScrollViewer) {
      try {
        xamlWindow = new XamlWindow({
          style: 'dialog',
          title,
          theme: options?.appearance ?? 'system',
        });
      } catch {
        // Plain node.exe/bun.exe without XAML Islands manifest falls back to Composition.
        xamlWindow = undefined;
      }
    }

    if (xamlWindow) {
      const scroller = new Windows.UI.Xaml.Controls.ScrollViewer();
      xamlWindow.content = scroller;
      backend = createXamlBackend(
        Windows.UI.Xaml,
        scroller,
        (node) => hostHandle?.triggerClick(node),
        (node, val) => hostHandle?.triggerInput(node, val),
        () => {},
        XamlWindow,
      );
      xamlWindow.place({ width, height });
      xamlWindow.show();
    } else {
      hwnd = nativeMod.createWindow(title, width, height);
      const size = nativeMod.getWindowSize?.(hwnd) as { width?: number } | null;
      if (size?.width && size.width > 0) currentViewportW = size.width;
      backend = createCompositionBackend(Windows, nativeMod, hwnd);
    }
  }

  hostHandle = makeWindowsHost({
    getViewportWidth: () => currentViewportW,
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

  if (!winuiMode && nativeMod?.pumpMessages) {
    const start = Date.now();
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        nativeMod.pumpMessages();
        if (hwnd && nativeMod.pollWindowEvents) {
          const events = nativeMod.pollWindowEvents(hwnd) as Array<any>;
          for (const ev of events) {
            if (ev.type === 'pointerdown') {
              hostHandle?.clickAt(ev.x, ev.y);
            } else if (ev.type === 'resize' && ev.width > 0) {
              currentViewportW = ev.width;
              hostHandle?.relayout();
            } else if (ev.type === 'close') {
              clearInterval(timer);
              hostHandle?.dispose();
              resolve();
              return;
            }
          }
        }
        if (options?.autoCloseMs && Date.now() - start >= options.autoCloseMs) {
          clearInterval(timer);
          hostHandle?.dispose();
          resolve();
        }
      }, 16);
    });
  }
}

export const WindowsHost = {
  makeWindowsHost,
  run,
} as const;
