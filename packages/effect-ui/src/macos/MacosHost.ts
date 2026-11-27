/**
 * `MacosHost`: a true native macOS AppKit `Renderer.Host` for `@effect/ui`,
 * powered by `@nativescript/macos-node-api` (Node-API -> Objective-C AppKit).
 *
 * Mounts unmodified `Html.component(...)` views (such as `PulseApp`) and
 * `@effect/ui-kit` headless components directly onto real `NSWindow`,
 * `NSScrollView`, `NSView`, `NSTextField`, and `NSPanel` modal sheet views -
 * with zero WebViews, zero Electron, zero React, and zero Xcode build step.
 */
import type * as Component from '@effect/ui/Component';
import { Html, HtmlSubscription } from '@effect/ui/html';
import * as Renderer from '@effect/ui/Renderer';
import type * as View from '@effect/ui/View';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type * as AsyncResult from 'effect/reactivity/AsyncResult';
import { layoutTree, measureNode, type LayoutNode, type Rect } from './layout.ts';
import {
  type ComputedBoxStyle,
  darkPalette,
  lightPalette,
  resolveMacosStyle,
  type RgbaColor,
} from './styles.ts';

export type MacosRoot<V> = [Renderer.HostOf<V>] extends [Html.Host]
  ? unknown
  : {
      readonly 'MacosHost.mount shows HTML elements. This root vocabulary needs': Renderer.HostOf<V>;
    };

export interface MacosNode {
  readonly kind: 'element' | 'text' | 'container';
  readonly tag: string;
  parent: MacosNode | undefined;
  readonly children: Array<MacosNode>;
  text: string;
  className: string;
  id: string;
  readonly attrs: Record<string, string | undefined>;
  readonly props: Record<string, unknown>;
  handlers: Readonly<Record<string, View.Handler<unknown, any>>>;
  dispatch: Renderer.Dispatch | undefined;
  nsView: any;
  nsLabel: any;
  nsInput: any;
  dialogWindow: any;
  layoutNode: LayoutNode | undefined;
}

export interface MacosRunOptions<V extends View.Elements, RF = never, Events = unknown, R = never> {
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
  /** Optional PNG path to snapshot the rendered native macOS window and exit (for verification/CI). */
  readonly capturePath?: string | undefined;
  readonly captureDelayMs?: number | undefined;
}

// AppKit classes initialized lazily once `@nativescript/macos-node-api` is loaded.
let classesReady = false;
let FlippedNSViewCtor: any;
let ClickableNSViewCtor: any;
let InputDelegateCtor: any;
let WindowDelegateCtor: any;
let AppDelegateCtor: any;

function g(name: string): any {
  return (globalThis as unknown as Record<string, any>)[name];
}

