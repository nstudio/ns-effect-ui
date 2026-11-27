/**
 * Native macOS Desktop demo running the EXACT SAME `PulseApp` component
 * (`packages/shared-app/src/components/App.ts`) on real AppKit views via
 * `@nstudio/nativescript-effect-ui/macos` and `@nativescript/macos-node-api`
 * with zero WebViews, zero Electron, and zero Xcode build step.
 *
 * Run with: `pnpm macos`
 * Capture screenshot: `pnpm macos -- --capture=/path/to/macos.png`
 */
import { MacosHost, MacosPlatformLayer } from '@nstudio/nativescript-effect-ui/macos';
import { PulseApp, SharedDomainLayer } from '@ns-effect-ui/shared';
import * as Layer from 'effect/Layer';

const AppLayer = SharedDomainLayer.pipe(Layer.provideMerge(MacosPlatformLayer));

const captureArg = process.argv.find((a) => a.startsWith('--capture='));
const capturePath = captureArg ? captureArg.slice('--capture='.length) : undefined;
const darkArg = process.argv.includes('--dark');

await MacosHost.run(PulseApp, {}, {
  title: 'Effect Pulse',
  width: 460,
  height: 820,
  appearance: darkArg ? 'dark' : 'light',
  layer: AppLayer,
  capturePath,
  captureDelayMs: 900,
});
