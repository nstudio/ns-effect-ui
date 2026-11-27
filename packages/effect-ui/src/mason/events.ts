/**
 * NativeScript/MasonKit event bridging for Effect UI's `Renderer.Host`.
 *
 * Implements the exact `@effect/ui` event contract:
 * - Handlers are stored as data per node (`setEvents` never tears down/re-adds
 *   native listeners on re-render).
 * - Only the innermost element with a handler for an event receives it.
 * - Handlers receive plain-data payloads matching `@effect/ui/html` (`Html.Events`).
 * - `<button type="submit">` clicks inside a `<form>` trigger the form's `submit`
 *   event with collected field values (`{ fields, entries }`).
 * - Controlled inputs revert rejected edits on the next microtask.
 */
import type * as Renderer from '@effect/ui/Renderer';
import type * as View from '@effect/ui/View';
import type { View as NSView } from '@nativescript/core';
import { getTagName, isViewNode, type MasonNode } from './elements.ts';

export interface EventEntry {
  handlers: Readonly<Record<string, View.Handler<unknown, any>>>;
  options: Readonly<Record<string, View.EventOptions>>;
  dispatch: Renderer.Dispatch;
  readonly wired: Set<string>;
}

export interface TreeAccess {
  readonly parentOf: (node: MasonNode) => MasonNode | undefined;
  readonly childrenOf: (node: MasonNode) => ReadonlyArray<MasonNode>;
}

export interface EventController {
  readonly setEvents: (
    node: NSView,
    handlers: Readonly<Record<string, View.Handler<unknown, any>>>,
    dispatch: Renderer.Dispatch,
    options: Readonly<Record<string, View.EventOptions>>,
  ) => void;
  readonly wireSubmitTrigger: (node: NSView) => void;
  readonly ensureControlledListener: (node: NSView) => void;
  readonly fireDirect: (
    node: NSView,
    name: string,
    payload: unknown,
    preventDefault?: (() => void) | undefined,
  ) => boolean;
  readonly requestFormSubmit: (node: NSView) => boolean;
  readonly setSuppressing: (on: boolean) => void;
  readonly isSuppressing: () => boolean;
}

const noFiles: ReadonlyArray<never> = [];

function buildPointerPayload(event: Record<string, unknown> | undefined) {
  return {
    button: typeof event?.['button'] === 'number' ? event['button'] : 0,
    x: typeof event?.['clientX'] === 'number' ? event['clientX'] : 0,
    y: typeof event?.['clientY'] === 'number' ? event['clientY'] : 0,
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
    pointerType: 'touch' as const,
  };
}

function readInputState(node: NSView) {
  const anyNode = node as unknown as Record<string, unknown>;
  const rawValue = anyNode['value'] ?? anyNode['text'] ?? '';
  return {
    value: String(rawValue),
    checked: Boolean(anyNode['checked']),
  };
}

function buildControlPayload(node: NSView, event: Record<string, unknown> | undefined) {
  const tag = getTagName(node);
  const { value, checked } = readInputState(node);
  const eventVal =
    event && typeof event['value'] === 'string'
      ? event['value']
      : event && typeof event['data'] === 'string' && tag !== 'input'
        ? value
        : value;
  const inputType = typeof event?.['inputType'] === 'string' ? event['inputType'] : '';
  const composing = event?.['isComposing'] === true;

  if (tag === 'input') {
    return {
      value: eventVal,
      checked,
      files: noFiles,
      composing,
      inputType,
    };
  }
  return {
    value: eventVal,
    composing,
    inputType,
  };
}

