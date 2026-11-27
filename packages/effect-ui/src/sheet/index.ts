/**
 * Native OS bottom sheets for `@nativescript/effect-ui` — zero plugins.
 *
 * - **iOS:** Configures real `UISheetPresentationController` (`medium` / `large`
 *   detents, native drag grabber, corner radius, interactive undimmed backdrop
 *   option, and transparent Liquid Glass passthrough on iOS 26+).
 * - **Android:** Presents a bottom-docked rounded Material sheet modal with
 *   scrim tap and hardware back dismissal.
 * - **HTML `<dialog>` integration:** `MasonHost` automatically uses this
 *   presenter whenever a `<dialog>` sets `data-presentation="sheet"`.
 */
import * as Command from '@effect/ui/Command';
import * as Component from '@effect/ui/Component';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';

export const SheetDetent = Schema.Literals(['medium', 'large']);
export type SheetDetent = typeof SheetDetent.Type;

export const SheetOptionsSchema = Schema.Struct({
  detents: Schema.optional(Schema.Array(SheetDetent)),
  grabber: Schema.optional(Schema.Boolean),
  cornerRadius: Schema.optional(Schema.Number),
  undimmedMedium: Schema.optional(Schema.Boolean),
  dismissable: Schema.optional(Schema.Boolean),
});
export type SheetOptions = typeof SheetOptionsSchema.Type;

const IOS_PAGE_SHEET = 1; // UIModalPresentationStyle.PageSheet

/**
 * Configures an already-presented NativeScript modal view as a native iOS
 * `UISheetPresentationController` (with Liquid Glass passthrough on iOS 26+).
 */
export function configureIOSSheetController(
  modalRoot: unknown,
  options?: SheetOptions | undefined,
): boolean {
  if (typeof __APPLE__ === 'undefined' || !__APPLE__) return false;
  try {
    const view = modalRoot as {
      viewController?: UIViewController;
      page?: { ios?: UIViewController; backgroundColor?: unknown };
      backgroundColor?: unknown;
    };
    const vc: UIViewController | undefined = view.viewController ?? view.page?.ios;
    if (!vc) return false;

    vc.modalPresentationStyle = IOS_PAGE_SHEET as UIModalPresentationStyle;
    const sheet =
      vc.sheetPresentationController ?? vc.parentViewController?.sheetPresentationController;
    if (!sheet) return false;

    const detentsSpec = options?.detents?.length ? options.detents : (['medium', 'large'] as const);
    const nativeDetents = NSMutableArray.array<UISheetPresentationControllerDetent>();
    for (const d of detentsSpec) {
      nativeDetents.addObject(
        d === 'medium'
          ? UISheetPresentationControllerDetent.mediumDetent()
          : UISheetPresentationControllerDetent.largeDetent(),
      );
    }
    sheet.detents = nativeDetents;
    sheet.prefersGrabberVisible = options?.grabber !== false;
    sheet.prefersScrollingExpandsWhenScrolledToEdge = true;
    sheet.preferredCornerRadius = options?.cornerRadius ?? 24;

    if (options?.undimmedMedium) {
      sheet.largestUndimmedDetentIdentifier = UISheetPresentationControllerDetentIdentifierMedium;
    }
    if (options?.dismissable === false) {
      vc.modalInPresentation = true;
    }

    // iOS 26+ Liquid Glass: clear controller background so system glass shines through.
    const majorVersion = Number.parseInt(
      String(UIDevice.currentDevice.systemVersion ?? '0').split('.')[0] ?? '0',
      10,
    );
    if (majorVersion >= 26) {
      if (vc.view) vc.view.backgroundColor = UIColor.clearColor;
      view.backgroundColor = 'transparent';
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Configures an already-presented NativeScript Android DialogFragment window as
 * a bottom-docked rounded sheet.
 */
export function configureAndroidSheetWindow(
  modalRoot: unknown,
  options?: SheetOptions | undefined,
): boolean {
  if (typeof __ANDROID__ === 'undefined' || !__ANDROID__) return false;
  try {
    const root = modalRoot as {
      _dialogFragment?: {
        getDialog?: () => android.app.Dialog | null;
      };
    };
    const dialog = root._dialogFragment?.getDialog?.();
    const win = dialog?.getWindow?.();
    if (!win) return false;

    win.setBackgroundDrawable(
      new android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT),
    );
    win.setGravity(android.view.Gravity.BOTTOM);
    win.setLayout(
      android.view.ViewGroup.LayoutParams.MATCH_PARENT,
      android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
    );

    if (options?.dismissable === false) {
      dialog?.setCancelable(false);
      dialog?.setCanceledOnTouchOutside(false);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Parses `data-detents="medium,large"` and `data-grabber` attributes from an
 * HTML `<dialog data-presentation="sheet">` element.
 */
export function parseSheetOptionsFromAttributes(
  attrs: Readonly<Record<string, string | undefined>>,
): SheetOptions {
  const rawDetents = attrs['data-detents'];
  const detents: Array<SheetDetent> = rawDetents
    ? rawDetents
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is SheetDetent => s === 'medium' || s === 'large')
    : ['medium', 'large'];

  const cornerRadius = attrs['data-corner-radius']
    ? Number.parseFloat(attrs['data-corner-radius'])
    : undefined;

  return {
    detents: detents.length > 0 ? detents : ['medium', 'large'],
    grabber: attrs['data-grabber'] !== 'false',
    cornerRadius: Number.isFinite(cornerRadius) ? cornerRadius : 24,
    undimmedMedium: attrs['data-undimmed-medium'] === 'true',
    dismissable: attrs['data-dismissable'] !== 'false',
  };
}

export interface SheetEvent {
  readonly id: string;
  readonly action: 'open' | 'close';
  readonly options?: SheetOptions | undefined;
}

export interface SheetServiceShape {
  readonly open: (id: string, options?: SheetOptions) => Effect.Effect<void>;
  readonly close: (id: string) => Effect.Effect<void>;
}

/**
 * Injectable Effect service for imperative native sheet presentation & testing.
 */
export class SheetService extends Context.Service<SheetService, SheetServiceShape>()(
  '@nativescript/effect-ui/SheetService',
) {}

export class OpenSheet extends Command.Service<OpenSheet>()('NativeSheet/Open', {
  args: {
    id: Schema.String,
    options: Schema.optional(SheetOptionsSchema),
  },
  success: Component.Noop,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const sheets = yield* SheetService;
      return ({ id, options }) =>
        sheets.open(id, options).pipe(Effect.as(Component.noop));
    }),
  );
}

export class CloseSheet extends Command.Service<CloseSheet>()('NativeSheet/Close', {
  args: { id: Schema.String },
  success: Component.Noop,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const sheets = yield* SheetService;
      return ({ id }) => sheets.close(id).pipe(Effect.as(Component.noop));
    }),
  );
}