function ensureAppKitClasses(): void {
  if (classesReady) return;
  classesReady = true;

  const NSViewCls = g('NSView');
  const NSObjectCls = g('NSObject');
  const NativeClassFn = g('NativeClass');
  const interopObj = g('interop');

  class FlippedNSView extends NSViewCls {
    get isFlipped() {
      return true;
    }
  }
  NativeClassFn(FlippedNSView);
  FlippedNSViewCtor = FlippedNSView;

  class ClickableNSView extends NSViewCls {
    _onClick?: () => void;
    get isFlipped() {
      return true;
    }
    mouseDown(_event: any) {
      if (this.layer) this.layer.opacity = 0.72;
    }
    mouseUp(_event: any) {
      if (this.layer) this.layer.opacity = 1.0;
      this._onClick?.();
    }
    resetCursorRects() {
      try {
        const NSCursorCls = g('NSCursor');
        this.addCursorRectCursor(this.bounds, NSCursorCls.pointingHandCursor);
      } catch {
        // Ignore
      }
    }
  }
  NativeClassFn(ClickableNSView);
  ClickableNSViewCtor = ClickableNSView;

  class InputDelegate extends NSObjectCls {
    _onChange?: (val: string) => void;
    static ObjCProtocols = [g('NSTextFieldDelegate')];
    controlTextDidChange(notification: any) {
      try {
        const field = notification?.object;
        const val = String(field?.stringValue ?? '');
        this._onChange?.(val);
      } catch {
        // Ignore
      }
    }
  }
  NativeClassFn(InputDelegate);
  InputDelegateCtor = InputDelegate;

  class WindowDelegate extends NSObjectCls {
    _onResize?: (w: number, h: number) => void;
    _onClose?: () => void;
    static ObjCProtocols = [g('NSWindowDelegate')];
    windowDidResize(notification: any) {
      try {
        const win = notification?.object;
        const rect = win?.contentView?.bounds;
        if (rect) {
          this._onResize?.(rect.size.width, rect.size.height);
        }
      } catch {
        // Ignore
      }
    }
    windowWillClose(_notification: any) {
      this._onClose?.();
    }
  }
  NativeClassFn(WindowDelegate);
  WindowDelegateCtor = WindowDelegate;

  class EffectAppDelegate extends NSObjectCls {
    running = true;
    static ObjCProtocols = [g('NSApplicationDelegate')];
    static ObjCExposedMethods = {
      quitApp: { returns: interopObj.types.void, params: [interopObj.types.id] },
    };
    applicationDidFinishLaunching(_notification: any) {
      const app = g('NSApp');
      app.activateIgnoringOtherApps(true);
      app.stop(this);
    }
    applicationWillTerminate(_notification: any) {
      this.running = false;
    }
    quitApp(_sender: any) {
      this.running = false;
      g('NSApp').terminate(this);
    }
  }
  NativeClassFn(EffectAppDelegate);
  AppDelegateCtor = EffectAppDelegate;
}

function toNSColor(c: RgbaColor): any {
  return g('NSColor').colorWithSRGBRedGreenBlueAlpha(c.r, c.g, c.b, c.a);
}

function toNSFont(size: number, weight: ComputedBoxStyle['fontWeight']): any {
  const NSFontCls = g('NSFont');
  // NSFontWeight values: regular=0, medium=0.23, semibold=0.3, bold=0.4
  const w =
    weight === 'bold' ? 0.4 : weight === 'semibold' ? 0.3 : weight === 'medium' ? 0.23 : 0.0;
  return NSFontCls.systemFontOfSizeWeight(size, w);
}

function makeAttributedText(text: string, style: ComputedBoxStyle): any {
  const attrs: Record<string, any> = {
    NSFont: toNSFont(style.fontSize, style.fontWeight),
    NSColor: toNSColor(style.color),
  };
  if (style.strikethrough) {
    attrs['NSStrikethrough'] = 1;
  }
  if (style.textAlign !== 'left') {
    const para = g('NSMutableParagraphStyle').new();
    // NSTextAlignment: Left=0, Right=1, Center=2
    para.alignment = style.textAlign === 'center' ? 2 : 1;
    attrs['NSParagraphStyle'] = para;
  }
  return g('NSAttributedString').alloc().initWithStringAttributes(text, attrs);
}

function measureAppKitText(
  text: string,
  style: ComputedBoxStyle,
  maxWidth: number,
): { readonly width: number; readonly height: number } {
  if (!text) return { width: 0, height: style.fontSize * 1.3 };
  try {
    const attrStr = makeAttributedText(text, style);
    const boundedW = maxWidth > 0 ? maxWidth : 10000;
    // NSStringDrawingUsesLineFragmentOrigin (1) | NSStringDrawingUsesFontLeading (2) = 3
    const rect = attrStr.boundingRectWithSizeOptionsContext(
      { width: boundedW, height: 10000 },
      3,
      null,
    );
    return {
      width: Math.min(boundedW, Math.ceil(rect.size.width) + 4),
      height: Math.max(Math.ceil(style.fontSize * 1.32), Math.ceil(rect.size.height) + 2),
    };
  } catch {
    const charW = style.fontSize * 0.56;
    const rawW = text.length * charW;
    const lines = maxWidth > 0 ? Math.max(1, Math.ceil(rawW / maxWidth)) : 1;
    return {
      width: Math.min(maxWidth || rawW, rawW),
      height: lines * style.fontSize * 1.38,
    };
  }
}

