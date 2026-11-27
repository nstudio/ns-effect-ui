/**
 * Native Windows Desktop demo running the exact same `PulseApp` component
 * (`packages/shared-app/src/components/App.ts`) on native Windows views via
 * `@nstudio/nativescript-effect-ui/windows` (`@nativescript/windows` WinUI 3
 * or `@nativescript/windows-napi` XAML Islands / WinRT Composition) with zero
 * WebViews and zero Electron.
 *
 * Run on Windows with: `pnpm windows` (Bun) or `pnpm --filter @ns-effect-ui/windows start:node`
 * Or run the full MasonKit WinUI 3 app with: `ns run windows` (from `apps/native`)
 */
import { WindowsHost, WindowsPlatformLayer } from '@nstudio/nativescript-effect-ui/windows';
import { PulseApp, SharedDomainLayer } from '@ns-effect-ui/shared';
import * as Layer from 'effect/Layer';

const AppLayer = SharedDomainLayer.pipe(Layer.provideMerge(WindowsPlatformLayer));

const darkArg = process.argv.includes('--dark');
const closeArg = process.argv.find((a) => a.startsWith('--auto-close='));
const autoCloseMs = closeArg ? Number(closeArg.slice('--auto-close='.length)) : undefined;

await WindowsHost.run(PulseApp, {}, {
  title: 'Effect Pulse',
  width: 460,
  height: 820,
  appearance: darkArg ? 'dark' : 'light',
  layer: AppLayer,
  autoCloseMs: autoCloseMs && !Number.isNaN(autoCloseMs) ? autoCloseMs : undefined,
});