function collectFormFields(
  form: MasonNode,
  tree: TreeAccess,
): { readonly fields: Record<string, string>; readonly entries: ReadonlyArray<readonly [string, string]> } {
  const fields: Record<string, string> = Object.create(null);
  const entries: Array<readonly [string, string]> = [];

  const visit = (node: MasonNode): void => {
    if (isViewNode(node)) {
      const tag = getTagName(node);
      const anyNode = node as unknown as Record<string, unknown>;
      const name = typeof anyNode['name'] === 'string' ? anyNode['name'] : '';
      const disabled = anyNode['disabled'] !== undefined || node.isEnabled === false;
      if (name && !disabled && (tag === 'input' || tag === 'textarea' || tag === 'select')) {
        const type = String(anyNode['type'] ?? 'text').toLowerCase();
        if (type === 'checkbox' || type === 'radio') {
          if (Boolean(anyNode['checked'])) {
            const val = String(anyNode['value'] || 'on');
            entries.push([name, val]);
            if (!Object.hasOwn(fields, name)) fields[name] = val;
          }
        } else {
          const val = String(anyNode['value'] ?? anyNode['text'] ?? '');
          entries.push([name, val]);
          if (!Object.hasOwn(fields, name)) fields[name] = val;
        }
      }
    }
    for (const child of tree.childrenOf(node)) {
      visit(child);
    }
  };

  visit(form);
  return { fields, entries };
}