function collectDirectText(node: MacosNode): string | undefined {
  let buf = '';
  let hasElements = false;
  for (const ch of node.children) {
    if (ch.kind === 'text') buf += ch.text;
    else if (ch.kind === 'element') hasElements = true;
    else if (ch.kind === 'container') {
      const sub = collectDirectText(ch);
      if (sub) buf += sub;
    }
  }
  if (hasElements) return undefined;
  return buf.length > 0 ? buf : undefined;
}

function collectElementChildren(node: MacosNode): Array<MacosNode> {
  const out: Array<MacosNode> = [];
  for (const ch of node.children) {
    if (ch.kind === 'element') out.push(ch);
    else if (ch.kind === 'container') out.push(...collectElementChildren(ch));
  }
  return out;
}

function fireBubble(node: MacosNode, eventName: string, payload: unknown): boolean {
  let cur: MacosNode | undefined = node;
  while (cur) {
    const handler = cur.handlers[eventName];
    if (handler && cur.dispatch) {
      cur.dispatch(eventName, handler, payload);
      return true;
    }
    cur = cur.parent;
  }
  return false;
}

function findAncestorTag(node: MacosNode, tag: string): MacosNode | undefined {
  let cur = node.parent;
  while (cur) {
    if (cur.kind === 'element' && cur.tag === tag) return cur;
    cur = cur.parent;
  }
  return undefined;
}

function collectFormValues(formNode: MacosNode): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (n: MacosNode) => {
    if (n.kind === 'element' && n.tag === 'input') {
      const name = n.attrs['name'];
      if (name) {
        out[name] = String(n.nsInput?.stringValue ?? n.props['value'] ?? '');
      }
    }
    for (const c of n.children) walk(c);
  };
  walk(formNode);
  return out;
}

function createMacosElementNode(tag: string): MacosNode {
  return {
    kind: 'element',
    tag: tag.toLowerCase(),
    parent: undefined,
    children: [],
    text: '',
    className: '',
    id: '',
    attrs: {},
    props: {},
    handlers: {},
    dispatch: undefined,
    nsView: undefined,
    nsLabel: undefined,
    nsInput: undefined,
    dialogWindow: undefined,
    layoutNode: undefined,
  };
}

function makeNativeHtmlServices(): Context.Context<Html.Host> {
  return Context.make(Html.Host, {
    focus: (el: any) => {
      try {
        const node = el as MacosNode;
        const win = node?.nsInput?.window ?? node?.nsView?.window;
        if (win && node?.nsInput) win.makeFirstResponder(node.nsInput);
      } catch {
        // Ignore
      }
    },
    blur: (el: any) => {
      try {
        const node = el as MacosNode;
        const win = node?.nsInput?.window ?? node?.nsView?.window;
        if (win) win.makeFirstResponder(null);
      } catch {
        // Ignore
      }
    },
    scrollIntoView: () => {},
    measure: (el: any) => {
      const f = (el as MacosNode)?.layoutNode?.frame;
      return {
        x: f?.x ?? 0,
        y: f?.y ?? 0,
        width: f?.width ?? 0,
        height: f?.height ?? 0,
        top: f?.y ?? 0,
        left: f?.x ?? 0,
        right: (f?.x ?? 0) + (f?.width ?? 0),
        bottom: (f?.y ?? 0) + (f?.height ?? 0),
      };
    },
    select: () => {},
    requestSubmit: (el: any) => {
      const node = el as MacosNode;
      if (!node) return false;
      return fireBubble(node, 'submit', { values: collectFormValues(node) });
    },
    showPicker: () => false,
  }).pipe(
    Context.add(HtmlSubscription.AnimationFrames, {
      now: () => Date.now(),
      listen: (cb) => {
        let stopped = false;
        let id: ReturnType<typeof setTimeout> | undefined;
        const tick = () => {
          if (stopped) return;
          cb(Date.now());
          if (!stopped) id = setTimeout(tick, 16);
        };
        id = setTimeout(tick, 16);
        return () => {
          stopped = true;
          if (id !== undefined) clearTimeout(id);
        };
      },
    }),
    Context.add(HtmlSubscription.MediaQueries, {
      matches: () => undefined,
      listen: () => () => {},
    }),
    Context.add(HtmlSubscription.GlobalEvents, {
      listen: () => () => {},
    }),
  ) as unknown as Context.Context<Html.Host>;
}

