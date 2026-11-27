/**
 * Crash recovery boundary (`NativeCrash`) for `@nativescript/effect-ui`.
 *
 * Provides:
 * - Clean `CrashReport` extraction from Effect `Cause`, `AsyncResult.Failure`,
 *   or raw JS exceptions.
 * - Drop-in `fallback` view factories for both `MasonHost` (`Html`) and
 *   `NativeHost` (`Native`) with one-tap diagnostics copy and instant restart.
 * - Optional hook into NativeScript's `Application.uncaughtErrorEvent` so an
 *   unexpected runtime error surfaces a recovery UI rather than a blank screen.
 */
import * as Cause from 'effect/Cause';
import * as Schema from 'effect/Schema';

export const CrashReport = Schema.Struct({
  title: Schema.String,
  message: Schema.String,
  stack: Schema.String,
  componentName: Schema.String,
  timestamp: Schema.String,
});
export type CrashReport = typeof CrashReport.Type;

function extractErrorDetails(failure: unknown): { readonly message: string; readonly stack: string } {
  if (failure && typeof failure === 'object') {
    // Handle Effect AsyncResult.Failure ({ _tag: "Failure", cause })
    const asFailure = failure as { readonly _tag?: string; readonly cause?: unknown };
    if (asFailure._tag === 'Failure' && asFailure.cause !== undefined) {
      try {
        const pretty = Cause.pretty(asFailure.cause as Cause.Cause<unknown>);
        const lines = pretty.split('\n');
        return {
          message: lines[0] || 'Unhandled Effect failure',
          stack: pretty,
        };
      } catch {
        // Fall through
      }
    }
    if (failure instanceof Error) {
      return {
        message: failure.message || failure.name || 'Unexpected error',
        stack: failure.stack ?? String(failure),
      };
    }
    const maybeMsg = (failure as { readonly message?: unknown }).message;
    if (typeof maybeMsg === 'string') {
      return {
        message: maybeMsg,
        stack: String((failure as { readonly stack?: unknown }).stack ?? maybeMsg),
      };
    }
  }
  const text = String(failure ?? 'Unknown error');
  return { message: text, stack: text };
}

/**
 * Builds a structured `CrashReport` from any Effect `AsyncResult.Failure`,
 * `Cause`, or JS error value.
 */
export function buildCrashReport(
  failure: unknown,
  componentName = 'EffectUIApp',
  now: () => Date = () => new Date(),
): CrashReport {
  const { message, stack } = extractErrorDetails(failure);
  return {
    title: `${componentName} encountered an error`,
    message,
    stack,
    componentName,
    timestamp: now().toISOString(),
  };
}

/**
 * Formats a `CrashReport` into a plain-text diagnostic block suitable for
 * copying to the system clipboard or pasting into an issue tracker.
 */
export function formatCrashText(report: CrashReport): string {
  return [
    `[${report.componentName}] ${report.title}`,
    `Time: ${report.timestamp}`,
    `Message: ${report.message}`,
    '',
    'Stack / Cause:',
    report.stack,
  ].join('\n');
}

export interface CrashFallbackOptions {
  readonly componentName?: string | undefined;
  readonly onCopy?: ((text: string) => void) | undefined;
  readonly onRestart?: (() => void) | undefined;
}

/**
 * Drop-in `fallback` renderer for `MasonHost.mount(...)` / `BrowserHost.mount(...)`.
 *
 * Renders a high-contrast recovery card with diagnostic details, Copy button,
 * and Start Again button using standard HTML elements.
 */
export function makeHtmlCrashFallback(options?: CrashFallbackOptions | undefined) {
  return (failure: unknown, h: any): any => {
    const report = buildCrashReport(failure, options?.componentName ?? 'EffectUIApp');
    const text = formatCrashText(report);

    return h.section
      .class('flex flex-col gap-3 p-4 rounded-xl')
      .style({
        backgroundColor: '#1b1414',
        borderColor: '#ef4444',
        borderWidth: '1px',
        color: '#fef2f2',
      })
      .children(
        h.h2.style({ fontSize: '18px', fontWeight: '700', color: '#fca5a5' }).children(report.title),
        h.p.style({ fontSize: '14px', color: '#fee2e2' }).children(report.message),
        h.pre
          .style({
            fontSize: '11px',
            color: '#e5e7eb',
            backgroundColor: '#0f0c0c',
            padding: '10px',
            borderRadius: '8px',
          })
          .children(report.stack.slice(0, 600)),
        h.div.class('flex flex-row gap-2').children(
          h.button
            .attr('id', 'crash-copy-btn')
            .style({
              backgroundColor: '#27272a',
              color: '#ffffff',
              padding: '10px 14px',
              borderRadius: '8px',
              fontWeight: '600',
            })
            .prop('__onNativeAction', () => {
              options?.onCopy?.(text);
            })
            .children('Copy Diagnostics'),
          h.button
            .attr('id', 'crash-restart-btn')
            .style({
              backgroundColor: '#dc2626',
              color: '#ffffff',
              padding: '10px 14px',
              borderRadius: '8px',
              fontWeight: '600',
            })
            .prop('__onNativeAction', () => {
              options?.onRestart?.();
            })
            .children('Start Again'),
        ),
      );
  };
}

/**
 * Drop-in `fallback` renderer for `NativeHost.mount(...)` (Strategy A).
 */
export function makeNativeCrashFallback(options?: CrashFallbackOptions | undefined) {
  return (failure: unknown, h: any): any => {
    const report = buildCrashReport(failure, options?.componentName ?? 'NativeEffectApp');
    const text = formatCrashText(report);

    return h.stackLayout
      .style({
        padding: 20,
        margin: 16,
        borderRadius: 16,
        backgroundColor: '#1b1414',
        borderColor: '#ef4444',
        borderWidth: 1,
      })
      .children(
        h.label
          .text(report.title)
          .textWrap(true)
          .style({ fontSize: 18, fontWeight: '700', color: '#fca5a5', marginBottom: 8 }),
        h.label
          .text(report.message)
          .textWrap(true)
          .style({ fontSize: 14, color: '#fee2e2', marginBottom: 12 }),
        h.label
          .text(report.stack.slice(0, 400))
          .textWrap(true)
          .style({
            fontSize: 11,
            color: '#d4d4d8',
            backgroundColor: '#0f0c0c',
            padding: 10,
            borderRadius: 8,
            marginBottom: 14,
          }),
        h.button
          .text('Copy Diagnostics')
          .style({
            backgroundColor: '#27272a',
            color: '#ffffff',
            borderRadius: 10,
            padding: 12,
            marginBottom: 8,
          })
          .prop('__onNativeAction', () => {
            options?.onCopy?.(text);
          }),
        h.button
          .text('Start Again')
          .style({
            backgroundColor: '#dc2626',
            color: '#ffffff',
            borderRadius: 10,
            padding: 12,
          })
          .prop('__onNativeAction', () => {
            options?.onRestart?.();
          }),
      );
  };
}

export const NativeCrash = {
  CrashReport,
  buildCrashReport,
  formatCrashText,
  makeHtmlCrashFallback,
  makeNativeCrashFallback,
} as const;
