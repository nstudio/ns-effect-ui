/**
 * Native modal dialog presentation for HTML `<dialog>` elements in `MasonHost`.
 *
 * When an Effect UI view renders `h.dialog.modal(model.open).on("cancel", ...)`,
 * `MasonHost` intercepts the controlled `open` property (`"modal"` | `true` | `false`)
 * and presents the dialog's MasonKit subtree inside a transparent NativeScript
 * fullscreen modal (`showModal`), complete with backdrop scrim tap -> `cancel`
 * event dispatch and automatic `.ns-dark` / `.ns-light` theme scope inheritance.
 */
import { Application, Frame, type View as NSView } from '@nativescript/core';
import { Div } from '@triniwiz/nativescript-masonkit';
import {
  configureAndroidSheetWindow,
  configureIOSSheetController,
  parseSheetOptionsFromAttributes,
} from '../sheet/index.js';

const IOS_OVER_FULL_SCREEN = 5;
const IOS_PAGE_SHEET = 1;

export interface DialogPresenter {
  readonly sync: (
    dialog: NSView,
    desired: 'modal' | boolean,
    callbacks: {
      readonly onCancel: () => void;
      readonly onClose: () => void;
    },
  ) => void;
  readonly dispose: (dialog: NSView) => void;
  readonly disposeAll: () => void;
}

interface ActiveModal {
  readonly root: NSView;
  readonly dialog: NSView;
  closing: boolean;
}

function clearModalWindowBackground(root: NSView): void {
  if (typeof __ANDROID__ !== 'undefined' && __ANDROID__) {
    const dialogFragment = (root as unknown as {
      _dialogFragment?: {
        getDialog?: () => { getWindow?: () => {
          setBackgroundDrawable: (d: unknown) => void;
          clearFlags: (f: number) => void;
        } };
      };
    })._dialogFragment;
    const win = dialogFragment?.getDialog?.()?.getWindow?.();
    if (win) {
      win.setBackgroundDrawable(
        new android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT),
      );
      win.clearFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND);
    }
  }
  if (typeof __APPLE__ !== 'undefined' && __APPLE__) {
    const controller = (root as unknown as { viewController?: { view: { backgroundColor: unknown } } })
      .viewController;
    if (controller) {
      controller.view.backgroundColor = UIColor.clearColor;
    }
  }
}

function currentThemeClass(): string {
  try {
    const rootView = Application.getRootView();
    if (rootView?.cssClasses?.has('ns-dark')) return 'ns-dark';
    const appearance = Application.systemAppearance?.();
    return appearance === 'dark' ? 'ns-dark' : 'ns-light';
  } catch {
    return 'ns-light';
  }
}

function findPresenter(openStack: ReadonlyArray<ActiveModal>): NSView | undefined {
  const top = openStack[openStack.length - 1];
  if (top) return top.root;
  return Frame.topmost()?.currentPage ?? Application.getRootView() ?? undefined;
}

/**
 * Creates a native `<dialog>` presenter for `MasonHost`.
 */
export function createDialogPresenter(): DialogPresenter {
  const active = new Map<NSView, ActiveModal>();
  const stack: Array<ActiveModal> = [];

  const detachFromStack = (entry: ActiveModal): void => {
    const idx = stack.indexOf(entry);
    if (idx >= 0) stack.splice(idx, 1);
  };

  const closeModal = (dialog: NSView, byHost: boolean, onClose?: () => void): void => {
    const entry = active.get(dialog);
    if (!entry || entry.closing) return;
    entry.closing = true;
    active.delete(dialog);
    detachFromStack(entry);
    try {
      entry.root.closeModal();
    } catch {
      // Already dismissed by platform.
    }
    try {
      (entry.root as unknown as { removeChild?: (child: NSView) => void }).removeChild?.(dialog);
    } catch {
      // Ignore if already detached.
    }
    if (!byHost) onClose?.();
  };

  return {
    sync(dialog, desired, { onCancel, onClose }) {
      const wantOpen = desired === 'modal' || desired === true;
      const isOpen = active.has(dialog);

      if (wantOpen === isOpen) return;

      if (!wantOpen) {
        closeModal(dialog, true);
        return;
      }

      const presenter = findPresenter(stack);
      if (!presenter || typeof presenter.showModal !== 'function') return;

      const dialogAttrs = dialog as unknown as Record<string, string | undefined>;
      const isSheet = dialogAttrs['data-presentation'] === 'sheet';
      const sheetOpts = isSheet ? parseSheetOptionsFromAttributes(dialogAttrs) : undefined;

      // Build a MasonKit modal wrapper. Standard `<dialog>` renders centered over a
      // scrim; `<dialog data-presentation="sheet">` uses native iOS
      // UISheetPresentationController (with Liquid Glass on iOS 26+) / Android bottom sheet.
      const root = new Div() as unknown as NSView;
      root.className = `${currentThemeClass()} ${isSheet ? 'ns-effect-sheet-host' : 'ns-effect-dialog-host'}`;
      const rootStyle = root.style as unknown as Record<string, unknown>;
      rootStyle['display'] = 'flex';
      rootStyle['flexDirection'] = 'column';
      rootStyle['width'] = '100%';
      rootStyle['height'] = '100%';
      if (isSheet) {
        rootStyle['alignItems'] = 'stretch';
        rootStyle['justifyContent'] = 'flex-start';
        rootStyle['padding'] = 16;
        rootStyle['backgroundColor'] = 'transparent';
      } else {
        rootStyle['alignItems'] = 'center';
        rootStyle['justifyContent'] = 'center';
        rootStyle['padding'] = 20;
        rootStyle['backgroundColor'] = 'rgba(0, 0, 0, 0.52)';
      }

      // Consume taps on the dialog card itself so they don't bubble to the backdrop.
      dialog.on('click', (event) => {
        const ev = event as unknown as Record<string, unknown> | undefined;
        if (typeof ev?.['stopPropagation'] === 'function') {
          (ev['stopPropagation'] as () => void)();
        }
      });

      if (!isSheet) {
        root.on('click', () => {
          onCancel();
        });
      }

      root.on('activityBackPressed', (args) => {
        (args as unknown as { cancel?: boolean }).cancel = true;
        onCancel();
      });

      (root as unknown as { addChild: (child: NSView) => void }).addChild(dialog);

      const entry: ActiveModal = { root, dialog, closing: false };
      active.set(dialog, entry);
      stack.push(entry);

      const applyPresentation = () => {
        if (isSheet) {
          setTimeout(() => {
            configureIOSSheetController(root, sheetOpts);
            configureAndroidSheetWindow(root, sheetOpts);
          }, 0);
        } else {
          clearModalWindowBackground(root);
        }
      };

      root.on('showingModally', applyPresentation);
      root.on('shownModally', applyPresentation);

      presenter.showModal(root, {
        context: null,
        closeCallback: () => {
          if (!entry.closing) {
            entry.closing = true;
            active.delete(dialog);
            detachFromStack(entry);
            try {
              (root as unknown as { removeChild?: (child: NSView) => void }).removeChild?.(dialog);
            } catch {
              // Ignore if already detached.
            }
            onClose();
          }
        },
        fullscreen: !isSheet,
        animated: true,
        cancelable: isSheet ? sheetOpts?.dismissable !== false : false,
        ios: { presentationStyle: isSheet ? IOS_PAGE_SHEET : IOS_OVER_FULL_SCREEN },
      });
    },

    dispose(dialog) {
      closeModal(dialog, true);
    },

    disposeAll() {
      for (const dialog of [...active.keys()]) {
        closeModal(dialog, true);
      }
    },
  };
}