/**
 * Builds the `Renderer.Host<MacosNode>` backed by AppKit views inside a native
 * macOS `NSScrollView` + `NSWindow`.
 */
export function makeMacosHost(options: {
  readonly getViewportWidth: () => number;
  readonly getDarkMode: () => boolean;
  readonly getHostWindow: () => any;
  readonly attachRootView: (view: any, contentHeight: number) => void;
  readonly onTitle?: ((title: string) => void) | undefined;
}): {
  readonly host: Renderer.Host<MacosNode>;
  readonly rootContainer: MacosNode;
  readonly relayout: () => void;
  readonly dispose: () => void;
} {
  ensureAppKitClasses();

  const rootContainer = createMacosElementNode('div');
  const activeDialogs = new Set<MacosNode>();
  let lastTitle: string | undefined;

  const ensureNSView = (node: MacosNode, isClickable: boolean): any => {
    if (node.nsView) return node.nsView;
    const view = isClickable ? ClickableNSViewCtor.new() : FlippedNSViewCtor.new();
    view.wantsLayer = true;
    if (isClickable) {
      view._onClick = () => {
        if (node.tag === 'button' && node.attrs['type'] === 'submit') {
          const form = findAncestorTag(node, 'form');
          if (form) {
            fireBubble(form, 'submit', { values: collectFormValues(form) });
            return;
          }
        }
        fireBubble(node, 'click', {});
      };
    }
    node.nsView = view;
    return view;
  };

  const applyViewVisuals = (
    node: MacosNode,
    style: ComputedBoxStyle,
    rect: Rect,
    text: string | undefined,
  ): any => {
    const clickable = node.tag === 'button' || Boolean(node.handlers['click']);
    const view = ensureNSView(node, clickable);
    view.frame = {
      origin: { x: rect.x, y: rect.y },
      size: { width: Math.max(0, rect.width), height: Math.max(0, rect.height) },
    };

    const layer = view.layer;
    if (layer) {
      layer.backgroundColor = style.backgroundColor ? toNSColor(style.backgroundColor).CGColor : null;
      layer.borderWidth = style.borderWidth;
      layer.borderColor = style.borderColor ? toNSColor(style.borderColor).CGColor : null;
      const maxR = Math.min(rect.width, rect.height) / 2;
      layer.cornerRadius = style.borderRadius >= 999 ? maxR : Math.min(style.borderRadius, maxR);
      layer.masksToBounds = style.borderRadius > 0;
    }

    // Input element -> real native editable NSTextField
    if (node.tag === 'input') {
      if (!node.nsInput) {
        const tf = g('NSTextField').alloc().initWithFrame({
          origin: { x: 0, y: 0 },
          size: { width: rect.width, height: rect.height },
        });
        tf.isEditable = true;
        tf.isSelectable = true;
        tf.isBordered = false;
        tf.drawsBackground = false;
        tf.focusRingType = 1; // NSFocusRingTypeNone
        const del = InputDelegateCtor.new();
        del._onChange = (val: string) => {
          node.props['value'] = val;
          fireBubble(node, 'input', { value: val });
        };
        tf.delegate = del;
        (node as any)._inputDelegate = del;
        node.nsInput = tf;
        view.addSubview(tf);
      }
      const tf = node.nsInput;
      tf.frame = {
        origin: { x: style.padLeft, y: Math.max(0, (rect.height - 20) / 2) },
        size: { width: Math.max(0, rect.width - style.padLeft - style.padRight), height: 22 },
      };
      tf.font = toNSFont(style.fontSize, style.fontWeight);
      tf.textColor = toNSColor(style.color);
      if (node.attrs['placeholder']) {
        tf.placeholderString = node.attrs['placeholder'];
      }
      const desired = String(node.props['value'] ?? '');
      if (String(tf.stringValue ?? '') !== desired) {
        tf.stringValue = desired;
      }
      return view;
    }

    // Leaf text element -> native non-editable NSTextField
    if (text !== undefined) {
      if (!node.nsLabel) {
        const lbl = g('NSTextField').labelWithString('');
        lbl.isEditable = false;
        lbl.isSelectable = false;
        lbl.drawsBackground = false;
        lbl.isBordered = false;
        lbl.usesSingleLineMode = false;
        lbl.lineBreakMode = 0; // NSLineBreakByWordWrapping
        node.nsLabel = lbl;
        view.addSubview(lbl);
      }
      const lbl = node.nsLabel;
      const innerW = Math.max(0, rect.width - style.padLeft - style.padRight);
      const innerH = Math.max(0, rect.height - style.padTop - style.padBottom);
      const measured = measureAppKitText(text, style, innerW);
      const textY =
        style.padTop + Math.max(0, (innerH - measured.height) / 2);
      lbl.frame = {
        origin: { x: style.padLeft, y: textY },
        size: { width: innerW, height: Math.max(innerH, measured.height) },
      };
      lbl.attributedStringValue = makeAttributedText(text, style);
    } else if (node.nsLabel) {
      node.nsLabel.removeFromSuperview();
      node.nsLabel = undefined;
    }

    return view;
  };

  const buildLayoutNode = (
    node: MacosNode,
    inheritedColor: RgbaColor,
    dark: boolean,
    allowDialog = false,
  ): LayoutNode => {
    const isPortal = node.tag === 'dialog' && !allowDialog;
    const style = resolveMacosStyle(node.tag, node.className, node.attrs, inheritedColor, dark);
    const text = collectDirectText(node);
    const childElements = text === undefined ? collectElementChildren(node) : [];
    const children = childElements.map((c) => buildLayoutNode(c, style.color, dark, false));
    const ln: LayoutNode = {
      tag: node.tag,
      isPortal,
      style,
      text,
      children,
      frame: { x: 0, y: 0, width: 0, height: 0 },
    };
    node.layoutNode = ln;
    return ln;
  };

  const syncNSViewTree = (node: MacosNode, parentNSView: any, allowDialog = false): void => {
    const ln = node.layoutNode;
    if (!ln || ln.style.display === 'none' || (node.tag === 'dialog' && !allowDialog)) {
      if (node.nsView && node.nsView.superview) {
        node.nsView.removeFromSuperview();
      }
      return;
    }

    const view = applyViewVisuals(node, ln.style, ln.frame, ln.text);
    if (parentNSView && view.superview !== parentNSView) {
      view.removeFromSuperview();
      parentNSView.addSubview(view);
    }

    const childElements = ln.text === undefined ? collectElementChildren(node) : [];
    const activeChildViews = new Set<any>();
    for (const ch of childElements) {
      syncNSViewTree(ch, view, false);
      if (ch.nsView && ch.nsView.superview === view) {
        activeChildViews.add(ch.nsView);
      }
    }

    // Prune stale subviews that are no longer in the tree
    try {
      const subviews = view.subviews;
      const count = subviews.count;
      for (let i = count - 1; i >= 0; i--) {
        const sv = subviews.objectAtIndex(i);
        if (sv !== node.nsLabel && sv !== node.nsInput && !activeChildViews.has(sv)) {
          sv.removeFromSuperview();
        }
      }
    } catch {
      // Ignore
    }
  };

  const syncDialogs = (root: MacosNode, dark: boolean): void => {
    const foundDialogs: Array<MacosNode> = [];
    const walk = (n: MacosNode) => {
      if (n.kind === 'element' && n.tag === 'dialog') foundDialogs.push(n);
      for (const c of n.children) walk(c);
    };
    walk(root);

    for (const dlg of foundDialogs) {
      const openVal = dlg.props['open'];
      const wantOpen = openVal === 'modal' || openVal === true;
      const isOpen = activeDialogs.has(dlg);

      if (wantOpen && !isOpen) {
        activeDialogs.add(dlg);
        const pal = dark ? darkPalette : lightPalette;
        const dlgW = 420;
        const ln = buildLayoutNode(dlg, pal.foreground, dark, true);
        const m = measureNode(ln, dlgW, measureAppKitText);
        const dlgH = Math.max(240, m.height + 16);
        layoutTree(ln, 0, 0, dlgW, dlgH, measureAppKitText);

        const panel = g('NSWindow')
          .alloc()
          .initWithContentRectStyleMaskBackingDefer(
            { origin: { x: 0, y: 0 }, size: { width: dlgW, height: dlgH } },
            1 | 2, // Titled | Closable
            2, // NSBackingStoreBuffered
            false,
          );
        panel.title = 'New Milestone';
        panel.backgroundColor = toNSColor(pal.card);
        const contentRoot = FlippedNSViewCtor.new();
        contentRoot.wantsLayer = true;
        contentRoot.frame = { origin: { x: 0, y: 0 }, size: { width: dlgW, height: dlgH } };
        panel.contentView = contentRoot;

        const del = WindowDelegateCtor.new();
        del._onClose = () => {
          if (activeDialogs.has(dlg)) {
            activeDialogs.delete(dlg);
            dlg.dialogWindow = undefined;
            fireBubble(dlg, 'cancel', { cancelable: true });
          }
        };
        panel.delegate = del;
        (panel as any)._winDel = del;

        syncNSViewTree(dlg, contentRoot, true);
        dlg.dialogWindow = panel;

        const hostWin = options.getHostWindow();
        if (hostWin) {
          hostWin.beginSheetCompletionHandler(panel, null);
        } else {
          panel.center();
          panel.makeKeyAndOrderFront(null);
        }
      } else if (wantOpen && isOpen && dlg.dialogWindow) {
        const pal = dark ? darkPalette : lightPalette;
        const dlgW = 420;
        const ln = buildLayoutNode(dlg, pal.foreground, dark, true);
        const m = measureNode(ln, dlgW, measureAppKitText);
        const dlgH = Math.max(240, m.height + 16);
        layoutTree(ln, 0, 0, dlgW, dlgH, measureAppKitText);
        syncNSViewTree(dlg, dlg.dialogWindow.contentView, true);
      } else if (!wantOpen && isOpen) {
        activeDialogs.delete(dlg);
        const panel = dlg.dialogWindow;
        dlg.dialogWindow = undefined;
        if (panel) {
          const hostWin = options.getHostWindow();
          try {
            if (hostWin) hostWin.endSheet(panel);
            panel.orderOut(null);
          } catch {
            // Ignore
          }
        }
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
    const m = measureNode(ln, viewportW, measureAppKitText);
    const totalH = Math.max(m.height, 100);
    layoutTree(ln, 0, 0, viewportW, totalH, measureAppKitText);
    syncNSViewTree(primary, null, false);

    if (primary.nsView) {
      options.attachRootView(primary.nsView, totalH);
    }
    syncDialogs(rootContainer, dark);
  };

  const detach = (node: MacosNode): void => {
    const oldParent = node.parent;
    if (!oldParent) return;
    const idx = oldParent.children.indexOf(node);
    if (idx >= 0) oldParent.children.splice(idx, 1);
    node.parent = undefined;
    if (node.nsView?.superview) {
      node.nsView.removeFromSuperview();
    }
  };

  const host: Renderer.Host<MacosNode> = {
    createElement(tag) {
      return createMacosElementNode(tag);
    },
    createText(text) {
      return {
        kind: 'text',
        tag: '#text',
        parent: undefined,
        children: [],
        text,
        className: '',
        id: '',
        attrs: {},
        props: {},
        handlers: {},
        dispatch: undefined,
        nsView: undefined,
        nsLabel: undefined,
        nsInput: undefined,
        dialogWindow: undefined,
        layoutNode: undefined,
      };
    },
    createContainer() {
      return {
        kind: 'container',
        tag: '#container',
        parent: undefined,
        children: [],
        text: '',
        className: '',
        id: '',
        attrs: {},
        props: {},
        handlers: {},
        dispatch: undefined,
        nsView: undefined,
        nsLabel: undefined,
        nsInput: undefined,
        dialogWindow: undefined,
        layoutNode: undefined,
      };
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
        options.onTitle?.(title);
      }
    },
  };

  return {
    host,
    rootContainer,
    relayout,
    dispose: () => {
      for (const dlg of activeDialogs) {
        try {
          dlg.dialogWindow?.orderOut?.(null);
        } catch {
          // Ignore
        }
      }
      activeDialogs.clear();
    },
  };
}

function captureWindowToPng(window: any, outputPath: string): void {
  try {
    const view = window.contentView;
    const bounds = view.bounds;
    const rep = view.bitmapImageRepForCachingDisplayInRect(bounds);
    if (!rep) return;
    view.cacheDisplayInRectToBitmapImageRep(bounds, rep);
    // NSBitmapImageFileTypePNG = 4
    const pngData = rep.representationUsingTypeProperties(4, null);
    if (pngData) {
      pngData.writeToFileAtomically(outputPath, true);
    }
  } catch (err) {
    console.error('[MacosHost] capture failed:', err);
  }
}

/**
 * Launches a real native macOS AppKit desktop application rendering any shared
 * `@effect/ui` HTML component (`PulseApp`, `@effect/ui-kit`, etc.) via
 * `@nativescript/macos-node-api` with zero Xcode build required.
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
  component: Component.Members<Name, Props, Model, Msg, Events, R, V, any> & MacosRoot<V>,
  props: Props | Effect.Effect<Props, never, RP>,
  options?: MacosRunOptions<V, RF, Events, Exclude<R | RF | RP, Html.Host>>,
): Promise<void> {
  // Dynamically load `@nativescript/macos-node-api` only on macOS desktop.
  await import('@nativescript/macos-node-api');
  g('objc').import('AppKit');
  g('objc').import('QuartzCore');
  ensureAppKitClasses();

  const NSApp = g('NSApplication').sharedApplication;
  // NSApplicationActivationPolicyRegular = 0
  NSApp.setActivationPolicy(0);

  const appDelegate = AppDelegateCtor.new();
  NSApp.delegate = appDelegate;

  // Build native macOS menu bar (Cmd+Q to quit cleanly)
  const mainMenu = g('NSMenu').new();
  const appMenuItem = g('NSMenuItem').new();
  mainMenu.addItem(appMenuItem);
  const appMenu = g('NSMenu').new();
  const quitItem = g('NSMenuItem')
    .alloc()
    .initWithTitleActionKeyEquivalent(
      `Quit ${options?.title ?? 'Effect Pulse'}`,
      'quitApp:',
      'q',
    );
  quitItem.target = appDelegate;
  appMenu.addItem(quitItem);
  appMenuItem.submenu = appMenu;
  NSApp.mainMenu = mainMenu;

  const width = options?.width ?? 460;
  const height = options?.height ?? 840;

  const window = g('NSWindow')
    .alloc()
    .initWithContentRectStyleMaskBackingDefer(
      { origin: { x: 0, y: 0 }, size: { width, height } },
      1 | 2 | 4 | 8, // Titled | Closable | Miniaturizable | Resizable
      2, // NSBackingStoreBuffered
      false,
    );
  window.title = options?.title ?? 'Effect Pulse';
  window.minSize = { width: 380, height: 560 };

  // Appearance selection (defaults to clean light monochrome matching PulseApp)
  const NSAppearance = g('NSAppearance');
  if (options?.appearance === 'dark') {
    window.appearance = NSAppearance.appearanceNamed('NSAppearanceNameDarkAqua');
  } else if (options?.appearance === 'light') {
    window.appearance = NSAppearance.appearanceNamed('NSAppearanceNameAqua');
  }

  const isDark = (): boolean => {
    if (options?.appearance === 'dark') return true;
    if (options?.appearance === 'light') return false;
    const name = String(window.effectiveAppearance?.name ?? '');
    return name.toLowerCase().includes('dark');
  };

  const pal = isDark() ? darkPalette : lightPalette;
  window.backgroundColor = toNSColor(pal.background);
  window.titlebarAppearsTransparent = true;

  const scrollView = g('NSScrollView').alloc().initWithFrame({
    origin: { x: 0, y: 0 },
    size: { width, height },
  });
  scrollView.hasVerticalScroller = true;
  scrollView.autohidesScrollers = true;
  scrollView.drawsBackground = true;
  scrollView.backgroundColor = toNSColor(pal.background);
  // Autoresize width & height with window
  scrollView.autoresizingMask = 2 | 16; // NSViewWidthSizable | NSViewHeightSizable
  window.contentView = scrollView;

  let currentViewportW = width;

  const macos = makeMacosHost({
    getViewportWidth: () => currentViewportW,
    getDarkMode: isDark,
    getHostWindow: () => window,
    attachRootView: (docView, contentHeight) => {
      const h = Math.max(contentHeight, scrollView.bounds.size.height);
      docView.frame = {
        origin: { x: 0, y: 0 },
        size: { width: currentViewportW, height: h },
      };
      if (scrollView.documentView !== docView) {
        scrollView.documentView = docView;
      }
    },
    onTitle: (title) => {
      window.title = title;
    },
  });

  const winDelegate = WindowDelegateCtor.new();
  winDelegate._onResize = (w: number) => {
    if (Math.abs(w - currentViewportW) > 1) {
      currentViewportW = w;
      macos.relayout();
    }
  };
  winDelegate._onClose = () => {
    appDelegate.running = false;
    macos.dispose();
    process.exit(0);
  };
  window.delegate = winDelegate;

  // Mount the Effect UI component directly into the AppKit host!
  const mountLayer = Layer.effectDiscard(
    Effect.provideContext(
      Renderer.mount(component as any, props as any, macos.rootContainer, {
        fallback: options?.fallback as any,
        onEmit: options?.onEmit,
      }),
      Context.make(Renderer.Renderer, { host: macos.host }).pipe(
        Context.merge(makeNativeHtmlServices()),
      ),
    ),
  );

  const provided = options?.layer ? Layer.provide(mountLayer, options.layer) : mountLayer;
  Effect.runFork(Layer.launch(provided as Layer.Layer<never, never, never>));

  window.center();
  window.makeKeyAndOrderFront(null);

  // Start AppKit cooperative event pump alongside Node/Bun + Effect event loop!
  NSApp.finishLaunching();
  NSApp.activateIgnoringOtherApps(true);

  if (options?.capturePath) {
    const delay = options.captureDelayMs ?? 900;
    setTimeout(() => {
      macos.relayout();
      window.displayIfNeeded();
      captureWindowToPng(window, options.capturePath!);
      appDelegate.running = false;
      process.exit(0);
    }, delay);
  }

  const pump = () => {
    if (!appDelegate.running) return;
    let drained = 0;
    while (drained < 16) {
      const ev = NSApp.nextEventMatchingMaskUntilDateInModeDequeue(
        0xffffffffffffffffn, // NSEventMaskAny
        null,
        'kCFRunLoopDefaultMode',
        true,
      );
      if (!ev) break;
      NSApp.sendEvent(ev);
      drained += 1;
    }
    NSApp.updateWindows();
    setTimeout(pump, drained > 0 ? 4 : 16);
  };
  setTimeout(pump, 0);
}

export const MacosHost = {
  makeMacosHost,
  run,
} as const;