/**
 * Deterministic in-memory `SheetService` for Node Vitest suites.
 */
export function makeTestSheetLayer(): {
  readonly layer: Layer.Layer<SheetService>;
  readonly events: Array<SheetEvent>;
  readonly openIds: Set<string>;
} {
  const events: Array<SheetEvent> = [];
  const openIds = new Set<string>();
  const layer = Layer.succeed(SheetService, {
    open: (id, options) =>
      Effect.sync(() => {
        openIds.add(id);
        events.push({ id, action: 'open', options });
      }),
    close: (id) =>
      Effect.sync(() => {
        openIds.delete(id);
        events.push({ id, action: 'close' });
      }),
  });
  return { layer, events, openIds };
}

/**
 * Presents an arbitrary NativeScript `View` inside a native OS bottom sheet
 * (`UISheetPresentationController` on iOS, bottom-docked sheet on Android).
 */
export function presentNativeSheet(
  presenter: { showModal: (view: unknown, opts: Record<string, unknown>) => void },
  contentView: unknown,
  options?: SheetOptions & { readonly onClose?: () => void },
): void {
  const root = contentView as {
    on?: (event: string, cb: () => void) => void;
    closeModal?: () => void;
  };

  const applySheetConfig = () => {
    setTimeout(() => {
      configureIOSSheetController(root, options);
      configureAndroidSheetWindow(root, options);
    }, 0);
  };

  root.on?.('loaded', applySheetConfig);
  root.on?.('showingModally', applySheetConfig);
  root.on?.('shownModally', applySheetConfig);

  presenter.showModal(root, {
    context: null,
    closeCallback: () => options?.onClose?.(),
    fullscreen: false,
    animated: true,
    cancelable: options?.dismissable !== false,
    ios: { presentationStyle: IOS_PAGE_SHEET },
  });
}

export const NativeSheet = {
  SheetDetent,
  SheetOptionsSchema,
  SheetService,
  OpenSheet,
  CloseSheet,
  configureIOSSheetController,
  configureAndroidSheetWindow,
  parseSheetOptionsFromAttributes,
  presentNativeSheet,
  makeTestSheetLayer,
} as const;
