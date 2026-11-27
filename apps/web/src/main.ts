import './main.css';
import { BrowserHost } from '@effect/ui/html';
import { WebPlatformLayer } from '@nstudio/nativescript-effect-ui/platform';
import { PulseApp, SharedDomainLayer } from '@ns-effect-ui/shared';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

const AppLayer = SharedDomainLayer.pipe(Layer.provideMerge(WebPlatformLayer));

const Main = BrowserHost.mount(
  PulseApp,
  {},
  document.getElementById('app')!,
).pipe(Layer.provide(AppLayer));

Effect.runFork(Layer.launch(Main));
