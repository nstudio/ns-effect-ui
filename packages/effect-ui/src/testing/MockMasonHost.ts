/**
 * In-memory mock NativeScript/MasonKit view & dialog presenter for testing
 * `MasonHost` in Node (Vitest) without an iOS/Android runtime.
 */
import type { View as NSView } from '@nativescript/core';
import type { DialogPresenter } from '../mason/dialog.ts';
import { setTagName } from '../mason/elements.ts';

type Listener = (event?: Record<string, unknown>) => void;

export interface MockMasonView {
  readonly tag: string;
  readonly cssType: string;
  readonly nativeChildren: Array<unknown>;
  readonly style: Record<string, unknown>;
  readonly pseudoClasses: Set<string>;
  readonly listeners: Map<string, Array<Listener>>;
  className: string;
  id: string;
  visibility: string;
  isEnabled: boolean;
  value: string;
  checked: boolean;
  open: boolean;
  placeholder: string;
  type: string;
  name: string;
  cssStateChanges: number;
  insertBefore: (child: unknown, ref: unknown) => void;
  addChild: (child: unknown) => void;
  removeChild: (child: unknown) => void;
  on: (event: string, listener: Listener) => void;
  off: (event: string, listener: Listener) => void;
  emit: (event: string, payload?: Record<string, unknown>) => void;
  addSinglePseudoClass: (name: string) => void;
  deleteSinglePseudoClass: (name: string) => void;
  _onCssStateChange: () => void;
  [key: string]: unknown;
}

export function createMockMasonView(tag: string): MockMasonView {
  const lower = tag.toLowerCase();
  const nativeChildren: Array<unknown> = [];
  const listeners = new Map<string, Array<Listener>>();
  const pseudoClasses = new Set<string>();

  const view: MockMasonView = {
    tag: lower,
    cssType: lower,
    nativeChildren,
    style: {},
    pseudoClasses,
    listeners,
    className: '',
    id: '',
    visibility: 'visible',
    isEnabled: true,
    value: '',
    checked: false,
    open: false,
    placeholder: '',
    type: lower === 'button' ? 'submit' : 'text',
    name: '',
    cssStateChanges: 0,

    insertBefore(child, ref) {
      const existing = nativeChildren.indexOf(child);
      if (existing >= 0) nativeChildren.splice(existing, 1);
      if (ref == null) {
        nativeChildren.push(child);
      } else {
        const idx = nativeChildren.indexOf(ref);
        if (idx < 0) nativeChildren.push(child);
        else nativeChildren.splice(idx, 0, child);
      }
    },

    addChild(child) {
      const existing = nativeChildren.indexOf(child);
      if (existing >= 0) nativeChildren.splice(existing, 1);
      nativeChildren.push(child);
    },

    removeChild(child) {
      const idx = nativeChildren.indexOf(child);
      if (idx >= 0) nativeChildren.splice(idx, 1);
    },

    on(event, listener) {
      let list = listeners.get(event);
      if (!list) {
        list = [];
        listeners.set(event, list);
      }
      list.push(listener);
    },

    off(event, listener) {
      const list = listeners.get(event);
      if (!list) return;
      const idx = list.indexOf(listener);
      if (idx >= 0) list.splice(idx, 1);
    },

    emit(event, payload) {
      const list = listeners.get(event);
      if (!list) return;
      for (const fn of [...list]) {
        fn(payload);
      }
    },

    addSinglePseudoClass(name) {
      pseudoClasses.add(name);
    },

    deleteSinglePseudoClass(name) {
      pseudoClasses.delete(name);
    },

    _onCssStateChange() {
      view.cssStateChanges++;
    },
  };

  setTagName(view as unknown as NSView, lower);
  return view;
}

export interface MockDialogRecord {
  readonly dialog: MockMasonView;
  readonly mode: 'modal' | boolean;
  readonly onCancel: () => void;
  readonly onClose: () => void;
}

export function createMockDialogPresenter(): {
  readonly presenter: DialogPresenter;
  readonly openDialogs: Map<MockMasonView, MockDialogRecord>;
} {
  const openDialogs = new Map<MockMasonView, MockDialogRecord>();

  const presenter: DialogPresenter = {
    sync(dialog, desired, callbacks) {
      const mock = dialog as unknown as MockMasonView;
      const wantOpen = desired === 'modal' || desired === true;
      if (wantOpen) {
        openDialogs.set(mock, {
          dialog: mock,
          mode: desired,
          onCancel: callbacks.onCancel,
          onClose: callbacks.onClose,
        });
      } else {
        openDialogs.delete(mock);
      }
    },
    dispose(dialog) {
      openDialogs.delete(dialog as unknown as MockMasonView);
    },
    disposeAll() {
      openDialogs.clear();
    },
  };

  return { presenter, openDialogs };
}

/** Collects visible text from a MockMasonView subtree for assertions. */
export function textContentOf(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as Record<string, unknown>;
  if (n['nodeType'] === 3) return String(n['data'] ?? '');
  const children = Array.isArray(n['nativeChildren']) ? n['nativeChildren'] : [];
  return children.map(textContentOf).join('');
}

/** Depth-first query helper over a MockMasonView subtree. */
export function findViews(
  root: MockMasonView,
  predicate: (view: MockMasonView) => boolean,
): Array<MockMasonView> {
  const out: Array<MockMasonView> = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const v = node as MockMasonView;
    if (typeof v.tag === 'string') {
      if (predicate(v)) out.push(v);
      for (const child of v.nativeChildren) visit(child);
    }
  };
  visit(root);
  return out;
}