export function createEventController(
  tree: TreeAccess,
  onControlledEdit: (node: NSView, handled: boolean) => void,
): EventController {
  const entries = new WeakMap<NSView, EventEntry>();
  const controlledWired = new WeakSet<NSView>();
  const submitWired = new WeakSet<NSView>();
  let suppressing = false;

  const isNodeDisabled = (node: NSView): boolean => {
    const anyNode = node as unknown as Record<string, unknown>;
    return anyNode['disabled'] !== undefined || node.isEnabled === false;
  };

  /**
   * Walks upward from `start` to find the innermost element with a handler for
   * `name`, honoring Effect UI's non-bubbling innermost-handler rule.
   */
  const dispatchFrom = (
    start: NSView,
    name: string,
    payload: unknown,
    preventDefault?: (() => void) | undefined,
  ): boolean => {
    let cur: MasonNode | undefined = start;
    while (cur !== undefined) {
      if (isViewNode(cur)) {
        const entry = entries.get(cur);
        const handler = entry?.handlers[name];
        if (entry && handler !== undefined) {
          if (isNodeDisabled(cur)) return false;
          const prevent = entry.options[name]?.preventDefault;
          if (prevent === 'always') preventDefault?.();
          return entry.dispatch(
            name,
            handler,
            payload,
            prevent === true ? preventDefault : undefined,
          );
        }
      }
      cur = tree.parentOf(cur);
    }
    return false;
  };

  const findEnclosingForm = (start: NSView): NSView | undefined => {
    let cur: MasonNode | undefined = start;
    while (cur !== undefined) {
      if (isViewNode(cur) && getTagName(cur) === 'form') return cur;
      cur = tree.parentOf(cur);
    }
    return undefined;
  };

  const requestFormSubmit = (node: NSView): boolean => {
    const form = getTagName(node) === 'form' ? node : findEnclosingForm(node);
    if (!form) return false;
    const payload = collectFormFields(form, tree);
    return dispatchFrom(form, 'submit', payload);
  };

  const fireDirect = (
    node: NSView,
    name: string,
    payload: unknown,
    preventDefault?: (() => void) | undefined,
  ): boolean => {
    const entry = entries.get(node);
    if (!entry) return false;
    const handler = entry.handlers[name];
    if (handler === undefined) return false;
    const prevent = entry.options[name]?.preventDefault;
    if (prevent === 'always') preventDefault?.();
    return entry.dispatch(
      name,
      handler,
      payload,
      prevent === true ? preventDefault : undefined,
    );
  };

  const ensureControlledListener = (node: NSView): void => {
    if (controlledWired.has(node)) return;
    controlledWired.add(node);

    const onInput = (event?: Record<string, unknown>) => {
      if (suppressing) return;
      const handled = dispatchFrom(node, 'input', buildControlPayload(node, event));
      onControlledEdit(node, handled);
    };

    const onChange = (event?: Record<string, unknown>) => {
      if (suppressing) return;
      const handled = dispatchFrom(node, 'change', buildControlPayload(node, event));
      onControlledEdit(node, handled);
    };

    if (typeof node.on === 'function') {
      node.on('input', onInput as never);
      node.on('change', onChange as never);
    }
  };

  const wireSubmitTrigger = (node: NSView): void => {
    if (submitWired.has(node)) return;
    if (getTagName(node) !== 'button') return;
    submitWired.add(node);

    if (typeof node.on === 'function') {
      node.on('click', (rawEvent) => {
        const event = rawEvent as unknown as Record<string, unknown> | undefined;
        if (isNodeDisabled(node)) return;
        const entry = entries.get(node);
        // Only synthesize form submit when the button is a submit button and
        // didn't already have a click handler that consumed it with preventDefault.
        const btnType = String((node as unknown as Record<string, unknown>)['type'] ?? 'submit').toLowerCase();
        if (btnType !== 'submit') return;
        let prevented = false;
        if (entry?.handlers['click'] !== undefined) {
          // Click listener itself handles dispatch; we only submit if not prevented.
          const prev = entry.options['click']?.preventDefault;
          if (prev === 'always' || prev === true) prevented = true;
        }
        if (!prevented && event?.['defaultPrevented'] !== true) {
          requestFormSubmit(node);
        }
      });
    }
  };

  const wireNativeListener = (node: NSView, entry: EventEntry, name: string): void => {
    if (entry.wired.has(name)) return;
    entry.wired.add(name);

    if (name === 'input' || name === 'change') {
      ensureControlledListener(node);
      return;
    }

    // `submit`, `cancel`, and `close` are synthetic/dialog-driven events, not
    // native gesture listeners on MasonKit views.
    if (name === 'submit' || name === 'cancel' || name === 'close') {
      return;
    }

    if (typeof node.on !== 'function') return;

    switch (name) {
      case 'click':
      case 'dblclick':
      case 'mousedown':
      case 'mouseup':
      case 'pointerdown':
      case 'pointerup':
      case 'pointercancel': {
        node.on(name, (rawEvent) => {
          const event = rawEvent as unknown as Record<string, unknown> | undefined;
          if (isNodeDisabled(node)) return;
          // Prevent MasonKit parent click listeners from double-firing once handled.
          if (typeof event?.['stopPropagation'] === 'function') {
            (event['stopPropagation'] as () => void)();
          }
          const prevent = () => {
            if (typeof event?.['preventDefault'] === 'function') {
              (event['preventDefault'] as () => void)();
            }
          };
          dispatchFrom(node, name, buildPointerPayload(event), prevent);
        });
        return;
      }
      case 'focus': {
        node.on('focus', () => {
          dispatchFrom(node, 'focus', { focusVisible: true });
        });
        return;
      }
      case 'blur': {
        node.on('blur', () => {
          dispatchFrom(node, 'blur', { disabled: isNodeDisabled(node) });
        });
        return;
      }
      case 'toggle': {
        node.on('toggle', () => {
          const open = Boolean((node as unknown as Record<string, unknown>)['open']);
          const newState = open ? 'open' : 'closed';
          const oldState = open ? 'closed' : 'open';
          dispatchFrom(node, 'toggle', { open, newState, oldState });
        });
        return;
      }
      case 'scroll': {
        node.on('scroll', () => {
          const anyNode = node as unknown as Record<string, unknown>;
          dispatchFrom(node, 'scroll', {
            top: typeof anyNode['scrollTop'] === 'number' ? anyNode['scrollTop'] : 0,
            left: typeof anyNode['scrollLeft'] === 'number' ? anyNode['scrollLeft'] : 0,
          });
        });
        return;
      }
      default: {
        node.on(name, (rawEvent) => {
          dispatchFrom(node, name, (rawEvent as unknown as Record<string, unknown>) ?? {});
        });
      }
    }
  };

  return {
    setEvents(node, handlers, dispatch, options) {
      let entry = entries.get(node);
      if (entry === undefined) {
        entry = {
          handlers,
          options,
          dispatch,
          wired: new Set(),
        };
        entries.set(node, entry);
      } else {
        entry.handlers = handlers;
        entry.options = options;
        entry.dispatch = dispatch;
      }

      for (const name in handlers) {
        wireNativeListener(node, entry, name);
      }
    },
    wireSubmitTrigger,
    ensureControlledListener,
    fireDirect,
    requestFormSubmit,
    setSuppressing(on) {
      suppressing = on;
    },
    isSuppressing() {
      return suppressing;
    },
  };
}
