/**
 * Native Linux GTK4 Desktop demo running the exact same `PulseApp` component
 * (`packages/shared-app/src/components/App.ts`) on real GTK4 widgets via
 * `@nstudio/nativescript-effect-ui/linux` (`@nativescript/linux` or
 * `@nativescript/linux-napi`) with zero WebViews and zero Electron.
 *
 * Run on Linux with: `pnpm linux` (Bun) or `pnpm --filter @ns-effect-ui/linux start:node`
 * Or run the full MasonKit GTK4 app with: `ns run linux` (from `apps/native`)
 */
import { LinuxHost, LinuxPlatformLayer } from '@nstudio/nativescript-effect-ui/linux';
import { PulseApp, SharedDomainLayer } from '@ns-effect-ui/shared';
import * as Layer from 'effect/Layer';

const AppLayer = SharedDomainLayer.pipe(Layer.provideMerge(LinuxPlatformLayer));

const darkArg = process.argv.includes('--dark');
const closeArg = process.argv.find((a) => a.startsWith('--auto-close='));
const autoCloseMs = closeArg ? Number(closeArg.slice('--auto-close='.length)) : undefined;

await LinuxHost.run(PulseApp, {}, {
  title: 'Effect Pulse',
  width: 460,
  height: 820,
  appearance: darkArg ? 'dark' : 'light',
  layer: AppLayer,
  autoCloseMs: autoCloseMs && !Number.isNaN(autoCloseMs) ? autoCloseMs : undefined,
});
